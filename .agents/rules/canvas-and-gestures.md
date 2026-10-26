---
trigger: glob
globs: "src/ui/**, src/state/**"
description: "120Hz Scene Graph, Bimanual Gesture FSM, and Wet/Dry Ink rules."
---

# Canvas Rendering & Gesture Rules

1. **Zero Pan/Zoom Drift (Unified Scene Graph):**
   - Committed Dry Ink, PDF Snippets, Zettel Cards, and Async Status Badges (`◌`, `🔄`, `●`) MUST be rendered inside the Unified Scene Graph sharing the exact same camera transformation matrix `(panX, panY, zoom, rotation)`.
   - Never position Async Status Badges using lagging React DOM `useEffect` listeners that drift behind canvas panning.

2. **Strict Pen vs. Touch Separation & 8px Slop:**
   - Always check `event.pointerType === 'pen'` vs `'touch'`.
   - Single-finger `TOUCH_START` MUST enter `TOUCH_1_PENDING` first (never jump straight to `TOUCH_PANNING`).
   - Only transition to `TOUCH_PANNING` if finger movement exceeds the `8px` slop threshold before the `220ms` hold timer expires.

3. **Decoupled Wet-Ink:**
   - Active pen drawing (`PEN_DOWN` to `PEN_UP`) must never trigger React component re-renders on `pointermove`.
