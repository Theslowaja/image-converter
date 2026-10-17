import UPNG from "upng-js";
import jpeg from "jpeg-js";

export const MAX_IMAGE_SIZE = 1024;

export interface DecodedImage {
  width: number;
  height: number;
  channels: 3 | 4;
  data: Uint8Array; // raw RGB or RGBA pixels
}

/**
 * Calculates normalized dimensions matching VeloverTemplate NormalizeImage logic.
 */
export function calculateNormalizedSize(
  width: number,
  height: number,
  maxSize: number = MAX_IMAGE_SIZE
): { width: number; height: number; resized: boolean } {
  const coefW = width / maxSize;
  const coefH = height / maxSize;

  if (coefH <= 1 && coefW <= 1) {
    return { width, height, resized: false };
  }

  if (coefW >= coefH) {
    return {
      width: maxSize,
      height: Math.max(1, Math.floor(height / coefW)),
      resized: true
    };
  } else {
    return {
      width: Math.max(1, Math.floor(width / coefH)),
      height: maxSize,
      resized: true
    };
  }
}

/**
 * Bilinear image resizing matching OpenCV's cv::INTER_LINEAR default behavior.
 */
export function resizeBilinear(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  channels: 3 | 4
): Uint8Array {
  if (srcW === dstW && srcH === dstH) {
    return src;
  }

  const dst = new Uint8Array(dstW * dstH * channels);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;

  for (let y = 0; y < dstH; y++) {
    const srcY = (y + 0.5) * yRatio - 0.5;
    const y0 = Math.max(0, Math.floor(srcY));
    const y1 = Math.min(srcH - 1, y0 + 1);
    const yLerp = srcY - y0;

    for (let x = 0; x < dstW; x++) {
      const srcX = (x + 0.5) * xRatio - 0.5;
      const x0 = Math.max(0, Math.floor(srcX));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const xLerp = srcX - x0;

      const dstIdx = (y * dstW + x) * channels;
      const idx00 = (y0 * srcW + x0) * channels;
      const idx10 = (y0 * srcW + x1) * channels;
      const idx01 = (y1 * srcW + x0) * channels;
      const idx11 = (y1 * srcW + x1) * channels;

      for (let c = 0; c < channels; c++) {
        const top = src[idx00 + c] * (1 - xLerp) + src[idx10 + c] * xLerp;
        const bottom = src[idx01 + c] * (1 - xLerp) + src[idx11 + c] * xLerp;
        const val = top * (1 - yLerp) + bottom * yLerp;
        dst[dstIdx + c] = Math.round(val);
      }
    }
  }

  return dst;
}

/**
 * Decodes PNG or JPEG image buffers into raw RGBA/RGB pixels and normalizes dimensions.
 */
export async function processImage(
  buffer: ArrayBuffer,
  useOpenCV: boolean = false
): Promise<DecodedImage> {
  const bytes = new Uint8Array(buffer);

  // Check if OpenCV is explicitly requested and available
  if (useOpenCV) {
    try {
      const cvModule = await import("@techstark/opencv-js");
      const cv = (cvModule as any).default || cvModule;
      if (typeof cv?.matFromImageData === "function" || typeof cv?.Mat === "function") {
        // OpenCV pipeline placeholder for environments where opencv-js wasm is bundled
      }
    } catch {
      // Fallback silently to ultra-fast native engine
    }
  }

  // Detect format by magic bytes
  const isPng =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;

  let width = 0;
  let height = 0;
  let rawPixels: Uint8Array;
  let channels: 3 | 4 = 4;

  if (isPng) {
    const png = UPNG.decode(buffer);
    width = png.width;
    height = png.height;
    const rgba = UPNG.toRGBA8(png)[0];
    rawPixels = new Uint8Array(rgba);
    channels = 4;
  } else if (isJpg) {
    const jpegData = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true });
    width = jpegData.width;
    height = jpegData.height;
    rawPixels = new Uint8Array(jpegData.data);
    channels = 4;
  } else {
    // Attempt UPNG fallback
    try {
      const png = UPNG.decode(buffer);
      width = png.width;
      height = png.height;
      const rgba = UPNG.toRGBA8(png)[0];
      rawPixels = new Uint8Array(rgba);
      channels = 4;
    } catch {
      throw new Error("Unsupported image format. Please supply a valid PNG or JPEG image.");
    }
  }

  // Check if image needs normalization (max 1024x1024)
  const norm = calculateNormalizedSize(width, height, MAX_IMAGE_SIZE);
  if (norm.resized) {
    rawPixels = resizeBilinear(rawPixels, width, height, norm.width, norm.height, channels);
    width = norm.width;
    height = norm.height;
  }

  return {
    width,
    height,
    channels,
    data: rawPixels
  };
}
