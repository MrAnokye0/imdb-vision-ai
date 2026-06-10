"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { getAllProducts, deleteProduct, saveCorrection } from "@/src/lib/firestore";
import { exportCSV, exportExcel } from "@/src/lib/export";
import type { SavedProduct, ProductRecord } from "@/src/types/product";

const IMDB_FIELDS: { key: keyof ProductRecord; label: string }[] = [
  { key: "barcode",          label: "Barcode" },
  { key: "categoryType",     label: "Category Type" },
  { key: "segmentType",      label: "Segment Type" },
  { key: "manufacturer",     label: "Manufacturer" },
  { key: "brand",            label: "Brand" },
  { key: "productName",      label: "Product Name" },
  { key: "weightUnit",       label: "Weight & Unit" },
  { key: "packagingType",    label: "Packaging Type" },
  { key: "countryOfOrigin",  label: "Country of Origin" },
  { key: "marketingMessage", label: "Marketing Message" },
];

const SOURCE_BADGE: Record<string, string> = {
  firebase:      "bg-orange-100 text-orange-700 border-orange-200",
  openfoodfacts: "bg-emerald-100 text-emerald-700 border-emerald-200",
  ocr:           "bg-blue-100 text-blue-700 border-blue-200",
  manual:        "bg-purple-100 text-purple-700 border-purple-200",
};

const SOURCE_LABEL: Record<string, string> = {
  firebase:      "🔥 Firebase",
  openfoodfacts: "🌍 Open Food Facts",
  ocr:           "🔤 OCR",
  manual:        "✏️ Manual",
};

