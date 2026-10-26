import { contours } from "d3-contour";
import * as ort from "onnxruntime-web";
import simplify from "simplify-js";

export type Sam2Provider = "webgpu" | "wasm";

export type Sam2PromptPoint = {
  x: number;
  y: number;
  label: 0 | 1;
};

export type Sam2Status =
  | { state: "idle" }
  | { state: "loading_models"; message: string }
  | { state: "encoding"; provider: Sam2Provider; message: string }
  | { state: "ready"; provider: Sam2Provider; message: string }
  | { state: "decoding"; provider: Sam2Provider; message: string }
  | { state: "error"; message: string };

const ENCODER_URL = "/models/sam2_hiera_tiny_encoder.onnx";
const DECODER_URL = "/models/sam2_hiera_tiny_decoder.onnx";
const SAM2_INPUT_SIZE = 1024;
const SAM2_MASK_SIZE = 256;

const IMAGENET_MEAN = [0.485, 0.456, 0.406] as const;
const IMAGENET_STD = [0.229, 0.224, 0.225] as const;

type Sam2Sessions = {
  encoder: ort.InferenceSession;
  decoder: ort.InferenceSession;
  provider: Sam2Provider;
};

type EncodedImageCache = {
  srcKey: string;
  image_embed: ort.Tensor;
  high_res_feats_0: ort.Tensor;
  high_res_feats_1: ort.Tensor;
};

let sessionsPromise: Promise<Sam2Sessions> | null = null;
let activeProvider: Sam2Provider = "wasm";
let encodedCache: EncodedImageCache | null = null;
let encodingInFlight: { srcKey: string; promise: Promise<EncodedImageCache> } | null = null;

export function isSam2Loaded(): boolean {
  return sessionsPromise !== null;
}

function configureOrtEnv() {
  if (typeof window !== "undefined") {
    ort.env.wasm.wasmPaths = "/ort-wasm/";
    // Single-threaded SIMD avoids SharedArrayBuffer / COOP+COEP requirements over LAN HTTP
    ort.env.wasm.numThreads = 1;
  }
}

async function canUseWebGpu(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) return false;
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter?: () => Promise<unknown> } })
      .gpu;
    if (!gpu || typeof gpu.requestAdapter !== "function") return false;
    const adapter = await gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

async function createSessionsWithProvider(provider: Sam2Provider): Promise<Sam2Sessions> {
  configureOrtEnv();
  const options: ort.InferenceSession.SessionOptions = {
    executionProviders: [provider],
    graphOptimizationLevel: "disabled",
  };
  const [encoder, decoder] = await Promise.all([
    ort.InferenceSession.create(ENCODER_URL, options),
    ort.InferenceSession.create(DECODER_URL, options),
  ]);
  activeProvider = provider;
  return { encoder, decoder, provider };
}

export async function getSam2Sessions(
  onStatus?: (status: Sam2Status) => void,
): Promise<Sam2Sessions> {
  if (!sessionsPromise) {
    sessionsPromise = (async () => {
      onStatus?.({ state: "loading_models", message: "Loading SAM2.1 models…" });
      const tryWebGpu = await canUseWebGpu();
      if (tryWebGpu) {
        try {
          return await createSessionsWithProvider("webgpu");
        } catch (err) {
          console.warn("[SAM2] WebGPU session creation failed, falling back to WASM:", err);
        }
      }
      try {
        return await createSessionsWithProvider("wasm");
      } catch (err) {
        sessionsPromise = null;
        const msg =
          err instanceof Error ? err.message : "Failed to load SAM2.1 models from /public/models";
        throw new Error(msg);
      }
    })();
  }
  return sessionsPromise;
}

/**
 * Resize an HTMLImageElement to 1024x1024 and convert to an ImageNet-normalized NCHW float32 tensor.
 */
