"use client";

import { BrowserMultiFormatReader } from "@zxing/library";
import { lookupBarcode } from "@/src/lib/barcode-lookup";
import { findByBarcode } from "@/src/lib/firestore";
import { urlToBase64, preprocessImageForBarcode } from "@/src/lib/image-preprocess";
import { normalizeProduct, generateValidationReport } from "@/src/lib/validation";
import type { ProductRecord, ExtractionSource, PipelineStep } from "@/src/types/product";
import type { ValidationReport } from "@/src/lib/validation";

const DEV = process.env.NODE_ENV === "development";

// ─── Debug logger ─────────────────────────────────────────────────────────────

type DebugStage = "RESIZE" | "BARCODE" | "ENGINE" | "FIREBASE" | "OPEN_FOOD_FACTS" | "MERGE" | "VALIDATE";

interface DebugEntry {
  stage: DebugStage;
  status: "ok" | "empty" | "error" | "timeout";
  data: unknown;
  ms: number;
}

const _debugLog: DebugEntry[] = [];

function log(stage: DebugStage, status: DebugEntry["status"], data: unknown, ms = 0) {
  _debugLog.push({ stage, status, data, ms });
  const icon = status === "ok" ? "✅" : status === "empty" ? "⚠️" : status === "timeout" ? "⏱" : "❌";
  if (DEV) {
    console.groupCollapsed(`[Pipeline] ${icon} ${stage} (${ms}ms)`);
    console.log(data);
    console.groupEnd();
  }
}

