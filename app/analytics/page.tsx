"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getAllProducts } from "@/src/lib/firestore";
import { exportExcel } from "@/src/lib/export";
import type { SavedProduct } from "@/src/types/product";

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
      <div className={`h-full ${color} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── Vibrant Gradient Palette for Categories and Countries ───────────────────
const CATEGORY_GRADIENTS = [
  "bg-gradient-to-r from-blue-500 to-indigo-500",      // Beverages
  "bg-gradient-to-r from-emerald-500 to-teal-500",    // Grocery
  "bg-gradient-to-r from-amber-500 to-orange-500",    // Food / Seasonings
  "bg-gradient-to-r from-fuchsia-500 to-pink-500",    // Personal Care
  "bg-gradient-to-r from-rose-500 to-red-500",        // Home Care
  "bg-gradient-to-r from-cyan-500 to-blue-500",       // Baby Care
  "bg-gradient-to-r from-violet-500 to-purple-500",   // Health
  "bg-gradient-to-r from-lime-500 to-green-500",      // Pet Care
  "bg-gradient-to-r from-pink-500 to-rose-500",       // Snacks
  "bg-gradient-to-r from-sky-500 to-cyan-500"         // Other
];

const COUNTRY_GRADIENTS = [
  "bg-gradient-to-r from-emerald-500 to-green-500",   // Ghana
  "bg-gradient-to-r from-red-500 to-orange-500",      // China
  "bg-gradient-to-r from-blue-500 to-cyan-500",       // USA
  "bg-gradient-to-r from-yellow-500 to-amber-500",    // Germany
  "bg-gradient-to-r from-purple-500 to-indigo-500",   // UK
  "bg-gradient-to-r from-fuchsia-500 to-rose-500",    // France
  "bg-gradient-to-r from-teal-500 to-cyan-500",       // Italy
  "bg-gradient-to-r from-orange-500 to-yellow-500",   // Japan
  "bg-gradient-to-r from-sky-500 to-indigo-500",      // Canada
  "bg-gradient-to-r from-lime-500 to-teal-500"        // Other
];

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
    { icon: "📦", label: "Products Uploaded",          value: stats.total },
    { icon: "📊", label: "Resolved by Barcode",        value: stats.byBarcode },
    { icon: "🔥", label: "Found in Firebase",          value: stats.firebase },
    { icon: "🌍", label: "Found in Open Food Facts",   value: stats.off },
    { icon: "🔤", label: "Resolved by OCR",            value: stats.byOCR },
    { icon: "🔁", label: "Duplicates Prevented",       value: stats.dupes },
    { icon: "⚠️", label: "Needs Human Review",        value: stats.needReview },
    { icon: "📥", label: "Ready for Export",           value: stats.readyExport },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[80vh] bg-slate-900 text-slate-300">
        <div className="text-center text-slate-400">
          <div className="w-10 h-10 border-2 border-indigo-500 border-t-indigo-200 rounded-full animate-spin mx-auto mb-4" />
          Loading analytics…
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-indigo-950 to-slate-950 text-slate-100 overflow-hidden pb-12">
      {/* Decorative liquid glowing blobs */}
      <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[50%] rounded-full bg-indigo-500/10 blur-[130px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[50%] rounded-full bg-purple-500/10 blur-[130px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-8 sm:py-10 space-y-8 sm:space-y-10 relative z-10">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start justify-between gap-3 sm:gap-4 border-b border-white/5 pb-4 sm:pb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Analytics</h1>
            <p className="text-indigo-200/60 text-xs sm:text-sm mt-1">Product extraction performance and data quality metrics</p>
          </div>
          <div className="flex gap-2 sm:gap-3 flex-wrap">
            {products.length > 0 && (
              <button
                onClick={async () => exportExcel(products)}
                className="text-xs sm:text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 sm:px-5 py-2 sm:py-2.5 rounded-xl transition-all shadow-lg shadow-indigo-500/10 active:scale-95 flex items-center gap-1.5 min-h-[40px]"
              >
                📊 Export
              </button>
            )}
            <Link href="/upload"
              className="text-sm bg-white/10 text-white font-semibold px-5 py-2.5 rounded-xl hover:bg-white/20 transition-all border border-white/10">
              + New Upload
            </Link>
          </div>
        </div>

        {/* KPI grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {kpis.map((k) => {
            const glowAccents: Record<string, string> = {
              "Products Uploaded": "border-indigo-500/20 hover:border-indigo-500/40 shadow-indigo-500/5",
              "Resolved by Barcode": "border-emerald-500/20 hover:border-emerald-500/40 shadow-emerald-500/5",
              "Found in Firebase": "border-orange-500/20 hover:border-orange-500/40 shadow-orange-500/5",
              "Found in Open Food Facts": "border-teal-500/20 hover:border-teal-500/40 shadow-teal-500/5",
              "Resolved by OCR": "border-blue-500/20 hover:border-blue-500/40 shadow-blue-500/5",
              "Duplicates Prevented": "border-amber-500/20 hover:border-amber-500/40 shadow-amber-500/5",
              "Needs Human Review": "border-red-500/20 hover:border-red-500/40 shadow-red-500/5",
              "Ready for Export": "border-violet-500/20 hover:border-violet-500/40 shadow-violet-500/5",
            };
            const accentClass = glowAccents[k.label] ?? "border-slate-200 hover:border-slate-300";
            return (
              <div key={k.label} className={`bg-white/90 p-5 border rounded-xl ${accentClass}`}>
                <span className="text-2xl">{k.icon}</span>
                <p className="text-3xl font-extrabold tabular-nums text-slate-900 mt-1.5">{k.value}</p>
                <p className="text-xs font-semibold text-slate-600 leading-tight mt-1">{k.label}</p>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Confidence breakdown */}
          <div className="bg-white/90 border border-slate-200 rounded-2xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-slate-900 text-lg">Confidence Distribution</h2>
              <span className="text-2xl font-extrabold text-indigo-600">{stats.avgConf}%</span>
            </div>
            {[
              { label: "High (≥ 80%)",  value: stats.confHigh, color: "bg-emerald-500", textColor: "text-emerald-600" },
              { label: "Medium (60–79%)", value: stats.confMid, color: "bg-amber-400",   textColor: "text-amber-600"   },
              { label: "Low (< 60%)",   value: stats.confLow,  color: "bg-red-500",     textColor: "text-red-600"     },
            ].map((row) => {
              const pct = stats.total > 0 ? Math.round((row.value / stats.total) * 100) : 0;
              return (
                <div key={row.label} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">{row.label}</span>
                    <span className={`font-bold ${row.textColor}`}>{row.value} ({pct}%)</span>
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                    <div className={`h-full ${row.color} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}

            <div className="pt-3 border-t border-slate-200 space-y-2">
              <div className="flex justify-between text-xs text-slate-600">
                <span>Human corrections applied</span>
                <span className="font-semibold text-slate-700">{stats.corrected}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-600">
                <span>Est. time saved vs manual</span>
                <span className="font-semibold text-slate-700">{stats.total * 3} min</span>
              </div>
            </div>
          </div>

          {/* Resolution sources */}
          <div className="bg-white/90 border border-slate-200 rounded-2xl p-6 space-y-4">
            <h2 className="font-bold text-slate-900 text-lg">Data Sources</h2>
            {sources.map(([src, count]) => {
              const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
              const COLOR: Record<string, string> = {
                firebase:      "bg-gradient-to-r from-orange-500 to-amber-500",
                openfoodfacts: "bg-gradient-to-r from-emerald-500 to-teal-500",
                ocr:           "bg-gradient-to-r from-blue-500 to-indigo-500",
                manual:        "bg-gradient-to-r from-purple-500 to-fuchsia-500",
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
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                    <div className={`h-full ${COLOR[src] ?? "bg-slate-400"} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Categories */}
          <div className="bg-white/90 border border-slate-200 rounded-2xl p-6 space-y-4">
            <h2 className="font-bold text-slate-900 text-lg">Products by Category</h2>
            {categories.length === 0 && <p className="text-sm text-slate-500">No data yet</p>}
            {categories.slice(0, 10).map(([cat, count], idx) => {
              const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
              const barColor = CATEGORY_GRADIENTS[idx % CATEGORY_GRADIENTS.length];
              return (
                <div key={cat} className="flex items-center gap-3 text-sm">
                  <span className="w-36 text-slate-600 truncate font-medium">{cat}</span>
                  <Bar pct={pct} color={barColor} />
                  <span className="w-20 text-right text-xs text-slate-600 tabular-nums shrink-0 font-medium">{count} ({pct}%)</span>
                </div>
              );
            })}
          </div>

          {/* Countries */}
          <div className="bg-white/90 border border-slate-200 rounded-2xl p-6 space-y-4">
            <h2 className="font-bold text-slate-900 text-lg">Top Countries of Origin</h2>
            {countries.length === 0 && <p className="text-sm text-slate-500">No data yet</p>}
            {countries.map(([country, count], idx) => {
              const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
              const barColor = COUNTRY_GRADIENTS[idx % COUNTRY_GRADIENTS.length];
              return (
                <div key={country} className="flex items-center gap-3 text-sm">
                  <span className="w-36 text-slate-600 truncate font-medium">{country}</span>
                  <Bar pct={pct} color={barColor} />
                  <span className="w-20 text-right text-xs text-slate-600 tabular-nums shrink-0 font-medium">{count} ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Empty state */}
        {stats.total === 0 && (
          <div className="text-center py-16 border border-slate-200 rounded-2xl bg-slate-50">
            <p className="text-5xl mb-4">📊</p>
            <p className="font-semibold text-slate-600">No data yet</p>
            <Link href="/upload" className="inline-block mt-6 bg-indigo-600 text-white px-6 py-2.5 rounded-xl text-sm hover:bg-indigo-700 font-bold transition-all shadow-md shadow-indigo-500/10">
              Upload Products
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
