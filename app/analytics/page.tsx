"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getAllProducts } from "@/src/lib/firestore";
import { exportExcel } from "@/src/lib/export";
import type { SavedProduct } from "@/src/types/product";

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function AnalyticsPage() {
  const [products, setProducts] = useState<SavedProduct[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    getAllProducts().then(setProducts).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    const total     = products.length;
    const byBarcode = products.filter((p) => p.source !== "ocr").length;
    const byOCR     = products.filter((p) => p.source === "ocr").length;
    const firebase  = products.filter((p) => p.source === "firebase").length;
    const off       = products.filter((p) => p.source === "openfoodfacts").length;
    const manual    = products.filter((p) => p.source === "manual").length;
    const needReview = products.filter((p) => p.needsReview && !p.corrected).length;
    const corrected  = products.filter((p) => p.corrected).length;
    const readyExport = total - needReview;

    const seenKeys = new Map<string, number>();
    products.forEach((p) => {
      const k = `${p.barcode}|${p.brand}|${p.weightUnit}`;
      seenKeys.set(k, (seenKeys.get(k) ?? 0) + 1);
    });
    const dupes = [...seenKeys.values()].filter((v) => v > 1).length;

    const avgConf = total > 0
      ? Math.round(products.reduce((s, p) => s + (p.confidenceScore ?? 0), 0) / total * 100)
      : 0;

    const confHigh = products.filter((p) => (p.confidenceScore ?? 0) >= 0.8).length;
    const confMid  = products.filter((p) => (p.confidenceScore ?? 0) >= 0.6 && (p.confidenceScore ?? 0) < 0.8).length;
    const confLow  = products.filter((p) => (p.confidenceScore ?? 0) < 0.6).length;

    return {
      total, byBarcode, byOCR, firebase, off, manual, needReview,
      corrected, readyExport, dupes, avgConf, confHigh, confMid, confLow,
    };
  }, [products]);

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    products.forEach((p) => {
      const k = p.categoryType || "Uncategorised";
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [products]);

  const sources = useMemo(() => {
    const m = new Map<string, number>();
    products.forEach((p) => m.set(p.source, (m.get(p.source) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [products]);

  const countries = useMemo(() => {
    const m = new Map<string, number>();
    products.forEach((p) => {
      if (p.countryOfOrigin) m.set(p.countryOfOrigin, (m.get(p.countryOfOrigin) ?? 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [products]);

  const kpis = [
    { icon: "📦", label: "Products Uploaded",          value: stats.total,        color: "bg-indigo-50 border-indigo-200" },
    { icon: "📊", label: "Resolved by Barcode",        value: stats.byBarcode,    color: "bg-emerald-50 border-emerald-200" },
    { icon: "🔥", label: "Found in Firebase",          value: stats.firebase,     color: "bg-orange-50 border-orange-200" },
    { icon: "🌍", label: "Found in Open Food Facts",   value: stats.off,          color: "bg-teal-50 border-teal-200" },
    { icon: "🔤", label: "Resolved by OCR",            value: stats.byOCR,        color: "bg-blue-50 border-blue-200" },
    { icon: "🔁", label: "Duplicates Prevented",       value: stats.dupes,        color: "bg-amber-50 border-amber-200" },
    { icon: "⚠️", label: "Needs Human Review",        value: stats.needReview,   color: "bg-red-50 border-red-200" },
    { icon: "📥", label: "Ready for Export",           value: stats.readyExport,  color: "bg-violet-50 border-violet-200" },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center text-slate-400">
          <div className="w-10 h-10 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4" />
          Loading analytics…
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-10 space-y-10">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Analytics</h1>
          <p className="text-slate-500 text-sm mt-1">Product extraction performance and data quality metrics</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {products.length > 0 && (
            <button onClick={async () => exportExcel(products)}
              className="text-sm bg-blue-600 text-white font-semibold px-4 py-2.5 rounded-xl hover:bg-blue-700 transition-colors">
              ⬇ Export All Excel
            </button>
          )}
          <Link href="/upload"
            className="text-sm bg-indigo-600 text-white font-semibold px-4 py-2.5 rounded-xl hover:bg-indigo-700 transition-colors">
            + New Upload
          </Link>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className={`border rounded-2xl p-5 space-y-1.5 ${k.color}`}>
            <span className="text-2xl">{k.icon}</span>
            <p className="text-3xl font-extrabold tabular-nums text-slate-900">{k.value}</p>
            <p className="text-xs font-medium text-slate-600 leading-tight">{k.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Confidence breakdown */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-800">Confidence Distribution</h2>
            <span className="text-2xl font-extrabold text-indigo-600">{stats.avgConf}%</span>
          </div>
          {[
            { label: "High (≥ 80%)",  value: stats.confHigh, color: "bg-emerald-500", textColor: "text-emerald-600" },
            { label: "Medium (60–79%)", value: stats.confMid, color: "bg-amber-400",   textColor: "text-amber-600"   },
            { label: "Low (< 60%)",   value: stats.confLow,  color: "bg-red-400",     textColor: "text-red-600"     },
          ].map((row) => {
            const pct = stats.total > 0 ? Math.round((row.value / stats.total) * 100) : 0;
            return (
              <div key={row.label} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">{row.label}</span>
                  <span className={`font-bold ${row.textColor}`}>{row.value} ({pct}%)</span>
                </div>
                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full ${row.color} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}

          <div className="pt-2 border-t border-slate-100 space-y-2">
            <div className="flex justify-between text-xs text-slate-500">
              <span>Human corrections applied</span>
              <span className="font-semibold text-slate-700">{stats.corrected}</span>
            </div>
            <div className="flex justify-between text-xs text-slate-500">
              <span>Est. time saved vs manual</span>
              <span className="font-semibold text-slate-700">{stats.total * 3} min</span>
            </div>
          </div>
        </div>

        {/* Resolution sources */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
          <h2 className="font-bold text-slate-800">Data Sources</h2>
          {sources.map(([src, count]) => {
            const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
            const COLOR: Record<string, string> = {
              firebase:      "bg-orange-400",
              openfoodfacts: "bg-emerald-500",
              ocr:           "bg-blue-400",
              manual:        "bg-purple-400",
            };
            const LABEL: Record<string, string> = {
              firebase:      "🔥 Firebase Cache",
              openfoodfacts: "🌍 Open Food Facts",
              ocr:           "🔤 OCR Extraction",
              manual:        "✏️ Manual Entry",
            };
            return (
              <div key={src} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">{LABEL[src] ?? src}</span>
                  <span className="font-bold text-slate-700">{count} ({pct}%)</span>
                </div>
                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full ${COLOR[src] ?? "bg-slate-400"} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Categories */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
          <h2 className="font-bold text-slate-800">Products by Category</h2>
          {categories.length === 0 && <p className="text-sm text-slate-400">No data yet</p>}
          {categories.slice(0, 10).map(([cat, count]) => {
            const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
            return (
              <div key={cat} className="flex items-center gap-3 text-sm">
                <span className="w-36 text-slate-600 truncate">{cat}</span>
                <Bar pct={pct} color="bg-indigo-500" />
                <span className="w-20 text-right text-xs text-slate-500 tabular-nums shrink-0">{count} ({pct}%)</span>
              </div>
            );
          })}
        </div>

        {/* Countries */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
          <h2 className="font-bold text-slate-800">Top Countries of Origin</h2>
          {countries.length === 0 && <p className="text-sm text-slate-400">No data yet</p>}
          {countries.map(([country, count]) => {
            const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
            return (
              <div key={country} className="flex items-center gap-3 text-sm">
                <span className="w-36 text-slate-600 truncate">{country}</span>
                <Bar pct={pct} color="bg-violet-500" />
                <span className="w-20 text-right text-xs text-slate-500 tabular-nums shrink-0">{count} ({pct}%)</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Empty state */}
      {stats.total === 0 && (
        <div className="text-center py-16 text-slate-400 border border-slate-200 rounded-2xl bg-white">
          <p className="text-5xl mb-4">📊</p>
          <p className="font-semibold">No data yet</p>
          <Link href="/upload" className="inline-block mt-6 bg-indigo-600 text-white px-6 py-2.5 rounded-xl text-sm hover:bg-indigo-700">
            Upload Products
          </Link>
        </div>
      )}
    </div>
  );
}
