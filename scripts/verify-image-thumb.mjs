import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { renderImageThumb } from "./labelling-api.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-marker-thumb-"));
const file = path.join(dir, "wide.jpg");

try {
  const raw = Buffer.alloc(2400 * 1600 * 3);
  for (let i = 0; i < raw.length; i += 64) raw[i] = (i * 17) % 256;
  await sharp(raw, { raw: { width: 2400, height: 1600, channels: 3 } })
    .jpeg({ quality: 90 })
    .toFile(file);
  const sourceSize = fs.statSync(file).size;

  const thumb = await renderImageThumb(file, 96);
  const meta = await sharp(thumb).metadata();
  assert.equal(meta.format, "jpeg");
  assert.ok((meta.width ?? 0) <= 96 && (meta.width ?? 0) >= 16);
  assert.ok((meta.height ?? 0) <= 96 && (meta.height ?? 0) >= 16);
  assert.ok(thumb.length < sourceSize, "thumb must be smaller than the source photo");
  assert.ok(thumb.length < 80_000, `thumb is ${thumb.length} bytes`);

  const clamped = await renderImageThumb(file, 4000);
  const clampedMeta = await sharp(clamped).metadata();
  assert.ok((clampedMeta.width ?? 0) <= 256);
  assert.ok((clampedMeta.height ?? 0) <= 256);

  console.log(
    `thumb ${meta.width}x${meta.height} ${thumb.length} bytes; source ${sourceSize} bytes`,
  );
  console.log("verify-image-thumb: ok");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
