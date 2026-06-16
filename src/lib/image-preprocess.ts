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
 * Convert a blob URL to base64.
 * Uses FileReader which handles large files without the btoa stack-overflow problem.
 */
export async function urlToBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const res  = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => {
      const dataUrl = reader.result as string;
      const comma   = dataUrl.indexOf(",");
      const base64  = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      resolve({ base64, mimeType: blob.type || "image/jpeg" });
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Barcode-specific preprocessing: enhance contrast, convert to B&W, optimize for scanner.
 * This produces high-contrast black & white images ideal for barcode detection.
 */
export async function preprocessImageForBarcode(
  inputUrl: string,
  maxDim = 1600
): Promise<{ url: string; width: number; height: number }> {
  const img = await loadImage(inputUrl);
  const originalWidth = img.naturalWidth;
  const originalHeight = img.naturalHeight;

  // Resize to larger size for barcode clarity
  const scale = Math.min(1, maxDim / Math.max(originalWidth, originalHeight));
  const width = Math.round(originalWidth * scale);
  const height = Math.round(originalHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);

  // Get image data
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Convert to grayscale and apply high contrast for barcode detection
  const contrastFactor = 2.0; // Aggressive contrast for barcodes
  const brightnessOffset = 5;
  const threshold = 128; // Adaptive threshold

  // First pass: enhance contrast in grayscale
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    
    // Convert to grayscale
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    
    // Enhance contrast
    const enhanced = Math.min(255, Math.max(0, (gray - 128) * contrastFactor + 128 + brightnessOffset));
    
    // Apply threshold to create sharp B&W
    const bw = enhanced > threshold ? 255 : 0;

    data[i] = bw;
    data[i + 1] = bw;
    data[i + 2] = bw;
    // alpha stays unchanged
  }

  // Apply sharpening for barcode edges
  const temp = new Uint8ClampedArray(data);
  const kernel = [-1, -1, -1, -1, 9, -1, -1, -1, -1]; // Sharpen kernel
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let k = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            sum += temp[((y + ky) * width + (x + kx)) * 4 + c] * kernel[k++];
          }
        }
        const idx = (y * width + x) * 4 + c;
        data[idx] = Math.min(255, Math.max(0, sum));
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Canvas toBlob failed"));
          return;
        }
        resolve({
          url: URL.createObjectURL(blob),
          width,
          height,
        });
      },
      "image/jpeg",
      0.98 // Very high quality for barcode detection
    );
  });
}
