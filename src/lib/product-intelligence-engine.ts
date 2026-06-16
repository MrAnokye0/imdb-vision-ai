/**
 * Product Intelligence Engine
 *
 * Pure rule-based extraction of all 10 IMDB fields from OCR text.
 * No LLM dependency. No external API required.
 * AWS Rekognition results are accepted as optional hints to boost confidence.
 */

import type { ProductRecord } from "@/src/types/product";
import type { OCRResult, OCRWord } from "@/src/lib/ocr";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FieldResult {
  value: string;
  confidence: number; // 0–1
  source: string;
}

export interface ExtractionOutput {
  barcode:          FieldResult;
  brand:            FieldResult;
  productName:      FieldResult;
  weightUnit:       FieldResult;
  categoryType:     FieldResult;
  segmentType:      FieldResult;
  manufacturer:     FieldResult;
  countryOfOrigin:  FieldResult;
  packagingType:    FieldResult;
  marketingMessage: FieldResult;
}

export interface RekognitionHints {
  categoryType?:  string;
  segmentType?:   string;
  packagingType?: string;
  confidence?:    number; // 0–100
}

// ─── Category mapping ─────────────────────────────────────────────────────────

const CATEGORY_RULES: Array<{ patterns: RegExp; category: string; segment?: string }> = [
  // Healthcare
  { patterns: /\b(cough|cold|catarrh|throat|flu|fever)\b/i,                    category: "Healthcare",    segment: "Cough & Cold Relief" },
  { patterns: /\b(paracetamol|ibuprofen|aspirin|antibiotic|tablet|capsule|syrup|pain relief|medicine|pharmaceutical)\b/i, category: "Healthcare" },
  { patterns: /\b(vitamin|supplement|mineral|zinc|iron|omega)\b/i,             category: "Healthcare",    segment: "Vitamins & Supplements" },
  // Personal Care
  { patterns: /\b(shampoo|conditioner|hair\s*care|hair\s*oil)\b/i,             category: "Personal Care", segment: "Hair Care" },
  { patterns: /\b(body\s*wash|shower\s*gel|bath\s*soap|bar\s*soap|soap)\b/i,   category: "Personal Care", segment: "Body Wash & Soap" },
  { patterns: /\b(lotion|moisturis|moisturiz|body\s*cream|face\s*cream|skincare|serum|sunscreen|sunblock|face\s*wash|cleanser)\b/i, category: "Personal Care", segment: "Skin Care" },
  { patterns: /\b(deodorant|antiperspirant|perfume|cologne|fragrance)\b/i,     category: "Personal Care", segment: "Deodorant & Fragrance" },
  // Oral Care
  { patterns: /\b(toothpaste|toothbrush|mouthwash|dental\s*floss|teeth\s*whitening|gum\s*care)\b/i, category: "Oral Care" },
  // Beverages
  { patterns: /\b(juice|fruit\s*drink|nectar|squash|cordial)\b/i,              category: "Beverages",     segment: "Juice & Fruit Drinks" },
  { patterns: /\b(malt|milo|horlicks|ovaltine|chocolate\s*drink)\b/i,          category: "Beverages",     segment: "Chocolate Malt Drink" },
  { patterns: /\b(coffee|espresso|latte|cappuccino|americano)\b/i,             category: "Beverages",     segment: "Coffee" },
  { patterns: /\b(tea|black\s*tea|green\s*tea|herbal\s*tea|chai)\b/i,          category: "Beverages",     segment: "Tea" },
  { patterns: /\b(energy\s*drink|redbull|monster|power)\b/i,                   category: "Beverages",     segment: "Energy Drink" },
  { patterns: /\b(water|mineral\s*water|sparkling\s*water|spring\s*water)\b/i, category: "Beverages",     segment: "Water" },
  { patterns: /\b(soda|cola|carbonated|soft\s*drink|fizzy|lemonade|fanta|sprite|pepsi|coca[-\s]?cola)\b/i, category: "Beverages", segment: "Carbonated Soft Drink" },
  { patterns: /\b(milk|dairy\s*drink|milkshake|dairy)\b/i,                     category: "Beverages",     segment: "Milk-Based Beverage" },
  { patterns: /\b(beer|lager|ale|stout|cider)\b/i,                             category: "Beverages",     segment: "Beer & Cider" },
  { patterns: /\b(wine|champagne|prosecco|spirit|whisky|vodka|rum|gin)\b/i,    category: "Beverages",     segment: "Wine & Spirits" },
  // Dairy
  { patterns: /\b(cheese|yogurt|yoghurt|butter|ghee|cream|custard|ice\s*cream|whey)\b/i, category: "Dairy" },
  // Snacks
  { patterns: /\b(potato\s*chip|crisp|pringles)\b/i,                           category: "Snacks",        segment: "Potato Chips" },
  { patterns: /\b(biscuit|cookie|cracker|wafer)\b/i,                           category: "Snacks",        segment: "Biscuit & Cookie" },
  { patterns: /\b(chocolate\s*bar|chocolate\s*slab|chocolate)\b/i,             category: "Snacks",        segment: "Chocolate" },
  { patterns: /\b(candy|sweet|lollipop|gum|caramel|toffee|marshmallow)\b/i,   category: "Snacks",        segment: "Confectionery" },
  { patterns: /\b(popcorn|pretzel|peanut|cashew|almond|nut|trail\s*mix)\b/i,  category: "Snacks",        segment: "Nuts & Seeds" },
  { patterns: /\b(granola|cereal\s*bar|protein\s*bar|energy\s*bar)\b/i,        category: "Snacks",        segment: "Cereal Bar" },
  // Bakery
  { patterns: /\b(bread|loaf|bun|roll|bagel|croissant|muffin|donut|doughnut|cake|pastry)\b/i, category: "Bakery" },
  // Grocery / Pantry
  { patterns: /\b(flour|sugar|salt|pepper|spice|seasoning|herb)\b/i,          category: "Grocery",       segment: "Spices & Seasonings" },
  { patterns: /\b(rice|pasta|noodle|spaghetti|macaroni)\b/i,                  category: "Grocery",       segment: "Rice, Pasta & Noodles" },
  { patterns: /\b(cooking\s*oil|olive\s*oil|vegetable\s*oil|palm\s*oil|sunflower\s*oil)\b/i, category: "Grocery", segment: "Cooking Oil" },
  { patterns: /\b(sauce|ketchup|tomato\s*paste|mustard|mayonnaise|vinegar|soy\s*sauce|condiment)\b/i, category: "Grocery", segment: "Sauces & Condiments" },
  { patterns: /\b(cereal|oats|cornflakes|porridge|muesli)\b/i,                 category: "Grocery",       segment: "Breakfast Cereals" },
  { patterns: /\b(stock\s*cube|bouillon|seasoning\s*cube|maggi|knorr)\b/i,     category: "Grocery",       segment: "Seasonings & Stock" },
  { patterns: /\b(jam|honey|spread|peanut\s*butter|marmalade|nutella)\b/i,    category: "Grocery",       segment: "Spreads & Jams" },
  { patterns: /\b(canned|tinned|beans|lentils|chickpeas|peas)\b/i,            category: "Grocery",       segment: "Canned & Pulses" },
  // Household
  { patterns: /\b(laundry|washing\s*powder|fabric\s*softener|fabric\s*conditioner)\b/i, category: "Household", segment: "Laundry" },
  { patterns: /\b(dishwash|dish\s*soap|washing\s*up|dishwasher\s*tablet)\b/i, category: "Household",     segment: "Dish Washing" },
  { patterns: /\b(bleach|disinfectant|sanitizer|sanitiser|floor\s*cleaner|toilet\s*cleaner)\b/i, category: "Household", segment: "Cleaning & Disinfectants" },
  { patterns: /\b(detergent|cleaner|degreaser|stain\s*remover|wipe)\b/i,      category: "Household",     segment: "General Cleaning" },
  // Baby
  { patterns: /\b(diaper|nappy|baby\s*wipe|baby\s*food|baby\s*formula|infant|baby)\b/i, category: "Baby Products" },
  // Pet
  { patterns: /\b(dog\s*food|cat\s*food|pet\s*food|kibble|animal\s*feed)\b/i, category: "Pet Care" },
];

