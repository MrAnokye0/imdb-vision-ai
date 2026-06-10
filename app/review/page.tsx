"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getAllProducts, saveCorrection, deleteProduct } from "@/src/lib/firestore";
import { exportExcel, exportCSV } from "@/src/lib/export";
import type { SavedProduct, ProductRecord } from "@/src/types/product";

const IMDB_FIELDS: { key: keyof ProductRecord; label: string; required?: boolean }[] = [
  { key: "barcode",          label: "Barcode",           required: false },
  { key: "categoryType",     label: "Category Type",     required: true  },
  { key: "segmentType",      label: "Segment Type",      required: false },
  { key: "manufacturer",     label: "Manufacturer",      required: false },
  { key: "brand",            label: "Brand",             required: true  },
  { key: "productName",      label: "Product Name",      required: true  },
  { key: "weightUnit",       label: "Weight & Unit",     required: false },
  { key: "packagingType",    label: "Packaging Type",    required: false },
  { key: "countryOfOrigin",  label: "Country of Origin", required: false },
  { key: "marketingMessage", label: "Marketing Message", required: false },
];

const SOURCE_STYLE: Record<string, string> = {
  firebase:      "bg-orange-100 text-orange-700 border-orange-200",
  openfoodfacts: "bg-emerald-100 text-emerald-700 border-emerald-200",
  ocr:           "bg-blue-100 text-blue-700 border-blue-200",
  manual:        "bg-purple-100 text-purple-700 border-purple-200",
};

