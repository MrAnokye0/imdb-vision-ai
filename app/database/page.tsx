"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { getAllProducts, deleteProduct, saveCorrection } from "@/src/lib/firestore";
import { exportExcel, exportCSV } from "@/src/lib/export";
import type { SavedProduct, ProductRecord } from "@/src/types/product";

const COLS: { key: keyof ProductRecord; label: string; width: string }[] = [
  { key: "barcode",          label: "Barcode",        width: "w-32" },
  { key: "brand",            label: "Brand",          width: "w-28" },
  { key: "productName",      label: "Product Name",   width: "w-48" },
  { key: "categoryType",     label: "Category",       width: "w-28" },
  { key: "segmentType",      label: "Segment",        width: "w-28" },
  { key: "weightUnit",       label: "Weight",         width: "w-20" },
  { key: "packagingType",    label: "Packaging",      width: "w-24" },
  { key: "countryOfOrigin",  label: "Country",        width: "w-28" },
  { key: "manufacturer",     label: "Manufacturer",   width: "w-32" },
  { key: "marketingMessage", label: "Marketing",      width: "w-40" },
];

const SOURCE_BADGE: Record<string, { cls: string; label: string }> = {
  firebase:      { cls: "bg-orange-100 text-orange-700",  label: "🔥" },
  openfoodfacts: { cls: "bg-emerald-100 text-emerald-700", label: "🌍" },
  ocr:           { cls: "bg-blue-100 text-blue-700",      label: "🔤" },
  manual:        { cls: "bg-purple-100 text-purple-700",  label: "✏️" },
};