// ─── Packaging mapping ────────────────────────────────────────────────────────

const PACKAGING_RULES: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /\b(glass\s*bottle|plastic\s*bottle|water\s*bottle|bottle)\b/i,  value: "Bottle"  },
  { pattern: /\b(aluminium\s*can|aluminum\s*can|tin\s*can|can|tin)\b/i,       value: "Can"     },
  { pattern: /\b(cardboard\s*box|carton|paperboard|box)\b/i,                  value: "Carton"  },
  { pattern: /\b(stand-up\s*pouch|doy\s*pack|pouch)\b/i,                      value: "Pouch"   },
  { pattern: /\b(sachet|single\s*serve|single-serve|packet)\b/i,              value: "Sachet"  },
  { pattern: /\b(glass\s*jar|jar|pot)\b/i,                                    value: "Jar"     },
  { pattern: /\b(squeeze\s*tube|tube)\b/i,                                    value: "Tube"    },
  { pattern: /\b(plastic\s*tub|tub)\b/i,                                      value: "Tub"     },
  { pattern: /\b(blister\s*pack|blister)\b/i,                                 value: "Blister" },
  { pattern: /\b(resealable\s*bag|foil\s*bag|paper\s*bag|bag)\b/i,           value: "Bag"     },
  { pattern: /\b(wrap|sleeve|tray)\b/i,                                       value: "Pack"    },
];

