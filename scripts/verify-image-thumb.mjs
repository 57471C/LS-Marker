import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { ensureThumb, removeProjectThumbs } from "./labelling-api.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ls-marker-thumb-"));
const originals = path.join(root, "originals");
const wide = path.join(originals, "wide.PNG");
const nested = path.join(originals, "nested", "shot.jpeg");
const tiny = path.join(originals, "tiny.png");

async function jpegFile(file, width, height) {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i += 64) raw[i] = (i * 17) % 256;
  await sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 })
    .toFile(file);
}

try {
  fs.mkdirSync(path.join(originals, "nested"), { recursive: true });
  await jpegFile(wide, 2400, 1600);
  await jpegFile(nested, 800, 800);
  await jpegFile(tiny, 20, 10);
  const wideBefore = fs.statSync(wide);
  const nestedBefore = fs.statSync(nested);

  const dest = await ensureThumb(7, "wide.PNG", { root, sourceFull: wide });
  assert.equal(path.resolve(dest), path.resolve(root, "data", "thumbs", "7", "wide.jpg"));
  const meta = await sharp(dest).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, 192);
  assert.equal(meta.height, 128);
  assert.ok(fs.statSync(dest).size < wideBefore.size);

  const wideAfter = fs.statSync(wide);
  assert.equal(wideAfter.size, wideBefore.size);
  assert.equal(wideAfter.mtimeMs, wideBefore.mtimeMs);
  assert.deepEqual(fs.readdirSync(originals).sort(), ["nested", "tiny.png", "wide.PNG"]);

  const stamped = fs.statSync(dest);
  const again = await ensureThumb(7, "wide.PNG", { root, sourceFull: wide });
  const restamp = fs.statSync(again);
  assert.equal(restamp.mtimeMs, stamped.mtimeMs);
  assert.equal(restamp.size, stamped.size);
  assert.equal(fs.statSync(wide).mtimeMs, wideBefore.mtimeMs);

  fs.writeFileSync(dest, Buffer.from("sentinel-thumb"));
  const skipped = await ensureThumb(7, "wide.PNG", { root, sourceFull: wide });
  assert.equal(fs.readFileSync(skipped, "utf8"), "sentinel-thumb");
  assert.equal(fs.statSync(wide).size, wideBefore.size);

  const nestedDest = await ensureThumb(7, "nested/shot.jpeg", { root, sourceFull: nested });
  assert.equal(
    path.resolve(nestedDest),
    path.resolve(root, "data", "thumbs", "7", "nested", "shot.jpg"),
  );
  const nestedMeta = await sharp(nestedDest).metadata();
  assert.equal(nestedMeta.format, "jpeg");
  assert.ok((nestedMeta.width ?? 0) <= 192 && (nestedMeta.height ?? 0) <= 192);
  assert.equal(fs.statSync(nested).size, nestedBefore.size);
  assert.equal(fs.statSync(nested).mtimeMs, nestedBefore.mtimeMs);

  const tinyDest = await ensureThumb(7, "tiny.png", { root, sourceFull: tiny });
  const tinyMeta = await sharp(tinyDest).metadata();
  assert.equal(tinyMeta.width, 20);
  assert.equal(tinyMeta.height, 10);

  await assert.rejects(
    () => ensureThumb(7, "../wide.PNG", { root, sourceFull: wide }),
    /Bad image name/,
  );
  await assert.rejects(
    () => ensureThumb(7, "nested/../../wide.PNG", { root, sourceFull: wide }),
    /Bad image name/,
  );
  await assert.rejects(
    () => ensureThumb(0, "wide.PNG", { root, sourceFull: wide }),
    /Bad project id/,
  );
  assert.equal(fs.existsSync(path.join(root, "wide.jpg")), false);
  assert.equal(fs.existsSync(path.join(root, "data", "wide.jpg")), false);

  const thumbRoot = path.join(root, "data", "thumbs", "7");
  assert.equal(fs.existsSync(thumbRoot), true);
  await removeProjectThumbs(root, 7);
  assert.equal(fs.existsSync(thumbRoot), false);
  assert.equal(fs.statSync(wide).size, wideBefore.size);
  assert.equal(fs.statSync(nested).size, nestedBefore.size);
  await removeProjectThumbs(root, 7);

  console.log(
    `thumb ${meta.width}x${meta.height}; source ${wideBefore.size} bytes; cleanup removed data/thumbs/7`,
  );
  console.log("verify-image-thumb: ok");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
