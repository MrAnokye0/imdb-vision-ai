import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import type { ProductRecord } from "@/src/types/product";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// ─── Validation helpers ───────────────────────────────────────────────────────

/** Normalise barcode — keep only digits, validate length 8/12/13/14 */
function normalizeBarcode(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return [8, 12, 13, 14].includes(digits.length) ? digits : digits || raw;
}

/** Normalise weight — e.g. "500 ML" → "500ml", "1 KG" → "1kg" */
function normalizeWeight(raw: string): string {
  return raw
    .replace(/\s+/g, "")
    .toLowerCase()
    .replace(/kilogram(s)?/i, "kg")
    .replace(/gram(s)?/i, "g")
    .replace(/milliliter(s)?|millilitre(s)?/i, "ml")
    .replace(/liter(s)?|litre(s)?/i, "l")
    .replace(/ounce(s)?/i, "oz")
    .replace(/pound(s)?/i, "lb");
}

/** Normalise country name — title-case */
function normalizeCountry(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Standardise packaging type */
const PACKAGING_MAP: Record<string, string> = {
  bottle: "Bottle", can: "Can", box: "Box", bag: "Bag",
  pouch: "Pouch", jar: "Jar", carton: "Carton", tube: "Tube",
  sachet: "Sachet", tub: "Tub", pack: "Pack", tin: "Tin",
};
function normalizePackaging(raw: string): string {
  return PACKAGING_MAP[raw.toLowerCase()] ?? raw;
}

function validateAndNormalize(product: ProductRecord): ProductRecord {
  return {
    ...product,
    barcode: normalizeBarcode(product.barcode),
    weightUnit: normalizeWeight(product.weightUnit),
    countryOfOrigin: normalizeCountry(product.countryOfOrigin),
    packagingType: normalizePackaging(product.packagingType),
    brand: product.brand.trim(),
    manufacturer: product.manufacturer.trim(),
    productName: product.productName.trim(),
    categoryType: product.categoryType.trim(),
    segmentType: product.segmentType.trim(),
    marketingMessage: product.marketingMessage.trim(),
  };
}

// ─── Fallback ─────────────────────────────────────────────────────────────────

function fallbackProduct(): ProductRecord {
  return {
    barcode: "", categoryType: "", segmentType: "", manufacturer: "",
    brand: "", productName: "Could not extract — please fill manually",
    weightUnit: "", packagingType: "", countryOfOrigin: "",
    marketingMessage: "", confidenceScore: 0,
  };
}

// ─── Gemini call ──────────────────────────────────────────────────────────────

const PROMPT = `You are an expert retail product data analyst.
Carefully examine this product image and extract the following 10 IMDB (Item Master Database) attributes.

Return ONLY a raw JSON object. No markdown. No code fences. No explanation. Just JSON.

{
  "barcode": "the numeric barcode/EAN/UPC visible on the product, empty string if not visible",
  "categoryType": "top-level product category e.g. Beverages, Snacks, Dairy, Personal Care, Household",
  "segmentType": "sub-category e.g. Carbonated Drinks, Potato Chips, Shampoo, Laundry Detergent",
  "manufacturer": "the company that manufactures the product",
  "brand": "the brand name printed on the packaging",
  "productName": "the full product name/variant e.g. Coca-Cola Original Taste 500ml",
  "weightUnit": "weight or volume with unit e.g. 500ml, 1.5L, 250g, 1kg",
  "packagingType": "packaging format e.g. Bottle, Can, Box, Bag, Pouch, Jar, Carton, Tube",
  "countryOfOrigin": "country where the product was made or manufactured",
  "marketingMessage": "any tagline, slogan, or promotional text on the packaging",
  "confidenceScore": 0.95
}

Important:
- confidenceScore must reflect how confident you are in the overall extraction (0.0 to 1.0)
- Use empty string "" for any field you genuinely cannot determine from the image
- Do NOT guess — only fill fields visible in the image`;

async function callGemini(
  base64Image: string,
  mimeType: string,
  retries = 3
): Promise<ProductRecord> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{
          role: "user",
          parts: [
            { inlineData: { data: base64Image, mimeType } },
            { text: PROMPT },
          ],
        }],
      });

      const text = response.text ?? "";
      console.log(`[Gemini attempt ${attempt}]:`, text.slice(0, 400));

      if (!text.trim()) throw new Error("Empty response from Gemini");

      const cleaned = text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();

      const parsed = JSON.parse(cleaned) as ProductRecord;
      return validateAndNormalize(parsed);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit = msg.includes("429") || msg.toLowerCase().includes("quota");
      console.error(`[Gemini attempt ${attempt} failed]:`, msg);

      if (isRateLimit && attempt < retries) {
        const wait = Math.pow(2, attempt) * 1500;
        console.log(`Rate limited — retrying in ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Gemini failed after all retries");
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.image || !body.mimeType) {
      return NextResponse.json({ success: true, data: fallbackProduct() });
    }

    try {
      const product = await callGemini(body.image, body.mimeType);
      return NextResponse.json({ success: true, data: product });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Gemini failed]:", msg);
      // Return the real error message so the UI can show it
      return NextResponse.json({
        success: false,
        error: msg,
        data: fallbackProduct(),
      });
    }
  } catch (err) {
    console.error("[Extract API unhandled error]:", err);
    return NextResponse.json({ success: true, data: fallbackProduct() });
  }
}
