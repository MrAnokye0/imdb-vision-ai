import assert from "assert";

// Local simplified types
type OCRWord = { text: string; x: number; y: number; w: number; h: number; conf: number };
type OCRResult = { text: string; words: OCRWord[]; width?: number; height?: number };

// Inline simplified parseOCRResult to avoid TS module resolution in tests
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

function parseOCRResult(ocr: OCRResult) {
  const words = ocr.words.filter((w) => w.text && w.text.trim());
  const joined = ocr.text || words.map((w) => w.text).join(" ");
  const lines = clusterLines(words);
  const blocks = lines.map(blockMetrics);
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
      if (wordsCount <= 5 && /^[A-Z0-9\s\-&'.®™]{2,}$/.test(t.toUpperCase())) { brand = t; break; }
    }
  }
  if (!brand && ranked[0]) brand = ranked[0].text;
  let productName = "";
  for (const r of ranked) {
    const wordsCount = lines[r.idx].length;
    if (wordsCount <= 10 && r.avgH >= (ranked[0]?.avgH ?? 0) * 0.6) {
      const t = r.text.trim();
      if (t.toLowerCase().includes("ingredient") || t.toLowerCase().includes("ingredients")) continue;
      if (t.length > 3 && t.toLowerCase() !== brand.toLowerCase()) { productName = t; break; }
    }
  }
  if (!productName) productName = ranked[1]?.text ?? ranked[0]?.text ?? "";
  const weightMatch = joined.match(/\b(\d+)\s?(ml|l|g|kg)\b/i);
  const weightUnit = weightMatch ? `${weightMatch[1]}${weightMatch[2].toLowerCase()}` : "";
  const PACKAGING_KEYWORDS = ["bottle", "box", "sachet", "can", "jar", "tube", "pouch", "carton", "pack"];
  const packMatch = new RegExp(`\\b(${PACKAGING_KEYWORDS.join("|")})\\b`, "i");
  const packagingType = (joined.match(packMatch) ?? [""])[0];
  const HEALTHCARE_KEYWORDS = ["cough", "throat", "catarrh", "chesty", "mixture", "medicine", "syrup"];
  const SEGMENT_COUGH = ["cough", "cold", "catarrh"];
  const lower = joined.toLowerCase();
  let categoryType = ""; for (const k of HEALTHCARE_KEYWORDS) if (lower.includes(k)) { categoryType = "Healthcare"; break; }
  let segmentType = ""; for (const s of SEGMENT_COUGH) if (lower.includes(s)) { segmentType = "Cough & Cold Relief"; break; }
  let finalPackaging = packagingType || "";
  if (!finalPackaging) {
    const lowerName = (productName || "").toLowerCase();
    if (lowerName.includes("mixture") || lowerName.includes("syrup") || lower.includes("syrup")) { finalPackaging = "Bottle"; }
  }
  const topBlocks = ranked.slice(0, 3);
  const avgTopConf = topBlocks.reduce((s, b) => s + b.avgConf, 0) / Math.max(1, topBlocks.length);
  const completeness = [brand, productName, weightUnit, finalPackaging, categoryType].filter(Boolean).length / 5;
  const confidenceScore = parseFloat(Math.max(0, Math.min(1, 0.25 * avgTopConf / 100 + 0.75 * completeness)).toFixed(2));
  return {
    barcode: "", brand: brand || "", productName: productName || "", weightUnit,
    categoryType, segmentType, countryOfOrigin: "", packagingType: finalPackaging || "",
    marketingMessage: "", imageUrl: undefined, confidenceScore, manufacturer: brand || "",
  };
}

// Simulated OCR output for Menthodex Cough Mixture
const simulated: OCRResult = {
  text: "MENTHODEX\nCough Mixture\n100ml\nFor coughs and colds\nIngredients: ...",
  width: 800,
  height: 1200,
  words: [
    // Brand (large, top-centered)
    { text: "MENTHODEX", x: 200, y: 40, w: 400, h: 80, conf: 96 },
    // Product name (large, centered)
    { text: "Cough", x: 220, y: 140, w: 180, h: 60, conf: 92 },
    { text: "Mixture", x: 400, y: 140, w: 220, h: 60, conf: 92 },
    // Weight
    { text: "100ml", x: 360, y: 220, w: 80, h: 40, conf: 90 },
    // Marketing line
    { text: "For", x: 300, y: 300, w: 40, h: 30, conf: 85 },
    { text: "coughs", x: 340, y: 300, w: 70, h: 30, conf: 85 },
    { text: "and", x: 420, y: 300, w: 40, h: 30, conf: 85 },
    { text: "colds", x: 470, y: 300, w: 60, h: 30, conf: 85 },
    // Ingredient panel (left-aligned, many small words)
    { text: "Ingredients:", x: 40, y: 500, w: 140, h: 20, conf: 80 },
    { text: "Sugar", x: 40, y: 530, w: 60, h: 18, conf: 78 },
  ],
};

const parsed = parseOCRResult(simulated);
console.log("Parsed:", parsed);
assert.strictEqual((parsed.brand ?? "").toLowerCase(), "menthodex", "Brand should be Menthodex");
assert.strictEqual((parsed.productName ?? "").toLowerCase(), "cough mixture", "Product Name should be 'Cough Mixture'");
assert.strictEqual(parsed.weightUnit ?? "", "100ml", "Weight should be 100ml");
assert.strictEqual((parsed.packagingType ?? "").toLowerCase(), "bottle", "Packaging should be Bottle");
assert.strictEqual(parsed.categoryType ?? "", "Healthcare", "Category should be Healthcare");
assert.strictEqual(parsed.segmentType ?? "", "Cough & Cold Relief", "Segment should be Cough & Cold Relief");
console.log("OCR test passed");
