# Phase 4A, 4B & 4C Walkthrough: Engine Hardening, Spec Sync & Interactive Tablet HUD Overlays

> **Verification Status:** **Phase 4A (Engine Hardening & Spec Sync)**, **Phase 4B (Interactive Tablet HUD Overlays)**, and **Phase 4C (Critical Review Remediation)** are implemented and verified with **0 TypeScript errors** (`npm run typecheck`), **64/64 passing headless tests** (`npm run test:headless`), and a clean production bundle (`npm run build`).

---

## 1. Phase 4A: Spatial Engine & Command Hardening + Spec Sync

### 1.1 `BrowserSqlEngine` Spatial Index & Zero-Copy Transaction Snapshots
- **Giant-Node Interior Query Fix:** Updated `SpatialGridIndex.insert` in [`src/db/browser_sql_engine.ts`](../src/db/browser_sql_engine.ts) to track nodes spanning `> 256` grid cells (`> 4,096px`) in an `oversizedRowIds` set and include them in `SpatialGridIndex.queryCandidateRowIds`, eliminating the interior viewport blind spot for large frames/diagrams.
- **$O(|matchingRowIds|)$ Secondary Index Lookup:** Added `spatialNodesByRowId: Map<number, SpatialNodeRowState>` in `BrowserSqlEngine` so R-Tree candidate filtering resolves directly by `rowid` instead of scanning `spatialNodes.values()`.
- **Zero-Copy `Uint8Array` Snapshots:** Updated `BrowserSqlEngine.pushSnapshot` to copy immutable `stroke_points` / `embedding` `Uint8Array` references rather than allocating new typed arrays on every transaction/savepoint, and eliminated empty-space transaction allocations in `SliceEraseCommand.execute` ([`src/core/commands/slice_erase_command.ts`](../src/core/commands/slice_erase_command.ts)) by pre-evaluating R-Tree intersections before opening `this.db.transaction(...)`.

### 1.2 Duplicate AI Badge Prevention & Cluster Disconnection Partitioning
- **Job Superseding on Incremental Merge:** Updated `Tier0StrokeClusterer.clusterLayerNow` in [`src/ai/tier0_clustering/stroke_clusterer.ts`](../src/ai/tier0_clustering/stroke_clusterer.ts) to cancel prior jobs anchored to `[targetClusterId, ...obsoleteClusterIds]` when cluster membership changes before enqueuing a fresh `verify_claim` badge job.
- **Cluster Disconnection Partitioning on Undo/Erase:** Upgraded `SpatialNodeRepository.pruneOrUpdateParentClusters` in [`src/db/repositories/spatial_node_repository.ts`](../src/db/repositories/spatial_node_repository.ts) and `CommitStrokeCommand` in [`src/core/commands/canvas_command.ts`](../src/core/commands/canvas_command.ts) so undoing or erasing a bridging stroke partitions disconnected stroke components (`> 48px` apart) back into separate `stroke_cluster` nodes with full Undo/Redo symmetry.

### 1.3 Teaching Mode Badge Filtering & `docs/SPEC.md` Synchronization
- **Layer-Aware Badge Filtering:** Updated `CanvasStore.buildSceneFrame` in [`src/state/canvas_store.ts`](../src/state/canvas_store.ts) so AI status badges are hidden whenever `ai_feedback` is hidden (`isTeachingMode === true`) or when their anchor node's layer is hidden.
- **Canonical Spec Sync:** Updated [`docs/SPEC.md`](./SPEC.md) §5.5 and §6 to match the canonical `CreateZettelCardToolSchema`, `UpdateJobBadgeToolSchema` ([`src/ai/agent_contract.ts`](../src/ai/agent_contract.ts)), and [`src/db/schema.sql`](../src/db/schema.sql).

---

## 2. Phase 4B: Interactive Tablet HUD Overlays

- **Floating 6-Slot Radial Tool Wheel:**
  - Added `TabletPointerBridge.holdAnchor` in [`src/ui/scene_graph/pointer_bridge.ts`](../src/ui/scene_graph/pointer_bridge.ts) to capture the 1-finger stationary hold coordinates on `TOUCH_HOLD_MODIFIER`.
  - Added `#radial-wheel-overlay` in [`src/ui/tablet_app.ts`](../src/ui/tablet_app.ts) and [`index.html`](../index.html), rendering 6 radial tool slices centered at `bridge.holdAnchor` while a 1-finger modifier hold is active.
