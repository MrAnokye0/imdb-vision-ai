"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import type { SavedProduct } from "@/src/types/product";

interface ExportButtonProps {
  products: SavedProduct[];
  filename?: string;
  /** Export format. Defaults to "csv". */
  format?: "csv" | "json";
  disabled?: boolean;
}

function productsToCSV(products: SavedProduct[]): string {
  const headers = [
    "id",
    "barcode",
    "brand",
    "productName",
    "categoryType",
    "segmentType",
    "manufacturer",
    "weightUnit",
    "packagingType",
    "countryOfOrigin",
    "marketingMessage",
    "confidenceScore",
    "source",
    "needsReview",
    "corrected",
    "imageUrl",
    "imageUrls",
    "savedAt",
  ];

  const escape = (value: string | number | undefined | null): string => {
    if (value == null) return "";
    const str = String(value);
    // Wrap in quotes if the value contains commas, quotes or newlines
    if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };

  const rows = products.map((p) =>
    [
      escape(p.id),
      escape(p.barcode),
      escape(p.brand),
      escape(p.productName),
      escape(p.categoryType),
      escape(p.segmentType),
      escape(p.manufacturer),
      escape(p.weightUnit),
      escape(p.packagingType),
      escape(p.countryOfOrigin),
      escape(p.marketingMessage),
      escape(p.confidenceScore),
      escape(p.source),
      escape(p.needsReview ? "true" : "false"),
      escape(p.corrected ? "true" : "false"),
      escape(p.imageUrl),
      escape(Array.isArray(p.imageUrls) ? p.imageUrls.join(";") : ""),
      escape(p.savedAt),
    ].join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function ExportButton({
  products,
  filename,
  format = "csv",
  disabled = false,
}: ExportButtonProps) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (products.length === 0 || exporting) return;
    setExporting(true);

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const baseName = filename ?? `products-${timestamp}`;

      if (format === "json") {
        const json = JSON.stringify(products, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        downloadBlob(blob, `${baseName}.json`);
      } else {
        const csv = productsToCSV(products);
        // BOM for Excel UTF-8 compatibility
        const blob = new Blob(["\uFEFF" + csv], {
          type: "text/csv;charset=utf-8;",
        });
        downloadBlob(blob, `${baseName}.csv`);
      }
    } finally {
      setExporting(false);
    }
  };

  const isEmpty = products.length === 0;

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={disabled || isEmpty || exporting}
      aria-label={`Export ${products.length} products as ${format.toUpperCase()}`}
      className={[
        "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500",
        isEmpty || disabled || exporting
          ? "cursor-not-allowed bg-zinc-200 text-zinc-400 dark:bg-zinc-700 dark:text-zinc-500"
          : "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800",
      ].join(" ")}
    >
      {exporting ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Download className="h-4 w-4" aria-hidden="true" />
      )}
      {exporting ? "Exporting…" : `Export ${format.toUpperCase()}`}
      {!exporting && products.length > 0 && (
        <span className="ml-1 rounded-full bg-blue-500/30 px-1.5 py-0.5 text-xs font-semibold">
          {products.length}
        </span>
      )}
    </button>
  );
}
