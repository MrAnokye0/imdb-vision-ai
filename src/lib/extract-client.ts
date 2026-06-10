"use client";

import { runOCR, parseOCRResult, type OCRResult } from "@/src/lib/ocr";
import { BrowserMultiFormatReader } from "@zxing/library";
import { lookupBarcode } from "@/src/lib/barcode-lookup";
import { findByBarcode } from "@/src/lib/firestore";
import { preprocessImage, urlToBase64 } from "@/src/lib/image-preprocess";
import { normalizeProduct, generateValidationReport } from "@/src/lib/validation";
import type { ProductRecord, ExtractionSource, PipelineStep } from "@/src/types/product";
import type { ValidationReport } from "@/src/lib/validation";

// ─── Extraction result ────────────────────────────────────────────────────────

export interface ExtractionResult {
  product: ProductRecord;
  source: ExtractionSource;
  steps: PipelineStep[];
  validation: ValidationReport;
  needsReview: boolean;
  preprocessedUrl?: string;
}

interface VisionExtractionResponse {
  barcode?: string;
  categoryType?: string;
  segmentType?: string;
  manufacturer?: string;
  brand?: string;
  productName?: string;
  weightUnit?: string;
  packagingType?: string;
  countryOfOrigin?: string;
  marketingMessage?: string;
  fieldConfidenceScores?: Record<string, number>;
}

