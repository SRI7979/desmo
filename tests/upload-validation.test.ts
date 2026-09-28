import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";

import { MAX_IMAGE_BYTES } from "../src/lib/solver-schema";
import { InvalidImageError, validateImage } from "../src/lib/upload-validation";

const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC",
  "base64",
);

function invalid(status: number, text: RegExp) {
  return (error: unknown) => {
    assert.ok(error instanceof InvalidImageError);
    assert.equal(error.status, status);
    assert.match(error.message, text);
    return true;
  };
}

test("decodes valid PNG, JPEG, and WebP screenshots, including tiny valid images", async () => {
  await validateImage(pixel, "image/png");
  await validateImage(await sharp(pixel).jpeg().toBuffer(), "image/jpeg");
  await validateImage(await sharp(pixel).webp().toBuffer(), "image/webp");
});

test("rejects empty and oversized files before image decoding", async () => {
  await assert.rejects(validateImage(Buffer.alloc(0), "image/png"), invalid(400, /empty/));
  await assert.rejects(
    validateImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), "image/png"),
    invalid(413, /8 MB/),
  );
});

test("does not trust the uploaded MIME type or a plausible file signature", async () => {
  await assert.rejects(validateImage(pixel, "image/jpeg"), invalid(400, /match/));
  await assert.rejects(validateImage(pixel, "image/gif"), invalid(415, /GIF file \(image\/gif\)\. Upload a PNG, JPG, or WebP/));
  await assert.rejects(
    validateImage(Buffer.from("<svg width='1' height='1'></svg>"), "image/png"),
    invalid(400, /match|could not be read/),
  );
  await assert.rejects(validateImage(pixel.subarray(0, 33), "image/png"), invalid(400, /damaged/));
});

test("fully decodes pixels instead of accepting corrupt image data with valid metadata", async () => {
  const corrupt = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  const metadata = await sharp(corrupt).metadata();
  assert.equal(metadata.width, 1);
  await assert.rejects(validateImage(corrupt, "image/png"), invalid(400, /damaged/));
});

test("bounds decoded pixels even when compression keeps the file size small", async () => {
  const large = await sharp({
    create: { width: 5_000, height: 4_001, channels: 3, background: "white" },
  }).png().toBuffer();
  assert.ok(large.length < MAX_IMAGE_BYTES);
  await assert.rejects(validateImage(large, "image/png"), invalid(413, /20 megapixels/));
});

test("rejects extremely long images even below the pixel limit", async () => {
  const long = await sharp({
    create: { width: 12_001, height: 1, channels: 3, background: "white" },
  }).png().toBuffer();
  await assert.rejects(validateImage(long, "image/png"), invalid(413, /12,000/));
});

test("rejects animated WebP instead of silently solving only its first frame", async () => {
  const second = await sharp(pixel).negate().png().toBuffer();
  const animated = await sharp([pixel, second], { join: { animated: true } })
    .webp({ delay: 100, loop: 0 })
    .toBuffer();
  assert.equal((await sharp(animated).metadata()).pages, 2);
  await assert.rejects(validateImage(animated, "image/webp"), invalid(400, /still screenshot/));
});

test("detects PNG animation declarations even if the decoder exposes only one frame", async () => {
  // Valid acTL chunk declaring two frames, inserted after IHDR. Reject before
  // attempting to decode the frame data that a first-frame-only PNG loader skips.
  const animationControl = Buffer.from("000000086163544c0000000200000000f38d9370", "hex");
  const animated = Buffer.concat([pixel.subarray(0, 33), animationControl, pixel.subarray(33)]);
  await assert.rejects(validateImage(animated, "image/png"), invalid(400, /still screenshot/));
});