// ─── Weight patterns ──────────────────────────────────────────────────────────

// Ordered most-specific first (net weight/vol labels preferred)
const WEIGHT_PATTERNS: Array<{ re: RegExp; units: string }> = [
  { re: /net\s+(?:wt\.?|weight|vol\.?|volume|content)\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*(mg|g|kg|ml|cl|l\b|lb|oz|fl\.?\s*oz)/i, units: "" },
  { re: /(\d+(?:[.,]\d+)?)\s*(mg)\b/i,          units: "mg"    },
  { re: /(\d+(?:[.,]\d+)?)\s*(kg)\b/i,          units: "kg"    },
  { re: /(\d+(?:[.,]\d+)?)\s*(ml)\b/i,          units: "ml"    },
  { re: /(\d+(?:[.,]\d+)?)\s*(cl)\b/i,          units: "cl"    },
  { re: /(\d+(?:[.,]\d+)?)\s*(fl\.?\s*oz)\b/i,  units: "fl oz" },
  { re: /(\d+(?:[.,]\d+)?)\s*(oz)\b/i,          units: "oz"    },
  { re: /(\d+(?:[.,]\d+)?)\s*(lb)\b/i,          units: "lb"    },
  { re: /(\d+(?:[.,]\d+)?)\s*g\b/i,             units: "g"     },
  { re: /(\d+(?:[.,]\d+)?)\s*l\b/i,             units: "l"     },
];

function normaliseUnit(raw: string): string {
  const u = raw.replace(/\s+/g, "").toLowerCase().replace(/\./, "");
  if (u === "floz" || u === "floz") return "fl oz";
  return u;
}

// ─── Country patterns ─────────────────────────────────────────────────────────

const COUNTRY_PATTERNS: RegExp[] = [
  /(?:made|manufactured|produced|packed|bottled|assembled|imported|origin)[:\s]+in\s+([A-Za-z][A-Za-z ,\-]{1,40})(?:[.\n,;]|$)/i,
  /(?:product|produce)\s+of\s+([A-Za-z][A-Za-z ,\-]{1,40})(?:[.\n,;]|$)/i,
  /country\s+of\s+origin\s*[:\-]?\s*([A-Za-z][A-Za-z ,\-]{1,40})(?:[.\n,;]|$)/i,
  /origin\s*[:\-]\s*([A-Za-z][A-Za-z ,\-]{1,40})(?:[.\n,;]|$)/i,
];

const COUNTRY_ALIASES: Record<string, string> = {
  "usa": "United States", "us": "United States", "u.s.a": "United States",
  "uk": "United Kingdom",  "gb": "United Kingdom", "great britain": "United Kingdom",
  "uae": "United Arab Emirates",
  "south korea": "South Korea", "korea": "South Korea",
  "ivory coast": "Côte d'Ivoire",
  "holland": "Netherlands",
  "england": "United Kingdom", "scotland": "United Kingdom",
};

