"use client";

import { useState } from "react";
import Image from "next/image";
import type { ProductRecord, ExtractionSource, PipelineStep } from "@/src/types/product";

interface KnowledgeGraphProps {
  product: ProductRecord;
  source: ExtractionSource;
  steps: PipelineStep[];
  fileName: string;
  previewUrl: string;
  telemetry?: any;
}

const SOURCE_LABELS: Record<ExtractionSource, { label: string; color: string; bg: string }> = {
  firebase:      { label: "Firebase Cache",    color: "text-orange-700", bg: "bg-orange-100 border-orange-200" },
  openfoodfacts: { label: "Open Food Facts",   color: "text-emerald-700", bg: "bg-emerald-100 border-emerald-200" },
  ocr:           { label: "OCR Extraction",    color: "text-blue-700",   bg: "bg-blue-100 border-blue-200" },
  ai:            { label: "AI Inference",      color: "text-violet-700", bg: "bg-violet-100 border-violet-200" },
  manual:        { label: "Manual Entry",      color: "text-purple-700", bg: "bg-purple-100 border-purple-200" },
};

const STEP_ICONS: Record<string, string> = {
  barcode:  "📊",
  firebase: "🔥",
  off:      "🌍",
  ocr:      "🔤",
  build:    "✨",
  engine:   "🧠",
  merge:    "🔧",
  validate: "✅",
};

const STEP_STATUS_STYLE: Record<PipelineStep["status"], string> = {
  pending: "bg-slate-100 text-slate-400",
  running: "bg-blue-100 text-blue-600 animate-pulse",
  done:    "bg-emerald-100 text-emerald-700",
  skipped: "bg-slate-100 text-slate-400 opacity-60",
  error:   "bg-red-100 text-red-600",
};

const STEP_STATUS_DOT: Record<PipelineStep["status"], string> = {
  pending: "bg-slate-300",
  running: "bg-blue-500 animate-pulse",
  done:    "bg-emerald-500",
  skipped: "bg-slate-300",
  error:   "bg-red-500",
};

