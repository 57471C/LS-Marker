# Repository Performance Audit: Top Optimization Candidates

## Executive Overview
The repository architecture generally follows standard React patterns but exhibits severe performance anti-patterns within its core interaction loop. The dominant hotspots are concentrated in the canvas labeling workspace (`<Labeler>` and `<LabelStage>`). High-frequency pointer events (drag, resize, move) are tightly coupled to the root state of the labeling component, triggering deeply nested re-render cascades and expensive synchronous JSON serialization on every frame. If left unaddressed, these issues guarantee dropped frames (breaking the 16ms budget), high CPU utilization, and substantial GC pressure on complex photos. The secondary concerns involve scaling the list views and protecting against unnecessary re-renders.

## Summary Matrix

| Rank | Subsystem / File | Bottleneck Type | Est. Impact (1-5) | Hot Path Tier (Hot/Warm/Cold) | Risk (Low/Med/High) | Priority Score |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `src/components/labeler.tsx` | UI/Re-render & Serialization | 5 | Hot | High | 8.3 |
| 2 | `src/components/labeler.tsx` | Memory/GC (Serialization) | 5 | Hot | Med | 10.0 |
| 3 | `src/components/label-stage.tsx` | UI/Re-render | 4 | Hot | Med | 8.0 |
| 4 | `src/components/label-stage.tsx` | Concurrency / Thread Jitter | 4 | Hot | Low | 13.3 |
| 5 | `src/components/photos-page.tsx`| UI/Re-render (Virtualization) | 3 | Warm | Low | 7.5 |
| 6 | `src/lib/project.tsx` | UI/Re-render (Context Leakage) | 2 | Warm | Low | 5.0 |

---

## Detailed Findings

### [Rank 1] The Pointer Interaction & State Cascade
- **Target Location:** `src/components/labeler.tsx` (`handleBoxesChange`), `src/components/label-stage.tsx` (`onPointerMove`)
- **Category:** `UI/Re-render`
- **Current Behavior:** During a drag, resize, or move operation on the canvas, `onPointerMove` computes the new coordinates and immediately calls the `onChange` callback (mapped to `handleBoxesChange` in the parent `<Labeler>`). This calls `setBoxes`, forcing a complete re-render of the `<Labeler>`, the toolbars, the sidebars, and re-mounting the entire SVG tree in `<LabelStage>` on every mouse tick.
- **Proposed Optimization:** Decouple active pointer drags from the parent state. Manage active transformations (translates/scales) purely via a mutable `useRef` or local state within the specific dragging component. Only commit the final transformed coordinates to the parent `<Labeler>` state and undo stack inside `onPointerUp`.
- **Estimated Payoff:**
  - *Time Complexity:* Drops React reconciliation cost per frame from $O(N)$ (where $N$ is all boxes + entire UI) to $O(1)$ (local transform update).
  - *Memory/Resource Impact:* Eliminates massive allocation churn from re-creating box arrays and unmounting/mounting DOM nodes per pixel moved.
- **Implementation Scope & Blast Radius:** High risk. Requires refactoring how `<LabelStage>` communicates with `<Labeler>`, moving from controlled component to uncontrolled-during-drag.
- **Validation & Profiling Strategy:** Record a Chrome DevTools Performance trace while dragging a bounding box. Ensure the React `Commit` phase only occurs on mouse up, not repeatedly during the drag.

### [Rank 2] Dirty Checking & Undo Stack Serialization Anti-Pattern
- **Target Location:** `src/components/labeler.tsx` (`pushUndoSnapshot`, `dirty` derivation)
- **Category:** `Memory/GC`
- **Current Behavior:** To detect if the workspace is "dirty" or to avoid duplicate undo snapshots, the app evaluates `JSON.stringify(toApiBoxes(boxes)) === saved` or `JSON.stringify(prev.boxes) === JSON.stringify(nextBoxes)`. Because `handleBoxesChange` is currently called on every pointer move, this blocking stringification runs continuously on the main thread, allocating massive strings and pausing execution.
- **Proposed Optimization:** Replace JSON stringification for dirty checking with a fast shallow reference check (`boxes !== prevBoxes`) or a dedicated numeric `revision` counter that increments on explicit mutations. Track dirty state explicitly via a boolean rather than comparing full payload strings.
- **Estimated Payoff:**
  - *Time Complexity:* $O(N)$ stringification $\rightarrow O(1)$ reference check.
  - *Memory/Resource Impact:* Drops GC string allocation from multiple MB/sec to zero during interactions.
- **Implementation Scope & Blast Radius:** Medium risk. Requires careful audit of when `dirty` is toggled true/false (e.g., on save) and updating the undo stack logic.
- **Validation & Profiling Strategy:** Run `node --prof` or Chrome DevTools Memory profiler to verify string allocation drops. Ensure `JSON.stringify` does not appear in the flame chart under pointer events.

