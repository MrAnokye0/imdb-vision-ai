import Tesseract from "tesseract.js";
import type { ProductRecord } from "@/src/types/product";

export interface OCRWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  conf: number;
}

export interface OCRResult {
  text: string;
  words: OCRWord[];
  width?: number;
  height?: number;
}

/**
 * Run Tesseract and return words with bounding boxes and confidence.
 */
export async function runOCR(imageUrl: string): Promise<OCRResult> {
  const res = await Tesseract.recognize(imageUrl, "eng", { logger: () => {} });
  const data = ((res as unknown) as { data?: Record<string, any> })?.data ?? {};
  const words: OCRWord[] = (Array.isArray(data.words) ? data.words : []).map((w) => {
    const word = w as Record<string, unknown>;
    const bbox = word.bbox as Record<string, number> | undefined;
    const x0 = typeof bbox?.x0 === "number" ? bbox.x0 : (typeof word.x0 === "number" ? word.x0 : 0);
    const y0 = typeof bbox?.y0 === "number" ? bbox.y0 : (typeof word.y0 === "number" ? word.y0 : 0);
    const x1 = typeof bbox?.x1 === "number" ? bbox.x1 : (typeof word.x === "number" ? word.x : 0);
    const y1 = typeof bbox?.y1 === "number" ? bbox.y1 : (typeof word.y === "number" ? word.y : 0);
    return {
      text: String(word?.text ?? "").trim(),
      x: x0,
      y: y0,
      w: x1 - x0,
      h: y1 - y0,
      conf: Number(word.confidence ?? word.conf ?? 0),
    };
  });

  return {
    text: data.text ?? words.map((w) => w.text).join(" "),
    words,
    width: data?.image?.width ?? data?.width,
    height: data?.image?.height ?? data?.height,
  };
}

function clusterLines(words: OCRWord[], yTol = 12) {
  const lines: OCRWord[][] = [];
  const sorted = [...words].sort((a, b) => a.y - b.y);
  for (const w of sorted) {
    const found = lines.find((ln) => Math.abs(ln[0].y - w.y) <= yTol);
    if (found) found.push(w);
    else lines.push([w]);
  }
  return lines.map((ln) => ln.sort((a, b) => a.x - b.x));
}

function blockMetrics(block: OCRWord[]) {
  const avgH = block.reduce((s, w) => s + w.h, 0) / block.length || 0;
  const area = block.reduce((s, w) => s + w.w * w.h, 0);
  const avgConf = block.reduce((s, w) => s + (w.conf || 0), 0) / block.length || 0;
  const text = block.map((w) => w.text).join(" ");
  const centerX = block.reduce((s, w) => s + (w.x + w.w / 2), 0) / block.length || 0;
  const centerY = block.reduce((s, w) => s + (w.y + w.h / 2), 0) / block.length || 0;
  return { avgH, area, avgConf, text, centerX, centerY };
}

const SEGMENT_COUGH = ["cough", "cold", "catarrh"];
const PACKAGING_KEYWORDS = ["bottle", "box", "sachet", "can", "jar", "tube", "pouch", "carton", "pack"];