export function getDebugLog(): DebugEntry[] { return [..._debugLog]; }
export function clearDebugLog()             { _debugLog.length = 0;  }

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExtractionResult {
  product: ProductRecord;
  source: ExtractionSource;
  steps: PipelineStep[];
  validation: ValidationReport;
  needsReview: boolean;
  preprocessedUrl?: string;
  timingMs?: number;
  telemetry?: any;
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

// ─── Main pipeline ────────────────────────────────────────────────────────────

export async function extractFromImages(
  imageUrls: string[],
  onProgress?: (msg: string, steps: PipelineStep[]) => void,
  imageLabels?: string[]
): Promise<ExtractionResult> {
  clearDebugLog();
  const t0 = performance.now();

  const steps: PipelineStep[] = [
    { id: "barcode",  label: "Barcode Detection",        status: "pending" },
    { id: "ocr",      label: "PaddleOCR (concurrent)",   status: "pending" },
    { id: "engine",   label: "Product Intelligence",     status: "pending" },
    { id: "firebase", label: "Firebase Cache Lookup",    status: "pending" },
    { id: "off",      label: "Open Food Facts",          status: "pending" },
    { id: "merge",    label: "Merge & Prioritise",       status: "pending" },
    { id: "validate", label: "Validation & Scoring",     status: "pending" },
  ];

  const upd = (id: string, status: PipelineStep["status"], detail?: string) => {
    const s = steps.find((s) => s.id === id);
    if (s) { s.status = status; s.detail = detail; }
    onProgress?.(detail ?? id, [...steps]);
  };

  // ── 1. Resize + ZXing barcode scan (all images parallel, 2s timeout) ─────
  upd("barcode", "running", "📊 Scanning barcodes…");
  const t1 = performance.now();

  const perImage = await Promise.all(
    imageUrls.map(async (url, i) => {
      const label   = imageLabels?.[i] ?? "Other";
      const resized = await fastResize(url, 800);
      
      // Attempt barcode reading with retry
      let barcode = "";
      try {
        barcode = await readBarcode(resized);
      } catch (err) {
        if (DEV) console.log(`[Barcode] Image ${i} (${label}): ${err instanceof Error ? err.message : "Unknown error"}`);
      }
      
      return { url, resized, label, barcode: barcode || undefined };
    })
  );

  // Prioritise the image explicitly labelled "Barcode"
  const barcodeImageIndex = perImage.findIndex((p) => p.label === "Barcode");
  const barcodeList = barcodeImageIndex >= 0
    ? [perImage[barcodeImageIndex].barcode, ...perImage.map((p) => p.barcode)]
    : perImage.map((p) => p.barcode);
  const barcode = barcodeList.find(Boolean) ?? "";

  log("BARCODE", barcode ? "ok" : "empty", { barcode, scanned: perImage.length, found: perImage.filter(p => p.barcode).length }, Math.round(performance.now() - t1));
  console.log("BARCODE:", barcode || "(none)");
  upd("barcode", barcode ? "done" : "skipped", barcode ? `✓ ${barcode}` : "⚠️ No barcode found — using OCR fallback");

  // ── 2. Run backend extraction + Firebase Cache + Open Food Facts in parallel ─
  upd("ocr", "running", "🔤 Running PaddleOCR...");
  upd("engine", "running", "🧠 Running Product Intelligence...");
  upd("firebase", "running", barcode ? `🔥 Firebase: ${barcode}` : "🔥 Skipping");
  upd("off",      "running", barcode ? "🌍 Open Food Facts…"      : "🌍 Skipping");

  const tBackend = performance.now();
  const resizedUrls = perImage.map((p) => p.resized);

  const [apiProduct, apiOffProduct, backendProduct] = await Promise.all([
    barcode ? findByBarcode(barcode).catch(() => null) : Promise.resolve(null),
    barcode ? lookupBarcode(barcode).catch(() => null) : Promise.resolve(null),
    fetchBackendExtraction(resizedUrls, imageLabels ?? []),
  ]);

  const backendMs = Math.round(performance.now() - tBackend);
  log("FIREBASE",       apiProduct     ? "ok" : "empty", apiProduct     ?? "(not found)");
  log("OPEN_FOOD_FACTS", apiOffProduct  ? "ok" : "empty", apiOffProduct  ?? "(not found)");
  log("ENGINE",          backendProduct ? "ok" : "empty", backendProduct ?? "(no response)", backendMs);

  upd("firebase", apiProduct    ? "done" : "skipped", apiProduct    ? `✓ ${apiProduct.productName ?? barcode}` : "Not in cache");
  upd("off",      apiOffProduct ? "done" : "skipped", apiOffProduct ? `✓ ${apiOffProduct.productName ?? barcode}` : "Not found");

  if (backendProduct) {
    upd("ocr", "done", `✓ PaddleOCR successful · ${backendMs}ms`);
    upd("engine", "done", `✓ ${Object.keys(backendProduct).filter(k => backendProduct[k] && k !== "fieldConfidenceScores" && k !== "telemetry" && k !== "completenessScore" && k !== "needsReviewFields").length}/10 fields · ${backendMs}ms`);
  } else {
    upd("ocr", "skipped", "PaddleOCR skipped or failed");
    upd("engine", "skipped", "Product Intelligence skipped or failed");
  }

  // ── 3. Merge — source priority: Firebase > OFF > Backend Engine ──────────
  upd("merge", "running", "🔧 Merging sources…");

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

  // Authoritative Cache hits first
  if (apiProduct)    for (const k of FIELDS) { const v = apiProduct[k];    if (typeof v === "string" && v.trim()) add(k, v, 1.20, "firebase");      }
  if (apiOffProduct) for (const k of FIELDS) { const v = apiOffProduct[k]; if (typeof v === "string" && v.trim()) add(k, v, 1.10, "openfoodfacts"); }

  // Backend rule-based engine
  if (backendProduct) {
    for (const k of FIELDS) {
      const v = backendProduct[k];
      const conf = backendProduct.fieldConfidenceScores?.[k] ?? 0.80;
      if (typeof v === "string" && v.trim()) {
        add(k, v, conf, "ocr");
      }
    }
  }

  const fieldConfidenceScores: Record<string, number> = {};
  const fieldSources: Record<string, string> = {};
  const merged: Partial<Record<ProductField, string>> = {};

  for (const k of FIELDS) {
    const list = candidates[k];
    if (!list.length) {
      merged[k] = "";
      fieldConfidenceScores[k] = 0;
      fieldSources[k] = "none";
      continue;
    }
    list.sort((a, b) => b.score - a.score);
    merged[k] = list[0].value;
    fieldConfidenceScores[k] = Math.min(1, list[0].score);
    fieldSources[k] = list[0].source;
  }

  // ZXing barcode is always authoritative
  if (barcode) {
    merged.barcode = barcode;
    fieldConfidenceScores.barcode = 1.0;
    fieldSources.barcode = "zxing";
  }

  const source: ExtractionSource = apiProduct
    ? "firebase"
    : apiOffProduct
      ? "openfoodfacts"
      : "ocr";

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

  // ── 4. Validate ───────────────────────────────────────────────────────────
  upd("merge",    "done",    "✅ Sources merged");
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

  log("VALIDATE", "ok", { overall: validation.overall, completeness: validation.completeness, needsReview: validation.needsReview }, timingMs);
  console.log("VALIDATION RESULT:", { overall: validation.overall, completeness: validation.completeness });

  upd("validate", "done", `✓ ${Math.round((product.confidenceScore) * 100)}% confidence · ${timingMs}ms`);

  const combinedTelemetry = {
    ...(backendProduct?.telemetry || {}),
    fieldSources,
  };

  return {
    product, source,
    steps: [...steps],
    validation,
    needsReview:     validation.needsReview,
    preprocessedUrl: resizedUrls[0],
    timingMs,
    telemetry:       combinedTelemetry,
  };
}

// ─── Barcode preprocessing — enhance for better detection ───────────────────

async function enhanceBarcodeImage(url: string): Promise<string> {
  try {
    const result = await preprocessImageForBarcode(url, 1600);
    return result.url;
  } catch (err) {
    if (DEV) console.log("Barcode preprocessing failed:", err);
    return url;
  }
}

// ─── ZXing fast detection with OCR fallback ──────────────────────────────────

export async function readBarcode(imageUrl: string): Promise<string> {
  try {
    const reader = new BrowserMultiFormatReader();

    // Attempt 1: Enhanced image (high contrast B&W) — 1.2s timeout
    let preprocessed: string | null = null;
    try {
      preprocessed = await enhanceBarcodeImage(imageUrl);
      const result = await Promise.race([
        reader.decodeFromImageUrl(preprocessed),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 1200)),
      ]);
      if (preprocessed !== imageUrl) URL.revokeObjectURL(preprocessed);
      return result.getText();
    } catch (err) {
      if (preprocessed && preprocessed !== imageUrl) URL.revokeObjectURL(preprocessed);
    }

    // Attempt 2: Original image — 1s timeout
    // If this fails, OCR engine will handle it (and it's working great!)
    const result = await Promise.race([
      reader.decodeFromImageUrl(imageUrl),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 1000)),
    ]);
    return result.getText();
  } catch {
    // Fall through to OCR engine — it's handling extraction perfectly
    return "";
  }
}

// ─── Backend extraction — 25s timeout, non-blocking ──────────────────────────

async function fetchBackendExtraction(
  imageUrls: string[],
  imageLabels: string[]
): Promise<any | null> {
  try {
    const images = await Promise.all(
      imageUrls.map(async (url) => {
        try { return (await urlToBase64(url)).base64; }
        catch { return ""; }
      })
    );

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 25000);

    let resp: Response;
    try {
      resp = await fetch("/api/ai-extract", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ocrText: "", images, imageLabels }),
        signal:  controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data?.ok || typeof data.payload !== "object") return null;

    return data.payload;
  } catch (err) {
    console.error("fetchBackendExtraction failed:", err);
    return null;
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
