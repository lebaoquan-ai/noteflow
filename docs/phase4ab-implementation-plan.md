# Phase 4A & 4B Implementation Plan: Post-Review Hardening, Spec Sync & Interactive Tablet HUD Overlays

## Goal Description
Following the initial fixes for Violations A–E in `tests/headless/code_review_violations.test.ts` and the architectural decisions documented in [`docs/progress-update-1.md`](./progress-update-1.md) (§8), a second-pass technical audit identified **6 subtle runtime/correctness edge cases** introduced or exposed by the new clustering and SQL engine implementations.

This plan resolves those 6 edge cases (**Phase 4A**) and delivers **Track 1 of the Collaboration Roadmap** (**Phase 4B**: Floating Radial Tool Wheel at the 1-finger hold coordinate + Interactive AI Status Badge Inspection Popovers on the Tablet Prototype).

---

## 1. Phase 4A: 6 Edge Cases & Architectural Gaps Addressed

1. **`SpatialGridIndex` silently drops giant nodes (`> 256` grid cells) from interior viewport queries (`src/db/browser_sql_engine.ts`):**
   - *Bug:* When a node's bounding box spans `> 256` cells (e.g., a large lecture frame or diagram spanning `> 4096px`), `SpatialGridIndex.insert()` truncated cell insertion after `MAX_CELLS_PER_NODE = 256`. Any camera viewport or lasso query inside the un-indexed interior of that node returned `[]`, causing the node to vanish when zoomed in.
   - *Fix:* Track nodes exceeding `MAX_CELLS_PER_NODE` in an `oversizedRowIds: Set<number>` on `SpatialGridIndex` and union `oversizedRowIds` into `queryCandidateRowIds()`. Maintain a `spatialNodesByRowId: Map<number, SpatialNodeRowState>` secondary index in `BrowserSqlEngine` so candidate lookup is strictly $O(|matchingRowIds|)$ instead of scanning `spatialNodes.values()`.

2. **Full-database `Uint8Array` deep-cloning on every 120Hz `SliceEraseCommand` `pointermove` (`src/core/commands/slice_erase_command.ts` & `src/db/browser_sql_engine.ts`):**
   - *Bug:* `TabletPointerBridge.handlePointerMove` created and executed a `SliceEraseCommand` on every 120Hz stylus move when `activeTool === 'stroke_eraser'`. Even when moving across empty canvas space (`didMutate === false`), `SliceEraseCommand.execute()` opened `this.db.transaction(...)`, triggering `BrowserSqlEngine.pushSnapshot()` which cloned every `spatial_nodes` row and `Uint8Array` stroke buffer 120 times per second.
   - *Fix:*
     1. In `SliceEraseCommand.execute()`, perform the R-Tree candidate lookup and polyline intersection math *before* opening `this.db.transaction(...)`; if no stroke is intersected, return immediately with `this.didMutate = false` and zero transaction/snapshot overhead.
     2. In `BrowserSqlEngine.pushSnapshot()`, treat `stroke_points` and `embedding` `Uint8Array` instances as immutable value blobs (copying the reference rather than allocating `new Uint8Array(row.stroke_points)` on every transaction).

3. **Duplicate AI Verification Badges on Incremental Violet Clustering (`src/ai/tier0_clustering/stroke_clusterer.ts`):**
   - *Bug:* When Cluster 1 already had a Violet verification job/badge and the user wrote another proximate stroke that merged into Cluster 1 (`targetClusterId = existingClustersInComp[0].id`), `clusterLayerNow()` saw `hasViolet === true` and unconditionally called `jobQueue.enqueueClusterJob(...)` again for the same `targetClusterId`—spawning duplicate stacked badges on the same cluster.
   - *Fix:* When a cluster's membership changes (`needsCommand === true`), cancel any existing jobs anchored to `[targetClusterId, ...obsoleteClusterIds]` before enqueuing a fresh `verify_claim` job on `targetClusterId` so the new job cleanly supersedes the stale one.

