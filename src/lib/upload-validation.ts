import sharp from "sharp";

import { MAX_IMAGE_BYTES } from "./solver-schema";

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
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new InvalidImageError("Use an image smaller than 8 MB.", 413);
  }
  const expectedFormat = IMAGE_FORMATS[mime];
  if (!expectedFormat) {
    throw new InvalidImageError("Upload a PNG, JPEG, or WebP image.");
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
