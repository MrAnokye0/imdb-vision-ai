/**
 * Rekognition-based product classifier.
 * Server-side only — do not import in client components.
 *
 * Maps Rekognition labels → categoryType / segmentType / packagingType hints
 * that can be injected into the Gemini / backend extraction prompt.
 */

import type { RekognitionLabel } from "@/src/lib/aws/rekognition";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CategoryHints {
  /** Best-guess categoryType derived from visual labels */
  categoryType: string;
  /** Best-guess segmentType (may be empty) */
  segmentType: string;
  /** Best-guess packagingType derived from visual labels */
  packagingType: string;
  /** Average confidence of the labels that drove this classification (0–100) */
  confidence: number;
  /** The top Rekognition label names that contributed to the classification */
  contributingLabels: string[];
}

// ─── Mapping tables ───────────────────────────────────────────────────────────
//
// Each entry maps one or more Rekognition label names (lowercase) to a
// categoryType string. Entries are checked in order; first match wins.
// Add more rows here as you discover new label patterns in production.

interface CategoryRule {
  labels: string[];
  categoryType: string;
  segmentType?: string;
}

const CATEGORY_RULES: CategoryRule[] = [
  // Healthcare / Pharma
  { labels: ["medicine", "pharmaceutical", "tablet", "capsule", "pill", "drug", "medication", "antibiotic", "pharmacy"], categoryType: "Healthcare" },
  { labels: ["cough", "syrup", "lozenges", "inhaler"], categoryType: "Healthcare", segmentType: "Cough & Cold Relief" },

  // Personal Care
  { labels: ["shampoo", "conditioner", "hair care", "soap", "body wash", "lotion", "cream", "moisturizer", "deodorant", "perfume", "cosmetics", "skincare", "sunscreen", "face wash"], categoryType: "Personal Care" },
  { labels: ["toothpaste", "toothbrush", "mouthwash", "dental floss", "dental"], categoryType: "Oral Care" },

  // Beverages
  { labels: ["beverage", "drink", "juice", "water", "soda", "cola", "beer", "wine", "spirits", "alcohol", "energy drink", "soft drink", "carbonated drink", "tea", "coffee", "mineral water", "fruit juice"], categoryType: "Beverages" },

  // Dairy
  { labels: ["milk", "cheese", "yogurt", "butter", "dairy", "cream", "ice cream"], categoryType: "Dairy" },

  // Snacks
  { labels: ["snack", "chip", "crisp", "cracker", "pretzel", "popcorn", "biscuit", "cookie", "candy", "chocolate", "confectionery", "gummy", "lollipop", "nut", "nuts", "peanut"], categoryType: "Snacks" },

  // Bakery
  { labels: ["bread", "cake", "pastry", "muffin", "bun", "roll", "croissant", "doughnut", "wafer", "bagel", "loaf"], categoryType: "Bakery" },

  // Grocery / Pantry
  { labels: ["flour", "sugar", "salt", "rice", "oil", "cooking oil", "olive oil", "sauce", "pasta", "noodle", "noodles", "cereal", "oats", "condiment", "ketchup", "mustard", "vinegar", "spice", "seasoning", "can", "canned food", "tin", "food"], categoryType: "Grocery" },

  // Household
  { labels: ["detergent", "bleach", "cleaner", "cleaning product", "dishwasher", "laundry", "fabric softener", "disinfectant", "mop", "spray", "sponge", "paper towel", "toilet paper", "garbage bag"], categoryType: "Household" },

  // Baby
  { labels: ["diaper", "nappy", "baby food", "baby formula", "infant", "pacifier", "baby"], categoryType: "Baby Products" },

  // Pet
  { labels: ["pet food", "dog food", "cat food", "pet", "kibble", "animal feed"], categoryType: "Pet Care" },

  // Electronics / Batteries
  { labels: ["battery", "electronics", "charger", "cable", "headphone", "earphone", "remote control"], categoryType: "Electronics" },

  // Stationery
  { labels: ["pen", "pencil", "notebook", "stationery", "marker", "eraser", "glue"], categoryType: "Stationery" },
];

