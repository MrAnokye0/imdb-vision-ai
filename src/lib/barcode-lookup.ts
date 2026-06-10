import type { ProductRecord } from "@/src/types/product";

// ─── Open Food Facts API ──────────────────────────────────────────────────────
// Completely free, no API key, covers 3M+ global products
// Docs: https://world.openfoodfacts.org/data

interface OFFProduct {
  product_name?: string;
  product_name_en?: string;
  brands?: string;
  categories?: string;
  categories_tags?: string[];
  quantity?: string;
  packaging?: string;
  packaging_tags?: string[];
  countries_tags?: string[];
  countries?: string;
  manufacturing_places?: string;
  labels?: string;
  generic_name?: string;
  ingredients_text?: string;
  stores?: string;
  nutriscore_grade?: string;
  image_url?: string;
  image_front_url?: string;
}

interface OFFResponse {
  status: number;       // 1 = found, 0 = not found
  status_verbose: string;
  product?: OFFProduct;
}

// ─── Normalise helpers ────────────────────────────────────────────────────────

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

function normaliseCountry(raw: string): string {
  return raw
    .replace(/^en:/i, "")
    .split(",")[0]
    .trim()
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function normalisePackaging(raw: string): string {
  const lower = raw.toLowerCase();
  if (/bottle|bouteille/.test(lower))  return "Bottle";
  if (/can|tin|boîte/.test(lower))     return "Can";
  if (/box|carton|cardboard/.test(lower)) return "Box";
  if (/bag|sachet|pouch/.test(lower))  return "Bag";
  if (/jar|pot/.test(lower))           return "Jar";
  if (/tube/.test(lower))              return "Tube";
  if (/tub|container/.test(lower))     return "Tub";
  return titleCase(raw.split(",")[0].trim());
}

function normaliseCategory(tags: string[]): { categoryType: string; segmentType: string } {
  // OFF category tags look like: "en:beverages", "en:carbonated-drinks"
  const clean = tags
    .filter((t) => t.startsWith("en:"))
    .map((t) => t.replace("en:", "").replace(/-/g, " "))
    .map(titleCase);

  const categoryType = clean[0] ?? "";
  const segmentType  = clean[1] ?? "";
  return { categoryType, segmentType };
}

// ─── Main lookup function ─────────────────────────────────────────────────────

export async function lookupBarcode(
  barcode: string
): Promise<Partial<ProductRecord> | null> {
  if (!barcode || barcode.length < 8) return null;

  try {
    // Try Open Food Facts first
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`,
      { headers: { "User-Agent": "IMDB-AutoFill/1.0" } }
    );

    if (!res.ok) return null;
    const json: OFFResponse = await res.json();

    if (json.status !== 1 || !json.product) {
      // Try Open Beauty Facts for cosmetics/personal care
      const res2 = await fetch(
        `https://world.openbeautyfacts.org/api/v0/product/${barcode}.json`,
        { headers: { "User-Agent": "IMDB-AutoFill/1.0" } }
      );
      if (!res2.ok) return null;
      const json2: OFFResponse = await res2.json();
      if (json2.status !== 1 || !json2.product) return null;
      return mapToIMDB(barcode, json2.product);
    }

    return mapToIMDB(barcode, json.product);

  } catch {
    return null; // network error — fall through to OCR
  }
}

function mapToIMDB(barcode: string, p: OFFProduct): Partial<ProductRecord> {
  const { categoryType, segmentType } = normaliseCategory(p.categories_tags ?? []);

  // Country of origin
  const countryTag = p.countries_tags?.[0] ?? p.manufacturing_places ?? p.countries ?? "";
  const countryOfOrigin = countryTag ? normaliseCountry(countryTag) : "";

  // Packaging
  const packagingRaw = p.packaging ?? p.packaging_tags?.[0] ?? "";
  const packagingType = packagingRaw ? normalisePackaging(packagingRaw) : "";

  // Brand
  const brand = p.brands
    ? titleCase(p.brands.split(",")[0].trim())
    : "";

  // Product name — prefer English
  const productName =
    p.product_name_en?.trim() ||
    p.product_name?.trim() ||
    p.generic_name?.trim() ||
    "";

  // Weight / quantity
  const weightUnit = p.quantity?.trim() ?? "";

  // Marketing message — use labels or nutriscore as fallback
  const marketingMessage = p.labels
    ? p.labels.split(",").slice(0, 2).map(titleCase).join(", ")
    : "";

  // Image
  const imageUrl = p.image_front_url ?? p.image_url ?? undefined;

  // Confidence: higher when more fields are filled by the API
  const fields = [brand, productName, weightUnit, categoryType, countryOfOrigin, packagingType];
  const filled = fields.filter((f) => f.trim() !== "").length;
  const confidenceScore = parseFloat((0.5 + (filled / fields.length) * 0.5).toFixed(2));

  return {
    barcode,
    brand,
    productName,
    weightUnit,
    categoryType,
    segmentType,
    countryOfOrigin,
    packagingType,
    marketingMessage,
    imageUrl,
    confidenceScore,
    manufacturer: brand, // OFF doesn't always separate manufacturer from brand
  };
}