export default function DatabasePage() {
  const [products, setProducts] = useState<SavedProduct[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [catFilter, setCatFilter]    = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [editId, setEditId]     = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<ProductRecord>>({});
  const [saving, setSaving]     = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    getAllProducts()
      .then(setProducts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(() => {
    const s = new Set(products.map((p) => p.categoryType).filter(Boolean));
    return ["all", ...s];
  }, [products]);

  const filtered = useMemo(() => products.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      p.productName.toLowerCase().includes(q) ||
      p.brand.toLowerCase().includes(q) ||
      p.barcode.includes(q) ||
      p.manufacturer.toLowerCase().includes(q);
    const matchCat    = catFilter    === "all" || p.categoryType === catFilter;
    const matchSource = sourceFilter === "all" || p.source        === sourceFilter;
    return matchSearch && matchCat && matchSource;
  }), [products, search, catFilter, sourceFilter]);

  const selectedProducts = products.filter((p) => selected.has(p.id));

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(filtered.map((p) => p.id)));
  }

  function clearSelect() {
    setSelected(new Set());
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this record?")) return;
    try {
      await deleteProduct(id);
      setProducts((prev) => prev.filter((p) => p.id !== id));
      setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
    } catch (err) {
      alert("Delete failed: " + (err instanceof Error ? err.message : err));
    }
  }

  async function handleDeleteSelected() {
    if (!confirm(`Delete ${selected.size} records?`)) return;
    for (const id of selected) {
      try { await deleteProduct(id); } catch { /* skip */ }
    }
    setProducts((prev) => prev.filter((p) => !selected.has(p.id)));
    setSelected(new Set());
  }

  async function handleSaveEdit(id: string) {
    setSaving(true);
    try {
      await saveCorrection(id, editData);
      setProducts((prev) => prev.map((p) => p.id === id ? { ...p, ...editData, corrected: true } : p));
      setEditId(null);
    } catch (err) {
      alert("Save failed: " + (err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  }

  const exportTarget = selected.size > 0 ? selectedProducts : filtered;

  return (
    <div className="max-w-full px-6 py-10 space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Master IMDB Database</h1>
          <p className="text-slate-500 text-sm mt-1">
            {products.length.toLocaleString()} records · searchable · filterable · exportable
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={async () => { setExporting(true); await exportCSV(exportTarget); setExporting(false); }}
            disabled={exportTarget.length === 0 || exporting}
            className="text-sm bg-emerald-600 text-white font-semibold px-4 py-2.5 rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            ⬇ Export CSV {selected.size > 0 && `(${selected.size} selected)`}
          </button>
          <button
            onClick={async () => { setExporting(true); await exportExcel(exportTarget); setExporting(false); }}
            disabled={exportTarget.length === 0 || exporting}
            className="text-sm bg-blue-600 text-white font-semibold px-4 py-2.5 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {exporting ? "⏳ Building…" : `⬇ Export Excel ${selected.size > 0 ? `(${selected.size})` : `(${filtered.length})`}`}
          </button>
          {selected.size > 0 && (
            <button onClick={handleDeleteSelected}
              className="text-sm bg-red-600 text-white font-semibold px-4 py-2.5 rounded-xl hover:bg-red-700 transition-colors">
              🗑 Delete {selected.size} Selected
            </button>
          )}
          <Link href="/upload"
            className="text-sm bg-indigo-600 text-white font-semibold px-4 py-2.5 rounded-xl hover:bg-indigo-700 transition-colors">
            + Upload
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-2xl px-5 py-4 flex items-center gap-3 flex-wrap shadow-sm">
        <input
          type="search"
          placeholder="Search product, brand, barcode, manufacturer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-400"
        />
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-indigo-400">
          {categories.map((c) => (
            <option key={c} value={c}>{c === "all" ? "All Categories" : c}</option>
          ))}
        </select>
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-indigo-400">
          <option value="all">All Sources</option>
          <option value="firebase">Firebase</option>
          <option value="openfoodfacts">Open Food Facts</option>
          <option value="ocr">OCR</option>
          <option value="manual">Manual</option>
        </select>
        <div className="flex gap-2 ml-auto">
          <button onClick={selectAll} className="text-xs text-indigo-600 hover:underline font-medium">
            Select all ({filtered.length})
          </button>
          {selected.size > 0 && (
            <button onClick={clearSelect} className="text-xs text-slate-400 hover:underline">
              Clear
            </button>
          )}
        </div>
        <span className="text-xs text-slate-400">{filtered.length} results</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-24 text-slate-400">
          <div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4" />
          Loading database…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-24 text-slate-400 border border-slate-200 rounded-2xl bg-white">
          <p className="text-5xl mb-4">📭</p>
          <p className="font-semibold">No records match your filters</p>
          <Link href="/upload" className="inline-block mt-6 bg-indigo-600 text-white px-6 py-2.5 rounded-xl text-sm hover:bg-indigo-700">
            Upload Products
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="w-10 px-3 py-3">
                    <input type="checkbox"
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={(e) => e.target.checked ? selectAll() : clearSelect()}
                      className="rounded"
                    />
                  </th>
                  {COLS.map((c) => (
                    <th key={c.key} className={`text-left px-3 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap ${c.width}`}>
                      {c.label}
                    </th>
                  ))}
                  <th className="w-24 px-3 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide text-center">Conf.</th>
                  <th className="w-16 px-3 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide text-center">Src</th>
                  <th className="w-32 px-3 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => {
                  const pct       = Math.round((p.confidenceScore ?? 0) * 100);
                  const confColor = pct >= 80 ? "text-emerald-600" : pct >= 60 ? "text-amber-600" : "text-red-500";
                  const isEditing = editId === p.id;
                  const src       = SOURCE_BADGE[p.source];

                  return (
                    <tr key={p.id} className={`hover:bg-slate-50/60 transition-colors ${selected.has(p.id) ? "bg-indigo-50/40" : ""}`}>
                      <td className="px-3 py-2.5">
                        <input type="checkbox" checked={selected.has(p.id)}
                          onChange={() => toggleSelect(p.id)} className="rounded" />
                      </td>

                      {isEditing ? (
                        COLS.map((c) => (
                          <td key={c.key} className="px-3 py-2.5">
                            <input
                              type="text"
                              value={(editData[c.key] as string) ?? ""}
                              onChange={(e) => setEditData((prev) => ({ ...prev, [c.key]: e.target.value }))}
                              className="w-full text-sm border-b border-indigo-400 bg-transparent focus:outline-none py-0.5"
                            />
                          </td>
                        ))
                      ) : (
                        COLS.map((c) => (
                          <td key={c.key} className="px-3 py-2.5 max-w-[200px]">
                            <span className="block truncate text-slate-700" title={String(p[c.key] ?? "")}>
                              {String(p[c.key] || "—")}
                            </span>
                          </td>
                        ))
                      )}

                      <td className={`px-3 py-2.5 text-center font-bold ${confColor}`}>{pct}%</td>

                      <td className="px-3 py-2.5 text-center">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${src?.cls ?? "bg-slate-100 text-slate-500"}`}>
                          {src?.label ?? p.source}
                        </span>
                      </td>

                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1 justify-end">
                          {isEditing ? (
                            <>
                              <button onClick={() => handleSaveEdit(p.id)} disabled={saving}
                                className="text-xs bg-indigo-600 text-white px-2 py-1 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                                {saving ? "…" : "✓"}
                              </button>
                              <button onClick={() => { setEditId(null); setEditData({}); }}
                                className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-200">
                                ✕
                              </button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => { setEditId(p.id); setEditData({ ...p }); }}
                                className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-lg hover:bg-blue-200">
                                Edit
                              </button>
                              <button onClick={() => handleDelete(p.id)}
                                className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded-lg hover:bg-red-200">
                                🗑
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 text-xs text-slate-400 flex justify-between">
            <span>Showing {filtered.length} of {products.length} records</span>
            {selected.size > 0 && <span className="text-indigo-600 font-semibold">{selected.size} selected</span>}
          </div>
        </div>
      )}
    </div>
  );
}