function normaliseCountry(raw: string): string {
  const s = raw.trim().replace(/[.,;:\s]+$/, "");
  if (!s || s.length < 2 || s.length > 50) return "";
  if (/\d/.test(s)) return ""; // reject address lines with numbers
  const lower = s.toLowerCase();
  return COUNTRY_ALIASES[lower] ?? s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Manufacturer patterns ────────────────────────────────────────────────────

const MANUFACTURER_PATTERNS: RegExp[] = [
  /manufactured\s+by\s*[:\-]?\s*(.{3,60})(?:[.\n]|$)/i,
  /manufactured\s+for\s*[:\-]?\s*(.{3,60})(?:[.\n]|$)/i,
  /produced\s+by\s*[:\-]?\s*(.{3,60})(?:[.\n]|$)/i,
  /distributed\s+by\s*[:\-]?\s*(.{3,60})(?:[.\n]|$)/i,
  /imported\s+by\s*[:\-]?\s*(.{3,60})(?:[.\n]|$)/i,
  /packed\s+by\s*[:\-]?\s*(.{3,60})(?:[.\n]|$)/i,
  /marketed\s+by\s*[:\-]?\s*(.{3,60})(?:[.\n]|$)/i,
];

// ─── Marketing message patterns ───────────────────────────────────────────────

const MARKETING_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(new\s+and\s+improved|new\s+formula|new\s+recipe)\b/i,         label: "New & Improved"       },
  { re: /\bnew\b/i,                                                         label: "New"                  },
  { re: /\blimited\s+edition\b/i,                                           label: "Limited Edition"      },
  { re: /\bno\s+added\s+sugar\b/i,                                          label: "No Added Sugar"       },
  { re: /\bsugar[- ]free\b/i,                                               label: "Sugar Free"           },
  { re: /\bgluten[- ]free\b/i,                                              label: "Gluten Free"          },
  { re: /\bdairy[- ]free\b/i,                                               label: "Dairy Free"           },
  { re: /\bvegan\b/i,                                                        label: "Vegan"                },
  { re: /\borganic\b/i,                                                      label: "Organic"              },
  { re: /\b100\s*%\s*(natural|pure|real|juice)\b/i,                         label: "100% Natural"         },
  { re: /\bextra\s+strength\b/i,                                             label: "Extra Strength"       },
  { re: /\bvalue\s+pack\b/i,                                                 label: "Value Pack"           },
  { re: /\bhigh\s+(protein|fibre|fiber|calcium|iron)\b/i,                   label: "High Protein/Nutrient"},
  { re: /\blow\s+(fat|sugar|calorie|sodium|salt)\b/i,                       label: "Low Fat/Sugar"        },
  { re: /\bfortified\s+with\b/i,                                             label: "Fortified"            },
  { re: /\bclinically\s+(proven|tested)\b/i,                                 label: "Clinically Proven"    },
  { re: /\bdermatologically\s+tested\b/i,                                    label: "Dermatologically Tested"},
  { re: /\bpremium\b/i,                                                      label: "Premium"              },
  { re: /\baward[- ]winning\b/i,                                             label: "Award Winning"        },
  { re: /\bbuy\s+\d+\s+get\s+\d+\b/i,                                       label: "Buy X Get Y"          },
  { re: /\bfree\s+gift\b/i,                                                  label: "Free Gift"            },
];

// ─── Brand / product name helpers ─────────────────────────────────────────────

const REJECT_LINES = [
  /ingredient/i, /nutrition/i, /warning/i, /directions/i, /preserve/i,
  /storage/i, /manufactured/i, /distributed/i, /imported/i, /made\s+in/i,
  /address/i, /www\./i, /http/i, /barcode/i, /net\s+wt/i, /best\s+before/i,
  /use\s+by/i, /keep\s+refrigerated/i, /allergen/i, /may\s+contain/i,
  /\@/, /tel:/i, /fax:/i, /email/i,
];

function isRejectLine(line: string): boolean {
  return REJECT_LINES.some((r) => r.test(line));
}

function clusterLines(words: OCRWord[], yTol = 14): OCRWord[][] {
  const sorted = [...words].sort((a, b) => a.y - b.y);
  const lines: OCRWord[][] = [];
  for (const w of sorted) {
    const found = lines.find((ln) => Math.abs(ln[0].y - w.y) <= yTol);
    if (found) found.push(w);
    else lines.push([w]);
  }
  return lines.map((ln) => ln.sort((a, b) => a.x - b.x));
}