4. **Undoing a Bridging Stroke Leaves Disconnected Clusters Merged (`src/db/repositories/spatial_node_repository.ts` & `src/core/commands/canvas_command.ts`):**
   - *Bug:* Suppose Cluster A (at $x \in [0, 50]$) and Cluster B (at $x \in [200, 250]$) are bridged by a new stroke $S_{\text{bridge}}$, merging them into Cluster A ($x \in [0, 250]$). When the user hits Undo on $S_{\text{bridge}}$, `pruneOrUpdateParentClusters()` only recomputed the bounding box of Cluster A's remaining children ($[0, 250]$), leaving two distant words permanently merged into one giant dashed box.
   - *Fix:* Enhance `SpatialNodeRepository.pruneOrUpdateParentClusters()` (and `CommitStrokeCommand`) so that when a cluster loses child strokes, it runs connected-components Union-Find (`proximityThreshold = 48.0`) over the remaining children; if the remaining children partition into $k > 1$ disconnected components, keep component 0 in the original cluster ID and split components $1 \dots k-1$ into newly restored `stroke_cluster` nodes.

5. **Teaching Mode (`isTeachingMode`) Does Not Hide AI Status Badges (`src/state/canvas_store.ts`):**
   - *Bug:* `CanvasStore.setTeachingMode(true)` hides the `hints_work` and `ai_feedback` layers, which hides nodes on those layers in `buildSceneFrame()`. However, `rawBadges = this.jobRepo.getBadgesForCanvas(this.canvasId)` was never filtered by layer visibility or `isTeachingMode`, so `◌ / ↻ / ●` AI badges remained visible during Teaching Mode lectures and in exported SVG artboards.
   - *Fix:* In `CanvasStore.buildSceneFrame()`, filter `badges` so that AI status badges are hidden whenever the `ai_feedback` layer is hidden (`!this.getLayerByType('ai_feedback').isVisible`) or when their `anchorNodeId` belongs to a hidden layer.

6. **`docs/SPEC.md` §5.5 & §6 Still Show Legacy Pre-Canonical Schemas:**
   - *Fix:* Update [`docs/SPEC.md`](./SPEC.md) §5.5 (`CreateZettelCardToolSchema`, `UpdateJobBadgeToolSchema`) and §6 (`schema.sql` DDL) to match the canonical [`src/db/schema.sql`](../src/db/schema.sql) and [`src/ai/agent_contract.ts`](../src/ai/agent_contract.ts) per Architectural Decision #2.

---

## 2. Phase 4B: Interactive Tablet HUD Overlays (Track 1)

1. **Floating 6-Slot Radial Tool Wheel at Touch Hold Coordinate:**
   - Extend `TabletPointerBridge` ([`src/ui/scene_graph/pointer_bridge.ts`](../src/ui/scene_graph/pointer_bridge.ts)) to record `holdAnchor: ScreenPoint | null` when transitioning into `'TOUCH_HOLD_MODIFIER'` (`220ms` stationary 1-finger hold) and pass `(state, holdAnchor)` to `onStateChange`.
   - Render a floating glassmorphic **6-slot Radial Tool Wheel** centered at `(holdAnchor.x, holdAnchor.y)` in [`src/ui/tablet_app.ts`](../src/ui/tablet_app.ts) & [`index.html`](../index.html) when `gestureState === 'TOUCH_HOLD_MODIFIER'`, allowing instant 1-tap tool switching (`fountain_pen`, `felt_tip_marker`, `ai_highlighter`, `freehand_lasso`, `stroke_eraser`, `pan_laser`) right under the user's non-dominant hand.
2. **Clickable AI Status Badge Inspection Popover:**
   - Add `hitTestBadgeAtScreenPoint(pt: ScreenPoint, viewportWidth: number, viewportHeight: number, hitRadiusPx?: number): ProjectedJobBadge | null` to `CanvasStore` ([`src/state/canvas_store.ts`](../src/state/canvas_store.ts)).
   - Wire `NoteFlowTabletApp` ([`src/ui/tablet_app.ts`](../src/ui/tablet_app.ts)) so tapping a `◌ / ↻ / ●` badge on the canvas opens a floating **AI Verification Popover** anchored near `(badge.screenX, badge.screenY)` displaying:
     - Verification status pill (`verified` / `conflict` / `hint_available` / `running`)
     - `tooltipMessage` from `badge.resultJson`
     - A **⚛ Synthesize Linked Zettel Card** button that executes an undoable `CreateZettelCardCommand` anchored to `badge.anchorNodeId`.

---

## 3. Verification Plan

```bash
npm run typecheck
npm run test:headless
npm run build
```