export function imageElementToSam2Tensor(imgEl: HTMLImageElement): ort.Tensor {
  const canvas = document.createElement("canvas");
  canvas.width = SAM2_INPUT_SIZE;
  canvas.height = SAM2_INPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not create 2D canvas context for SAM2 preprocessing");
  }
  ctx.drawImage(imgEl, 0, 0, SAM2_INPUT_SIZE, SAM2_INPUT_SIZE);
  const { data } = ctx.getImageData(0, 0, SAM2_INPUT_SIZE, SAM2_INPUT_SIZE);

  const area = SAM2_INPUT_SIZE * SAM2_INPUT_SIZE;
  const floatData = new Float32Array(3 * area);
  const [mr, mg, mb] = IMAGENET_MEAN;
  const [sr, sg, sb] = IMAGENET_STD;

  for (let i = 0; i < area; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    floatData[i] = (r - mr) / sr;
    floatData[area + i] = (g - mg) / sg;
    floatData[2 * area + i] = (b - mb) / sb;
  }

  return new ort.Tensor("float32", floatData, [1, 3, SAM2_INPUT_SIZE, SAM2_INPUT_SIZE]);
}

export async function encodeSam2Image(
  imgEl: HTMLImageElement,
  srcKey: string,
  onStatus?: (status: Sam2Status) => void,
): Promise<EncodedImageCache> {
  if (encodedCache && encodedCache.srcKey === srcKey) {
    onStatus?.({
      state: "ready",
      provider: activeProvider,
      message: `SAM2.1 Ready (${activeProvider.toUpperCase()})`,
    });
    return encodedCache;
  }

  if (encodingInFlight && encodingInFlight.srcKey === srcKey) {
    return encodingInFlight.promise;
  }

  const promise = (async () => {
    let sessions = await getSam2Sessions(onStatus);
    onStatus?.({
      state: "encoding",
      provider: sessions.provider,
      message: `SAM2.1 encoding photo (${sessions.provider.toUpperCase()})…`,
    });

    const inputTensor = imageElementToSam2Tensor(imgEl);
    let encOut: ort.InferenceSession.OnnxValueMapType;
    try {
      encOut = await sessions.encoder.run({ image: inputTensor });
    } catch (err) {
      if (sessions.provider === "webgpu") {
        console.warn("[SAM2] WebGPU encoder inference failed, retrying with WASM:", err);
        sessionsPromise = createSessionsWithProvider("wasm");
        sessions = await sessionsPromise;
        onStatus?.({
          state: "encoding",
          provider: "wasm",
          message: "SAM2.1 encoding photo (WASM)…",
        });
        encOut = await sessions.encoder.run({ image: inputTensor });
      } else {
        throw err;
      }
    }

    const result: EncodedImageCache = {
      srcKey,
      image_embed: encOut.image_embed,
      high_res_feats_0: encOut.high_res_feats_0,
      high_res_feats_1: encOut.high_res_feats_1,
    };
    encodedCache = result;
    onStatus?.({
      state: "ready",
      provider: sessions.provider,
      message: `SAM2.1 Ready (${sessions.provider.toUpperCase()}) — click object to trace`,
    });
    return result;
  })();

  encodingInFlight = { srcKey, promise };
  try {
    return await promise;
  } finally {
    if (encodingInFlight?.srcKey === srcKey) {
      encodingInFlight = null;
    }
  }
}

function pointInRing(px: number, py: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polygonSignedArea(ring: number[][]): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(area / 2);
}

function minDistSqToRing(px: number, py: number, ring: number[][]): number {
  let minD2 = Number.POSITIVE_INFINITY;
  for (const [rx, ry] of ring) {
    const d2 = (rx - px) * (rx - px) + (ry - py) * (ry - py);
    if (d2 < minD2) minD2 = d2;
  }
  return minD2;
}

