import sharp from "sharp";

import { MAX_IMAGE_BYTES } from "./solver-schema";

/**
 * The upload size limit: MAX_IMAGE_BYTES (default 8 MB), read per request.
 * On Vercel, request bodies over 4.5 MB are refused by the platform before
 * the app runs, so a limit above that only applies on other hosts.
 */
export function maxImageBytes(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number(env.MAX_IMAGE_BYTES?.trim());
  return env.MAX_IMAGE_BYTES?.trim() && Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : MAX_IMAGE_BYTES;
}

export function formatBytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 1) return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "That screenshot is 9.3 MB; use an image under 8 MB." */
export function tooLargeMessage(size: number | null, limit: number): string {
  return size
    ? `That screenshot is ${formatBytes(size)}, over the ${formatBytes(limit)} limit. Crop it or export a smaller image.`
    : `That screenshot is over the ${formatBytes(limit)} limit. Crop it or export a smaller image.`;
}

/** "That file is a GIF (image/gif); use a PNG, JPG, or WebP screenshot." */
export function unsupportedTypeMessage(mime: string): string {
  const kind = mime.trim() ? `a ${mime.split("/").pop()?.toUpperCase()} file (${mime})` : "a file with no image type";
  return `That is ${kind}. Upload a PNG, JPG, or WebP screenshot.`;
}

const MAX_IMAGE_PIXELS = 20_000_000;
const MAX_IMAGE_SIDE = 12_000;
const IMAGE_FORMATS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
};

export class InvalidImageError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "InvalidImageError";
  }
}

// libvips can expose only the first frame of an APNG. Inspect actual PNG chunks,
// rather than searching compressed pixel data for a coincidental "acTL" string.
function hasPngAnimation(bytes: Buffer): boolean {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return false; // The decoder rejects truncation below.
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "acTL") return true;
    if (type === "IEND") return false;
    offset = end;
  }
  return false;
}

/** Validate actual pixels before sending or retaining an untrusted upload. */
export async function validateImage(bytes: Buffer, mime: string): Promise<void> {
  if (bytes.length === 0) {
    throw new InvalidImageError("This image is empty. Upload a screenshot of one math question.");
  }
  const limit = maxImageBytes();
  if (bytes.length > limit) {
    throw new InvalidImageError(tooLargeMessage(bytes.length, limit), 413);
  }
  const expectedFormat = IMAGE_FORMATS[mime];
  if (!expectedFormat) {
    throw new InvalidImageError(unsupportedTypeMessage(mime), 415);
  }

  try {
    const decoder = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: MAX_IMAGE_PIXELS,
      sequentialRead: true,
    });
    const metadata = await decoder.metadata();
    if (metadata.format !== expectedFormat) {
      throw new InvalidImageError(
        "The file does not match its image type. Export a new PNG, JPEG, or WebP screenshot.",
      );
    }
    if (
      (metadata.pages ?? 1) > 1 ||
      (metadata.format === "png" && hasPngAnimation(bytes))
    ) {
      throw new InvalidImageError(
        "Animated or multi-page images are not supported. Upload one still screenshot.",
      );
    }
    const { width, height } = metadata;
    if (
      !width ||
      !height ||
      width > MAX_IMAGE_SIDE ||
      height > MAX_IMAGE_SIDE ||
      width * height > MAX_IMAGE_PIXELS
    ) {
      throw new InvalidImageError(
        "This image is too large. Crop it to one question (up to 20 megapixels and 12,000 pixels per side).",
        413,
      );
    }

    // Metadata/header checks alone accept some corrupt or truncated image files.
    // Decoding all pixels also exercises the decoder's input-pixel safety limit.
    await decoder.raw().toBuffer();
  } catch (error) {
    if (error instanceof InvalidImageError) throw error;
    if (error instanceof Error && /pixel limit/i.test(error.message)) {
      throw new InvalidImageError(
        "This image is too large. Crop it to one question (up to 20 megapixels).",
        413,
      );
    }
    throw new InvalidImageError(
      "This image could not be read or is damaged. Export a new screenshot and try again.",
    );
  }
}

/** Vision tokens and upload time grow with pixels; SAT screenshots need no more than this. */
export const MODEL_IMAGE_MAX_EDGE = 1600;

export type ModelImage = { bytes: Buffer; mime: string; width: number; height: number; resized: boolean };

/**
 * The image sent to OpenAI: the upload itself when its long edge is at most
 * 1600 px, otherwise a copy scaled to fit 1600 x 1600 in the same format
 * (PNG stays lossless, so small text stays sharp). Run only after
 * validateImage. The original is still what history saves and what the
 * cache hashes, so re-uploads keep matching.
 */
export async function prepareModelImage(bytes: Buffer, mime: string, maxEdge = MODEL_IMAGE_MAX_EDGE): Promise<ModelImage> {
  const image = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS });
  const { width = 0, height = 0 } = await image.metadata();
  if (Math.max(width, height) <= maxEdge) return { bytes, mime, width, height, resized: false };
  const resized = image.resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true });
  const output =
    mime === "image/jpeg" ? resized.jpeg({ quality: 90, mozjpeg: true })
      : mime === "image/webp" ? resized.webp({ quality: 90 })
        : resized.png({ compressionLevel: 9 });
  const { data, info } = await output.toBuffer({ resolveWithObject: true });
  return { bytes: data, mime, width: info.width, height: info.height, resized: true };
}
