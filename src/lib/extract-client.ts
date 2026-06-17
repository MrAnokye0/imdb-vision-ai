"use client";

import { BrowserMultiFormatReader } from "@zxing/library";
import { lookupBarcode } from "@/src/lib/barcode-lookup";
import { findByBarcode } from "@/src/lib/firestore";
import { urlToBase64 } from "@/src/lib/image-preprocess";
import { runOCR } from "@/src/lib/ocr";
import { runProductIntelligenceEngine, toProductRecord } from "@/src/lib/product-intelligence-engine";
import { normalizeProduct, generateValidationReport } from "@/src/lib/validation";
import type { ProductRecord, ExtractionSource, PipelineStep } from "@/src/types/product";
import type { ValidationReport } from "@/src/lib/validation";

const DEV = process.env.NODE_ENV === "development";

// ─── Debug logger ─────────────────────────────────────────────────────────────

type DebugStage = "BARCODE" | "OCR" | "ENGINE" | "FIREBASE" | "OPEN_FOOD_FACTS" | "BACKEND" | "MERGE" | "VALIDATE";

interface DebugEntry {
  stage: DebugStage;
  status: "ok" | "empty" | "error" | "timeout";
  data: unknown;
  ms: number;
}

const _debugLog: DebugEntry[] = [];

function log(stage: DebugStage, status: DebugEntry["status"], data: unknown, ms = 0) {
  _debugLog.push({ stage, status, data, ms });
  if (DEV) {
    const icon = status === "ok" ? "✅" : status === "empty" ? "⚠️" : status === "timeout" ? "⏱" : "❌";
    console.groupCollapsed(`[Pipeline] ${icon} ${stage} (${ms}ms)`);
    console.log(data);
    console.groupEnd();
  }
}

export function getDebugLog(): DebugEntry[] { return [..._debugLog]; }
export function clearDebugLog() { _debugLog.length = 0; }

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExtractionResult {
  product: ProductRecord;
  source: ExtractionSource;
  steps: PipelineStep[];
  validation: ValidationReport;
  needsReview: boolean;
  preprocessedUrl?: string;
  timingMs?: number;
}

// ─── Fast canvas resize ───────────────────────────────────────────────────────

async function fastResize(url: string, maxDim = 800): Promise<string> {
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const el = new window.Image();
      el.onload  = () => res(el);
      el.onerror = rej;
      el.src = url;
    });
    const scale  = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w      = Math.round(img.naturalWidth  * scale);
    const h      = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx    = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<string>((res, rej) =>
      canvas.toBlob(
        (b) => (b ? res(URL.createObjectURL(b)) : rej(new Error("toBlob failed"))),
        "image/jpeg", 0.80
      )
    );
  } catch { return url; }
}

// ─── blob URL → data URL for Tesseract ───────────────────────────────────────

