import { contours } from "d3-contour";
import * as ort from "onnxruntime-web";
import simplify from "simplify-js";
import {
  CACHE_NAME,
  clearModelCache,
  fetchModelWithCache,
  isModelCached,
  type FetchModelMeta,
} from "./samCache";

export { CACHE_NAME, clearModelCache, fetchModelWithCache, isModelCached, type FetchModelMeta };

export type Sam2Provider = "webgpu" | "wasm";

export type SamModelStatus = "unloaded" | "downloading" | "loading_from_cache" | "ready" | "error";

export type Sam2PromptPoint = {
  x: number;
  y: number;
  label: 0 | 1;
};

export type Sam2Status =
  | { state: "idle"; samModelStatus?: SamModelStatus; downloadProgress?: number }
  | {
      state: "loading_models";
      samModelStatus: "downloading" | "loading_from_cache";
      downloadProgress: number;
      message: string;
    }
  | { state: "encoding"; provider: Sam2Provider; message: string }
  | {
      state: "ready";
      provider: Sam2Provider;
      fromCache?: boolean;
      loadTimeMs?: number;
      message: string;
    }
  | { state: "decoding"; provider: Sam2Provider; message: string }
  | { state: "error"; message: string };

export type SamModelStateSnapshot = {
  samModelStatus: SamModelStatus;
  downloadProgress: number;
  loadTimeMs: number | null;
  fromCache: boolean | null;
  provider: Sam2Provider | null;
  message: string;
};

export const ENCODER_URL = "/models/sam2_hiera_tiny_encoder.onnx";
export const DECODER_URL = "/models/sam2_hiera_tiny_decoder.onnx";
const SAM2_INPUT_SIZE = 1024;
const SAM2_MASK_SIZE = 256;

export const DEFAULT_MASK_LOGIT_THRESHOLD = 0.25;
export const DEFAULT_MASK_PROB_THRESHOLD = 0.58;
export const DEFAULT_SIMPLIFY_TOLERANCE = 0.9;
export const MIN_CONTOUR_AREA_PX = 15;

const IMAGENET_MEAN = [0.485, 0.456, 0.406] as const;
const IMAGENET_STD = [0.229, 0.224, 0.225] as const;

export type Sam2Sessions = {
  encoder: ort.InferenceSession;
  decoder: ort.InferenceSession;
  provider: Sam2Provider;
  fromCache: boolean;
  loadTimeMs: number;
};

type EncodedImageCache = {
  srcKey: string;
  image_embed: ort.Tensor;
  high_res_feats_0: ort.Tensor;
  high_res_feats_1: ort.Tensor;
};

let sessionsPromise: Promise<Sam2Sessions> | null = null;
let cachedBuffers: { encoderBuffer: ArrayBuffer; decoderBuffer: ArrayBuffer } | null = null;
let activeProvider: Sam2Provider = "wasm";
let encodedCache: EncodedImageCache | null = null;
let encodingInFlight: { srcKey: string; promise: Promise<EncodedImageCache> } | null = null;

let modelState: SamModelStateSnapshot = {
  samModelStatus: "unloaded",
  downloadProgress: 0,
  loadTimeMs: null,
  fromCache: null,
  provider: null,
  message: "",
};

const modelStateListeners = new Set<(snapshot: SamModelStateSnapshot) => void>();

function updateModelState(patch: Partial<SamModelStateSnapshot>) {
  modelState = { ...modelState, ...patch };
  for (const listener of modelStateListeners) {
    listener(modelState);
  }
}

export function getSamModelState(): SamModelStateSnapshot {
  return modelState;
}

export function subscribeSamModelState(
  listener: (snapshot: SamModelStateSnapshot) => void,
): () => void {
  modelStateListeners.add(listener);
  listener(modelState);
  return () => {
    modelStateListeners.delete(listener);
  };
}

export function isSam2Loaded(): boolean {
  return sessionsPromise !== null && modelState.samModelStatus === "ready";
}

