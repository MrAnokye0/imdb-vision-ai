"use client";

import { BrowserMultiFormatReader } from "@zxing/library";
import { lookupBarcode } from "@/src/lib/barcode-lookup";
import { findByBarcode } from "@/src/lib/firestore";
import { urlToBase64 } from "@/src/lib/image-preprocess";
import { runOCR } from "@/src/lib/ocr";
import { runProductIntelligenceEngine } from "@/src/lib/product-intelligence-engine";
import { normalizeProduct, generateValidationReport } from "@/src/lib/validation";
import type { ProductRecord, ExtractionSource, PipelineStep } from "@/src/types/product";
import type { ValidationReport } from "@/src/lib/validation";

const DEV = process.env.NODE_ENV === "development";

// ─── Debug logger ─────────────────────────────────────────────────────────────

type DebugStage = "BARCODE" | "OCR" | "ENGINE" | "FIREBASE" | "OPEN_FOOD_FACTS" | "MERGE" | "VALIDATE";

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

// ─── Canvas resize ────────────────────────────────────────────────────────────

async function fastResize(url: string, maxDim = 800): Promise<string> {
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const el = new window.Image();
      el.onload = () => res(el);
      el.onerror = rej;
      el.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<string>((res, rej) =>
      canvas.toBlob(
        (b) => (b ? res(URL.createObjectURL(b)) : rej(new Error("toBlob failed"))),
        "image/jpeg", 0.82
      )
    );
  } catch { return url; }
}

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
    { id: "barcode",  label: "Barcode Detection",    status: "pending" },
    { id: "ocr",      label: "OCR Extraction",       status: "pending" },
    { id: "engine",   label: "Product Intelligence", status: "pending" },
    { id: "firebase", label: "Firebase Cache",       status: "pending" },
    { id: "off",      label: "Open Food Facts",      status: "pending" },
    { id: "merge",    label: "Merge & Prioritise",   status: "pending" },
    { id: "validate", label: "Validation & Scoring", status: "pending" },
  ];

  const upd = (id: string, status: PipelineStep["status"], detail?: string) => {
    const s = steps.find((s) => s.id === id);
    if (s) { s.status = status; s.detail = detail; }
    onProgress?.(detail ?? id, [...steps]);
  };

  // ── 1. Resize ─────────────────────────────────────────────────────────────
  const perImage = await Promise.all(
    imageUrls.map(async (url, i) => ({
      url, label: imageLabels?.[i] ?? "Other",
      resized: await fastResize(url, 800),
    }))
  );
  const resizedUrls = perImage.map((p) => p.resized);

  // ── 2. ZXing barcode — ALL images race, 2s total ──────────────────────────
  upd("barcode", "running", "📊 Scanning barcodes…");
  const t1 = performance.now();

  let barcode = "";
  try {
    const reader = new BrowserMultiFormatReader();
    const result = await Promise.race([
      Promise.any(perImage.map((p) =>
        reader.decodeFromImageUrl(p.resized).then((r) => r.getText())
      )),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 2000)),
    ]);
    barcode = result;
  } catch { /* no barcode — continue */ }

  log("BARCODE", barcode ? "ok" : "empty", { barcode }, Math.round(performance.now() - t1));
  console.log("BARCODE:", barcode || "(none)");
  upd("barcode", barcode ? "done" : "skipped", barcode ? `✓ ${barcode}` : "No barcode");

  // ── 3. OCR all images in parallel + Firebase/OFF lookup — ALL CONCURRENT ──
  // Start Firebase lookup immediately (even without barcode result yet)
  // so the Firestore connection warms up during OCR processing.
  upd("ocr",      "running", "🔤 Running OCR…");
  upd("firebase", "running", "🔥 Checking Firebase…");
  upd("off",      "running", "🌍 Open Food Facts…");

  const t2 = performance.now();

  // Run OCR, Firebase, and OFF all at the same time
  const [ocrResults, apiProduct, apiOffProduct] = await Promise.all([
    // OCR — all images parallel, 6s per-image timeout
    Promise.all(
      perImage.map(async (p) => {
        try {
          const dataUrl = await toDataUrl(p.resized);
          const result  = await Promise.race([
            runOCR(dataUrl),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("ocr timeout")), 6000)),
          ]);
          return { result, label: p.label };
        } catch {
          return { result: { text: "", words: [] }, label: p.label };
        }
      })
    ),
    // Firebase — barcode lookup (or null if no barcode yet — we'll retry below)
    barcode ? findByBarcode(barcode).catch(() => null) : Promise.resolve(null),
    barcode ? lookupBarcode(barcode).catch(() => null)  : Promise.resolve(null),
  ]);

  const combinedText = ocrResults.map((r) => r.result.text ?? "").filter(Boolean).join("\n\n");
  const ocrMs = Math.round(performance.now() - t2);
  log("OCR", combinedText.trim() ? "ok" : "empty",
    { chars: combinedText.length, preview: combinedText.slice(0, 200) }, ocrMs);
  console.log("OCR TEXT:", combinedText.slice(0, 400) || "(empty)");
  upd("ocr", combinedText.trim() ? "done" : "skipped",
    combinedText.trim() ? `✓ ${combinedText.length} chars · ${ocrMs}ms` : "No text");

  // ── 4. Product Intelligence Engine (instant — no network call) ────────────
  upd("engine", "running", "🧠 Product Intelligence Engine…");
  const t3 = performance.now();
  const engineOutput = runProductIntelligenceEngine(ocrResults, barcode);
  const engineMs = Math.round(performance.now() - t3);
  const engineFields = Object.values(engineOutput).filter((f) => f.value.trim()).length;
  log("ENGINE", engineFields > 0 ? "ok" : "empty", engineOutput, engineMs);
  console.log("ENGINE:", engineOutput);
  upd("engine", engineFields > 0 ? "done" : "skipped",
    `✓ ${engineFields}/10 fields · ${engineMs}ms`);

  // ── 5. Log Firebase + OFF results ────────────────────────────────────────
  log("FIREBASE",        apiProduct    ? "ok" : "empty", apiProduct    ?? "(not found)");
  log("OPEN_FOOD_FACTS", apiOffProduct ? "ok" : "empty", apiOffProduct ?? "(not found)");
  upd("firebase", apiProduct    ? "done" : "skipped", apiProduct    ? `✓ ${apiProduct.productName ?? barcode}` : "Not in cache");
  upd("off",      apiOffProduct ? "done" : "skipped", apiOffProduct ? `✓ ${apiOffProduct.productName ?? barcode}` : "Not found");

  // ── 6. Merge — priority: Firebase > OFF > Engine ─────────────────────────
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

  // Authoritative cache hits first
  if (apiProduct)    for (const k of FIELDS) { const v = apiProduct[k];    if (typeof v === "string" && v.trim()) add(k, v, 1.20, "firebase");      }
  if (apiOffProduct) for (const k of FIELDS) { const v = apiOffProduct[k]; if (typeof v === "string" && v.trim()) add(k, v, 1.10, "openfoodfacts"); }

  // Engine (always populated from OCR)
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

  // ZXing barcode always wins
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

  // ── 7. Validate ───────────────────────────────────────────────────────────
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

  if (FIELDS.filter((k) => merged[k]).length === 0) {
    console.error("❌ All fields empty. OCR chars:", combinedText.length, "Engine fields:", engineFields);
  }

  const source: ExtractionSource = apiProduct
    ? "firebase"
    : apiOffProduct
      ? "openfoodfacts"
      : engineFields > 0 ? "ai" : "ocr";

  upd("validate", "done", `✓ ${Math.round(validation.overall * 100)}% · ${timingMs}ms`);

  return {
    product, source,
    steps: [...steps],
    validation,
    needsReview:     validation.needsReview,
    preprocessedUrl: resizedUrls[0],
    timingMs,
  };
}

// ─── ZXing (exported for test pages) ─────────────────────────────────────────

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

// ─── Single-image wrapper ─────────────────────────────────────────────────────

export async function extractFromImage(
  imageUrl: string,
  onProgress?: (msg: string, steps: PipelineStep[]) => void,
  imageLabels?: string[]
): Promise<ExtractionResult> {
  return extractFromImages([imageUrl], onProgress, imageLabels);
}