// ─── Multi-image extraction (process multiple photos of same product) ──────
export async function extractFromImages(
  imageUrls: string[],
  onProgress?: (msg: string, steps: PipelineStep[]) => void
): Promise<ExtractionResult> {
  const steps: PipelineStep[] = [
    { id: "preprocess", label: "Image Preprocessing",   status: "pending" },
    { id: "barcode",    label: "Barcode Detection",      status: "pending" },
    { id: "firebase",   label: "Firebase Cache Lookup",  status: "pending" },
    { id: "off",        label: "Open Food Facts Lookup", status: "pending" },
    { id: "ocr",        label: "OCR Extraction",         status: "pending" },
    { id: "vision",     label: "Vision AI",              status: "pending" },
    { id: "merge",      label: "Merge Results",          status: "pending" },
    { id: "validate",   label: "Validation & Scoring",   status: "pending" },
  ];

  const upd = (id: string, status: PipelineStep["status"], detail?: string) => {
    const s = steps.find((s) => s.id === id);
    if (s) { s.status = status; s.detail = detail; }
    onProgress?.(detail ?? id, [...steps]);
  };

  const perImage: Array<{
    url: string;
    processed?: string;
    barcode?: string;
    ocr?: OCRResult | null;
    parsed?: Partial<ProductRecord>;
  }> = [];

  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    upd("preprocess", "running", `🖼 Preprocessing image ${i + 1}/${imageUrls.length}`);
    let processed = url;
    try {
      const r = await preprocessImage(url, { maxDim: 1200, contrast: 1.35, brightness: 12, sharpen: true });
      processed = r.url;
    } catch {
      // ignore and continue with original image
    }

    upd("barcode", "running", `📊 Scanning barcode ${i + 1}/${imageUrls.length}`);
    const bc = await readBarcode(processed).catch(() => "");

    upd("ocr", "running", `🔤 Running OCR on image ${i + 1}/${imageUrls.length}`);
    let ocrRes: OCRResult | null = null;
    let parsed: Partial<ProductRecord> | undefined = undefined;
    try {
      ocrRes = await runOCRWithLayout(processed);
      parsed = parseOCRResult(ocrRes);
    } catch {
      ocrRes = null;
      parsed = undefined;
    }

    perImage.push({ url, processed, barcode: bc || undefined, ocr: ocrRes, parsed });
  }

  const barcode = perImage.map((p) => p.barcode).find(Boolean) ?? "";

  upd("firebase", "running", barcode ? `🔥 Checking Firebase for ${barcode}` : "🔥 Skipping Firebase lookup");
  let apiProduct: Partial<ProductRecord> | null = null;
  if (barcode) {
    try { apiProduct = await findByBarcode(barcode); } catch { apiProduct = null; }
    if (apiProduct) upd("firebase", "done", `Cache hit: ${apiProduct.productName ?? barcode}`);
    else upd("firebase", "skipped", "No cached record found");
  } else {
    upd("firebase", "skipped", "No barcode available");
  }

  const imageText = perImage
    .map((p, index) => `IMAGE ${index + 1}\n${p.ocr?.text ?? ""}`)
    .filter(Boolean)
    .join("\n\n");

  const preprocessedUrls = perImage.map((p) => p.processed ?? p.url);
  upd("vision", "running", "🧠 Sending images and OCR text to Gemini Vision...");
  const visionData = await runVisionExtraction(preprocessedUrls, imageText);
  const visionFields = Object.values(visionData).filter((v) => typeof v === "string" && String(v).trim()).length;
  if (visionFields > 0) {
    upd("vision", "done", `Vision AI extracted ${visionFields} fields`);
  } else {
    upd("vision", "skipped", "Vision AI did not return structured fields");
  }

  upd("off", "running", barcode ? `🌍 Checking Open Food Facts for ${barcode}` : "🌍 Skipping Open Food Facts");
  let apiOffProduct: Partial<ProductRecord> | null = null;
  if (barcode) {
    try {
      apiOffProduct = await lookupBarcode(barcode);
      if (apiOffProduct) {
        upd("off", "done", `Found Open Food Facts record`);
      } else {
        upd("off", "skipped", "Open Food Facts lookup returned no match");
      }
    } catch {
      upd("off", "error", "Open Food Facts lookup failed");
    }
  }

  type ProductField = keyof ProductRecord;
  const FIELDS: ProductField[] = [
    "barcode", "brand", "productName", "weightUnit", "categoryType",
    "segmentType", "manufacturer", "countryOfOrigin", "packagingType", "marketingMessage",
  ];

  type FieldCandidate = {
    value: string;
    score: number;
    source: string;
    imageIndex: number;
  };

  const candidates: Record<ProductField, FieldCandidate[]> = {} as Record<ProductField, FieldCandidate[]>;
  for (const f of FIELDS) candidates[f] = [];

  const addCandidate = (
    field: ProductField,
    value: string,
    score: number,
    source: string,
    imageIndex: number
  ) => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    const existing = candidates[field].find((c) => c.value === trimmed);
    if (existing) {
      existing.score = Math.max(existing.score, score);
      return;
    }
    candidates[field].push({ value: trimmed, score: Math.min(1, score), source, imageIndex });
  };

  if (apiProduct) {
    for (const key of FIELDS) {
      const value = apiProduct[key];
      if (typeof value === "string" && value.trim()) {
        addCandidate(key, value, 1.2, "firebase", -1);
      }
    }
  }

  if (apiOffProduct) {
    for (const key of FIELDS) {
      const value = apiOffProduct[key];
      if (typeof value === "string" && value.trim()) {
        addCandidate(key, value, 1.15, "openfoodfacts", -1);
      }
    }
  }

  if (visionData) {
    for (const key of FIELDS) {
      const value = visionData[key];
      if (typeof value === "string" && value.trim()) {
        const visionConfidence = typeof visionData.fieldConfidenceScores?.[key] === "number"
          ? Math.min(1, visionData.fieldConfidenceScores[key] * 0.5 + 0.5)
          : 0.92;
        addCandidate(key, value, visionConfidence, "vision", -1);
      }
    }
  }

  for (let index = 0; index < perImage.length; index += 1) {
    const p = perImage[index];
    const parsed = p.parsed ?? {} as Partial<ProductRecord>;
    const baseOcrScore = typeof parsed.confidenceScore === "number" ? parsed.confidenceScore : 0.55;
    for (const key of FIELDS) {
      const parsedValue = parsed[key];
      if (typeof parsedValue === "string" && parsedValue.trim()) {
        addCandidate(key, parsedValue, 0.58 + baseOcrScore * 0.28, "ocr", index);
      }
    }
  }

  let aiProduct: Partial<ProductRecord> = {};
  const hasAnyVision = visionFields > 0;
  if (!hasAnyVision) {
    upd("ai", "running", "🤖 Running AI fallback on OCR text...");
    const firstOCR = perImage.find((p) => p.ocr?.text);
    if (firstOCR?.ocr) {
      aiProduct = await runAIExtraction(firstOCR.ocr);
      const filled = Object.values(aiProduct).filter((v) => typeof v === "string" && String(v).trim()).length;
      if (filled > 0) {
        upd("ai", "done", `AI fallback extracted ${filled} fields`);
      } else {
        upd("ai", "skipped", "AI fallback did not produce structured output");
      }
    } else {
      upd("ai", "skipped", "No OCR text available for AI fallback");
    }
  } else {
    upd("ai", "skipped", "Vision AI provided structured results");
  }

  for (const key of FIELDS) {
    const value = aiProduct[key];
    if (typeof value === "string" && value.trim()) {
      addCandidate(key, value, 0.72, "ai", -1);
    }
  }

  const fieldConfidenceScores: Record<string, number> = {};
  const merged: Partial<ProductRecord> = {};

  for (const key of FIELDS) {
    const list = candidates[key];
    if (list.length === 0) {
      merged[key] = "";
      fieldConfidenceScores[key] = 0;
      continue;
    }

    list.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.value.length !== b.value.length) return b.value.length - a.value.length;
      return a.source.localeCompare(b.source);
    });

    const chosen = list[0];
    merged[key] = chosen.value;
    fieldConfidenceScores[key] = Math.min(1, chosen.score);
  }

  merged.barcode = barcode || merged.barcode || "";

  if (merged.barcode) {
    const barcodeMatch = barcode && barcode === merged.barcode;
    if (barcodeMatch) fieldConfidenceScores.barcode = 1;
  }

  // If the vision layer suggested a higher-confidence barcode and it validates, prefer it.
  if (visionData?.barcode && visionData.barcode.trim()) {
    merged.barcode = visionData.barcode.trim();
    fieldConfidenceScores.barcode = Math.max(fieldConfidenceScores.barcode ?? 0, 0.95);
  }

  upd("merge", "running", "🔧 Merging OCR, barcode, vision, and validation sources...");

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
    imageUrl:         preprocessedUrls[0],
    imageUrls:        preprocessedUrls,
    confidenceScore:  0,
    fieldConfidenceScores,
  };

  const normalized = normalizeProduct(raw);
  const validation = generateValidationReport(normalized);
  const product = {
    ...normalized,
    confidenceScore:    validation.overall,
    fieldConfidenceScores: fieldConfidenceScores,
    completenessScore:  validation.completeness,
  };

  const source: ExtractionSource = apiProduct
    ? "firebase"
    : apiOffProduct
      ? "openfoodfacts"
      : hasAnyVision
        ? "ai"
        : "ocr";

  upd("merge", "done", "✅ Selected highest-confidence fields from all sources");
  upd("validate", "running", "✅ Validating final record...");
  upd("validate", "done", `Final confidence ${Math.round(validation.overall * 100)}% · completeness ${Math.round(validation.completeness * 100)}%`);

  return {
    product,
    source,
    steps: [...steps],
    validation,
    needsReview: validation.needsReview,
    preprocessedUrl: preprocessedUrls[0],
  };
}