export default function DashboardPage() {
  const [products, setProducts] = useState<SavedProduct[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [filterSource, setFilterSource] = useState("all");
  const [filterReview, setFilterReview] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData]   = useState<Partial<ProductRecord>>({});
  const [saving, setSaving]       = useState(false);
  const [exportingXlsx, setExportingXlsx] = useState(false);

  useEffect(() => {
    getAllProducts()
      .then(setProducts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total        = products.length;
    const byBarcode    = products.filter((p) => p.source !== "ocr").length;
    const byOCR        = products.filter((p) => p.source === "ocr").length;
    const fromFirebase = products.filter((p) => p.source === "firebase").length;
    const fromOFF      = products.filter((p) => p.source === "openfoodfacts").length;
    const needsReview  = products.filter((p) => p.needsReview).length;
    const avgConf      = total > 0
      ? Math.round(products.reduce((s, p) => s + (p.confidenceScore ?? 0), 0) / total * 100)
      : 0;

    const seenKeys = new Map<string, number>();
    products.forEach((p) => {
      const k = `${p.barcode}|${p.brand}|${p.weightUnit}`;
      seenKeys.set(k, (seenKeys.get(k) ?? 0) + 1);
    });
    const dupes = [...seenKeys.values()].filter((v) => v > 1).length;

    return { total, byBarcode, byOCR, fromFirebase, fromOFF, needsReview, avgConf, dupes };
  }, [products]);

  // Category breakdown
  const categories = useMemo(() => {
    const m = new Map<string, number>();
    products.forEach((p) => m.set(p.categoryType || "Uncategorised", (m.get(p.categoryType || "Uncategorised") ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [products]);

  // Filtered list
  const filtered = useMemo(() => products.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      p.productName.toLowerCase().includes(q) ||
      p.brand.toLowerCase().includes(q) ||
      p.barcode.includes(q) ||
      p.categoryType.toLowerCase().includes(q);
    const matchSource = filterSource === "all" || p.source === filterSource;
    const matchReview = !filterReview || p.needsReview;
    return matchSearch && matchSource && matchReview;
  }), [products, search, filterSource, filterReview]);

  // ── Actions ────────────────────────────────────────────────────────────────
  async function handleDelete(id: string) {
    if (!confirm("Delete this record from Firestore?")) return;
    try {
      await deleteProduct(id);
      setProducts((p) => p.filter((x) => x.id !== id));
    } catch (err) {
      alert("Delete failed: " + (err instanceof Error ? err.message : err));
    }
  }

  async function handleSaveEdit(id: string) {
    setSaving(true);
    try {
      await saveCorrection(id, editData);
      setProducts((p) => p.map((x) => x.id === id ? { ...x, ...editData, corrected: true, needsReview: false } : x));
      setEditingId(null);
    } catch (err) {
      alert("Save failed: " + (err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  }

  const kpis = [
    { icon: "📦", label: "Products Processed",         value: stats.total,        color: "border-indigo-200 bg-indigo-50" },
    { icon: "📊", label: "Found by Barcode",            value: stats.byBarcode,    color: "border-emerald-200 bg-emerald-50" },
    { icon: "🔤", label: "Found by OCR",                value: stats.byOCR,        color: "border-blue-200 bg-blue-50" },
    { icon: "🔥", label: "From Firebase Cache",         value: stats.fromFirebase, color: "border-orange-200 bg-orange-50" },
    { icon: "🌍", label: "From Open Food Facts",        value: stats.fromOFF,      color: "border-teal-200 bg-teal-50" },
    { icon: "🔁", label: "Duplicates Prevented",        value: stats.dupes,        color: "border-amber-200 bg-amber-50" },
    { icon: "📥", label: "Ready for Export",            value: stats.total - stats.needsReview, color: "border-violet-200 bg-violet-50" },
    { icon: "⚠️", label: "Needs Human Review",         value: stats.needsReview,  color: "border-red-200 bg-red-50" },
  ];

  return (
    <div className="max-w-7xl mx-auto px-6 py-10 space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Product Intelligence Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">All extracted IMDB records · real-time view</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {products.length > 0 && (
            <>
              <button onClick={() => exportCSV(products)}
                className="text-sm bg-emerald-600 text-white font-semibold px-4 py-2.5 rounded-xl hover:bg-emerald-700 transition-colors">
                ⬇ Export All CSV
              </button>
              <button
                onClick={async () => { setExportingXlsx(true); await exportExcel(products); setExportingXlsx(false); }}
                disabled={exportingXlsx}
                className="text-sm bg-blue-600 text-white font-semibold px-4 py-2.5 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {exportingXlsx ? "⏳ Building…" : "⬇ Export All Excel"}
              </button>
            </>
          )}
          <Link href="/upload"
            className="text-sm bg-indigo-600 text-white font-semibold px-4 py-2.5 rounded-xl hover:bg-indigo-700 transition-colors">
            + New Upload
          </Link>
        </div>
      </div>

      {/* KPI cards — 4 per row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className={`border rounded-2xl p-5 space-y-2 ${k.color}`}>
            <span className="text-2xl">{k.icon}</span>
            <p className="text-3xl font-extrabold tabular-nums text-slate-900">{k.value}</p>
            <p className="text-xs font-medium text-slate-600">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Category breakdown */}
      {categories.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-800">Products by Category</h2>
            <span className="text-xs text-slate-400">Avg Confidence: <strong className="text-slate-700">{stats.avgConf}%</strong></span>
          </div>
          {categories.map(([cat, count]) => {
            const pct = Math.round((count / stats.total) * 100);
            return (
              <div key={cat} className="flex items-center gap-3">
                <span className="w-40 text-sm text-slate-700 truncate">{cat}</span>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-16 text-right text-xs text-slate-500 tabular-nums">{count} ({pct}%)</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-center py-24 text-slate-400">
          <div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4" />
          Loading records…
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-24 text-slate-400 border border-slate-200 rounded-2xl">
          <p className="text-5xl mb-4">📭</p>
          <p className="font-semibold">No saved products yet</p>
          <Link href="/upload" className="inline-block mt-6 bg-indigo-600 text-white px-6 py-2.5 rounded-xl text-sm hover:bg-indigo-700">
            Go to Upload
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">

          {/* Table controls */}
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center gap-3 flex-wrap">
            <input
              type="search"
              placeholder="Search by name, brand, barcode…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-[200px] text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-400"
            />
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-400 bg-white"
            >
              <option value="all">All Sources</option>
              <option value="firebase">Firebase</option>
              <option value="openfoodfacts">Open Food Facts</option>
              <option value="ocr">OCR</option>
            </select>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer">
              <input type="checkbox" checked={filterReview} onChange={(e) => setFilterReview(e.target.checked)} className="rounded" />
              Needs Review Only
            </label>
            <span className="text-xs text-slate-400 ml-auto">{filtered.length} records</span>
          </div>

          {/* Records */}
          <div className="divide-y divide-slate-100">
            {filtered.map((p) => {
              const pct  = Math.round((p.confidenceScore ?? 0) * 100);
              const conf = pct >= 80 ? "text-emerald-600" : pct >= 60 ? "text-yellow-600" : "text-red-600";
              const isEditing = editingId === p.id;

              return (
                <div key={p.id} className={`px-5 py-4 space-y-3 transition-colors hover:bg-slate-50/40 ${p.needsReview && !p.corrected ? "border-l-2 border-orange-400" : ""}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 text-sm">{p.productName || "—"}</span>
                        {p.needsReview && !p.corrected && (
                          <span className="text-[10px] font-bold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full border border-orange-200">NEEDS REVIEW</span>
                        )}
                        {p.corrected && (
                          <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200">CORRECTED</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        {p.brand && <span className="mr-2 font-medium">{p.brand}</span>}
                        {p.categoryType && <span className="mr-2">· {p.categoryType}</span>}
                        {p.barcode && <span className="font-mono text-slate-400">· {p.barcode}</span>}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap shrink-0">
                      <span className={`text-sm font-bold ${conf}`}>{pct}%</span>
                      <span className={`text-xs font-semibold border px-2 py-0.5 rounded-full ${SOURCE_BADGE[p.source] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
                        {SOURCE_LABEL[p.source] ?? p.source}
                      </span>

                      {!isEditing ? (
                        <>
                          <button onClick={() => { setEditingId(p.id); setEditData({ ...p }); }}
                            className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-200 px-3 py-1.5 rounded-lg font-medium transition-colors">
                            ✏️ Edit
                          </button>
                          <button onClick={() => exportCSV([p])}
                            className="text-xs bg-emerald-100 text-emerald-700 hover:bg-emerald-200 px-3 py-1.5 rounded-lg font-medium transition-colors">
                            ⬇ CSV
                          </button>
                          <button onClick={async () => exportExcel([p])}
                            className="text-xs bg-blue-600 text-white hover:bg-blue-700 px-3 py-1.5 rounded-lg font-medium transition-colors">
                            ⬇ Excel
                          </button>
                          <button onClick={() => handleDelete(p.id)}
                            className="text-xs bg-red-100 text-red-600 hover:bg-red-200 px-3 py-1.5 rounded-lg font-medium transition-colors">
                            🗑 Delete
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => handleSaveEdit(p.id)} disabled={saving}
                            className="text-xs bg-indigo-600 text-white hover:bg-indigo-700 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50 transition-colors">
                            {saving ? "Saving…" : "✓ Save"}
                          </button>
                          <button onClick={() => { setEditingId(null); setEditData({}); }}
                            className="text-xs bg-slate-100 text-slate-600 hover:bg-slate-200 px-3 py-1.5 rounded-lg font-medium transition-colors">
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Inline edit form */}
                  {isEditing && (
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-3 border-t border-slate-100">
                      {IMDB_FIELDS.map((f) => (
                        <div key={f.key} className="flex flex-col gap-1">
                          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{f.label}</label>
                          <input
                            type="text"
                            value={(editData[f.key] as string) ?? ""}
                            onChange={(e) => setEditData((prev) => ({ ...prev, [f.key]: e.target.value }))}
                            className="text-sm border-b border-slate-300 bg-transparent py-0.5 focus:border-indigo-500 focus:outline-none"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Read-only compact row */}
                  {!isEditing && (
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400">
                      {p.weightUnit    && <span>⚖️ {p.weightUnit}</span>}
                      {p.packagingType && <span>📦 {p.packagingType}</span>}
                      {p.countryOfOrigin && <span>🌍 {p.countryOfOrigin}</span>}
                      {p.manufacturer  && <span>🏭 {p.manufacturer}</span>}
                      {p.segmentType   && <span>📂 {p.segmentType}</span>}
                      {p.marketingMessage && <span className="max-w-xs truncate">📣 {p.marketingMessage}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