function lineText(words: OCRWord[]): string {
  return words.map((w) => w.text).join(" ").trim();
}

interface ScoredLine {
  text: string;
  avgH: number;
  area: number;
  centerX: number;
  centerY: number;
  avgConf: number;
}

function scoredLines(ocr: OCRResult): ScoredLine[] {
  const words = ocr.words.filter((w) => w.text.trim().length >= 1);
  const lines  = clusterLines(words);
  return lines.map((ln) => {
    const avgH    = ln.reduce((s, w) => s + w.h, 0) / ln.length || 0;
    const area    = ln.reduce((s, w) => s + w.w * w.h, 0);
    const centerX = ln.reduce((s, w) => s + w.x + w.w / 2, 0) / ln.length || 0;
    const centerY = ln.reduce((s, w) => s + w.y + w.h / 2, 0) / ln.length || 0;
    const avgConf = ln.reduce((s, w) => s + (w.conf ?? 0), 0) / ln.length || 0;
    return { text: lineText(ln), avgH, area, centerX, centerY, avgConf };
  }).sort((a, b) => b.avgH - a.avgH || b.area - a.area);
}

// ─── Core extraction functions ────────────────────────────────────────────────

function extractWeight(text: string): FieldResult {
  for (const { re } of WEIGHT_PATTERNS) {
    const m = text.match(re);
    if (m) {
      // Group positions vary — handle both "net wt X unit" (groups 1,2) and simple "X unit"
      const value = (m[1] ?? m[2] ?? "").replace(",", ".").trim();
      const unit  = normaliseUnit((m[2] ?? m[3] ?? "").trim());
      const result = `${value}${unit}`;
      if (value && unit) return { value: result, confidence: 0.92, source: "regex" };
    }
  }
  return { value: "", confidence: 0, source: "none" };
}

function extractCountry(text: string): FieldResult {
  for (const re of COUNTRY_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const normalised = normaliseCountry(m[1]);
      if (normalised) return { value: normalised, confidence: 0.88, source: "regex" };
    }
  }
  return { value: "", confidence: 0, source: "none" };
}

function extractManufacturer(text: string): FieldResult {
  for (const re of MANUFACTURER_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const candidate = m[1].trim().replace(/[.,;:]+$/, "").trim();
      // Reject if it looks like a full address (contains digits or is too long)
      if (candidate.length >= 2 && candidate.length <= 80 && !/\d{3,}/.test(candidate)) {
        return { value: candidate, confidence: 0.85, source: "regex" };
      }
    }
  }
  return { value: "", confidence: 0, source: "none" };
}

function extractPackaging(text: string): FieldResult {
  for (const { pattern, value } of PACKAGING_RULES) {
    if (pattern.test(text)) return { value, confidence: 0.80, source: "regex" };
  }
  return { value: "", confidence: 0, source: "none" };
}

function extractCategory(text: string): FieldResult {
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.test(text)) {
      return { value: rule.category, confidence: 0.82, source: "regex" };
    }
  }
  return { value: "", confidence: 0, source: "none" };
}

function extractSegment(text: string, category: string): FieldResult {
  for (const rule of CATEGORY_RULES) {
    if (rule.segment && rule.patterns.test(text)) {
      return { value: rule.segment, confidence: 0.78, source: "regex" };
    }
  }
  // Fallback segment from category
  const categorySegments: Record<string, string> = {
    "Bakery":       "Baked Goods",
    "Dairy":        "Dairy Products",
    "Baby Products":"Baby Care",
    "Pet Care":     "Pet Food",
  };
  if (categorySegments[category]) {
    return { value: categorySegments[category], confidence: 0.60, source: "category_fallback" };
  }
  return { value: "", confidence: 0, source: "none" };
}

function extractMarketing(text: string): FieldResult {
  for (const { re, label } of MARKETING_PATTERNS) {
    if (re.test(text)) return { value: label, confidence: 0.75, source: "regex" };
  }
  return { value: "", confidence: 0, source: "none" };
}