function clampUnit(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Converts SAM2 decoder output logits `[1, numMasks, maskH, maskW]` into normalized `[0..1]` polygon vertices
 * matching LS-Marker's `StageBox.points` format (`[number, number][]`).
 */
export function maskToPolygon(
  masksData: Float32Array | number[],
  iouData: Float32Array | number[],
  numMasks: number,
  maskW: number,
  maskH: number,
  clickNormX: number,
  clickNormY: number,
  simplifyTolerance = 1.0,
  prompts?: Sam2PromptPoint[],
): [number, number][] | null {
  const area = maskW * maskH;
  const positivePrompts = prompts?.some((p) => p.label === 1)
    ? prompts.filter((p) => p.label === 1)
    : [{ x: clickNormX, y: clickNormY, label: 1 as const }];
  const negativePrompts = prompts ? prompts.filter((p) => p.label === 0) : [];

  const anchorX = clampUnit(positivePrompts[0].x) * maskW;
  const anchorY = clampUnit(positivePrompts[0].y) * maskH;

  // Sort candidate mask indices by IoU descending, preferring specific object masks over coarse whole-scene masks
  const maskOrder = Array.from({ length: numMasks }, (_, i) => i).sort(
    (a, b) => Number(iouData[b] ?? 0) - Number(iouData[a] ?? 0),
  );

  for (const maskIdx of maskOrder) {
    const offset = maskIdx * area;
    const values = new Array<number>(area);
    let positiveCount = 0;
    for (let i = 0; i < area; i++) {
      const logit = Number(masksData[offset + i]);
      if (logit > 0) positiveCount++;
      // Sigmoid for smooth sub-pixel contour interpolation at 0.5 threshold
      values[i] = 1 / (1 + Math.exp(-Math.max(-15, Math.min(15, logit))));
    }

    // Skip empty or full-frame background masks
    if (positiveCount < 6 || positiveCount > area * 0.96) {
      continue;
    }

    const generated = contours().size([maskW, maskH]).thresholds([0.5])(values);
    if (!generated.length || !generated[0].coordinates.length) {
      continue;
    }

    const polygons = generated[0].coordinates;
    // Choose the outer ring that best satisfies positive & negative prompt points
    let bestRing: number[][] | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const poly of polygons) {
      const outerRing = poly[0];
      if (!outerRing || outerRing.length < 4) continue;
      const ringArea = polygonSignedArea(outerRing);
      if (ringArea < 4) continue;

      let posHits = 0;
      for (const pt of positivePrompts) {
        if (pointInRing(clampUnit(pt.x) * maskW, clampUnit(pt.y) * maskH, outerRing)) {
          posHits++;
        }
      }
      let negHits = 0;
      for (const pt of negativePrompts) {
        if (pointInRing(clampUnit(pt.x) * maskW, clampUnit(pt.y) * maskH, outerRing)) {
          negHits++;
        }
      }

      const distPenalty =
        posHits > 0 ? 0 : Math.sqrt(minDistSqToRing(anchorX, anchorY, outerRing)) * 50;
      const score = posHits * 1_000_000 - negHits * 200_000 + ringArea - distPenalty;

      if (score > bestScore) {
        bestScore = score;
        bestRing = outerRing;
      }
    }

    if (!bestRing) continue;

    // Remove duplicate closing point if present
    const openRing =
      bestRing.length > 3 &&
      Math.hypot(
        bestRing[0][0] - bestRing[bestRing.length - 1][0],
        bestRing[0][1] - bestRing[bestRing.length - 1][1],
      ) < 1e-3
        ? bestRing.slice(0, -1)
        : bestRing;

    const rawPoints = openRing.map(([x, y]) => ({ x, y }));
    const simplified = simplify(rawPoints, simplifyTolerance, true);
    const finalPts = simplified.length >= 3 ? simplified : rawPoints;

    if (finalPts.length < 3) continue;

    return finalPts.map((pt) => [round6(clampUnit(pt.x / maskW)), round6(clampUnit(pt.y / maskH))]);
  }

  return null;
}

/**
 * Runs SAM2.1 encoder (cached per image) and decoder for one or more positive/negative prompt clicks
 * in normalized [0..1] coordinates, returning normalized polygon vertices for LS-Marker.
 */