export async function areAllSamModelsCached(): Promise<boolean> {
  const [encCached, decCached] = await Promise.all([
    isModelCached(ENCODER_URL),
    isModelCached(DECODER_URL),
  ]);
  return encCached && decCached;
}

export async function clearSamModelCacheAndReset(): Promise<boolean> {
  const deleted = await clearModelCache();
  sessionsPromise = null;
  cachedBuffers = null;
  encodedCache = null;
  encodingInFlight = null;
  updateModelState({
    samModelStatus: "unloaded",
    downloadProgress: 0,
    loadTimeMs: null,
    fromCache: null,
    provider: null,
    message: "SAM 2.1 local model cache cleared",
  });
  return deleted;
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

async function createSessionsFromBuffers(
  encoderBuffer: ArrayBuffer,
  decoderBuffer: ArrayBuffer,
  provider: Sam2Provider,
  fromCache: boolean,
  loadTimeMs: number,
  externalData?: ort.InferenceSession.SessionOptions["externalData"],
): Promise<Sam2Sessions> {
  configureOrtEnv();
  const options: ort.InferenceSession.SessionOptions = {
    executionProviders: [provider],
    graphOptimizationLevel: "disabled",
    ...(externalData ? { externalData } : {}),
  };
  const [encoder, decoder] = await Promise.all([
    ort.InferenceSession.create(encoderBuffer, options),
    ort.InferenceSession.create(decoderBuffer, options),
  ]);
  activeProvider = provider;
  return { encoder, decoder, provider, fromCache, loadTimeMs };
}

/**
 * Initializes the SAM 2.1 encoder and decoder ONNX Runtime sessions using persistent local
 * Cache Storage (`ls-marker-sam2-cache-v1`).
 * - Downloads models once with real-time 0–100% progress reporting (`samModelStatus = 'downloading'`).
 * - Subsequent visits load `ArrayBuffer`s directly from disk (`samModelStatus = 'loading_from_cache'`).
 */
export async function initSamModels(
  onStatus?: (status: Sam2Status) => void,
): Promise<Sam2Sessions> {
  if (!sessionsPromise) {
    sessionsPromise = (async () => {
      try {
        const alreadyCached = await areAllSamModelsCached();
        const initialStatus: "downloading" | "loading_from_cache" = alreadyCached
          ? "loading_from_cache"
          : "downloading";
        const initialMsg = alreadyCached
          ? "Loading SAM 2.1 models from local storage…"
          : "Caching SAM 2.1 models locally: 0%";

        updateModelState({
          samModelStatus: initialStatus,
          downloadProgress: alreadyCached ? 100 : 0,
          message: initialMsg,
        });
        onStatus?.({
          state: "loading_models",
          samModelStatus: initialStatus,
          downloadProgress: alreadyCached ? 100 : 0,
          message: initialMsg,
        });

        const progressParts = { encoder: 0, decoder: 0 };
        const emitProgress = (part: "encoder" | "decoder", p: number) => {
          progressParts[part] = p;
          // Encoder is ~104 MB (87%) and Decoder is ~16 MB (13%)
          const weighted = Math.min(
            100,
            Math.max(0, Math.round(progressParts.encoder * 0.87 + progressParts.decoder * 0.13)),
          );
          const currentMode =
            modelState.samModelStatus === "loading_from_cache"
              ? "loading_from_cache"
              : "downloading";
          const msg =
            currentMode === "loading_from_cache"
              ? "Loading SAM 2.1 models from local storage…"
              : `Caching SAM 2.1 models locally: ${weighted}%`;
          updateModelState({
            samModelStatus: currentMode,
            downloadProgress: weighted,
            message: msg,
          });
          onStatus?.({
            state: "loading_models",
            samModelStatus: currentMode,
            downloadProgress: weighted,
            message: msg,
          });
        };

        let encoderMeta: FetchModelMeta | null = null;
        let decoderMeta: FetchModelMeta | null = null;

        const [encoderBuffer, decoderBuffer] = await Promise.all([
          fetchModelWithCache(
            ENCODER_URL,
            (p) => emitProgress("encoder", p),
            (meta) => {
              encoderMeta = meta;
            },
          ),
          fetchModelWithCache(
            DECODER_URL,
            (p) => emitProgress("decoder", p),
            (meta) => {
              decoderMeta = meta;
            },
          ),
        ]);

        cachedBuffers = { encoderBuffer, decoderBuffer };
        const fromCache = Boolean(
          (encoderMeta as FetchModelMeta | null)?.fromCache &&
            (decoderMeta as FetchModelMeta | null)?.fromCache,
        );
        const cacheLoadMs = Math.max(
          (encoderMeta as FetchModelMeta | null)?.loadTimeMs ?? 1,
          (decoderMeta as FetchModelMeta | null)?.loadTimeMs ?? 1,
        );

        let sessions: Sam2Sessions | null = null;
        const tryWebGpu = await canUseWebGpu();
        if (tryWebGpu) {
          try {
            sessions = await createSessionsFromBuffers(
              encoderBuffer,
              decoderBuffer,
              "webgpu",
              fromCache,
              cacheLoadMs,
            );
          } catch (err) {
            console.warn("[SAM2] WebGPU session creation failed, falling back to WASM:", err);
          }
        }

        if (!sessions) {
          sessions = await createSessionsFromBuffers(
            encoderBuffer,
            decoderBuffer,
            "wasm",
            fromCache,
            cacheLoadMs,
          );
        }

        const readyMessage = fromCache
          ? `SAM 2.1 loaded from local storage (${cacheLoadMs}ms)`
          : `SAM 2.1 cached locally (${sessions.provider.toUpperCase()})`;

        updateModelState({
          samModelStatus: "ready",
          downloadProgress: 100,
          fromCache,
          loadTimeMs: cacheLoadMs,
          provider: sessions.provider,
          message: readyMessage,
        });

        onStatus?.({
          state: "ready",
          provider: sessions.provider,
          fromCache,
          loadTimeMs: cacheLoadMs,
          message: readyMessage,
        });

        return sessions;
      } catch (err) {
        sessionsPromise = null;
        const msg =
          err instanceof Error ? err.message : "Failed to load SAM2.1 models from /public/models";
        updateModelState({
          samModelStatus: "error",
          message: msg,
        });
        onStatus?.({
          state: "error",
          message: msg,
        });
        throw new Error(msg);
      }
    })();
  }
  return sessionsPromise;
}

export async function getSam2Sessions(
  onStatus?: (status: Sam2Status) => void,
): Promise<Sam2Sessions> {
  return initSamModels(onStatus);
}

async function fallbackToWasmSessions(): Promise<Sam2Sessions> {
  if (cachedBuffers) {
    return createSessionsFromBuffers(
      cachedBuffers.encoderBuffer,
      cachedBuffers.decoderBuffer,
      "wasm",
      modelState.fromCache ?? true,
      modelState.loadTimeMs ?? 1,
    );
  }
  const [encoderBuffer, decoderBuffer] = await Promise.all([
    fetchModelWithCache(ENCODER_URL),
    fetchModelWithCache(DECODER_URL),
  ]);
  cachedBuffers = { encoderBuffer, decoderBuffer };
  return createSessionsFromBuffers(encoderBuffer, decoderBuffer, "wasm", true, 1);
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
      fromCache: modelState.fromCache ?? undefined,
      loadTimeMs: modelState.loadTimeMs ?? undefined,
      message: `SAM2.1 Ready (${activeProvider.toUpperCase()})`,
    });
    return encodedCache;
  }

  if (encodingInFlight && encodingInFlight.srcKey === srcKey) {
    return encodingInFlight.promise;
  }

  const promise = (async () => {
    let sessions = await initSamModels(onStatus);
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
        sessionsPromise = fallbackToWasmSessions();
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
      fromCache: sessions.fromCache,
      loadTimeMs: sessions.loadTimeMs,
      message: sessions.fromCache
        ? `SAM 2.1 loaded from local storage (${sessions.loadTimeMs}ms) — click object to trace`
        : `SAM2.1 Ready (${sessions.provider.toUpperCase()}) — click object to trace`,
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
 * Converts SAM2 decoder output logits or probabilities `[1, numMasks, maskH, maskW]` into normalized `[0..1]`
 * polygon vertices matching LS-Marker's `StageBox.points` format (`[number, number][]`).
 *
 * Uses tighter foreground thresholding (`rawLogit > 0.25` or `probability > 0.58`) to eliminate background
 * halos around metallic chamfers, filters out internal holes and micro-islands (`< 15 px²`), and simplifies
 * with Douglas-Peucker (`tolerance = 0.9 px`, `highQuality = true`).
 */
export function maskToPolygon(
  masksData: Float32Array | number[],
  iouData: Float32Array | number[],
  numMasks: number,
  maskW: number,
  maskH: number,
  clickNormX: number,
  clickNormY: number,
  simplifyTolerance = DEFAULT_SIMPLIFY_TOLERANCE,
  prompts?: Sam2PromptPoint[],
  maskThreshold = DEFAULT_MASK_LOGIT_THRESHOLD,
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

    // Detect whether decoder output is already probability [0.0, 1.0] or raw logits
    let minVal = Number.POSITIVE_INFINITY;
    let maxVal = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < area; i++) {
      const v = Number(masksData[offset + i]);
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
    const isProbabilityInput = minVal >= 0.0 && maxVal <= 1.0;
    const probCutoff =
      maskThreshold > 0.0 && maskThreshold < 1.0 && maskThreshold !== DEFAULT_MASK_LOGIT_THRESHOLD
        ? maskThreshold
        : DEFAULT_MASK_PROB_THRESHOLD;

    const values = new Array<number>(area);
    let positiveCount = 0;
    for (let i = 0; i < area; i++) {
      const val = Number(masksData[offset + i]);
      if (isProbabilityInput) {
        const probability = val;
        const isForeground = probability > probCutoff;
        if (isForeground) positiveCount++;
        values[i] = isForeground ? 1 : 0;
      } else {
        const rawLogit = val;
        const isForeground = rawLogit > maskThreshold;
        if (isForeground) positiveCount++;
        // Shift logit by maskThreshold so the 0.5 iso-surface aligns with rawLogit === maskThreshold
        const shifted = Math.max(-15, Math.min(15, rawLogit - maskThreshold));
        values[i] = 1 / (1 + Math.exp(-shifted));
      }
    }

    // Skip micro-noise (< 15 px²) or full-frame background masks
    if (positiveCount < MIN_CONTOUR_AREA_PX || positiveCount > area * 0.96) {
      continue;
    }

    const generated = contours().size([maskW, maskH]).thresholds([0.5])(values);
    if (!generated.length || !generated[0].coordinates.length) {
      continue;
    }

    const polygons = generated[0].coordinates;
    // Extract only the largest valid external boundary contour loop (poly[0]),
    // discarding internal holes (poly.slice(1)) and micro-islands smaller than 15 px².
    let bestRing: number[][] | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const poly of polygons) {
      const outerRing = poly[0];
      if (!outerRing || outerRing.length < 4) continue;
      const ringArea = polygonSignedArea(outerRing);
      if (ringArea < MIN_CONTOUR_AREA_PX) continue;

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
    const clampedTolerance = Math.min(1.2, Math.max(0.8, simplifyTolerance));
    const simplified = simplify(rawPoints, clampedTolerance, true);
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
  let sessions = await initSamModels(onStatus);

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
      sessionsPromise = fallbackToWasmSessions();
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
    DEFAULT_SIMPLIFY_TOLERANCE,
    prompts,
    DEFAULT_MASK_LOGIT_THRESHOLD,
  );

  onStatus?.({
    state: "ready",
    provider: sessions.provider,
    fromCache: sessions.fromCache,
    loadTimeMs: sessions.loadTimeMs,
    message: `SAM2.1 Ready (${sessions.provider.toUpperCase()}) — Left-click (+) • Right-click/Shift+click (−) • Enter to commit`,
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
