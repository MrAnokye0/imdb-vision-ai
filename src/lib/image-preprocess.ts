"use client";

/**
 * Image Preprocessing Pipeline
 *
 * Runs entirely in the browser using the Canvas API.
 * Steps:
 *  1. Resize to a standard analysis size (max 1200px longest edge)
 *  2. Increase contrast and brightness to improve OCR accuracy
 *  3. Sharpen edges (unsharp mask approximation) for barcode readability
 *  4. Return a processed data URL
 */

export interface PreprocessOptions {
  /** Maximum dimension in pixels (default: 1200) */
  maxDim?: number;
  /** Contrast multiplier 0–3 (default: 1.3) */
  contrast?: number;
  /** Brightness offset -255–255 (default: 10) */
  brightness?: number;
  /** Whether to apply sharpening (default: true) */
  sharpen?: boolean;
}

/**
 * Load an image URL (blob URL or data URL) into an HTMLImageElement.
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src     = url;
  });
}

/**
 * Apply contrast + brightness adjustment to ImageData.
 * Formula: pixel = (pixel - 128) * contrast + 128 + brightness
 */
function applyContrastBrightness(
  data: Uint8ClampedArray,
  contrast: number,
  brightness: number
): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = Math.min(255, Math.max(0, (data[i]     - 128) * contrast + 128 + brightness));
    data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] - 128) * contrast + 128 + brightness));
    data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] - 128) * contrast + 128 + brightness));
    // alpha channel [i+3] unchanged
  }
}

/**
 * Unsharp mask: sharpen = original + amount * (original - blur).
 * We approximate blur with a 3x3 box filter.
 */
function applySharpen(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  amount = 0.4
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data);
  const kernel = [1, 1, 1, 1, 8, 1, 1, 1, 1]; // box blur weights (center = 8, total = 16)

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      for (let c = 0; c < 3; c++) { // r, g, b
        let blurred = 0;
        let k = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            blurred += data[((y + ky) * width + (x + kx)) * 4 + c] * kernel[k++];
          }
        }
        blurred /= 16;
        const idx = (y * width + x) * 4 + c;
        const sharpened = data[idx] + amount * (data[idx] - blurred);
        out[idx] = Math.min(255, Math.max(0, sharpened));
      }
    }
  }
  return out;
}

/**
 * Main preprocessing function.
 * Returns a processed object URL and the processed dimensions.
 */
export async function preprocessImage(
  inputUrl: string,
  options: PreprocessOptions = {}
): Promise<{ url: string; width: number; height: number; originalWidth: number; originalHeight: number }> {
  const {
    maxDim    = 1200,
    contrast  = 1.3,
    brightness = 10,
    sharpen   = true,
  } = options;

  const img = await loadImage(inputUrl);
  const originalWidth  = img.naturalWidth;
  const originalHeight = img.naturalHeight;

  // ── Resize ─────────────────────────────────────────────────────────────────
  const scale   = Math.min(1, maxDim / Math.max(originalWidth, originalHeight));
  const width   = Math.round(originalWidth  * scale);
  const height  = Math.round(originalHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width  = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d")!;

  // Enable image smoothing for quality downscaling
  ctx.imageSmoothingEnabled  = true;
  ctx.imageSmoothingQuality  = "high";

  ctx.drawImage(img, 0, 0, width, height);

  // ── Contrast + brightness ─────────────────────────────────────────────────
  const imageData = ctx.getImageData(0, 0, width, height);
  applyContrastBrightness(imageData.data, contrast, brightness);

  // ── Sharpening ─────────────────────────────────────────────────────────────
  if (sharpen) {
    const sharpened = applySharpen(imageData.data, width, height, 0.4);
    imageData.data.set(sharpened);
  }

  ctx.putImageData(imageData, 0, 0);

  // ── Return blob URL ────────────────────────────────────────────────────────
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) { reject(new Error("Canvas toBlob failed")); return; }
        resolve({
          url:            URL.createObjectURL(blob),
          width,
          height,
          originalWidth,
          originalHeight,
        });
      },
      "image/jpeg",
      0.92 // high quality JPEG
    );
  });
}

/**
 * Convert a preprocessed blob URL to a base64 string for API calls.
 */
export async function urlToBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const res    = await fetch(url);
  const blob   = await res.blob();
  const buffer = await blob.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  return { base64, mimeType: blob.type || "image/jpeg" };
}