export function parseOCRResult(ocr: OCRResult): Partial<ProductRecord> {
  const words = ocr.words.filter((w) => w.text && w.text.trim());
  const rawText = (ocr.text ?? "").trim();
  const joined = rawText || words.map((w) => w.text).join(" ");
  const lower = joined.toLowerCase();

  const textLines = rawText
    ? rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : clusterLines(words).map((line) => line.map((w) => w.text).join(" ").trim()).filter(Boolean);

  const lines = clusterLines(words);
  const blocks = lines.map(blockMetrics);

  // Heuristics: prefer large-font, large-area, centered blocks near top
  const imgCenterX = (ocr.width ?? 0) / 2;
  const topThreshold = (ocr.height ?? 0) * 0.45 || Number.POSITIVE_INFINITY;

  const ranked = blocks.map((b, i) => ({ ...b, idx: i }))
    .sort((a, b) => {
      const centerScoreA = -Math.abs(a.centerX - imgCenterX);
      const centerScoreB = -Math.abs(b.centerX - imgCenterX);
      if (a.avgH !== b.avgH) return b.avgH - a.avgH;
      if (a.area !== b.area) return b.area - a.area;
      return centerScoreB - centerScoreA;
    });

  let brand = "";
  for (const r of ranked) {
    if (r.centerY <= topThreshold || ocr.height === undefined) {
      const wordsCount = lines[r.idx].length;
      const t = r.text.trim();
      if (wordsCount <= 5 && /^[A-Z0-9\s\-&'.®™]{2,}$/.test(t.toUpperCase())) {
        brand = t;
        break;
      }
    }
  }
  if (!brand && textLines.length > 0) {
    brand = textLines[0];
  }
  if (!brand && ranked[0]) {
    brand = ranked[0].text;
  }

  let productName = "";
  for (const r of ranked) {
    const wordsCount = lines[r.idx].length;
    if (wordsCount <= 10 && r.avgH >= (ranked[0]?.avgH ?? 0) * 0.6) {
      const t = r.text.trim();
      if (t.toLowerCase().includes("ingredient") || t.toLowerCase().includes("ingredients")) continue;
      if (t.length > 3 && t.toLowerCase() !== brand.toLowerCase()) {
        productName = t;
        break;
      }
    }
  }
  if (!productName && textLines.length > 1) {
    productName = textLines[1];
  }
  if (!productName) {
    productName = ranked[1]?.text ?? ranked[0]?.text ?? textLines[0] ?? "";
  }

  const weightMatch = joined.match(/\b(\d+(?:\.\d+)?)\s*(mg|g|kg|ml|cl|l\b|lb|oz|fl\.?\s*oz)\b/i);
  const weightUnit = weightMatch ? `${weightMatch[1]}${weightMatch[2].replace(/\s/g, "").toLowerCase()}` : "";

  const packMatch = new RegExp(`\\b(${PACKAGING_KEYWORDS.join("|")})\\b`, "i");
  const packagingType = (joined.match(packMatch) ?? [""])[0];

  let finalPackaging = packagingType || "";
  if (!finalPackaging) {
    const lowerName = (productName || "").toLowerCase();
    if (lowerName.includes("mixture") || lowerName.includes("syrup") || lower.includes("syrup")) {
      finalPackaging = "Bottle";
    }
    if (lower.includes("carton") || lower.includes("box")) {
      finalPackaging = "Box";
    }
  }

  let categoryType = "";
  if (/beverage|drink|juice|water|soda|cola|beer|wine/.test(lower)) categoryType = "Beverages";
  else if (/snack|chip|crisp|biscuit|cookie|cracker|candy|chocolate/.test(lower)) categoryType = "Snacks";
  else if (/milk|cheese|yogurt|butter|dairy/.test(lower)) categoryType = "Dairy";
  else if (/shampoo|conditioner|soap|lotion|cream|body wash|cosmetic|skincare/.test(lower)) categoryType = "Personal Care";
  else if (/toothpaste|toothbrush|dental/.test(lower)) categoryType = "Oral Care";
  else if (/detergent|bleach|cleaner|dishwash|laundry/.test(lower)) categoryType = "Household";
  else if (/flour|sugar|salt|rice|oil|sauce|pasta|noodle|cereal|bread/.test(lower)) categoryType = "Grocery";
  else if (/bread|cake|pastry|bun/.test(lower)) categoryType = "Bakery";
  else if (/cough|cold|catarrh|medicine|syrup|pain relief|tablet|capsule/.test(lower)) categoryType = "Healthcare";

  let segmentType = "";
  for (const s of SEGMENT_COUGH) if (lower.includes(s)) { segmentType = "Cough & Cold Relief"; break; }

  const countryMatch = joined.match(/(?:made in|product of|produced in|manufactured in|origin:|made by|packed in)\s*([A-Za-z0-9&\-\s]{2,40})(?:\.|,|\n|$)/i);
  const countryOfOrigin = countryMatch ? countryMatch[1].trim().replace(/\.$/, "") : "";

  const marketingPatterns = [
    /new\b/i,
    /limited edition/i,
    /no added sugar/i,
    /sugar free/i,
    /organic/i,
    /gluten free/i,
    /buy 1 get 1/i,
    /best before/i,
    /extra strength/i,
    /value pack/i,
    /free from/i,
    /high protein/i,
  ];
  let marketingMessage = "";
  for (const pattern of marketingPatterns) {
    const match = joined.match(pattern);
    if (match) {
      marketingMessage = match[0];
      break;
    }
  }
  if (!marketingMessage) {
    marketingMessage = textLines.find((line) => marketingPatterns.some((pattern) => pattern.test(line))) ?? "";
  }

  const topBlocks = ranked.slice(0, 3);
  const avgTopConf = topBlocks.length > 0
    ? topBlocks.reduce((s, b) => s + b.avgConf, 0) / topBlocks.length
    : 80;
  const completeness = [brand, productName, weightUnit, finalPackaging, categoryType].filter(Boolean).length / 5;
  const confidenceScore = parseFloat(
    Math.max(0, Math.min(1, 0.25 * avgTopConf / 100 + 0.75 * completeness)).toFixed(2)
  );

  return {
    barcode: "",
    brand: brand || "",
    productName: productName || "",
    weightUnit,
    categoryType,
    segmentType,
    countryOfOrigin,
    packagingType: finalPackaging || "",
    marketingMessage: marketingMessage || "",
    imageUrl: undefined,
    confidenceScore,
    manufacturer: brand || "",
  };
}

export function computeOCRConfidence(record: Partial<ProductRecord>): number {
  if (typeof record.confidenceScore === "number" && record.confidenceScore > 0) return record.confidenceScore;
  const fields: (keyof ProductRecord)[] = [
    "barcode", "brand", "productName", "weightUnit",
    "countryOfOrigin", "categoryType", "packagingType",
  ];
  const filled = fields.filter((f) => record[f] && record[f] !== "").length;
  return parseFloat((filled / fields.length).toFixed(2));
}