export default function ReviewPage() {
  const [products, setProducts] = useState<SavedProduct[]>([]);
  const [loading, setLoading]   = useState(true);
  const [editId, setEditId]     = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<ProductRecord>>({});
  const [saving, setSaving]     = useState(false);
  const [approved, setApproved] = useState<Set<string>>(new Set());

  useEffect(() => {
    getAllProducts()
      .then((all) => setProducts(all.filter((p) => p.needsReview && !p.corrected)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const total     = products.length;
  const remaining = products.filter((p) => !approved.has(p.id)).length;

  async function handleApprove(p: SavedProduct) {
    setSaving(true);
    try {
      await saveCorrection(p.id, { needsReview: false });
      setApproved((prev) => new Set([...prev, p.id]));
    } catch (err) {
      alert("Approve failed: " + (err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit(id: string) {
    setSaving(true);
    try {
      await saveCorrection(id, editData);
      setProducts((prev) =>
        prev.map((p) => p.id === id ? { ...p, ...editData, corrected: true, needsReview: false } : p)
      );
      setApproved((prev) => new Set([...prev, id]));
      setEditId(null);
    } catch (err) {
      alert("Save failed: " + (err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this record?")) return;
    try {
      await deleteProduct(id);
      setProducts((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      alert("Delete failed: " + (err instanceof Error ? err.message : err));
    }
  }

  const pendingProducts = products.filter((p) => !approved.has(p.id));

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 bg-orange-100 border border-orange-200 rounded-xl flex items-center justify-center text-xl">⚠️</div>
            <h1 className="text-2xl font-extrabold text-slate-900">Human Review Queue</h1>
          </div>
          <p className="text-slate-500 text-sm ml-13">
            These records have confidence below 80% and require your verification.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {pendingProducts.length > 0 && (
            <>
              <button onClick={() => exportCSV(pendingProducts)}
                className="text-sm bg-emerald-600 text-white font-semibold px-4 py-2.5 rounded-xl hover:bg-emerald-700 transition-colors">
                ⬇ Export CSV
              </button>
              <button onClick={async () => exportExcel(pendingProducts)}
                className="text-sm bg-blue-600 text-white font-semibold px-4 py-2.5 rounded-xl hover:bg-blue-700 transition-colors">
                ⬇ Export Excel
              </button>
            </>
          )}
          <Link href="/upload"
            className="text-sm bg-indigo-600 text-white font-semibold px-4 py-2.5 rounded-xl hover:bg-indigo-700 transition-colors">
            + New Upload
          </Link>
        </div>
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 shadow-sm">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-slate-700">Review Progress</span>
            <span className="text-slate-500">
              {total - remaining} / {total} approved
            </span>
          </div>
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-600 rounded-full transition-all duration-500"
              style={{ width: `${total > 0 ? ((total - remaining) / total) * 100 : 0}%` }}
            />
          </div>
          {remaining === 0 && total > 0 && (
            <p className="text-sm text-emerald-600 font-semibold text-center">
              ✓ All records reviewed! Ready to export.
            </p>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-24 text-slate-400">
          <div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4" />
          Loading review queue…
        </div>
      )}

      {/* Empty state */}
      {!loading && products.length === 0 && (
        <div className="text-center py-24 text-slate-400 border border-slate-200 rounded-2xl bg-white">
          <p className="text-5xl mb-4">✅</p>
          <p className="font-semibold text-slate-600">No records need review</p>
          <p className="text-sm mt-1">All products have high enough confidence scores</p>
          <Link href="/upload" className="inline-block mt-6 bg-indigo-600 text-white px-6 py-2.5 rounded-xl text-sm hover:bg-indigo-700">
            Upload More Products
          </Link>
        </div>
      )}

      {/* Review cards */}
      <div className="space-y-4">
        {products.map((p) => {
          const pct       = Math.round((p.confidenceScore ?? 0) * 100);
          const isEditing = editId === p.id;
          const isApproved = approved.has(p.id);
          const confColor = pct >= 80 ? "text-emerald-600" : pct >= 60 ? "text-amber-600" : "text-red-600";
          const confBar   = pct >= 80 ? "bg-emerald-500"   : pct >= 60 ? "bg-amber-400"   : "bg-red-400";

          return (
            <div
              key={p.id}
              className={`bg-white border rounded-2xl shadow-sm overflow-hidden transition-all ${
                isApproved ? "border-emerald-200 opacity-60" : "border-orange-200"
              }`}
            >
              {/* Card header */}
              <div className={`px-5 py-3 flex items-center justify-between gap-3 flex-wrap ${
                isApproved ? "bg-emerald-50" : "bg-orange-50"
              }`}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-900 text-sm">{p.productName || "Unknown product"}</span>
                      {isApproved && (
                        <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200">
                          ✓ APPROVED
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      {p.brand && <span className="font-medium">{p.brand}</span>}
                      {p.barcode && <span className="font-mono">{p.barcode}</span>}
                      <span className={`font-semibold border px-1.5 py-0.5 rounded-full text-[10px] ${SOURCE_STYLE[p.source] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
                        {p.source}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Confidence */}
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <span className={`text-lg font-extrabold ${confColor}`}>{pct}%</span>
                    <p className="text-[10px] text-slate-400">confidence</p>
                  </div>
                  <div className="w-24 h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${confBar}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="px-5 py-4 space-y-4">
                {/* Low confidence warning */}
                {!isApproved && (() => {
                  const lowConfidenceFields = IMDB_FIELDS.filter(f => {
                    const score = p.fieldConfidenceScores?.[f.key] ?? 0;
                    return score < 0.7;
                  });
                  return lowConfidenceFields.length > 0 ? (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                      <div className="flex items-start gap-2">
                        <span className="text-red-600 font-bold text-lg mt-0.5">⚠</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-red-700">Low Confidence Fields</p>
                          <p className="text-xs text-red-600 mt-1">
                            {lowConfidenceFields.map(f => f.label).join(", ")} below 70% confidence
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : null;
                })()}

                {/* IMDB fields */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {IMDB_FIELDS.map((f) => {
                    const val      = isEditing ? ((editData[f.key] as string) ?? "") : ((p[f.key] as string) ?? "");
                    const isEmpty  = !val.trim();
                    const isRequired = f.required;
                    const fieldConfidence = p.fieldConfidenceScores?.[f.key] ?? 0;
                    const fieldConfidencePct = Math.round(fieldConfidence * 100);
                    
                    let confidenceColor = "text-emerald-600";
                    let confidenceBgColor = "bg-emerald-50 border-emerald-200";
                    let confidenceTextColor = "text-emerald-700";
                    
                    if (fieldConfidencePct < 70) {
                      confidenceColor = "text-red-600";
                      confidenceBgColor = "bg-red-50 border-red-200";
                      confidenceTextColor = "text-red-700";
                    } else if (fieldConfidencePct < 90) {
                      confidenceColor = "text-amber-600";
                      confidenceBgColor = "bg-amber-50 border-amber-200";
                      confidenceTextColor = "text-amber-700";
                    }

                    return (
                      <div key={f.key} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-1">
                          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 flex items-center gap-1">
                            {f.label}
                            {isRequired && isEmpty && <span className="text-red-500">*</span>}
                            {isEmpty && !isRequired && <span className="text-orange-400">●</span>}
                          </label>
                          <span className={`text-[9px] font-bold ${confidenceColor}`}>
                            {fieldConfidencePct}%
                          </span>
                        </div>
                        {isEditing ? (
                          <input
                            type="text"
                            value={val}
                            onChange={(e) => setEditData((prev) => ({ ...prev, [f.key]: e.target.value }))}
                            className={`text-sm border-b py-1 bg-transparent focus:outline-none transition-colors ${
                              isEmpty && isRequired ? "border-red-400 text-red-600" : "border-slate-300 focus:border-indigo-500"
                            }`}
                            placeholder={isRequired ? "Required" : "—"}
                          />
                        ) : (
                          <>
                            <span className={`text-sm ${isEmpty ? "text-slate-300 italic" : "text-slate-800 font-medium"}`}>
                              {val || "—"}
                            </span>
                            {!isEmpty && fieldConfidencePct < 90 && (
                              <div className={`text-[9px] font-semibold px-2 py-0.5 rounded border ${confidenceBgColor} ${confidenceTextColor} inline-block w-fit`}>
                                {fieldConfidencePct < 70 ? "⚠ Review" : "✓ Check"}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Actions */}
                {!isApproved && (
                  <div className="flex items-center gap-2 pt-2 border-t border-slate-100 flex-wrap">
                    {!isEditing ? (
                      <>
                        <button
                          onClick={() => handleApprove(p)}
                          disabled={saving}
                          className="text-sm font-semibold bg-emerald-600 text-white px-4 py-2 rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                        >
                          ✓ Approve as-is
                        </button>
                        <button
                          onClick={() => { setEditId(p.id); setEditData({ ...p }); }}
                          className="text-sm font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 px-4 py-2 rounded-xl hover:bg-indigo-100 transition-colors"
                        >
                          ✏️ Edit & Approve
                        </button>
                        <button
                          onClick={() => handleDelete(p.id)}
                          className="text-sm font-semibold bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded-xl hover:bg-red-100 transition-colors"
                        >
                          🗑 Remove
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleSaveEdit(p.id)}
                          disabled={saving}
                          className="text-sm font-semibold bg-indigo-600 text-white px-4 py-2 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                        >
                          {saving ? "Saving…" : "✓ Save & Approve"}
                        </button>
                        <button
                          onClick={() => { setEditId(null); setEditData({}); }}
                          className="text-sm font-semibold bg-slate-100 text-slate-600 px-4 py-2 rounded-xl hover:bg-slate-200 transition-colors"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
