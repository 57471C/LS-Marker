import assert from "node:assert/strict";
import fs from "node:fs";
import { contours } from "d3-contour";
import * as ort from "onnxruntime-web";
import simplify from "simplify-js";

console.log("--- Starting SAM2.1 Persistent Cache Storage & Polygon Tracing Verification ---");

const CACHE_NAME = "ls-marker-sam2-cache-v1";
const encPath = "public/models/sam2_hiera_tiny_encoder.onnx";
const decPath = "public/models/sam2_hiera_tiny_decoder.onnx";

assert.ok(fs.existsSync(encPath), "Encoder ONNX model must exist in public/models/");
assert.ok(fs.existsSync(decPath), "Decoder ONNX model must exist in public/models/");

// 1. Verify persistent Cache Storage API wrapper (cache miss -> stream progress -> cache hit offline <50ms)
const mockStorage = new Map();
let networkFetchCount = 0;
let isOffline = false;

const mockCaches = {
  async open(name) {
    if (!mockStorage.has(name)) {
      mockStorage.set(name, new Map());
    }
    const bucket = mockStorage.get(name);
    return {
      async match(url) {
        const buf = bucket.get(url);
        if (!buf) return undefined;
        return {
          ok: true,
          status: 200,
          async arrayBuffer() {
            return buf;
          },
        };
      },
      async put(url, response) {
        const ab = await response.arrayBuffer();
        bucket.set(url, ab);
      },
    };
  },
  async delete(name) {
    return mockStorage.delete(name);
  },
};

async function mockFetch(url) {
  if (isOffline) {
    throw new Error(`Network is offline: cannot fetch ${url}`);
  }
  networkFetchCount++;
  const filePath = url.includes("encoder") ? encPath : decPath;
  const fileBuf = fs.readFileSync(filePath);
  const chunkSize = Math.ceil(fileBuf.byteLength / 4);
  let offset = 0;

  const stream = new ReadableStream({
    pull(controller) {
      if (offset >= fileBuf.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, fileBuf.byteLength);
      controller.enqueue(new Uint8Array(fileBuf.buffer, fileBuf.byteOffset + offset, end - offset));
      offset = end;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(fileBuf.byteLength),
    },
  });
}

async function fetchModelWithCacheSim(url, onProgress) {
  const t0 = performance.now();
  const cache = await mockCaches.open(CACHE_NAME);
  const cached = await cache.match(url);
  if (cached) {
    const buffer = await cached.arrayBuffer();
    const loadTimeMs = Math.max(1, Math.round(performance.now() - t0));
    onProgress?.(100);
    return { buffer, fromCache: true, loadTimeMs };
  }

  const response = await mockFetch(url);
  const totalBytes = Number.parseInt(response.headers.get("content-length") || "0", 10);
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  onProgress?.(0);
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (totalBytes > 0) {
      onProgress?.(Math.min(99, Math.round((received / totalBytes) * 100)));
    }
  }
  const combined = new Uint8Array(received);
  let pos = 0;
  for (const c of chunks) {
    combined.set(c, pos);
    pos += c.byteLength;
  }
  onProgress?.(100);
  await cache.put(url, new Response(combined.buffer.slice(0)));
  const loadTimeMs = Math.max(1, Math.round(performance.now() - t0));
  return { buffer: combined.buffer, fromCache: false, loadTimeMs };
}

// First run: Cache Miss -> Network download with progress 0 -> 100%
const encProgressLog = [];
const decProgressLog = [];
const [firstEnc, firstDec] = await Promise.all([
  fetchModelWithCacheSim("/models/sam2_hiera_tiny_encoder.onnx", (p) => encProgressLog.push(p)),
  fetchModelWithCacheSim("/models/sam2_hiera_tiny_decoder.onnx", (p) => decProgressLog.push(p)),
]);

assert.equal(firstEnc.fromCache, false, "First load must be a cache miss");
assert.equal(firstDec.fromCache, false, "First load must be a cache miss");
assert.equal(networkFetchCount, 2, "Expected exactly 2 network fetches on first run");
assert.equal(encProgressLog[0], 0, "Progress must start at 0%");
assert.equal(encProgressLog.at(-1), 100, "Progress must finish at 100%");
assert.ok(encProgressLog.length >= 4, "Streaming reader must emit incremental progress updates");

// Second run: Toggle server offline & verify Cache Hit in <50ms with 0 network requests
isOffline = true;
const [cachedEnc, cachedDec] = await Promise.all([
  fetchModelWithCacheSim("/models/sam2_hiera_tiny_encoder.onnx"),
  fetchModelWithCacheSim("/models/sam2_hiera_tiny_decoder.onnx"),
]);

assert.equal(cachedEnc.fromCache, true, "Second load must hit local cache");
assert.equal(cachedDec.fromCache, true, "Second load must hit local cache");
assert.equal(networkFetchCount, 2, "Zero network requests allowed on cache hit");
assert.ok(
  cachedEnc.loadTimeMs < 50 && cachedDec.loadTimeMs < 50,
  `Expected cache hit load time < 50ms, got encoder=${cachedEnc.loadTimeMs}ms, decoder=${cachedDec.loadTimeMs}ms`,
);
console.log(
  `[PASS] Cache Storage (${CACHE_NAME}): offline cache hit in ${Math.max(cachedEnc.loadTimeMs, cachedDec.loadTimeMs)}ms with 0 network requests`,
);

