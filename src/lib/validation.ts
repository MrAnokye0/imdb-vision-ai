import type { ProductRecord } from "@/src/types/product";

// ─── Per-field confidence scores ──────────────────────────────────────────────

export interface FieldConfidence {
  field: keyof ProductRecord;
  label: string;
  value: string;
  confidence: number;   // 0–1
  valid: boolean;
  message?: string;
}

export interface ValidationReport {
  overall: number;            // 0–1 weighted average
  completeness: number;       // 0–1 completeness score based on collected fields
  needsReview: boolean;       // true if overall < 0.8
  fields: FieldConfidence[];
  errors: string[];
  warnings: string[];
}

// ─── Barcode validators ────────────────────────────────────────────────────────

const BARCODE_PATTERNS = [
  { name: "EAN-13",  regex: /^\d{13}$/ },
  { name: "EAN-8",   regex: /^\d{8}$/  },
  { name: "UPC-A",   regex: /^\d{12}$/ },
  { name: "UPC-E",   regex: /^\d{8}$/  },
  { name: "EAN-14",  regex: /^\d{14}$/ },
];

export function validateBarcode(raw: string): { valid: boolean; normalized: string; format?: string; message?: string } {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return { valid: false, normalized: "", message: "No barcode detected" };

  for (const p of BARCODE_PATTERNS) {
    if (p.regex.test(digits)) {
      return { valid: true, normalized: digits, format: p.name };
    }
  }
  // Partial match — still usable
  if (digits.length >= 8) {
    return { valid: true, normalized: digits, message: `Non-standard length (${digits.length} digits)` };
  }
  return { valid: false, normalized: digits, message: `Too short (${digits.length} digits)` };
}

// ─── Weight validators ─────────────────────────────────────────────────────────

const WEIGHT_REGEX = /^(\d+(?:\.\d+)?)\s*(g|kg|mg|ml|l|cl|oz|lb|fl\.?\s*oz)$/i;

export function validateWeight(raw: string): { valid: boolean; normalized: string; message?: string } {
  if (!raw) return { valid: false, normalized: "", message: "Weight not found" };

  const clean = raw.replace(/\s+/g, "").toLowerCase()
    .replace(/kilogram(s)?/, "kg")
    .replace(/gram(s)?/, "g")
    .replace(/milliliter(s)?|millilitre(s)?/, "ml")
    .replace(/liter(s)?|litre(s)?/, "l")
    .replace(/ounce(s)?/, "oz")
    .replace(/pound(s)?/, "lb");

  const m = clean.match(WEIGHT_REGEX);
  if (m) return { valid: true, normalized: clean };
  return { valid: false, normalized: raw, message: "Unrecognized format" };
}

// ─── Country normalizer ────────────────────────────────────────────────────────

const COUNTRY_ALIASES: Record<string, string> = {
  "usa":             "United States",
  "us":              "United States",
  "u.s.":            "United States",
  "united states of america": "United States",
  "uk":              "United Kingdom",
  "great britain":   "United Kingdom",
  "gb":              "United Kingdom",
  "uae":             "United Arab Emirates",
  "drc":             "DR Congo",
  "south korea":     "South Korea",
  "korea":           "South Korea",
  "republic of ireland": "Ireland",
  "ivory coast":     "Côte d'Ivoire",
  "india":           "India",
  "china":           "China",
  "vietnam":         "Vietnam",
  "thailand":        "Thailand",
  "france":          "France",
  "germany":         "Germany",
};