// Maps Rekognition label names → packagingType
const PACKAGING_RULES: Array<{ labels: string[]; packagingType: string }> = [
  { labels: ["bottle", "plastic bottle", "glass bottle", "water bottle"],  packagingType: "Bottle"  },
  { labels: ["can", "tin can", "aluminum can", "beer can", "soda can"],    packagingType: "Can"     },
  { labels: ["box", "cardboard", "carton", "cardboard box"],               packagingType: "Box"     },
  { labels: ["jar", "glass jar"],                                           packagingType: "Jar"     },
  { labels: ["tube", "squeeze tube"],                                       packagingType: "Tube"    },
  { labels: ["pouch", "stand-up pouch", "doy pack"],                       packagingType: "Pouch"   },
  { labels: ["bag", "plastic bag", "paper bag", "foil bag"],               packagingType: "Bag"     },
  { labels: ["sachet", "packet", "single serve"],                          packagingType: "Sachet"  },
  { labels: ["tub", "container", "plastic container"],                     packagingType: "Tub"     },
  { labels: ["blister", "blister pack", "blister packaging"],              packagingType: "Blister" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function labelNames(labels: RekognitionLabel[]): string[] {
  return labels.flatMap((l) => [
    l.name.toLowerCase(),
    ...l.parents.map((p) => p.toLowerCase()),
    ...l.aliases.map((a) => a.toLowerCase()),
  ]);
}

/** Returns the first matching rule entry and the label name that triggered it. */
function matchRules<T extends { labels: string[] }>(
  haystack: string[],
  rules: T[]
): { match: T; trigger: string } | null {
  for (const rule of rules) {
    for (const ruleLabel of rule.labels) {
      if (haystack.includes(ruleLabel)) {
        return { match: rule, trigger: ruleLabel };
      }
    }
  }
  return null;
}

// ─── Main classification function ────────────────────────────────────────────

/**
 * Convert Rekognition labels into category/segment/packaging hints.
 * Safe to call with an empty array — returns empty strings (no hints).
 */
export function classifyFromLabels(labels: RekognitionLabel[]): CategoryHints {
  if (labels.length === 0) {
    return { categoryType: "", segmentType: "", packagingType: "", confidence: 0, contributingLabels: [] };
  }

  const haystack    = labelNames(labels);
  const contributing: string[] = [];

  // Category
  const catResult = matchRules(haystack, CATEGORY_RULES);
  const categoryType = catResult?.match.categoryType ?? "";
  const segmentType  = catResult?.match.segmentType  ?? "";
  if (catResult) contributing.push(catResult.trigger);

  // Packaging
  const packResult = matchRules(haystack, PACKAGING_RULES);
  const packagingType = packResult?.match.packagingType ?? "";
  if (packResult) contributing.push(packResult.trigger);

  // Confidence: average confidence of top-3 labels that contributed
  const relevant = labels
    .filter((l) => contributing.some((t) => l.name.toLowerCase() === t || l.parents.map((p) => p.toLowerCase()).includes(t)))
    .slice(0, 3);

  const confidence =
    relevant.length > 0
      ? relevant.reduce((s, l) => s + l.confidence, 0) / relevant.length
      : labels.slice(0, 3).reduce((s, l) => s + l.confidence, 0) / Math.min(3, labels.length);

  return {
    categoryType,
    segmentType,
    packagingType,
    confidence: Math.round(confidence * 10) / 10,
    contributingLabels: contributing,
  };
}

// ─── Prompt injection helper ──────────────────────────────────────────────────

/**
 * Builds a plain-text hint block suitable for appending to an LLM extraction prompt.
 * Returns an empty string when there are no hints to inject.
 */
export function buildCategoryHintText(hints: CategoryHints): string {
  const lines: string[] = [];

  if (hints.categoryType) {
    lines.push(`- categoryType: "${hints.categoryType}" (visual classification confidence: ${hints.confidence.toFixed(1)}%)`);
  }
  if (hints.segmentType) {
    lines.push(`- segmentType: "${hints.segmentType}"`);
  }
  if (hints.packagingType) {
    lines.push(`- packagingType: "${hints.packagingType}"`);
  }

  if (lines.length === 0) return "";

  return [
    "VISUAL CLASSIFICATION HINTS (from AWS Rekognition — use these to improve accuracy):",
    ...lines,
    `Contributing visual labels: ${hints.contributingLabels.join(", ")}`,
  ].join("\n");
}