export async function traceSam2WithPrompts(
  imgEl: HTMLImageElement,
  srcKey: string,
  prompts: Sam2PromptPoint[],
  onStatus?: (status: Sam2Status) => void,
): Promise<[number, number][] | null> {
  if (prompts.length === 0) return null;
  const encoded = await encodeSam2Image(imgEl, srcKey, onStatus);
  let sessions = await getSam2Sessions(onStatus);

  onStatus?.({
    state: "decoding",
    provider: sessions.provider,
    message: "SAM2.1 tracing boundary…",
  });

  const numPts = prompts.length;
  const coordsArr = new Float32Array(numPts * 2);
  const labelsArr = new Float32Array(numPts);
  for (let i = 0; i < numPts; i++) {
    coordsArr[i * 2] = clampUnit(prompts[i].x) * SAM2_INPUT_SIZE;
    coordsArr[i * 2 + 1] = clampUnit(prompts[i].y) * SAM2_INPUT_SIZE;
    labelsArr[i] = prompts[i].label;
  }

  const pointCoords = new ort.Tensor("float32", coordsArr, [1, numPts, 2]);
  const pointLabels = new ort.Tensor("float32", labelsArr, [1, numPts]);
  const maskInput = new ort.Tensor("float32", new Float32Array(SAM2_MASK_SIZE * SAM2_MASK_SIZE), [
    1,
    1,
    SAM2_MASK_SIZE,
    SAM2_MASK_SIZE,
  ]);
  const hasMaskInput = new ort.Tensor("float32", new Float32Array([0]), [1]);

  let decOut: ort.InferenceSession.OnnxValueMapType;
  try {
    decOut = await sessions.decoder.run({
      image_embed: encoded.image_embed,
      high_res_feats_0: encoded.high_res_feats_0,
      high_res_feats_1: encoded.high_res_feats_1,
      point_coords: pointCoords,
      point_labels: pointLabels,
      mask_input: maskInput,
      has_mask_input: hasMaskInput,
    });
  } catch (err) {
    if (sessions.provider === "webgpu") {
      console.warn("[SAM2] WebGPU decoder failed, falling back to WASM:", err);
      sessionsPromise = createSessionsWithProvider("wasm");
      sessions = await sessionsPromise;
      decOut = await sessions.decoder.run({
        image_embed: encoded.image_embed,
        high_res_feats_0: encoded.high_res_feats_0,
        high_res_feats_1: encoded.high_res_feats_1,
        point_coords: pointCoords,
        point_labels: pointLabels,
        mask_input: maskInput,
        has_mask_input: hasMaskInput,
      });
    } else {
      throw err;
    }
  }

  const masksTensor = decOut.masks;
  const iouTensor = decOut.iou_predictions;
  const dims = masksTensor.dims; // [1, numMasks, 256, 256]
  const numMasks = dims[1] ?? 3;
  const maskH = dims[2] ?? SAM2_MASK_SIZE;
  const maskW = dims[3] ?? SAM2_MASK_SIZE;

  const firstPos = prompts.find((p) => p.label === 1) ?? prompts[0];
  const polygon = maskToPolygon(
    masksTensor.data as Float32Array,
    iouTensor.data as Float32Array,
    numMasks,
    maskW,
    maskH,
    firstPos.x,
    firstPos.y,
    1.1,
    prompts,
  );

  onStatus?.({
    state: "ready",
    provider: sessions.provider,
    message: `SAM2.1 Ready (${sessions.provider.toUpperCase()}) — Click to trace • Ctrl+L-click add • Ctrl+R-click remove`,
  });

  return polygon;
}

/**
 * Runs SAM2.1 encoder (cached per image) and decoder for a single positive click in normalized [0..1] coordinates,
 * returning normalized polygon vertices for LS-Marker.
 */
export async function traceSam2ObjectAtPoint(
  imgEl: HTMLImageElement,
  srcKey: string,
  clickNormX: number,
  clickNormY: number,
  onStatus?: (status: Sam2Status) => void,
): Promise<[number, number][] | null> {
  return traceSam2WithPrompts(
    imgEl,
    srcKey,
    [{ x: clickNormX, y: clickNormY, label: 1 }],
    onStatus,
  );
}
