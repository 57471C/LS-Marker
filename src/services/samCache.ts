export const CACHE_NAME = "ls-marker-sam2-cache-v1";

export type FetchModelMeta = {
  fromCache: boolean;
  loadTimeMs: number;
  byteLength: number;
};

function hasCacheStorage(): boolean {
  return (
    typeof window !== "undefined" &&
    "caches" in window &&
    Boolean(window.caches) &&
    typeof window.caches.open === "function"
  );
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

async function readStreamWithProgress(
  response: Response,
  onProgress?: (percentage: number) => void,
): Promise<ArrayBuffer> {
  const contentLengthHeader = response.headers.get("content-length");
  const totalBytes = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : 0;

  if (!response.body || typeof response.body.getReader !== "function") {
    const buffer = await response.arrayBuffer();
    onProgress?.(100);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  onProgress?.(0);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.byteLength > 0) {
      chunks.push(value);
      receivedBytes += value.byteLength;
      if (totalBytes > 0) {
        const percentage = Math.min(
          99,
          Math.max(0, Math.round((receivedBytes / totalBytes) * 100)),
        );
        onProgress?.(percentage);
      }
    }
  }

  const combined = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  onProgress?.(100);
  return combined.buffer;
}

function assertValidOnnxBuffer(buffer: ArrayBuffer, url: string): void {
  if (buffer.byteLength < 1024) {
    throw new Error(`Model file at ${url} is unexpectedly small (${buffer.byteLength} bytes).`);
  }
  const head = new Uint8Array(buffer, 0, Math.min(64, buffer.byteLength));
  const prefix = new TextDecoder("utf-8", { fatal: false }).decode(head).trimStart().toLowerCase();
  if (prefix.startsWith("<!doctype") || prefix.startsWith("<html")) {
    throw new Error(
      `Model file at ${url} returned an HTML page instead of an ONNX binary. Ensure the .onnx weights exist in /public/models.`,
    );
  }
}

/**
 * Fetches an ONNX model binary using the browser's persistent Cache Storage API (`window.caches`).
 * - Cache Hit: Reads the `ArrayBuffer` directly from disk and logs the load time in milliseconds.
 * - Cache Miss: Streams the response with a `ReadableStreamDefaultReader` to report 0–100% download
 *   progress via `onProgress`, stores a cloned `Response` in `CACHE_NAME`, and returns the `ArrayBuffer`.
 * - Fallback: Falls back to standard `fetch(url)` if `window.caches` is unavailable (e.g., non-secure context).
 */
export async function fetchModelWithCache(
  url: string,
  onProgress?: (percentage: number) => void,
  onMeta?: (meta: FetchModelMeta) => void,
): Promise<ArrayBuffer> {
  const t0 = nowMs();

  if (hasCacheStorage()) {
    try {
      const cache = await window.caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(url);
      if (cachedResponse) {
        const buffer = await cachedResponse.arrayBuffer();
        assertValidOnnxBuffer(buffer, url);
        const loadTimeMs = Math.max(1, Math.round(nowMs() - t0));
        console.info(
          `[SAM2 Cache] Loaded ${url} from local disk cache (${CACHE_NAME}) in ${loadTimeMs}ms (${(
            buffer.byteLength / (1024 * 1024)
          ).toFixed(1)} MB)`,
        );
        onProgress?.(100);
        onMeta?.({ fromCache: true, loadTimeMs, byteLength: buffer.byteLength });
        return buffer;
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch model ${url} (HTTP ${response.status})`);
      }

      const buffer = await readStreamWithProgress(response, onProgress);
      assertValidOnnxBuffer(buffer, url);

      try {
        await cache.put(
          url,
          new Response(buffer.slice(0), {
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Length": String(buffer.byteLength),
            },
          }),
        );
      } catch (cachePutErr) {
        console.warn(`[SAM2 Cache] Failed to store ${url} in ${CACHE_NAME}:`, cachePutErr);
      }

      const loadTimeMs = Math.max(1, Math.round(nowMs() - t0));
      console.info(
        `[SAM2 Cache] Downloaded and cached ${url} in ${loadTimeMs}ms (${(
          buffer.byteLength / (1024 * 1024)
        ).toFixed(1)} MB)`,
      );
      onMeta?.({ fromCache: false, loadTimeMs, byteLength: buffer.byteLength });
      return buffer;
    } catch (err) {
      // If cache open/match failed due to security policy, fall through to direct fetch
      if (err instanceof Error && err.message.startsWith("Failed to fetch model")) {
        throw err;
      }
      if (err instanceof Error && err.message.includes("Model file at")) {
        throw err;
      }
      console.warn(`[SAM2 Cache] Cache API error for ${url}, falling back to network fetch:`, err);
    }
  }

  // Fallback: direct network fetch when window.caches is unavailable
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch model ${url} (HTTP ${response.status})`);
  }
  const buffer = await readStreamWithProgress(response, onProgress);
  assertValidOnnxBuffer(buffer, url);
  const loadTimeMs = Math.max(1, Math.round(nowMs() - t0));
  onMeta?.({ fromCache: false, loadTimeMs, byteLength: buffer.byteLength });
  return buffer;
}

/**
 * Deletes the `ls-marker-sam2-cache-v1` Cache Storage container so updated ONNX weights
 * are re-downloaded on the next session initialization.
 */
export async function clearModelCache(): Promise<boolean> {
  if (!hasCacheStorage()) return false;
  try {
    const deleted = await window.caches.delete(CACHE_NAME);
    console.info(`[SAM2 Cache] Cleared cache "${CACHE_NAME}" (deleted=${deleted})`);
    return deleted;
  } catch (err) {
    console.warn(`[SAM2 Cache] Failed to delete cache "${CACHE_NAME}":`, err);
    return false;
  }
}

/**
 * Checks whether a specific model URL is currently stored in `ls-marker-sam2-cache-v1`.
 */
export async function isModelCached(url: string): Promise<boolean> {
  if (!hasCacheStorage()) return false;
  try {
    const cache = await window.caches.open(CACHE_NAME);
    const match = await cache.match(url);
    return Boolean(match);
  } catch {
    return false;
  }
}