async function toDataUrl(blobUrl: string): Promise<string> {
  try {
    const { base64, mimeType } = await urlToBase64(blobUrl);
    return `data:${mimeType};base64,${base64}`;
  } catch { return blobUrl; }
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

export async function extractFromImages(
  imageUrls: string[],
  onProgress?: (msg: string, steps: PipelineStep[]) => void,
  imageLabels?: string[]
): Promise<ExtractionResult> {
  clearDebugLog();
  const t0 = performance.now();

  const steps: PipelineStep[] = [
    { id: "barcode",  label: "Barcode Detection",     status: "pending" },
    { id: "ocr",      label: "OCR Extraction",        status: "pending" },
    { id: "engine",   label: "Product Intelligence",  status: "pending" },
    { id: "firebase", label: "Firebase Cache",        status: "pending" },
    { id: "off",      label: "Open Food Facts",       status: "pending" },
    { id: "merge",    label: "Merge & Prioritise",    status: "pending" },
    { id: "validate", label: "Validation & Scoring",  status: "pending" },
  ];

  const upd = (id: string, status: PipelineStep["status"], detail?: string) => {
    const s = steps.find((s) => s.id === id);
    if (s) { s.status = status; s.detail = detail; }
    onProgress?.(detail ?? id, [...steps]);
  };

  // ── 1. Resize all images ──────────────────────────────────────────────────
  const perImage = await Promise.all(
    imageUrls.map(async (url, i) => ({
      url,
      resized: await fastResize(url, 800),
      label:   imageLabels?.[i] ?? "Other",
    }))
  );
  const resizedUrls = perImage.map((p) => p.resized);

  // ── 2. All heavy work runs CONCURRENTLY ───────────────────────────────────
  upd("barcode",  "running", "📊 Scanning barcodes…");
  upd("ocr",      "running", "🔤 Running OCR…");
  upd("engine",   "running", "🧠 Product Intelligence…");
  upd("firebase", "running", "🔥 Checking Firebase…");
  upd("off",      "running", "🌍 Open Food Facts…");

  const t1 = performance.now();

  const [barcodeResult, ocrResults, backendResult] = await Promise.all([
    // ZXing — race ALL images simultaneously, 2s total timeout
    (async () => {
      try {
        const reader = new BrowserMultiFormatReader();
        const result = await Promise.race([
          // Try all images in parallel — first barcode wins
          Promise.any(
            perImage.map((p) => reader.decodeFromImageUrl(p.resized).then((r) => ({ label: p.label, barcode: r.getText() })))
          ),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 2000)),
        ]);
        return perImage.map((p) => ({ ...p, barcode: result.label === p.label ? result.barcode : undefined }));
      } catch {
        return perImage.map((p) => ({ ...p, barcode: undefined }));
      }
    })(),
    // Tesseract OCR on all images (data URL conversion avoids blob expiry)
    Promise.all(
      perImage.map(async (p) => {
        try {
          const dataUrl = await toDataUrl(p.resized);
          const result  = await runOCR(dataUrl);
          return { result, label: p.label };
        } catch {
          return { result: { text: "", words: [] }, label: p.label };
        }
      })
    ),
    // Backend (Rekognition + PaddleOCR) — 8s hard timeout
    fetchBackendWithTimeout(resizedUrls, imageLabels ?? [], 8000),
  ]);

  const elapsed = Math.round(performance.now() - t1);

  // Barcode — take the first found across all images
  const barcodeFound = barcodeResult.find((p) => p.barcode);
  const barcode = barcodeFound?.barcode ?? "";

  log("BARCODE", barcode ? "ok" : "empty", { barcode }, elapsed);
  console.log("BARCODE:", barcode || "(none)");
  upd("barcode", barcode ? "done" : "skipped", barcode ? `✓ ${barcode}` : "No barcode");

  // OCR
  const combinedText = ocrResults.map((r) => r.result.text ?? "").filter(Boolean).join("\n\n");
  log("OCR", combinedText.trim() ? "ok" : "empty",
    { chars: combinedText.length, preview: combinedText.slice(0, 150) }, elapsed);
  console.log("OCR TEXT:", combinedText.slice(0, 300) || "(empty)");
  upd("ocr", combinedText.trim() ? "done" : "skipped",
    combinedText.trim() ? `✓ ${combinedText.length} chars` : "No text extracted");

  // Backend
  log("BACKEND", backendResult ? "ok" : "empty", backendResult ?? "(timeout/unavailable)", elapsed);
  upd("engine", backendResult ? "done" : "skipped",
    backendResult ? `✓ Backend fields · ${elapsed}ms` : `OCR fallback · ${elapsed}ms`);

  // Firebase + OFF (share the same concurrent window)
  const [apiProduct, apiOffProduct] = await Promise.all([
    barcode ? findByBarcode(barcode).catch(() => null) : Promise.resolve(null),
    barcode ? lookupBarcode(barcode).catch(() => null) : Promise.resolve(null),
  ]);

  log("FIREBASE",        apiProduct    ? "ok" : "empty", apiProduct    ?? "(not found)");
  log("OPEN_FOOD_FACTS", apiOffProduct ? "ok" : "empty", apiOffProduct ?? "(not found)");
  upd("firebase", apiProduct    ? "done" : "skipped", apiProduct    ? `✓ ${apiProduct.productName ?? barcode}` : "Not in cache");
  upd("off",      apiOffProduct ? "done" : "skipped", apiOffProduct ? `✓ ${apiOffProduct.productName ?? barcode}` : "Not found");

  // ── 3. Client-side Product Intelligence Engine (always runs) ─────────────
  // This is instant (~5ms) and ensures fields are populated even when
  // backend + Firebase + OFF all miss.
  upd("engine", "running", "🧠 Product Intelligence Engine…");
  const engineOutput = runProductIntelligenceEngine(ocrResults, barcode);
  upd("engine", "done", `✓ Engine complete`);

  // ── 4. Merge — priority: Firebase > OFF > Backend > Engine ───────────────
  upd("merge", "running", "🔧 Merging…");

  type ProductField = keyof ProductRecord;
  const FIELDS: ProductField[] = [
    "barcode", "brand", "productName", "weightUnit", "categoryType",
    "segmentType", "manufacturer", "countryOfOrigin", "packagingType", "marketingMessage",
  ];

  type Candidate = { value: string; score: number; source: string };
  const candidates = Object.fromEntries(FIELDS.map((f) => [f, [] as Candidate[]])) as Record<ProductField, Candidate[]>;

  const add = (field: ProductField, value: string, score: number, source: string) => {
    const v = value?.trim();
    if (!v) return;
    const ex = candidates[field].find((c) => c.value === v);
    if (ex) { ex.score = Math.max(ex.score, score); return; }
    candidates[field].push({ value: v, score: Math.min(1, score), source });
  };

  if (apiProduct)    for (const k of FIELDS) { const v = apiProduct[k];    if (typeof v === "string" && v.trim()) add(k, v, 1.20, "firebase");      }
  if (apiOffProduct) for (const k of FIELDS) { const v = apiOffProduct[k]; if (typeof v === "string" && v.trim()) add(k, v, 1.10, "openfoodfacts"); }
  if (backendResult) for (const k of FIELDS) {
    const v = (backendResult as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim()) {
      const conf = (backendResult as Record<string, unknown>).fieldConfidenceScores as Record<string, number> | undefined;
      add(k, v, conf?.[k] ?? 0.85, "backend");
    }
  }
  // Engine is the fallback — always adds candidates for empty fields
  for (const k of FIELDS) {
    const ef = engineOutput[k as keyof typeof engineOutput];
    if (ef?.value?.trim()) add(k, ef.value, ef.confidence, ef.source);
  }

  const fieldConfidenceScores: Record<string, number> = {};
  const merged: Partial<Record<ProductField, string>> = {};

  for (const k of FIELDS) {
    const list = candidates[k];
    if (!list.length) { merged[k] = ""; fieldConfidenceScores[k] = 0; continue; }
    list.sort((a, b) => b.score - a.score);
    merged[k] = list[0].value;
    fieldConfidenceScores[k] = Math.min(1, list[0].score);
  }

  if (barcode) { merged.barcode = barcode; fieldConfidenceScores.barcode = 1.0; }

  const raw: ProductRecord = {
    barcode:          merged.barcode          ?? "",
    brand:            merged.brand            ?? "",
    productName:      merged.productName      ?? "",
    weightUnit:       merged.weightUnit       ?? "",
    categoryType:     merged.categoryType     ?? "",
    segmentType:      merged.segmentType      ?? "",
    manufacturer:     merged.manufacturer     ?? "",
    countryOfOrigin:  merged.countryOfOrigin  ?? "",
    packagingType:    merged.packagingType     ?? "",
    marketingMessage: merged.marketingMessage ?? "",
    imageUrl:         resizedUrls[0],
    imageUrls:        resizedUrls,
    confidenceScore:  0,
    fieldConfidenceScores,
  };

  log("MERGE", "ok", { merged, fieldConfidenceScores }, Math.round(performance.now() - t0));
  console.log("MERGED RECORD:", raw);

  // ── 5. Validate ───────────────────────────────────────────────────────────
  upd("merge",    "done",    "✅ Merged");
  upd("validate", "running", "✅ Validating…");

  const normalized = normalizeProduct(raw);
  const validation  = generateValidationReport(normalized);
  const timingMs    = Math.round(performance.now() - t0);

  const product = {
    ...normalized,
    confidenceScore:   validation.overall,
    fieldConfidenceScores,
    completenessScore: validation.completeness,
  };

  log("VALIDATE", "ok", { overall: validation.overall, completeness: validation.completeness }, timingMs);
  console.log("VALIDATION RESULT:", { overall: validation.overall, completeness: validation.completeness });

  const filledCount = FIELDS.filter((k) => merged[k]).length;
  if (filledCount === 0) {
    console.error("❌  All IMDB fields empty. OCR text length:", combinedText.length);
  }

  const source: ExtractionSource = apiProduct
    ? "firebase"
    : apiOffProduct
      ? "openfoodfacts"
      : filledCount > 0 ? "ai" : "ocr";

  upd("validate", "done", `✓ ${Math.round(validation.overall * 100)}% confidence · ${timingMs}ms`);

  return {
    product, source,
    steps: [...steps],
    validation,
    needsReview:     validation.needsReview,
    preprocessedUrl: resizedUrls[0],
    timingMs,
  };
}