// ─── ZXing barcode scan ───────────────────────────────────────────────────────

export async function readBarcode(imageUrl: string): Promise<string> {
  try {
    const reader = new BrowserMultiFormatReader();
    const result = await reader.decodeFromImageUrl(imageUrl);
    return result.getText();
  } catch {
    return "";
  }
}

// ─── Tesseract OCR (runs on preprocessed image) — structured result
async function runOCRWithLayout(imageUrl: string): Promise<OCRResult> {
  return await runOCR(imageUrl);
}

// ─── OCR regex helpers ────────────────────────────────────────────────────────


function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

async function runAIExtraction(ocr: OCRResult): Promise<Partial<ProductRecord>> {
  try {
    const response = await fetch("/api/ai-extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ocrText: ocr.text ?? "" }),
    });

    if (!response.ok) return {};
    const data = await response.json();
    if (!data?.ok || typeof data.payload !== "object") return {};

    return {
      barcode:          safeString(data.payload.barcode),
      categoryType:     safeString(data.payload.categoryType),
      segmentType:      safeString(data.payload.segmentType),
      manufacturer:     safeString(data.payload.manufacturer),
      brand:            safeString(data.payload.brand),
      productName:      safeString(data.payload.productName),
      weightUnit:       safeString(data.payload.weightUnit),
      packagingType:    safeString(data.payload.packagingType),
      countryOfOrigin:  safeString(data.payload.countryOfOrigin),
      marketingMessage: safeString(data.payload.marketingMessage),
    };
  } catch {
    return {};
  }
}

function emptyProduct(): ProductRecord {
  return {
    barcode: "", categoryType: "", segmentType: "", manufacturer: "",
    brand: "", productName: "", weightUnit: "", packagingType: "",
    countryOfOrigin: "", marketingMessage: "", confidenceScore: 0,
  };
}
async function runVisionExtraction(
  imageUrls: string[],
  ocrText: string
): Promise<VisionExtractionResponse> {
  try {
    const images = await Promise.all(
      imageUrls.map(async (url) => {
        const converted = await urlToBase64(url);
        return { data: converted.base64, mimeType: converted.mimeType };
      })
    );

    const response = await fetch("/api/ai-extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ocrText, images }),
    });

    if (!response.ok) return {};
    const data = await response.json();
    if (!data?.ok || typeof data.payload !== "object") return {};
    return data.payload as VisionExtractionResponse;
  } catch {
    return {};
  }
}

export async function extractFromImage(
  imageUrl: string,
  onProgress?: (msg: string, steps: PipelineStep[]) => void
): Promise<ExtractionResult> {
  return extractFromImages([imageUrl], onProgress);
}