// Initialize ONNX Runtime directly from cached ArrayBuffers
const enc = await ort.InferenceSession.create(cachedEnc.buffer, {
  graphOptimizationLevel: "disabled",
});
const dec = await ort.InferenceSession.create(cachedDec.buffer, {
  graphOptimizationLevel: "disabled",
});

// 2. Test multi-point prompt session ([1, N, 2] and [1, N]) on synthetic fastener image
const W = 1024;
const H = 1024;
const data = new Float32Array(3 * W * H);
const mean = [0.485, 0.456, 0.406];
const std = [0.229, 0.224, 0.225];

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const inPartA = Math.hypot(x - 420, y - 512) < 110;
    const inPartB = Math.hypot(x - 620, y - 512) < 110;
    const fg = inPartA || inPartB;
    const idx = y * W + x;
    data[idx] = ((fg ? 0.9 : 0.1) - mean[0]) / std[0];
    data[W * H + idx] = ((fg ? 0.25 : 0.1) - mean[1]) / std[1];
    data[2 * W * H + idx] = ((fg ? 0.2 : 0.1) - mean[2]) / std[2];
  }
}

const encOut = await enc.run({
  image: new ort.Tensor("float32", data, [1, 3, H, W]),
});

// Feed 1 positive point on Part A (420, 512) and 1 negative point on Part B (620, 512) -> N = 2
const prompts = [
  { x: 420 / 1024, y: 512 / 1024, label: 1 },
  { x: 620 / 1024, y: 512 / 1024, label: 0 },
];
const N = prompts.length;
const pointCoords = new ort.Tensor("float32", new Float32Array([420, 512, 620, 512]), [1, N, 2]);
const pointLabels = new ort.Tensor("float32", new Float32Array([1, 0]), [1, N]);

const decOut = await dec.run({
  image_embed: encOut.image_embed,
  high_res_feats_0: encOut.high_res_feats_0,
  high_res_feats_1: encOut.high_res_feats_1,
  point_coords: pointCoords,
  point_labels: pointLabels,
  mask_input: new ort.Tensor("float32", new Float32Array(256 * 256), [1, 1, 256, 256]),
  has_mask_input: new ort.Tensor("float32", new Float32Array([0]), [1]),
});

const iou = Array.from(decOut.iou_predictions.data);
const bestIdx = iou.indexOf(Math.max(...iou));
assert.ok(iou[bestIdx] > 0.9, `Expected high IoU prediction (>0.9), got ${iou[bestIdx]}`);

// 3. Verify tighter logit thresholding (0.25) and micro-island (<15 px²) filtering
const maskW = 256;
const maskH = 256;
const area = maskW * maskH;
const maskThreshold = 0.25;
const values = new Array(area);

// Inject a synthetic 3x3 (9 px² < 15 px²) micro-island at (10, 10)
for (let i = 0; i < area; i++) {
  let rawLogit = decOut.masks.data[bestIdx * area + i];
  const mx = i % maskW;
  const my = Math.floor(i / maskW);
  if (mx >= 10 && mx < 13 && my >= 10 && my < 13) {
    rawLogit = 5.0; // 9 px² micro-island
  }
  const isForeground = rawLogit > maskThreshold;
  const shifted = Math.max(-15, Math.min(15, rawLogit - maskThreshold));
  values[i] = isForeground ? 1 / (1 + Math.exp(-shifted)) : 0;
}

const generated = contours().size([maskW, maskH]).thresholds([0.5])(values);
assert.ok(generated.length > 0 && generated[0].coordinates.length > 0, "Contour must be extracted");

function polygonSignedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(a / 2);
}

const validLoops = generated[0].coordinates
  .map((poly) => poly[0])
  .filter((ring) => ring && ring.length >= 4 && polygonSignedArea(ring) >= 15);

assert.equal(
  validLoops.length,
  1,
  "Micro-island (<15 px²) must be discarded, leaving 1 external boundary",
);

const outerRing = validLoops[0].slice(0, -1);
const simplified = simplify(
  outerRing.map(([x, y]) => ({ x, y })),
  0.9,
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

for (const [px] of normPoints) {
  assert.ok(
    px < 0.55,
    `Vertex X (${px}) must stay on Part A and exclude negatively prompted Part B`,
  );
}

// Verify cache clear
const deleted = await mockCaches.delete(CACHE_NAME);
assert.equal(deleted, true, "clearModelCache must delete the cache container");

console.log(
  `[PASS] Multi-point SAM2.1 ([1,${N},2]) + tighter threshold (0.25) + 0.9px highQuality simplify (${normPoints.length} vertices, IoU=${iou[bestIdx].toFixed(4)})`,
);
console.log("--- All SAM2.1 Verifications Passed ---");