function extractBrand(ocr: OCRResult, imageLabel?: string): FieldResult {
  // For front images: prefer largest font, top-of-image, short, all-caps or title-case text
  const scored = scoredLines(ocr);
  const imgH   = ocr.height ?? 1000;
  const topZone = imgH * 0.50;

  for (const line of scored) {
    const t = line.text.trim();
    if (!t || t.length < 2 || t.length > 50) continue;
    if (isRejectLine(t)) continue;
    if (/^\d+$/.test(t)) continue;                          // pure numbers
    if (/^[\W_]+$/.test(t)) continue;                       // symbols only
    if (line.centerY > topZone && imageLabel === "Front") continue; // too far down front

    // Prefer: all-caps, or title-case, 1-4 words, high font size
    const wordCount = t.split(/\s+/).length;
    if (wordCount <= 5) {
      const isAllCaps = t === t.toUpperCase() && /[A-Z]/.test(t);
      const isTitleCase = /^[A-Z]/.test(t);
      if (isAllCaps || isTitleCase) {
        return { value: t, confidence: isAllCaps ? 0.85 : 0.75, source: "ocr_font_size" };
      }
    }
  }

  // Fallback: first non-reject line from the OCR text
  const lines = (ocr.text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (!isRejectLine(line) && line.length >= 2 && line.length <= 50) {
      return { value: line, confidence: 0.55, source: "ocr_first_line" };
    }
  }
  return { value: "", confidence: 0, source: "none" };
}

