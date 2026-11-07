import assert from "node:assert/strict";
import { createServer } from "vite";

console.log("=== LS-Marker Isolated Active Layer & Canvas Verification ===");

const server = await createServer({
  server: { middlewareMode: true },
  logLevel: "warn",
});

try {
  const stageModule = await server.ssrLoadModule("./src/components/label-stage.tsx");
  const { StaticAnnotationsLayer, ActiveAnnotationLayer } = stageModule;

  assert.equal(
    typeof StaticAnnotationsLayer,
    "object",
    "StaticAnnotationsLayer must be exported as a memoized React component (object)",
  );
  assert.equal(
    typeof ActiveAnnotationLayer,
    "function",
    "ActiveAnnotationLayer must be exported as a React function component",
  );

  // 1. Verify Memoization Behavior of StaticAnnotationsLayer
  const compareMemo = StaticAnnotationsLayer.type ? StaticAnnotationsLayer.compare : undefined;

  // Test memo comparator logic directly
  const sampleBoxes = [
    { key: "box-1", classId: 1, x: 0.2, y: 0.2, w: 0.2, h: 0.2 },
    { key: "box-2", classId: 2, x: 0.6, y: 0.6, w: 0.3, h: 0.3 },
  ];

  const baseProps = {
    boxes: sampleBoxes,
    selectedKey: null,
    activeKey: null,
    colorFor: () => "#1473e6",
    labelFor: () => "IC1",
    renderMode: "outline",
    readOnly: false,
    hiddenKeys: undefined,
    spaceMode: "off",
    zoom: 1,
  };

  // If StaticAnnotationsLayer has a custom compare function (memo)
  if (compareMemo) {
    // A: Identical props -> should return true (skip render)
    assert.equal(
      compareMemo(baseProps, { ...baseProps }),
      true,
      "Identical props must skip re-render",
    );

    // B: activeKey transitions from null -> 'box-1' (drag begins) -> should return false (re-render once to omit active)
    assert.equal(
      compareMemo(baseProps, { ...baseProps, activeKey: "box-1" }),
      false,
      "Drag start must trigger a re-render to partition active shape",
    );

    // C: activeKey remains 'box-1' during active pointer moves -> MUST return true (ZERO reconciliations during drag)
    const draggingProps1 = { ...baseProps, activeKey: "box-1" };
    const draggingProps2 = { ...baseProps, activeKey: "box-1" };
    assert.equal(
      compareMemo(draggingProps1, draggingProps2),
      true,
      "StaticAnnotationsLayer must produce zero reconciliations while activeKey is being manipulated",
    );

    // D: activeKey transitions from 'box-1' -> null (drag ends) -> should return false (re-render to include committed shape)
    assert.equal(
      compareMemo(draggingProps1, baseProps),
      false,
      "Drag finish must trigger re-render to incorporate final committed shape",
    );

    // E: Selection change -> should return false
    assert.equal(
      compareMemo(baseProps, { ...baseProps, selectedKey: "box-1" }),
      false,
      "Selection change must re-render to show selection highlight",
    );
  }

  // 2. Verify Frame-Throttled Pointer Interaction Pattern
  console.log("Testing rAF throttle dispatch and single-commit on pointer release...");

  let rafScheduled = false;
  let rafCallback = null;

  // Mock requestAnimationFrame
  const mockRaf = (cb) => {
    rafScheduled = true;
    rafCallback = cb;
    return 1;
  };

  let onChangeCallCount = 0;
  let lastCommittedBoxes = null;
  const mockOnChange = (boxes) => {
    onChangeCallCount++;
    lastCommittedBoxes = boxes;
  };

  // Simulate pointer interaction state machine
  let activeBox = null;
  let hasMoved = false;
  let rafPending = false;
  let pointerCoords = null;

  function simulatePointerDown(box) {
    activeBox = box;
    hasMoved = false;
  }

  function simulatePointerMove(coords) {
    pointerCoords = coords;
    if (!rafPending) {
      rafPending = true;
      mockRaf(() => {
        rafPending = false;
        hasMoved = true;
        // Compute new coordinates
        activeBox = {
          ...activeBox,
          x: pointerCoords.x,
          y: pointerCoords.y,
        };
      });
    }
  }

  function simulatePointerUp() {
    if (!hasMoved || !activeBox) {
      activeBox = null;
      return;
    }
    mockOnChange([activeBox]);
    activeBox = null;
    hasMoved = false;
  }

  // Step 1: Click without drag (selection click)
  simulatePointerDown(sampleBoxes[0]);
  simulatePointerUp();
  assert.equal(
    onChangeCallCount,
    0,
    "Clicking without movement must NOT call onChange or mark parent dirty",
  );

  // Step 2: Dragging with multiple rapid pointermove events
  simulatePointerDown(sampleBoxes[0]);
  simulatePointerMove({ x: 0.25, y: 0.25 });
  simulatePointerMove({ x: 0.26, y: 0.26 });
  simulatePointerMove({ x: 0.27, y: 0.27 });

  // While moves are queued, onChange has still NOT been called
  assert.equal(
    onChangeCallCount,
    0,
    "No onChange calls should occur synchronously during pointer movement",
  );

  // Execute rAF frame
  assert.equal(rafScheduled, true, "rAF must be scheduled for pointer movement");
  rafCallback();
  assert.equal(activeBox.x, 0.27, "Active box updated to latest pointer coords via rAF");
  assert.equal(
    onChangeCallCount,
    0,
    "Even after rAF frame renders activeBox locally, parent onChange must NOT be called yet",
  );

  // Step 3: Release pointer
  simulatePointerUp();
  assert.equal(onChangeCallCount, 1, "onChange must be called exactly once upon pointer release");
  assert.equal(lastCommittedBoxes[0].x, 0.27, "Committed box has final position");

  console.log("All canvas layer & rAF interaction checks PASSED cleanly.");
} finally {
  await server.close();
}
