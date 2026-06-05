import assert from "node:assert/strict";
import { cloneObjects } from "../src/js/state.js";

const objects = [
  { id: 1, type: "pen", layerId: "layer-1", color: "#111111", size: 4, points: [{ x: 1, y: 2, u: .1, v: .2 }, { x: 3, y: 4, u: .2, v: .3 }] },
  { id: 2, type: "ellipse", layerId: "layer-2", color: "#cc0000", size: 5, shapeMode: "fill", points: [{ x: 0, y: 0, u: 0, v: 0 }, { x: 10, y: 10, u: 1, v: 1 }] }
];
const cloned = cloneObjects(objects);
assert.deepEqual(cloned, objects);
cloned[0].points[0].x = 999;
assert.notEqual(cloned[0].points[0].x, objects[0].points[0].x);
console.log("Storage clone roundtrip smoke test passed.");