// ─── ZXing — 2s hard timeout ──────────────────────────────────────────────────

export async function readBarcode(imageUrl: string): Promise<string> {
  try {
    const reader = new BrowserMultiFormatReader();
    const result = await Promise.race([
      reader.decodeFromImageUrl(imageUrl),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 2000)),
    ]);
    return result.getText();
  } catch { return ""; }
}

// ─── Backend call — configurable hard timeout ─────────────────────────────────

async function fetchBackendWithTimeout(
  imageUrls: string[],
  imageLabels: string[],
  timeoutMs: number
): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const images = await Promise.all(
      imageUrls.map(async (url) => {
        try { return (await urlToBase64(url)).base64; }
        catch { return ""; }
      })
    );
    const resp = await fetch("/api/ai-extract", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ ocrText: "", images, imageLabels }),
      signal:  controller.signal,
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data?.ok || typeof data.payload !== "object") return null;
    return data.payload as Record<string, unknown>;
  } catch {
    return null; // timeout or network error — silently return null
  } finally {
    clearTimeout(timer);
  }
}

// ─── Single-image wrapper ─────────────────────────────────────────────────────

export async function extractFromImage(
  imageUrl: string,
  onProgress?: (msg: string, steps: PipelineStep[]) => void,
  imageLabels?: string[]
): Promise<ExtractionResult> {
  return extractFromImages([imageUrl], onProgress, imageLabels);
}
