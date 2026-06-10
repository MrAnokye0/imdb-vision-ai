import ExcelJS from "exceljs";
import type { ProductRecord } from "@/src/types/product";

// ─── Column definitions ────────────────────────────────────────────────────────

const COLUMNS: { key: keyof ProductRecord; header: string; width: number }[] = [
  { key: "barcode",          header: "Barcode",           width: 20 },
  { key: "categoryType",     header: "Category Type",     width: 22 },
  { key: "segmentType",      header: "Segment Type",      width: 22 },
  { key: "manufacturer",     header: "Manufacturer",      width: 26 },
  { key: "brand",            header: "Brand",             width: 20 },
  { key: "productName",      header: "Product Name",      width: 36 },
  { key: "weightUnit",       header: "Weight & Unit",     width: 16 },
  { key: "packagingType",    header: "Packaging Type",    width: 18 },
  { key: "countryOfOrigin",  header: "Country of Origin", width: 22 },
  { key: "marketingMessage", header: "Marketing Message", width: 40 },
  { key: "confidenceScore",  header: "Confidence",        width: 14 },
];

// ─── Colour palette ────────────────────────────────────────────────────────────
// All ARGB values (Alpha + RGB hex)
const C = {
  headerBg:     "FF4F46E5", // indigo-600
  headerText:   "FFFFFFFF",
  headerBorder: "FF6366F1", // indigo-500
  rowEven:      "FFFAFAFA",
  rowOdd:       "FFFFFFFF",
  rowBorder:    "FFE2E8F0", // slate-200
  confHigh:     "FF16A34A", // green-700
  confMid:      "FFD97706", // amber-600
  confLow:      "FFDC2626", // red-600
  confHighBg:   "FFF0FDF4", // green-50
  confMidBg:    "FFFEFCE8", // yellow-50
  confLowBg:    "FFFEF2F2", // red-50
  titleBg:      "FF1E1B4B", // indigo-950
  titleText:    "FFFFFFFF",
  summaryBg:    "FFF1F5F9", // slate-100
  summaryText:  "FF475569", // slate-600
  accent:       "FF6366F1",
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function escapeCSV(v: string | number | undefined | null): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function formatDate(): string {
  return new Date().toLocaleDateString("en-GB", {
    day: "2-digit", month: "long", year: "numeric",
  });
}

// ─── CSV export ────────────────────────────────────────────────────────────────

export function exportCSV(products: ProductRecord[]): void {
  const lines: string[] = [];

  // File header comment
  lines.push(`# IMDB Auto-Fill Export`);
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push(`# Total Records: ${products.length}`);
  lines.push(``);

  // Column headers
  lines.push(COLUMNS.map((c) => escapeCSV(c.header)).join(","));

  // Data rows — confidence as percentage string
  products.forEach((p) => {
    const row = COLUMNS.map((c) => {
      if (c.key === "confidenceScore") {
        return escapeCSV(`${Math.round((Number(p[c.key]) || 0) * 100)}%`);
      }
      return escapeCSV(p[c.key] as string);
    });
    lines.push(row.join(","));
  });

  downloadBlob(
    new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" }),
    `IMDB-export-${timestamp()}.csv`
  );
}

// ─── Excel export ──────────────────────────────────────────────────────────────

export async function exportExcel(products: ProductRecord[]): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator  = "AI-Driven IMDB Auto-Fill Tool";
  wb.created  = new Date();
  wb.modified = new Date();

  // ── Sheet 1: Products ──────────────────────────────────────────────────────
  const ws = wb.addWorksheet("IMDB Products", {
    views: [{ state: "frozen", ySplit: 3 }], // freeze title + header
    pageSetup: {
      paperSize: 9, // A4
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
    },
    headerFooter: {
      oddHeader: "&C&B IMDB Auto-Fill Export &D",
      oddFooter:  "&CPage &P of &N",
    },
  });

  // Row 1: Title banner
  ws.mergeCells("A1", `K1`);
  const titleCell = ws.getCell("A1");
  titleCell.value = "📦  IMDB Auto-Fill — Item Master Database Export";
  titleCell.font  = { bold: true, size: 14, color: { argb: C.titleText } };
  titleCell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: C.titleBg } };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 2 };
  ws.getRow(1).height = 36;

  // Row 2: Metadata bar
  ws.mergeCells("A2", "D2");
  ws.mergeCells("E2", "H2");
  ws.mergeCells("I2", "K2");

  const metaCells = [
    { cell: "A2", value: `Generated: ${formatDate()}` },
    { cell: "E2", value: `Total Records: ${products.length}` },
    { cell: "I2", value: `Avg Confidence: ${products.length > 0 ? Math.round(products.reduce((s, p) => s + (Number(p.confidenceScore) || 0), 0) / products.length * 100) : 0}%` },
  ];
  metaCells.forEach(({ cell, value }) => {
    const c = ws.getCell(cell);
    c.value = value;
    c.font  = { size: 10, color: { argb: C.summaryText }, italic: true };
    c.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: C.summaryBg } };
    c.alignment = { vertical: "middle", horizontal: "left", indent: 2 };
  });
  ws.getRow(2).height = 22;

  // Row 3: Column headers
  ws.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }));

  const headerRow = ws.getRow(3);
  COLUMNS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.font  = { bold: true, size: 11, color: { argb: C.headerText } };
    cell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: C.headerBg } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: false };
    cell.border = {
      bottom: { style: "medium", color: { argb: C.headerBorder } },
      right:  i < COLUMNS.length - 1
        ? { style: "thin", color: { argb: "FF6366F1" } }
        : undefined,
    };
  });
  headerRow.height = 30;

  // Rows 4+: Data
  products.forEach((p, i) => {
    const rowData: Record<string, unknown> = {};
    COLUMNS.forEach((c) => { rowData[c.key] = p[c.key]; });

    const row = ws.addRow(rowData);
    row.height = 22;

    const isEven = i % 2 === 0;

    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      // Alternating row background
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: isEven ? C.rowEven : C.rowOdd },
      };
      cell.font      = { size: 10, color: { argb: "FF1E293B" } };
      cell.alignment = { vertical: "middle", wrapText: false };
      cell.border    = {
        bottom: { style: "hair", color: { argb: C.rowBorder } },
        right:  colNum < COLUMNS.length
          ? { style: "hair", color: { argb: C.rowBorder } }
          : undefined,
      };
    });

    // Confidence cell — colour-coded with background tint
    const score    = Number(p.confidenceScore ?? 0);
    const pct      = Math.round(score * 100);
    const confCell = row.getCell("confidenceScore");
    confCell.value  = score;
    confCell.numFmt = "0%";
    confCell.font   = {
      bold: true, size: 10,
      color: { argb: pct >= 70 ? C.confHigh : pct >= 50 ? C.confMid : C.confLow },
    };
    confCell.fill = {
      type: "pattern", pattern: "solid",
      fgColor: { argb: pct >= 70 ? C.confHighBg : pct >= 50 ? C.confMidBg : C.confLowBg },
    };
    confCell.alignment = { vertical: "middle", horizontal: "center" };

    // Barcode — monospace
    const barcodeCell = row.getCell("barcode");
    barcodeCell.font = { size: 10, name: "Courier New", color: { argb: "FF334155" } };
    barcodeCell.alignment = { horizontal: "center" };

    // Product name — slightly bolder
    const nameCell = row.getCell("productName");
    nameCell.font = { size: 10, bold: true, color: { argb: "FF1E293B" } };
  });

  // Auto-filter on header row
  ws.autoFilter = {
    from: { row: 3, column: 1 },
    to:   { row: 3, column: COLUMNS.length },
  };

  // ── Sheet 2: Summary ───────────────────────────────────────────────────────
  const ws2 = wb.addWorksheet("Summary");
  ws2.columns = [
    { key: "metric", width: 30 },
    { key: "value",  width: 20 },
  ];

  // Summary header
  ws2.mergeCells("A1:B1");
  const sumTitle = ws2.getCell("A1");
  sumTitle.value = "Export Summary";
  sumTitle.font  = { bold: true, size: 13, color: { argb: C.titleText } };
  sumTitle.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: C.titleBg } };
  sumTitle.alignment = { vertical: "middle", horizontal: "left", indent: 2 };
  ws2.getRow(1).height = 32;

  // Category breakdown
  const catMap = new Map<string, number>();
  products.forEach((p) => {
    const k = p.categoryType || "Uncategorised";
    catMap.set(k, (catMap.get(k) ?? 0) + 1);
  });

  const avgConf = products.length > 0
    ? Math.round(products.reduce((s, p) => s + (Number(p.confidenceScore) || 0), 0) / products.length * 100)
    : 0;

  const high = products.filter((p) => Number(p.confidenceScore) >= 0.7).length;
  const mid  = products.filter((p) => Number(p.confidenceScore) >= 0.5 && Number(p.confidenceScore) < 0.7).length;
  const low  = products.filter((p) => Number(p.confidenceScore) < 0.5).length;

  const summaryRows = [
    ["", ""],
    ["OVERVIEW", ""],
    ["Total Products",         products.length],
    ["Export Date",            formatDate()],
    ["Average Confidence",     `${avgConf}%`],
    ["", ""],
    ["CONFIDENCE BREAKDOWN",   ""],
    ["High (≥ 70%)",           high],
    ["Medium (50–69%)",        mid],
    ["Low (< 50%)",            low],
    ["", ""],
    ["BY CATEGORY",            ""],
    ...[...catMap.entries()].sort((a, b) => b[1] - a[1]).map(([cat, n]) => [cat, n]),
  ];

  summaryRows.forEach((r) => {
    const row = ws2.addRow(r);
    const isSection = typeof r[0] === "string" && r[0] !== "" && r[1] === "";
    if (isSection) {
      row.getCell(1).font = { bold: true, size: 10, color: { argb: C.accent } };
      row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F3FF" } };
    } else if (r[0] !== "") {
      row.getCell(1).font = { size: 10, color: { argb: "FF475569" } };
      row.getCell(2).font = { bold: true, size: 10, color: { argb: "FF1E293B" } };
    }
    row.height = 20;
  });

  // ── Write & download ───────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `IMDB-export-${timestamp()}.xlsx`
  );
}