export default function KnowledgeGraph({
  product,
  source,
  steps,
  fileName,
  previewUrl,
  telemetry,
}: KnowledgeGraphProps) {
  const [debugTab, setDebugTab] = useState<"ocr" | "barcodes" | "rekognition" | "merged" | "final" | null>(null);

  const pct = Math.round((product.confidenceScore ?? 0) * 100);
  const src = SOURCE_LABELS[source] || { label: "Unknown", color: "text-slate-700", bg: "bg-slate-100 border-slate-200" };
  const confColor = pct >= 80 ? "text-emerald-600" : pct >= 60 ? "text-amber-600" : "text-red-500";
  const confBar   = pct >= 80 ? "bg-emerald-500"   : pct >= 60 ? "bg-amber-400"   : "bg-red-400";

  const attrs = [
    { icon: "🔢", label: "Barcode",       value: product.barcode },
    { icon: "⭐", label: "Brand",         value: product.brand },
    { icon: "🏭", label: "Manufacturer",  value: product.manufacturer },
    { icon: "🏷️", label: "Category",     value: product.categoryType },
    { icon: "📂", label: "Segment",       value: product.segmentType },
    { icon: "📝", label: "Product Name",  value: product.productName },
    { icon: "⚖️", label: "Weight",        value: product.weightUnit },
    { icon: "📦", label: "Packaging",     value: product.packagingType },
    { icon: "🌍", label: "Country",       value: product.countryOfOrigin },
    { icon: "📣", label: "Marketing",     value: product.marketingMessage },
  ];

  return (
    <div className="mt-4 bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 bg-white">
        <div className="w-2 h-2 rounded-full bg-indigo-500" />
        <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
          Product Knowledge Graph
        </span>
        <span className={`ml-auto text-xs font-semibold border px-2 py-0.5 rounded-full ${src.color} ${src.bg}`}>
          Source: {src.label}
        </span>
      </div>

      <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        {/* Left: product image + confidence */}
        <div className="p-4 flex flex-col items-center gap-3">
          <div className="relative w-24 h-24 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shadow-sm">
            <Image
              src={product.imageUrl || product.imageUrls?.[0] || previewUrl}
              alt={product.productName || fileName}
              fill
              sizes="96px"
              className="object-contain"
            />
          </div>
          <div className="w-full space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-500 font-medium">Confidence</span>
              <span className={`font-bold ${confColor}`}>{pct}%</span>
            </div>
            <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${confBar}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Middle: IMDB attributes */}
        <div className="sm:col-span-1 p-4 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
            IMDB Attributes
          </p>
          {attrs.map((a) => (
            <div key={a.label} className="flex items-start gap-2">
              <span className="text-sm w-5 shrink-0">{a.icon}</span>
              <div className="min-w-0">
                <span className="text-[10px] text-slate-400 uppercase tracking-wide block">
                  {a.label}
                </span>
                <span className={`text-xs font-semibold ${a.value ? "text-slate-800" : "text-slate-300"} truncate block`}>
                  {a.value || "—"}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Right: pipeline steps */}
        <div className="p-4 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
            Resolution Pipeline
          </p>
          {steps.map((step, i) => (
            <div key={step.id} className="flex items-start gap-2.5">
              {/* Step line */}
              <div className="flex flex-col items-center">
                <div className={`w-2 h-2 rounded-full shrink-0 mt-1 ${STEP_STATUS_DOT[step.status]}`} />
                {i < steps.length - 1 && (
                  <div className="w-px flex-1 bg-slate-200 my-0.5" />
                )}
              </div>
              <div className="pb-2 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs">{STEP_ICONS[step.id] ?? "•"}</span>
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-md ${STEP_STATUS_STYLE[step.status]}`}>
                    {step.label}
                  </span>
                </div>
                {step.detail && (
                  <p className="text-[10px] text-slate-400 mt-0.5 ml-5 truncate">{step.detail}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Expandable Debug Mode Panel */}
      <div className="border-t border-slate-200 bg-slate-100/40 p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
            🔬 Debug Mode Console
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setDebugTab(debugTab === "ocr" ? null : "ocr")}
              className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold transition-all ${
                debugTab === "ocr" ? "bg-indigo-600 border-indigo-600 text-white shadow-sm" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              Raw OCR
            </button>
            <button
              onClick={() => setDebugTab(debugTab === "barcodes" ? null : "barcodes")}
              className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold transition-all ${
                debugTab === "barcodes" ? "bg-indigo-600 border-indigo-600 text-white shadow-sm" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              Barcodes
            </button>
            <button
              onClick={() => setDebugTab(debugTab === "rekognition" ? null : "rekognition")}
              className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold transition-all ${
                debugTab === "rekognition" ? "bg-indigo-600 border-indigo-600 text-white shadow-sm" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              Rek Hints
            </button>
            <button
              onClick={() => setDebugTab(debugTab === "merged" ? null : "merged")}
              className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold transition-all ${
                debugTab === "merged" ? "bg-indigo-600 border-indigo-600 text-white shadow-sm" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              Merged Text
            </button>
            <button
              onClick={() => setDebugTab(debugTab === "final" ? null : "final")}
              className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold transition-all ${
                debugTab === "final" ? "bg-indigo-600 border-indigo-600 text-white shadow-sm" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              Field Map
            </button>
          </div>
        </div>

        {/* Tab content */}
        {debugTab === "ocr" && (
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {telemetry?.raw_ocr_per_image?.map((item: any, idx: number) => (
              <div key={idx} className="bg-white border rounded-xl p-3 text-xs shadow-sm">
                <span className="font-bold text-[10px] text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
                  {item.label} Label
                </span>
                <pre className="text-[11px] font-mono text-slate-600 mt-2 bg-slate-50 p-2 rounded whitespace-pre-wrap overflow-x-auto">
                  {item.text || "(empty)"}
                </pre>
              </div>
            )) || <p className="text-xs text-slate-400 italic">No OCR telemetry available.</p>}
          </div>
        )}

        {debugTab === "barcodes" && (
          <div className="bg-white border rounded-xl p-3 text-xs shadow-sm">
            <p className="font-bold text-slate-700">Barcodes Scanned (ZXing / pyzbar):</p>
            <ul className="list-disc list-inside mt-2 space-y-1 font-mono text-slate-600">
              {telemetry?.barcodes_detected?.length > 0 ? (
                telemetry.barcodes_detected.map((b: string, idx: number) => (
                  <li key={idx}>{b}</li>
                ))
              ) : (
                <li className="text-slate-400 italic list-none">No barcodes detected</li>
              )}
            </ul>
          </div>
        )}

        {debugTab === "rekognition" && (
          <div className="bg-white border rounded-xl p-3 text-xs shadow-sm space-y-2">
            <p className="font-bold text-slate-700">AWS Rekognition Visual Classification Hints:</p>
            {telemetry?.rekognition_hints ? (
              <div className="space-y-1.5 mt-2 bg-slate-50 p-2.5 rounded font-medium text-slate-600">
                <p><span className="text-slate-400">Category Type:</span> {telemetry.rekognition_hints.categoryType || "N/A"}</p>
                <p><span className="text-slate-400">Segment Type:</span> {telemetry.rekognition_hints.segmentType || "N/A"}</p>
                <p><span className="text-slate-400">Packaging Type:</span> {telemetry.rekognition_hints.packagingType || "N/A"}</p>
                <p><span className="text-slate-400">Confidence Score:</span> {telemetry.rekognition_hints.confidence ? `${Math.round(telemetry.rekognition_hints.confidence)}%` : "N/A"}</p>
                <p><span className="text-slate-400">Contributing Labels:</span> {telemetry.rekognition_hints.labels?.join(", ") || "None"}</p>
              </div>
            ) : (
              <p className="text-slate-400 italic">No AWS Rekognition hints available (running local offline).</p>
            )}
          </div>
        )}

        {debugTab === "merged" && (
          <div className="bg-white border rounded-xl p-3 shadow-sm">
            <p className="font-bold text-xs text-slate-700 mb-2">Merged Text Context sent to Engine:</p>
            <pre className="text-[11px] font-mono text-slate-600 bg-slate-50 p-2.5 rounded whitespace-pre-wrap max-h-[250px] overflow-y-auto">
              {telemetry?.merged_text || "(empty)"}
            </pre>
          </div>
        )}

        {debugTab === "final" && (
          <div className="border rounded-xl overflow-hidden bg-white text-xs shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b text-slate-400 font-bold uppercase tracking-wider text-[9px]">
                  <th className="px-4 py-2">Field</th>
                  <th className="px-4 py-2">Value</th>
                  <th className="px-4 py-2">Confidence</th>
                  <th className="px-4 py-2">Source Mapping</th>
                </tr>
              </thead>
              <tbody className="divide-y text-slate-700">
                {attrs.map((attr) => {
                  const key = attr.label.replace(" ", "").replace("&", "")
                    .replace("Barcode", "barcode")
                    .replace("Brand", "brand")
                    .replace("Manufacturer", "manufacturer")
                    .replace("Category", "categoryType")
                    .replace("Segment", "segmentType")
                    .replace("ProductName", "productName")
                    .replace("Weight", "weightUnit")
                    .replace("Packaging", "packagingType")
                    .replace("Country", "countryOfOrigin")
                    .replace("Marketing", "marketingMessage");

                  const score = product.fieldConfidenceScores?.[key];
                  return (
                    <tr key={attr.label} className="hover:bg-slate-50/50">
                      <td className="px-4 py-2 font-semibold flex items-center gap-1">
                        <span>{attr.icon}</span>
                        <span>{attr.label}</span>
                      </td>
                      <td className="px-4 py-2 truncate max-w-[200px] font-medium text-slate-800">
                        {attr.value || "—"}
                      </td>
                      <td className="px-4 py-2 font-mono">
                        {score !== undefined ? `${Math.round(score * 100)}%` : "N/A"}
                      </td>
                      <td className="px-4 py-2">
                        <span className="text-[9px] bg-slate-100 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide text-slate-500">
                          {telemetry?.fieldSources?.[key] ?? (score === 1.0 ? "Authoritative" : "OCR Regex")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