### [Rank 3] SVG Canvas Rendering Decomposition
- **Target Location:** `src/components/label-stage.tsx` (SVG mapping loop)
- **Category:** `UI/Re-render`
- **Current Behavior:** The entire collection of annotations (`boxes`) is mapped directly inside an `<svg>` block. If one point on one polygon changes, every `<polygon>`, `<g>`, and `<rect>` for all annotations on the image is re-evaluated and re-rendered by React.
- **Proposed Optimization:** Isolate individual annotations into memoized components (e.g., `<MemoizedPolygon box={box} selected={selected} />`). Furthermore, split the "active" layer (the shape currently being drawn or edited) from the "static" layer (shapes at rest) so that modifying one box does not trigger reconciliation checks for the others.
- **Estimated Payoff:**
  - *Time Complexity:* $O(N)$ React fiber updates per interaction $\rightarrow O(1)$ update for the active element.
- **Implementation Scope & Blast Radius:** Medium risk. Involves extracting JSX into separate components and applying `React.memo` with custom comparison functions.
- **Validation & Profiling Strategy:** Use the React DevTools Profiler with "Highlight updates when components render" enabled. While dragging one box, other static boxes should not flash.

### [Rank 4] Missing rAF Throttling on Pointer Dispatches
- **Target Location:** `src/components/label-stage.tsx` (`onPointerMove`)
- **Category:** `Concurrency`
- **Current Behavior:** Hardware pointer events fire much faster than the display refresh rate (e.g., 1000Hz on gaming mice vs 60Hz display). The `onPointerMove` handler runs synchronously for every event, needlessly recalculating clamping and transformations.
- **Proposed Optimization:** Throttle the pointer move visual updates using `requestAnimationFrame`. Store the latest `clientX/Y` in a ref and process the calculation once per frame.
- **Estimated Payoff:**
  - *Time Complexity:* Caps execution to 60fps (or display rate), preventing main-thread starvation from excessive event dispatch.
- **Implementation Scope & Blast Radius:** Low risk. Standard animation loop pattern.
- **Validation & Profiling Strategy:** Chrome DevTools Performance trace; verify that `onPointerMove` execution blocks align cleanly with the vsync intervals.

### [Rank 5] Unvirtualized Table Rendering Limits
- **Target Location:** `src/components/photos-page.tsx` (Table Rows)
- **Category:** `UI/Re-render`
- **Current Behavior:** The component chunks data into pages of 50 (`PAGE_SIZE = 50`), but maps all 50 items synchronously. Each item includes a thumbnail image and several columns. As dataset complexity grows or users request larger page sizes, mounting 50+ complex nodes synchronously causes noticeable layout thrashing and jitter when switching pages or filtering.
- **Proposed Optimization:** Implement DOM virtualization (e.g., using `@tanstack/react-virtual` or similar) to only mount rows actively visible in the scroll viewport, allowing infinite scrolling or much larger page sizes without blocking the thread.
- **Estimated Payoff:**
  - *Time Complexity:* Page load $O(P)$ (where P is page size) $\rightarrow O(V)$ (where V is visible items, ~10-15).
- **Implementation Scope & Blast Radius:** Low risk. Replaces the `.slice().map()` with a virtualizer map.
- **Validation & Profiling Strategy:** Set `PAGE_SIZE = 500`. Verify via Chrome DevTools that mounting the component takes < 50ms and the DOM node count remains low.

### [Rank 6] Global Context Leakage
- **Target Location:** `src/lib/project.tsx`, `src/lib/session.tsx`
- **Category:** `UI/Re-render`
- **Current Behavior:** The `ProjectProvider` and `SessionProvider` wrap large portions of the app. A change to any value within these contexts (e.g., toggling the `picker` boolean in `ProjectContext`) will force a re-render of every subscribed component, even if the component only cares about `current` project.
- **Proposed Optimization:** Split high-frequency or unrelated state into separate contexts (e.g., `ProjectStateContext` vs `ProjectActionsContext` vs `PickerContext`), or adopt a granular subscription model (Zustand) to prevent UI-level toggles from causing data-level consumers to re-render.
- **Estimated Payoff:**
  - *Time Complexity:* Prevents accidental global re-renders.
- **Implementation Scope & Blast Radius:** Low risk to implement, but requires updating `useProject` imports.
- **Validation & Profiling Strategy:** React DevTools Profiler; toggle the project picker and ensure unrelated components do not re-render.

---

## Recommended Next Steps

**Quick Win:** Execute **Rank #2 (Dirty Checking & Undo Stack Anti-Pattern)** immediately. Swapping the deep JSON stringification for a shallow `dirty` flag and direct object reference checks requires minimal structural changes but will yield massive immediate frame-rate improvements during interaction.

**Architectural RFC:** **Rank #1 & #3 (The Pointer Interaction Cascade & Canvas Decomposition)** requires an RFC. Moving from a tightly coupled, fully controlled state to a local-transform architecture during drag/drop operations is a fundamental structural shift. It requires planning how to manage the boundary between temporary local state and committed global state without breaking the undo stack or multi-user claim logic.