# Phase 5 Implementation Plan: Galaxy Tab S-Pen Readiness, IndexedDB Persistence & Android `.apk` Pipeline

## 1. Architectural Decisions Locked In (`/grill-me` Summary)

1. **Android `.apk` Packaging via Capacitor + GitHub Actions CI (`0 GB` Local Toolchain):**
   - Add `@capacitor/core`, `@capacitor/cli`, and `@capacitor/android` configured for landscape tablet full-screen (`com.noteflow.tablet`, `NoteFlow`).
   - Add `.github/workflows/build-android-apk.yml` (using `ubuntu-latest` with pre-installed JDK 21 + Android SDK) to run `npm run verify:gate`, `npm run build`, `npx cap sync android`, and `./gradlew assembleDebug`, publishing `noteflow-galaxy-tab-debug.apk` as a downloadable GitHub Actions Artifact on every push.
2. **Samsung Galaxy Tab (Wacom EMR) Bimanual Gesture Resilience:**
   - **Mid-Lasso Touch Release/Cancel Survival (`gesture_fsm.ts` + `pointer_bridge.ts`):** When in `TOUCH_HOLD_PEN_LASSOING`, if the non-dominant thumb lifts (`TOUCH_END`) or is cancelled by Android Wacom EMR palm rejection (`TOUCH_CANCEL`) while the S-Pen is still down on the glass, the gesture remains in `TOUCH_HOLD_PEN_LASSOING` until `PEN_UP` (at which point it commits the lasso selection and transitions to `IDLE` if `activeTouches.size === 0`).
   - **400ms Wacom Hover `pointercancel` Grace Window (`pointer_bridge.ts`):** When in `TOUCH_HOLD_MODIFIER` and Android dispatches `pointercancel` on the thumb because the S-Pen entered the ~15mm Wacom hover field, `TabletPointerBridge` retains a `400ms` modifier grace window (`wacomModifierGraceUntil`). If `PEN_DOWN` arrives within `400ms`, it transitions into `TOUCH_HOLD_PEN_LASSOING` instead of normal drawing.
   - **No S-Pen Barrel Button Mapping Yet:** Keep S-Pen side button unmapped for this slice.
3. **2-Finger Camera Rotation with Default HUD Lock (`rotationLocked = true`):**
   - Add `rotationLocked: boolean = true` and `setRotationLocked(locked: boolean)` to `CanvasStore`.
   - In `TabletPointerBridge.handlePointerMove` (`TOUCH_PINCH_ZOOMING`), track `lastPinchAngle` (`Math.atan2(p1.y - p0.y, p1.x - p0.x)`). When `!this.store.rotationLocked`, apply angle deltas via `this.store.rotateCamera(this.store.camera.rotationRad + deltaAngle)` (which uses `rotateCameraWithSnap` for `±5°` cardinal snapping).
   - Add a HUD toggle button (`#btn-rotation-lock`: `🔒 Rotate: OFF` / `🔓 Rotate: ON`) in `NoteFlowTabletApp`.
4. **Track 2: Synchronous `BrowserSqlEngine` + Debounced `IndexedDB` Write-Behind Persistence:**
   - **Why IndexedDB for Android APK:** Works natively in Android WebView without `SharedArrayBuffer` / COOP+COEP header restrictions while preserving 0ms synchronous `requestAnimationFrame` reads in `BrowserSqlEngine`.
   - **Zod-Validated Snapshot Serialization (`src/db/browser_sql_engine.ts`):**
     - Add `BrowserSqlSnapshotSchema` (validating serialized `canvases`, `layers`, `spatialNodes`, `aiJobs`, `zettelCards`, `zettelLinks`, and auto-increment counters, converting `Float32Array` blobs to base64 or `number[]` for structured cloning).
     - Add `exportSnapshot(): BrowserSqlSnapshot` and `importSnapshot(raw: unknown): void` on `BrowserSqlEngine`.
   - **Debounced IndexedDB Adapter (`src/db/indexeddb_persistence.ts`):**
     - `IndexedDbVaultStorage` stores the snapshot in IndexedDB database `noteflow_vault_v1`, object store `snapshots`, key `active_vault`.
     - Provides `loadSnapshot()`, `scheduleSave(engine)` (debounced at `250ms`), `saveImmediate(engine)` (triggered on `visibilitychange` / `pagehide` when switching apps on Android), and `clearVault()`.
   - **HUD Reset Action (`src/ui/tablet_app.ts`):**
     - Add a `🗑️ Reset Vault` button in the right dock / top bar to clear IndexedDB and re-seed the initial demo state cleanly.

---

## 2. Exact File Modifications & New Files

| File | Action | Purpose |
| :--- | :--- | :--- |
| `src/state/gesture_fsm.ts` | **Modify** | Keep `TOUCH_HOLD_PEN_LASSOING` active if `TOUCH_CANCEL` or `TOUCH_END` fires mid-lasso; track or resolve back to `IDLE` on `PEN_UP` when no touches remain. |
| `src/ui/scene_graph/pointer_bridge.ts` | **Modify** | Add `400ms` Wacom hover `pointercancel` grace window for `TOUCH_HOLD_MODIFIER -> TOUCH_HOLD_PEN_LASSOING`; wire `lastPinchAngle` 2-finger rotation gated by `!this.store.rotationLocked`. |
| `src/state/canvas_store.ts` | **Modify** | Add `rotationLocked` boolean (`true` by default) and `setRotationLocked(locked: boolean)`. |
| `src/db/browser_sql_engine.ts` | **Modify** | Add `BrowserSqlSnapshotSchema`, `exportSnapshot()`, `importSnapshot(raw)`, and `onMutation` callback hook for write-behind persistence. |
| `src/db/indexeddb_persistence.ts` | **New** | Debounced (`250ms`) IndexedDB persistence manager + `visibilitychange` flush for Android WebView lifecycle. |
| `src/ui/tablet_app.ts` | **Modify** | Add `#btn-rotation-lock` toggle, `#btn-reset-vault` button, and async IndexedDB hydration helper (`hydrateOrSeedTabletApp`). |
| `src/main.ts` | **Modify** | Hydrate `BrowserSqlEngine` from `IndexedDbVaultStorage` before constructing `NoteFlowTabletApp` and attach debounced write-behind listener. |
| `tests/headless/phase5_galaxy_tab_and_persistence.test.ts` | **New** | Headless TDD suite verifying: (1) Wacom `pointercancel` 400ms grace window, (2) mid-lasso touch release survival, (3) 2-finger pinch rotation locked vs. unlocked, and (4) `BrowserSqlEngine` snapshot round-trip (`exportSnapshot` -> `importSnapshot`) preserving strokes, clusters, badges, and Zettel cards. |
| `capacitor.config.json` & `.github/workflows/build-android-apk.yml` | **New** | Capacitor Android configuration and automated GitHub Actions APK build workflow. |

---

## 3. Verification Gate
1. `npm run verify:gate` must return `{"status":"PASS","typecheck":"OK","invariants":"OK",...}` with 0 errors.
2. `npm run build` must succeed cleanly.
3. Pushing to `origin/main` triggers `.github/workflows/build-android-apk.yml` to produce `noteflow-galaxy-tab-debug.apk`.
