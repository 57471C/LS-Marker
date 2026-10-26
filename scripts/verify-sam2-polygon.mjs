import assert from "node:assert/strict";
import fs from "node:fs";
import { contours } from "d3-contour";
import * as ort from "onnxruntime-web";
import simplify from "simplify-js";

console.log("--- Starting SAM2.1 Polygon Tracing Verification ---");

const encPath = "public/models/sam2_hiera_tiny_encoder.onnx";
const decPath = "public/models/sam2_hiera_tiny_decoder.onnx";

assert.ok(fs.existsSync(encPath), "Encoder ONNX model must exist in public/models/");
assert.ok(fs.existsSync(decPath), "Decoder ONNX model must exist in public/models/");

const encStat = fs.statSync(encPath);
const decStat = fs.statSync(decPath);
assert.ok(encStat.size > 50_000_000, "Encoder ONNX must be binary (>50MB)");
assert.ok(decStat.size > 10_000_000, "Decoder ONNX must be binary (>10MB)");

const enc = await ort.InferenceSession.create(fs.readFileSync(encPath), {
  graphOptimizationLevel: "disabled",
});
const dec = await ort.InferenceSession.create(fs.readFileSync(decPath), {
  graphOptimizationLevel: "disabled",
});

// Create synthetic 1024x1024 image with a circular washer/part centered at (512, 512) of radius 120
const W = 1024;
const H = 1024;
const data = new Float32Array(3 * W * H);
const mean = [0.485, 0.456, 0.406];
const std = [0.229, 0.224, 0.225];

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const inPart = Math.hypot(x - 512, y - 512) < 120;
    const r = inPart ? 0.9 : 0.1;
    const g = inPart ? 0.25 : 0.1;
    const b = inPart ? 0.2 : 0.1;
    const idx = y * W + x;
    data[idx] = (r - mean[0]) / std[0];
    data[W * H + idx] = (g - mean[1]) / std[1];
    data[2 * W * H + idx] = (b - mean[2]) / std[2];
  }
}

const encOut = await enc.run({
  image: new ort.Tensor("float32", data, [1, 3, H, W]),
});

const decOut = await dec.run({
  image_embed: encOut.image_embed,
  high_res_feats_0: encOut.high_res_feats_0,
  high_res_feats_1: encOut.high_res_feats_1,
  point_coords: new ort.Tensor("float32", new Float32Array([512, 512, 0, 0]), [1, 2, 2]),
  point_labels: new ort.Tensor("float32", new Float32Array([1, -1]), [1, 2]),
  mask_input: new ort.Tensor("float32", new Float32Array(256 * 256), [1, 1, 256, 256]),
  has_mask_input: new ort.Tensor("float32", new Float32Array([0]), [1]),
});

const iou = Array.from(decOut.iou_predictions.data);
const bestIdx = iou.indexOf(Math.max(...iou));
assert.ok(iou[bestIdx] > 0.9, `Expected high IoU prediction (>0.9), got ${iou[bestIdx]}`);

const maskW = 256;
const maskH = 256;
const area = maskW * maskH;
const values = new Float64Array(area);
for (let i = 0; i < area; i++) {
  const logit = decOut.masks.data[bestIdx * area + i];
  values[i] = 1 / (1 + Math.exp(-Math.max(-15, Math.min(15, logit))));
}

const generated = contours().size([maskW, maskH]).thresholds([0.5])(values);
assert.ok(generated.length > 0 && generated[0].coordinates.length > 0, "Contour must be extracted");

const outerRing = generated[0].coordinates[0][0].slice(0, -1);
const simplified = simplify(
  outerRing.map(([x, y]) => ({ x, y })),
  1.1,
  true,
);
const normPoints = simplified.map((pt) => [
  Math.round((pt.x / maskW) * 1e6) / 1e6,
  Math.round((pt.y / maskH) * 1e6) / 1e6,
]);

assert.ok(
  normPoints.length >= 6 && normPoints.length <= 60,
  `Expected simplified polygon vertex count in [6, 60], got ${normPoints.length}`,
);
for (const [px, py] of normPoints) {
  assert.ok(px > 0.3 && px < 0.7, `Vertex X (${px}) should bound center object`);
  assert.ok(py > 0.3 && py < 0.7, `Vertex Y (${py}) should bound center object`);
}

console.log(
  `[PASS] SAM2.1 traced polygon with ${normPoints.length} vertices (IoU=${iou[bestIdx].toFixed(4)})`,
);
console.log("--- All SAM2.1 Verifications Passed ---");