function extractProductName(ocr: OCRResult, brand: string): FieldResult {
  const scored  = scoredLines(ocr);
  const brandLo = brand.toLowerCase();

  for (const line of scored.slice(0, 12)) {
    const t = line.text.trim();
    if (!t || t.length < 3 || t.length > 120) continue;
    if (isRejectLine(t)) continue;
    if (t.toLowerCase() === brandLo) continue;            // skip brand itself
    if (/^\d+$/.test(t)) continue;
    if (line.avgH < 4) continue;                          // too small to be product name

    return { value: t, confidence: 0.72, source: "ocr_font_rank" };
  }

  // Fallback: second non-reject line in raw text
  const lines = (ocr.text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let skip = 0;
  for (const line of lines) {
    if (isRejectLine(line)) continue;
    if (line.toLowerCase() === brandLo) { skip = 1; continue; }
    if (skip > 0 && line.length >= 3) return { value: line, confidence: 0.55, source: "ocr_second_line" };
    if (skip === 0 && line.length >= 3 && line.toLowerCase() !== brandLo) {
      return { value: line, confidence: 0.50, source: "ocr_fallback" };
    }
  }
  return { value: "", confidence: 0, source: "none" };
}

// ─── Multi-image merge ────────────────────────────────────────────────────────

/**
 * Merge OCR results from multiple images.
 * Front image is used for brand/product name.
 * Back image is used for manufacturer/country.
 * All images contribute to weight, category, packaging, marketing.
 */
function mergeOCRTexts(
  ocrResults: Array<{ result: OCRResult; label: string }>
): { combined: string; front?: OCRResult; back?: OCRResult } {
  let front: OCRResult | undefined;
  let back: OCRResult | undefined;

  for (const { result, label } of ocrResults) {
    if (label === "Front"  && !front) front = result;
    if (label === "Back"   && !back)  back  = result;
  }

  const combined = ocrResults
    .map(({ result }) => result.text ?? "")
    .filter(Boolean)
    .join("\n\n");

  return { combined, front, back };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function runProductIntelligenceEngine(
  ocrResults: Array<{ result: OCRResult; label: string }>,
  barcodeFromZXing: string,
  rekognitionHints?: RekognitionHints
): ExtractionOutput {
  const { combined, front, back } = mergeOCRTexts(ocrResults);
  const combinedLower = combined.toLowerCase();

  // ── Barcode ──────────────────────────────────────────────────────────────
  let barcode: FieldResult = { value: "", confidence: 0, source: "none" };
  if (barcodeFromZXing) {
    barcode = { value: barcodeFromZXing, confidence: 1.0, source: "zxing" };
  } else {
    // Regex fallback on OCR text
    const m = combined.match(/(?<![+\d])(\d{13}|\d{12}|\d{8})(?!\d)/);
    if (m) barcode = { value: m[1], confidence: 0.75, source: "ocr_regex" };
  }

  // ── Weight ───────────────────────────────────────────────────────────────
  // Try front first, then combined
  let weightUnit = extractWeight(front?.text ?? "");
  if (!weightUnit.value) weightUnit = extractWeight(combined);
  // Corroborate across multiple images (boosts confidence)
  if (weightUnit.value) {
    const matches = ocrResults.filter(({ result }) => extractWeight(result.text ?? "").value === weightUnit.value).length;
    if (matches >= 2) weightUnit = { ...weightUnit, confidence: Math.min(1, weightUnit.confidence + 0.07) };
  }

  // ── Country ──────────────────────────────────────────────────────────────
  // Manufacturer side / back is priority source
  let countryOfOrigin = extractCountry(back?.text ?? "");
  if (!countryOfOrigin.value) countryOfOrigin = extractCountry(combined);

  // ── Manufacturer ─────────────────────────────────────────────────────────
  let manufacturer = extractManufacturer(back?.text ?? "");
  if (!manufacturer.value) manufacturer = extractManufacturer(combined);

  // ── Packaging ────────────────────────────────────────────────────────────
  let packagingType = extractPackaging(combined);

  // ── Category + Segment ───────────────────────────────────────────────────
  let categoryType = extractCategory(combinedLower);
  let segmentType  = extractSegment(combinedLower, categoryType.value);

  // ── Marketing message ─────────────────────────────────────────────────────
  const marketingMessage = extractMarketing(combined);

  // ── Brand ────────────────────────────────────────────────────────────────
  // Use front image if available, else first image
  const brandSource = front ?? ocrResults[0]?.result;
  let brand: FieldResult = { value: "", confidence: 0, source: "none" };
  if (brandSource) {
    brand = extractBrand(brandSource, ocrResults.find(r => r.result === brandSource)?.label);
  }

  // ── Product Name ──────────────────────────────────────────────────────────
  let productName: FieldResult = { value: "", confidence: 0, source: "none" };
  if (brandSource) {
    productName = extractProductName(brandSource, brand.value);
  }

  // ── AWS Rekognition hints (boosts category + packaging) ───────────────────
  if (rekognitionHints) {
    const rekConf = rekognitionHints.confidence ? rekognitionHints.confidence / 100 : 0.80;

    if (rekognitionHints.categoryType && rekConf > categoryType.confidence) {
      categoryType = { value: rekognitionHints.categoryType, confidence: rekConf, source: "rekognition" };
    }
    if (rekognitionHints.segmentType && rekConf > segmentType.confidence) {
      segmentType = { value: rekognitionHints.segmentType, confidence: rekConf, source: "rekognition" };
    }
    if (rekognitionHints.packagingType && rekConf > packagingType.confidence) {
      packagingType = { value: rekognitionHints.packagingType, confidence: rekConf, source: "rekognition" };
    }
  }

  // ── Infer manufacturer from brand if missing ──────────────────────────────
  if (!manufacturer.value && brand.value) {
    manufacturer = { value: brand.value, confidence: 0.50, source: "brand_fallback" };
  }

  return {
    barcode,
    brand,
    productName,
    weightUnit,
    categoryType,
    segmentType,
    manufacturer,
    countryOfOrigin,
    packagingType,
    marketingMessage,
  };
}

// ─── Convert to ProductRecord ─────────────────────────────────────────────────

export function toProductRecord(
  output: ExtractionOutput,
  imageUrl?: string,
  imageUrls?: string[]
): ProductRecord {
  const fieldConfidenceScores: Record<string, number> = {};
  for (const [key, result] of Object.entries(output) as [string, FieldResult][]) {
    fieldConfidenceScores[key] = result.confidence;
  }

  return {
    barcode:          output.barcode.value,
    brand:            output.brand.value,
    productName:      output.productName.value,
    weightUnit:       output.weightUnit.value,
    categoryType:     output.categoryType.value,
    segmentType:      output.segmentType.value,
    manufacturer:     output.manufacturer.value,
    countryOfOrigin:  output.countryOfOrigin.value,
    packagingType:    output.packagingType.value,
    marketingMessage: output.marketingMessage.value,
    confidenceScore:  0, // set by validation
    fieldConfidenceScores,
    imageUrl,
    imageUrls,
  };
}
