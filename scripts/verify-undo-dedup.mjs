import assert from "node:assert/strict";
import { createServer } from "vite";

console.log("=== LS-Marker Undo Deduplication & Dirty Checking Verification ===");

const server = await createServer({
  server: { middlewareMode: true },
  logLevel: "warn",
});

try {
  const labelerModule = await server.ssrLoadModule("./src/components/labeler.tsx");
  const { areBoxesEqual } = labelerModule;

  assert.equal(typeof areBoxesEqual, "function", "areBoxesEqual must be exported as a function");

  // 1. Referential identity test
  const sampleBoxes = [
    { key: "box-1", classId: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    { key: "box-2", classId: 2, x: 0.5, y: 0.6, w: 0.2, h: 0.2 },
  ];
  assert.equal(
    areBoxesEqual(sampleBoxes, sampleBoxes),
    true,
    "Identical reference should be equal",
  );

  // 2. Structural identity test (different references, same values)
  const cloneBoxes = [
    { key: "box-1", classId: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    { key: "box-2", classId: 2, x: 0.5, y: 0.6, w: 0.2, h: 0.2 },
  ];
  assert.equal(areBoxesEqual(sampleBoxes, cloneBoxes), true, "Equal box values should be equal");

  // 3. Early exit on length mismatch
  const shorterBoxes = [sampleBoxes[0]];
  assert.equal(
    areBoxesEqual(sampleBoxes, shorterBoxes),
    false,
    "Different lengths must not be equal",
  );

  // 4. Coordinate mismatch
  const movedBoxes = [
    { key: "box-1", classId: 1, x: 0.100001, y: 0.2, w: 0.3, h: 0.4 },
    { key: "box-2", classId: 2, x: 0.5, y: 0.6, w: 0.2, h: 0.2 },
  ];
  assert.equal(
    areBoxesEqual(sampleBoxes, movedBoxes),
    false,
    "Coordinate change must not be equal",
  );

  // 5. ClassId mismatch
  const reclassedBoxes = [
    { key: "box-1", classId: 99, x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    { key: "box-2", classId: 2, x: 0.5, y: 0.6, w: 0.2, h: 0.2 },
  ];
  assert.equal(areBoxesEqual(sampleBoxes, reclassedBoxes), false, "Class change must not be equal");

  // 6. Polygon points comparison
  const polyBoxes1 = [
    {
      key: "box-poly",
      classId: 1,
      x: 0.5,
      y: 0.5,
      w: 0.2,
      h: 0.2,
      points: [
        [0.4, 0.4],
        [0.6, 0.4],
        [0.5, 0.6],
      ],
    },
  ];
  const polyBoxes2 = [
    {
      key: "box-poly",
      classId: 1,
      x: 0.5,
      y: 0.5,
      w: 0.2,
      h: 0.2,
      points: [
        [0.4, 0.4],
        [0.6, 0.4],
        [0.5, 0.6],
      ],
    },
  ];
  const polyBoxesChanged = [
    {
      key: "box-poly",
      classId: 1,
      x: 0.5,
      y: 0.5,
      w: 0.2,
      h: 0.2,
      points: [
        [0.4, 0.4],
        [0.6, 0.4],
        [0.5, 0.7],
      ],
    },
  ];
  assert.equal(
    areBoxesEqual(polyBoxes1, polyBoxes2),
    true,
    "Identical polygon points should be equal",
  );
  assert.equal(
    areBoxesEqual(polyBoxes1, polyBoxesChanged),
    false,
    "Changed polygon points must not be equal",
  );

  // 7. Verify Undo Stack Deduplication behavior without JSON serialization
  const undoStack = [];
  let committedSnapshot = { boxes: sampleBoxes, selectedKey: null };

  function pushUndoSnapshot(nextBoxes, nextSelectedKey) {
    const prev = committedSnapshot;
    if (areBoxesEqual(prev.boxes, nextBoxes)) {
      committedSnapshot = { boxes: nextBoxes, selectedKey: nextSelectedKey };
      return;
    }
    undoStack.push(prev);
    committedSnapshot = { boxes: nextBoxes, selectedKey: nextSelectedKey };
  }

  // Push identical state multiple times
  pushUndoSnapshot(cloneBoxes, "box-1");
  pushUndoSnapshot(cloneBoxes, "box-2");
  pushUndoSnapshot(sampleBoxes, null);

  assert.equal(
    undoStack.length,
    0,
    "Successive identical states must NOT create undo stack entries",
  );
  assert.equal(
    committedSnapshot.selectedKey,
    null,
    "Committed snapshot selection updated without history duplication",
  );

  // Push modified state
  pushUndoSnapshot(movedBoxes, "box-1");
  assert.equal(undoStack.length, 1, "Modified state must push previous snapshot to undo stack");
  assert.deepEqual(undoStack[0].boxes, sampleBoxes, "Undo stack stores the previous snapshot");

  // Push identical modified state again
  pushUndoSnapshot(movedBoxes, "box-1");
  assert.equal(undoStack.length, 1, "Duplicate modified state must not push duplicate entry");

  // 8. Verify Dirty state tracking
  const savedBoxes = sampleBoxes;
  let currentBoxes = sampleBoxes;
  let isDirty = !areBoxesEqual(currentBoxes, savedBoxes);
  assert.equal(isDirty, false, "Initial loaded state must not be dirty");

  // Apply mutation
  currentBoxes = movedBoxes;
  isDirty = !areBoxesEqual(currentBoxes, savedBoxes);
  assert.equal(isDirty, true, "State after mutation must be dirty");

  // Revert/undo back to saved state
  currentBoxes = cloneBoxes;
  isDirty = !areBoxesEqual(currentBoxes, savedBoxes);
  assert.equal(isDirty, false, "State after reverting to saved state must not be dirty");

  console.log("All undo stack deduplication & dirty checking checks PASSED cleanly.");
} finally {
  await server.close();
}