export function normalizeCountry(raw: string): string {
  if (!raw) return "";
  const lower = raw.toLowerCase().trim();
  if (COUNTRY_ALIASES[lower]) return COUNTRY_ALIASES[lower];
  return raw.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

// ─── Brand normalizer ──────────────────────────────────────────────────────────

// Standardize known brand spellings
const BRAND_ALIASES: Record<string, string> = {
  "coca cola":  "Coca-Cola",
  "cocacola":   "Coca-Cola",
  "pepsi cola": "Pepsi",
  "mcdonald s": "McDonald's",
  "mcdonalds":  "McDonald's",
  "nestle":     "Nestlé",
  "p&g":        "Procter & Gamble",
  "procter and gamble": "Procter & Gamble",
};

export function normalizeBrand(raw: string): string {
  if (!raw) return "";
  const lower = raw.toLowerCase().trim();
  if (BRAND_ALIASES[lower]) return BRAND_ALIASES[lower];
  // Title case
  return raw.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

// ─── Category normalizer ───────────────────────────────────────────────────────

const CATEGORY_MAP: Record<string, string> = {
  "beverages":     "Beverages",
  "beverage":      "Beverages",
  "drinks":        "Beverages",
  "soft drinks":   "Beverages",
  "cold drinks":   "Beverages",
  "energy drinks": "Beverages",
  "snacks":        "Snacks",
  "snack":         "Snacks",
  "chips":         "Snacks",
  "crisp":         "Snacks",
  "dairy":         "Dairy",
  "personal care": "Personal Care",
  "beauty":        "Personal Care",
  "cosmetics":     "Personal Care",
  "household":     "Household",
  "groceries":     "Grocery",
  "grocery":       "Grocery",
  "food":          "Food",
  "confectionery": "Confectionery",
  "sweets":        "Confectionery",
  "breakfast":     "Breakfast",
  "bakery":        "Bakery",
  "oral care":     "Oral Care",
  "healthcare":    "Healthcare",
  "health":        "Healthcare",
  "snack food":    "Snacks",
};

export function normalizeCategory(raw: string): string {
  if (!raw) return "";
  const lower = raw.toLowerCase().trim();
  return CATEGORY_MAP[lower] ?? raw.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

// ─── Packaging normalizer ──────────────────────────────────────────────────────

const PACKAGING_MAP: Record<string, string> = {
  bottle: "Bottle", bottles: "Bottle",
  can: "Can", cans: "Can", tin: "Can",
  box: "Box", boxes: "Box", carton: "Carton", cardboard: "Box",
  bag: "Bag", bags: "Bag", sachet: "Sachet",
  pouch: "Pouch", pouches: "Pouch",
  jar: "Jar", jars: "Jar",
  tube: "Tube", tubes: "Tube",
  tub: "Tub", container: "Container",
  pack: "Pack", packet: "Pack",
  sleeve: "Pack", blister: "Pack", tray: "Tray",
  barrel: "Barrel", crate: "Crate",
};

export function normalizePackaging(raw: string): string {
  if (!raw) return "";
  const lower = raw.toLowerCase().trim();
  return PACKAGING_MAP[lower] ?? raw.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

// ─── Full normalization pass ───────────────────────────────────────────────────

export function normalizeProduct(p: ProductRecord): ProductRecord {
  return {
    ...p,
    barcode:         validateBarcode(p.barcode).normalized,
    weightUnit:      validateWeight(p.weightUnit).normalized || p.weightUnit,
    countryOfOrigin: normalizeCountry(p.countryOfOrigin),
    brand:           normalizeBrand(p.brand),
    manufacturer:    p.manufacturer.trim(),
    categoryType:    normalizeCategory(p.categoryType),
    segmentType:     p.segmentType.trim(),
    packagingType:   normalizePackaging(p.packagingType),
    productName:     p.productName.trim(),
    marketingMessage: p.marketingMessage.trim(),
  };
}

// ─── Per-field confidence scoring ─────────────────────────────────────────────

function scoreField(
  field: keyof ProductRecord,
  label: string,
  value: string
): FieldConfidence {
  if (!value || !value.trim()) {
    return { field, label, value: "", confidence: 0, valid: false, message: "Field is empty" };
  }

  switch (field) {
    case "barcode": {
      const r = validateBarcode(value);
      return { field, label, value: r.normalized, confidence: r.valid ? 1.0 : 0.4, valid: r.valid, message: r.format ?? r.message };
    }
    case "weightUnit": {
      const r = validateWeight(value);
      return { field, label, value: r.normalized, confidence: r.valid ? 0.95 : 0.5, valid: r.valid, message: r.message };
    }
    case "brand": {
      const conf = value.length >= 2 && value.length <= 40 ? 0.9 : 0.6;
      return { field, label, value, confidence: conf, valid: conf >= 0.7 };
    }
    case "productName": {
      const conf = value.length >= 3 && value.length <= 120 ? 0.88 : 0.5;
      return { field, label, value, confidence: conf, valid: conf >= 0.7 };
    }
    case "countryOfOrigin": {
      const normalized = normalizeCountry(value);
      const conf = normalized.length >= 3 ? 0.85 : 0.5;
      return { field, label, value: normalized, confidence: conf, valid: conf >= 0.7 };
    }
    case "categoryType": {
      const normalized = normalizeCategory(value);
      return { field, label, value: normalized, confidence: 0.82, valid: true };
    }
    case "packagingType": {
      const normalized = normalizePackaging(value);
      return { field, label, value: normalized, confidence: 0.85, valid: true };
    }
    case "segmentType": {
      const conf = value.trim() ? 0.8 : 0.4;
      return { field, label, value, confidence: conf, valid: conf >= 0.7 };
    }
    case "manufacturer": {
      const conf = value.trim().length >= 2 ? 0.78 : 0.5;
      return { field, label, value, confidence: conf, valid: conf >= 0.7 };
    }
    case "marketingMessage": {
      const promo = /(new|limited edition|no added sugar|sugar free|organic|gluten free|buy 1 get 1|best before|extra strength|value pack)/i;
      const conf = promo.test(value) ? 0.85 : 0.55;
      return { field, label, value, confidence: conf, valid: conf >= 0.7 };
    }
    default:
      return { field, label, value, confidence: 0.7, valid: true };
  }
}

// ─── Generate full validation report ──────────────────────────────────────────

const FIELD_LABELS: Partial<Record<keyof ProductRecord, string>> = {
  barcode:          "Barcode",
  categoryType:     "Category Type",
  segmentType:      "Segment Type",
  manufacturer:     "Manufacturer",
  brand:            "Brand",
  productName:      "Product Name",
  weightUnit:       "Weight & Unit",
  packagingType:    "Packaging Type",
  countryOfOrigin:  "Country of Origin",
  marketingMessage: "Marketing Message",
};

// Weights for overall confidence calculation
const FIELD_WEIGHTS: Partial<Record<keyof ProductRecord, number>> = {
  barcode:          1.5,
  brand:            1.4,
  productName:      1.3,
  categoryType:     1.0,
  weightUnit:       1.0,
  countryOfOrigin:  0.9,
  packagingType:    0.8,
  manufacturer:     0.8,
  segmentType:      0.6,
  marketingMessage: 0.4,
};

export function generateValidationReport(product: ProductRecord): ValidationReport {
  const fields: FieldConfidence[] = [];
  const errors: string[]   = [];
  const warnings: string[] = [];

  let weightedSum   = 0;
  let totalWeight   = 0;

  for (const [field, label] of Object.entries(FIELD_LABELS) as [keyof ProductRecord, string][]) {
    const value  = (product[field] as string) ?? "";
    const scored = scoreField(field, label, value);
    const weight = FIELD_WEIGHTS[field] ?? 0.7;

    fields.push(scored);
    weightedSum += scored.confidence * weight;
    totalWeight += weight;

    if (!scored.valid && scored.confidence === 0) {
      warnings.push(`${label} is empty`);
    } else if (!scored.valid) {
      errors.push(`${label}: ${scored.message}`);
    }
  }

  const overall = totalWeight > 0
    ? parseFloat((weightedSum / totalWeight).toFixed(2))
    : 0;

  const filledFields = fields.filter((field) => field.value.trim().length > 0).length;
  const completeness = parseFloat((filledFields / fields.length).toFixed(2));

  return {
    overall,
    completeness,
    needsReview: overall < 0.8,
    fields,
    errors,
    warnings,
  };
}