- **AI Status Badge Hit-Testing & Inspection Popover:**
  - Added `CanvasStore.hitTestBadgeAtScreenPoint` in [`src/state/canvas_store.ts`](../src/state/canvas_store.ts).
  - Added `NoteFlowTabletApp.openBadgePopoverAtScreenPoint` and `NoteFlowTabletApp.synthesizeZettelFromInspectedBadge` in [`src/ui/tablet_app.ts`](../src/ui/tablet_app.ts) to inspect verified/conflict/hint badges and spawn an undoable linked Zettel card via `CreateZettelCardCommand` ([`src/core/commands/zettel_commands.ts`](../src/core/commands/zettel_commands.ts)).

---

## 3. Phase 4C: Remediation of 6 Critical Review Findings

1. **Split-Cluster Undo Symmetry in `EraseNodesCommand` & `SliceEraseCommand`:**
   - Updated [`EraseNodesCommand`](../src/core/commands/canvas_command.ts) and [`SliceEraseCommand`](../src/core/commands/slice_erase_command.ts) to snapshot unaffected sibling strokes of `affectedClusterIds` prior to `pruneOrUpdateParentClusters`, record newly created `splitClusterIdsCreated`, merge them across continuous eraser drags (`tryMergeWith`), and delete `splitClusterIdsCreated` + restore sibling `parentClusterId`s on `undo()`.
2. **Canonical Anisotropic Proximity Predicate & Child-Stroke AABB Verification:**
   - Exported `areStrokeBoxesProximate(a, b, maxGapX = 48, maxGapY = 24)` in [`src/core/canvas/math.ts`](../src/core/canvas/math.ts) and unified both [`Tier0StrokeClusterer`](../src/ai/tier0_clustering/stroke_clusterer.ts) and [`SpatialNodeRepository.pruneOrUpdateParentClusters`](../src/db/repositories/spatial_node_repository.ts) to use the exact same anisotropic thresholds.
   - Updated `Tier0StrokeClusterer.clusterLayerNow()` to verify proximity against at least one constituent child stroke of an `existingCluster` so L-shaped or multi-line clusters never falsely absorb strokes in empty corners of their coarse AABB.
3. **Single-Hand & Bimanual Radial Tool Wheel Interaction:**
   - Added `hitTestRadialWheelSlice(anchor, cursor)` in [`src/ui/tablet_app.ts`](../src/ui/tablet_app.ts) supporting both **Hold-Slide-Release** marking-menu selection and **Stationary Hold-Release** sticky wheel summoning (`pinnedRadialAnchor`).
4. **Badge Tap-on-Release Disambiguation & Idempotent Zettel Synthesis:**
   - Updated `NoteFlowTabletApp.bindPointerEvents` in [`src/ui/tablet_app.ts`](../src/ui/tablet_app.ts) so badge inspection triggers on stationary `pointerup` ($\le 8\text{px}$ slop) rather than swallowing `pointerdown`, allowing pen strokes and 1-finger pans starting near a badge to proceed without interruption.
   - Added `synthesizeZettelForBadge` in [`src/ui/tablet_app.ts`](../src/ui/tablet_app.ts), recording `linkedZettelId` in the badge's `resultJson` to prevent duplicate Zettel cards when clicked repeatedly.
5. **Redo AI Badge Restoration & Zero N+1 Badge Layer Filtering:**
   - Added `n.layer_id AS anchor_layer_id` to [`AsyncJobRepository`](../src/db/repositories/async_job_repository.ts) and [`BrowserSqlEngine`](../src/db/browser_sql_engine.ts), allowing `CanvasStore.buildSceneFrame()` to filter badges in $O(1)$ without per-badge `nodeRepo.getById` queries.
   - Wired `onRedoCommand` in [`CommandHistory`](../src/core/commands/canvas_command.ts) and [`CanvasStore`](../src/state/canvas_store.ts) so redoing an undone Violet stroke restores its AI verification badge.

---

## 4. Verification Summary

- `npm run typecheck` — **0 errors**
- `npm run test:headless` — **13 test suites, 64/64 tests passed** (including regression suites `Phase 4A.1–4A.3`, `Phase 4B`, and `Phase 4C.1–4C.4` in [`tests/headless/code_review_violations.test.ts`](../tests/headless/code_review_violations.test.ts)).
- `npm run build` — **Clean production bundle in `dist/`**
