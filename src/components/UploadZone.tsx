"use client";

import { useState, useCallback, useRef, type ChangeEvent } from "react";
import Image from "next/image";
import { extractFromImage, extractFromImages, type ExtractionResult } from "@/src/lib/extract-client";
import { saveProduct, isDuplicate, findSimilarProducts, findDuplicates, type DuplicateMatch } from "@/src/lib/firestore";
import { exportCSV, exportExcel } from "@/src/lib/export";
import CameraCapture from "@/src/components/CameraCapture";
import KnowledgeGraph from "@/src/components/KnowledgeGraph";
import type { ProductRecord, PipelineStep, ExtractionSource } from "@/src/types/product";
import type { ValidationReport } from "@/src/lib/validation";

// ─── Types ────────────────────────────────────────────────────────────────────

type RowStatus = "processing" | "review" | "ready" | "duplicate" | "saved" | "error";

interface StagedRow {
  id: string;
  fileName: string;
  previewUrl: string;
  previewUrls?: string[];
  preprocessedUrl?: string;
  status: RowStatus;
  progress: string;
  product: ProductRecord;
  source: ExtractionSource;
  steps: PipelineStep[];
  validation?: ValidationReport;
  showGraph: boolean;
  errorMsg?: string;
}

interface DuplicateAlert {
  rowId: string;
  fileName: string;
  previewUrl: string;
  product: ProductRecord;
  duplicates: DuplicateMatch[];
}

type ScanStepKey = "front" | "back" | "side" | "barcode";

const SCAN_STEPS = [
  { key: "front", title: "Front label",  detail: "Capture the main front label for product recognition.", required: true },
  { key: "back",  title: "Back label",   detail: "Capture ingredient, nutrition or regulatory details.", required: false },
  { key: "side",  title: "Side label",   detail: "Capture the packaging side panel or product edge.", required: false },
  { key: "barcode", title: "Barcode",    detail: "Capture the barcode clearly for faster lookup.", required: true },
] as const;

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

function emptyProduct(): ProductRecord {
  return {
    barcode: "", categoryType: "", segmentType: "", manufacturer: "",
    brand: "", productName: "", weightUnit: "", packagingType: "",
    countryOfOrigin: "", marketingMessage: "", confidenceScore: 0,
  };
}

// ─── Status Pill ──────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: RowStatus }) {
  const cfg: Record<RowStatus, { cls: string; label: string }> = {
    processing: { cls: "bg-indigo-100 text-indigo-700",   label: "⏳ Processing" },
    review:     { cls: "bg-orange-100 text-orange-700",   label: "⚠ Needs Review" },
    ready:      { cls: "bg-slate-100 text-slate-600",     label: "✎ Ready" },
    duplicate:  { cls: "bg-amber-100 text-amber-800",     label: "🔁 Duplicate" },
    saved:      { cls: "bg-emerald-100 text-emerald-700", label: "✓ Saved" },
    error:      { cls: "bg-red-100 text-red-600",         label: "✗ Error" },
  };
  const { cls, label } = cfg[status];
  return (
    <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${cls}`}>
      {label}
    </span>
  );
}

// ─── Confidence badge ─────────────────────────────────────────────────────────

function ConfBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const cls = pct >= 80 ? "text-emerald-600 bg-emerald-50 border-emerald-200"
            : pct >= 60 ? "text-amber-600 bg-amber-50 border-amber-200"
            :             "text-red-600 bg-red-50 border-red-200";
  return (
    <span className={`text-xs font-bold border px-2 py-0.5 rounded-full ${cls}`}>
      {pct}%
    </span>
  );
}

// ─── Duplicate Modal ──────────────────────────────────────────────────────────

function DuplicateModal({
  alerts, onKeep, onRemove, onKeepAll, onRemoveAll,
}: {
  alerts: DuplicateAlert[];
  onKeep: (id: string) => void;
  onRemove: (id: string) => void;
  onKeepAll: () => void;
  onRemoveAll: () => void;
}) {
  if (!alerts.length) return null;
  const cur = alerts[0];
  const pct = Math.round((cur.product.confidenceScore ?? 0) * 100);
  const topDuplicate = cur.duplicates[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-4 flex items-start gap-3 shrink-0">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-xl shrink-0">🔁</div>
          <div className="flex-1">
            <p className="font-bold text-slate-900">Duplicate Product Detected</p>
            <p className="text-sm text-amber-700 mt-0.5">
              {cur.duplicates.length} matching product{cur.duplicates.length !== 1 ? "s" : ""} found in your database. Review and choose to keep or remove.
            </p>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5">
          <div className="space-y-5">
            {/* New Product */}
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">New Product</p>
              <div className="flex items-start gap-4 bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div className="relative w-20 h-20 rounded-xl overflow-hidden bg-slate-100 border shrink-0">
                  <Image src={cur.previewUrl} alt={cur.fileName} fill sizes="80px" className="object-cover" />
                </div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <p className="font-bold text-slate-900 text-sm">{cur.product.productName || cur.fileName}</p>
                  <div className="space-y-1 text-xs text-slate-600">
                    {cur.product.barcode && <p>📊 <span className="font-mono font-semibold">{cur.product.barcode}</span></p>}
                    {cur.product.brand && <p>🏷️ <span className="font-semibold">{cur.product.brand}</span></p>}
                    {cur.product.productName && <p>📦 {cur.product.productName}</p>}
                    {cur.product.weightUnit && <p>⚖️ <span className="font-semibold">{cur.product.weightUnit}</span></p>}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${pct >= 80 ? "bg-emerald-500" : "bg-amber-400"}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs font-bold text-slate-600">{pct}%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Existing Duplicates */}
            {topDuplicate && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">
                  Matching in Database
                </p>
                <div className="space-y-3">
                  {cur.duplicates.map((dup, idx) => {
                    const confPct = Math.round((dup.product.confidenceScore ?? 0) * 100);
                    const matchCount = Object.values(dup.matchFields).filter(Boolean).length;
                    const matchLabel = dup.matchFields.barcode 
                      ? "Exact match (same barcode)" 
                      : `${matchCount}/4 fields match`;
                    
                    return (
                      <div key={idx} className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-slate-900 text-sm">{dup.product.productName}</p>
                            <div className="space-y-1 text-xs text-slate-600 mt-1">
                              {dup.product.barcode && (
                                <p className={dup.matchFields.barcode ? "text-amber-700 font-semibold" : ""}>
                                  📊 <span className="font-mono">{dup.product.barcode}</span>
                                  {dup.matchFields.barcode && " ✓"}
                                </p>
                              )}
                              {dup.product.brand && (
                                <p className={dup.matchFields.brand ? "text-amber-700 font-semibold" : ""}>
                                  🏷️ {dup.product.brand}
                                  {dup.matchFields.brand && " ✓"}
                                </p>
                              )}
                              {dup.product.productName && (
                                <p className={dup.matchFields.productName ? "text-amber-700 font-semibold" : ""}>
                                  📦 {dup.product.productName}
                                  {dup.matchFields.productName && " ✓"}
                                </p>
                              )}
                              {dup.product.weightUnit && (
                                <p className={dup.matchFields.weight ? "text-amber-700 font-semibold" : ""}>
                                  ⚖️ {dup.product.weightUnit}
                                  {dup.matchFields.weight && " ✓"}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded">{matchLabel}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="border-t border-slate-200 bg-slate-50 px-6 py-4 space-y-3 shrink-0">
          <p className="text-sm text-slate-600 font-medium text-center">What would you like to do?</p>

          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => onRemove(cur.rowId)}
              className="flex flex-col items-center gap-1 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 font-semibold text-sm px-4 py-3 rounded-xl transition-colors">
              <span className="text-xl">🗑</span>
              Remove It
              <span className="text-xs font-normal text-red-400">Discard this duplicate</span>
            </button>
            <button onClick={() => onKeep(cur.rowId)}
              className="flex flex-col items-center gap-1 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 font-semibold text-sm px-4 py-3 rounded-xl transition-colors">
              <span className="text-xl">✅</span>
              Keep It
              <span className="text-xs font-normal text-indigo-400">Add as new entry</span>
            </button>
          </div>

          {alerts.length > 1 && (
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200">
              <button onClick={onRemoveAll} className="text-xs font-semibold text-red-600 hover:bg-red-50 py-2 rounded-lg transition-colors">
                Remove All {alerts.length}
              </button>
              <button onClick={onKeepAll} className="text-xs font-semibold text-indigo-600 hover:bg-indigo-50 py-2 rounded-lg transition-colors">
                Keep All {alerts.length}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function UploadZone() {
  const [rows, setRows]           = useState<StagedRow[]>([]);
  const [dupeAlerts, setDupeAlerts] = useState<DuplicateAlert[]>([]);
  const [savingAll, setSavingAll]   = useState(false);
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [scanActive, setScanActive] = useState(false);
  const [scanStepIndex, setScanStepIndex] = useState(0);
  const [scanFiles, setScanFiles] = useState<Partial<Record<ScanStepKey, File>>>({});
  const [scanUrls, setScanUrls] = useState<Partial<Record<ScanStepKey, string>>>({});
  const [scanSkipped, setScanSkipped] = useState<Partial<Record<ScanStepKey, boolean>>>({});
  const [scanStatus, setScanStatus] = useState<string>("");
  const [showCamera, setShowCamera] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const isProcessing = rows.some((r) => r.status === "processing");
  const pendingRows  = rows.filter((r) => ["ready", "review", "duplicate"].includes(r.status));
  const savedRows    = rows.filter((r) => r.status === "saved");
  const exportable   = rows.filter((r) => !["processing", "error"].includes(r.status)).map((r) => r.product);

  const currentScanStep = SCAN_STEPS[scanStepIndex];

  const completedScanSteps = SCAN_STEPS.filter((s) => scanFiles[s.key] || scanSkipped[s.key]).length;
  const canFinishScan = SCAN_STEPS.every((s) => (s.required ? Boolean(scanFiles[s.key]) : true));

  // Duplicate handlers
  const handleKeep = useCallback((id: string) => {
    setRows((p) => p.map((r) => r.id === id ? { ...r, status: "ready" } : r));
    setDupeAlerts((p) => p.filter((a) => a.rowId !== id));
  }, []);

  const handleRemove = useCallback((id: string) => {
    setRows((p) => { const r = p.find((x) => x.id === id); if (r) { (r.previewUrls ?? [r.previewUrl]).forEach((u) => URL.revokeObjectURL(u)); } return p.filter((x) => x.id !== id); });
    setDupeAlerts((p) => p.filter((a) => a.rowId !== id));
  }, []);

  const handleKeepAll = useCallback(() => {
    const ids = dupeAlerts.map((a) => a.rowId);
    setRows((p) => p.map((r) => ids.includes(r.id) ? { ...r, status: "ready" } : r));
    setDupeAlerts([]);
  }, [dupeAlerts]);

  const handleRemoveAll = useCallback(() => {
    const ids = dupeAlerts.map((a) => a.rowId);
    setRows((p) => { p.filter((r) => ids.includes(r.id)).forEach((r) => (r.previewUrls ?? [r.previewUrl]).forEach((u) => URL.revokeObjectURL(u))); return p.filter((r) => !ids.includes(r.id)); });
    setDupeAlerts([]);
  }, [dupeAlerts]);

  function startScan() {
    Object.values(scanUrls).forEach((u) => u && URL.revokeObjectURL(u));
    setScanFiles({});
    setScanUrls({});
    setScanSkipped({});
    setScanStepIndex(0);
    setScanStatus("Ready to capture front label.");
    setScanActive(true);
  }

  function cancelScan() {
    Object.values(scanUrls).forEach((u) => u && URL.revokeObjectURL(u));
    setScanActive(false);
    setScanStepIndex(0);
    setScanFiles({});
    setScanUrls({});
    setScanSkipped({});
    setScanStatus("");
  }

  function openScanCapture(index: number) {
    setScanStepIndex(index);
    setScanStatus(`Ready to capture ${SCAN_STEPS[index].title.toLowerCase()}.`);
    setShowCamera(true);
  }

  function handleCameraCapture(blob: Blob) {
    // Convert blob to File object
    const timestamp = Date.now();
    const fileName = `capture-${currentScanStep.key}-${timestamp}.jpg`;
    const file = new File([blob], fileName, { type: "image/jpeg" });

    setScanFiles((prev) => ({ ...prev, [currentScanStep.key]: file }));
    setScanUrls((prev) => {
      if (prev[currentScanStep.key]) URL.revokeObjectURL(prev[currentScanStep.key]!);
      return { ...prev, [currentScanStep.key]: URL.createObjectURL(blob) };
    });

    setScanStatus(`${currentScanStep.title} captured.`);
    setShowCamera(false);
    setScanStepIndex((idx) => Math.min(idx + 1, SCAN_STEPS.length - 1));
  }

  function handleScanInput(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanFiles((prev) => ({ ...prev, [currentScanStep.key]: file }));
    setScanUrls((prev) => {
      if (prev[currentScanStep.key]) URL.revokeObjectURL(prev[currentScanStep.key]!);
      return { ...prev, [currentScanStep.key]: URL.createObjectURL(file) };
    });

    setScanStatus(`${currentScanStep.title} captured.`);
    setScanStepIndex((idx) => Math.min(idx + 1, SCAN_STEPS.length - 1));
    e.target.value = "";
  }

  function skipScanStep() {
    const step = SCAN_STEPS[scanStepIndex];
    if (step.required) return;
    setScanSkipped((prev) => ({ ...prev, [step.key]: true }));
    setScanStatus(`${step.title} skipped.`);
    setScanStepIndex((idx) => Math.min(idx + 1, SCAN_STEPS.length - 1));
  }

  function finishScan() {
    const files = SCAN_STEPS.map((s) => scanFiles[s.key]).filter(Boolean) as File[];
    if (!files.length) return;
    setScanActive(false);
    setScanStatus("");
    processFiles(files);
  }

  // Process uploaded files
  async function processFiles(files: File[]) {
    if (!files.length) return;

    // If user selected multiple files at once, group them into a single staged product
    const grouped = files.length > 1;
    const newRows: StagedRow[] = grouped
      ? [{
          id: `${Date.now()}-${Math.random()}`,
          fileName: `${files[0].name} (+${files.length - 1})`,
          previewUrl: URL.createObjectURL(files[0]),
          previewUrls: files.map((f) => URL.createObjectURL(f)),
          status: "processing",
          progress: "Starting…",
          product: emptyProduct(),
          source: "ocr" as ExtractionSource,
          steps: [],
          showGraph: false,
        }]
      : files.map((f) => ({
          id: `${Date.now()}-${Math.random()}`,
          fileName: f.name,
          previewUrl: URL.createObjectURL(f),
          status: "processing",
          progress: "Starting…",
          product: emptyProduct(),
          source: "ocr" as ExtractionSource,
          steps: [],
          showGraph: false,
        }));

    setRows((p) => [...p, ...newRows]);

    for (const row of newRows) {
      try {
        const images = row.previewUrls ?? [row.previewUrl];
        const result: ExtractionResult = images.length > 1
          ? await extractFromImages(images, (_msg, steps) => setRows((p) => p.map((r) => r.id === row.id ? { ...r, steps, progress: _msg } : r)))
          : await extractFromImage(images[0], (_msg, steps) => setRows((p) => p.map((r) => r.id === row.id ? { ...r, steps, progress: _msg } : r)));

        const { product, source, steps, needsReview, preprocessedUrl, validation } = result;

        // Duplicate check
        let duplicates: DuplicateMatch[] = [];
        try {
          duplicates = await findDuplicates(product);
        } catch { /* skip */ }
        const batchDupe = newRows
          .filter((x) => x.id !== row.id)
          .some((x) => x.product.barcode && x.product.barcode === product.barcode && x.product.brand === product.brand);

        const isDupe = duplicates.length > 0 || batchDupe;
        let status: RowStatus = needsReview ? "review" : "ready";
        if (isDupe) status = "duplicate";

        setRows((p) => p.map((r) =>
          r.id === row.id ? { ...r, status, progress: "", product, source, steps, validation, preprocessedUrl, showGraph: true } : r
        ));

        if (isDupe) {
          setDupeAlerts((p) => [...p, { rowId: row.id, fileName: row.fileName, previewUrl: (row.previewUrls ?? [row.previewUrl])[0], product, duplicates }]);
        }
      } catch (err) {
        setRows((p) => p.map((r) =>
          r.id === row.id ? { ...r, status: "error", progress: "", errorMsg: err instanceof Error ? err.message : "Failed" } : r
        ));
      }
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    processFiles(files);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    processFiles(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/")));
  }

  function updateField(id: string, field: keyof ProductRecord, value: string) {
    setRows((p) => p.map((r) => r.id === id ? { ...r, product: { ...r.product, [field]: value } } : r));
  }

  function removeRow(id: string) {
    setRows((p) => { const r = p.find((x) => x.id === id); if (r) URL.revokeObjectURL(r.previewUrl); return p.filter((x) => x.id !== id); });
  }

  async function saveRow(id: string) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    setRows((p) => p.map((r) => r.id === id ? { ...r, status: "processing", progress: "Saving to Firestore…" } : r));
    try {
      await saveProduct(row.product, row.source);
      setRows((p) => p.map((r) => r.id === id ? { ...r, status: "saved", progress: "" } : r));
    } catch (err) {
      setRows((p) => p.map((r) =>
        r.id === id ? { ...r, status: "error", progress: "", errorMsg: err instanceof Error ? err.message : "Save failed" } : r
      ));
    }
  }

  async function saveAll() {
    setSavingAll(true);
    for (const r of pendingRows) await saveRow(r.id);
    setSavingAll(false);
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      <DuplicateModal
        alerts={dupeAlerts}
        onKeep={handleKeep}
        onRemove={handleRemove}
        onKeepAll={handleKeepAll}
        onRemoveAll={handleRemoveAll}
      />

      {showCamera && (
        <CameraCapture
          title={currentScanStep.title}
          detail={currentScanStep.detail}
          onCapture={handleCameraCapture}
          onCancel={() => setShowCamera(false)}
        />
      )}

      <div className="space-y-5">

        <input
          ref={scanInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleScanInput}
          className="hidden"
        />

        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">Scan Product Workflow</p>
                <p className="text-xs text-slate-500">Capture a single product across front, back, side, and barcode images.</p>
              </div>
              <button
                type="button"
                onClick={scanActive ? cancelScan : startScan}
                className="inline-flex items-center gap-2 text-xs font-semibold bg-indigo-600 text-white px-3 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
              >
                {scanActive ? "Cancel scan" : "Start scan"}
              </button>
            </div>

            {scanActive ? (
              <div className="space-y-4">
                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-900">Step {Math.min(scanStepIndex + 1, SCAN_STEPS.length)} of {SCAN_STEPS.length}</p>
                    <span className="text-xs text-slate-500">{completedScanSteps} captured / skipped</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{scanStatus}</p>
                </div>

                <div className="space-y-3">
                  {SCAN_STEPS.map((step, index) => {
                    const isCompleted = Boolean(scanFiles[step.key] || scanSkipped[step.key]);
                    const statusLabel = scanFiles[step.key]
                      ? "Captured"
                      : scanSkipped[step.key]
                        ? "Skipped"
                        : index < scanStepIndex
                          ? "Missed"
                          : "Pending";

                    return (
                      <div key={step.key} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 p-4">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900">{step.title}</p>
                          <p className="text-xs text-slate-500">{step.detail}</p>
                        </div>
                        <div className="text-right">
                          <span className={`text-[11px] font-semibold rounded-full px-2.5 py-1 ${isCompleted ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                            {statusLabel}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="rounded-3xl border border-slate-200 p-4 bg-slate-50">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{currentScanStep.title}</p>
                      <p className="text-xs text-slate-500">{currentScanStep.detail}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openScanCapture(scanStepIndex)}
                        className="inline-flex items-center justify-center rounded-full bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
                      >
                        {scanFiles[currentScanStep.key] ? "Retake" : "Capture"}
                      </button>
                      {!currentScanStep.required && !scanFiles[currentScanStep.key] && (
                        <button
                          type="button"
                          onClick={skipScanStep}
                          className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                        >
                          Skip step
                        </button>
                      )}
                    </div>
                  </div>

                  {scanUrls[currentScanStep.key] && (
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white h-40">
                        <Image src={scanUrls[currentScanStep.key]} alt={currentScanStep.title} fill sizes="360px" className="object-contain" />
                      </div>
                      <div className="flex flex-col justify-between gap-3">
                        <div className="rounded-2xl bg-white border border-slate-200 p-3 text-sm text-slate-600">
                          Preview captured image for <strong>{currentScanStep.title}</strong>.
                        </div>
                        <div className="text-xs text-slate-400">
                          You can retake this step, or finish capture once required images are complete.
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center">
                    <button
                      type="button"
                      onClick={finishScan}
                      disabled={!canFinishScan || completedScanSteps === 0}
                      className="inline-flex items-center justify-center w-full rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-700 transition-colors sm:w-auto"
                    >
                      Finish & Extract Images
                    </button>
                    <p className="text-xs text-slate-500">
                      Required: Front + Barcode. Optional: Back + Side.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm text-slate-600">Tap Start scan to capture product images step-by-step. This workflow does not modify the standard upload process.</p>
              </div>
            )}
          </div>

          <div className="lg:col-span-1">
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
              <p className="text-sm font-semibold text-slate-900">Why use scan workflow?</p>
              <ul className="mt-3 space-y-2 text-sm text-slate-500">
                <li>• Capture product detail images in a guided order.</li>
                <li>• Skip optional images if a panel is unavailable.</li>
                <li>• All images are grouped into one product entry.</li>
                <li>• Existing upload tooling remains unchanged.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className={`relative border-2 border-dashed rounded-2xl transition-all ${
            isProcessing ? "border-indigo-400 bg-indigo-50/60" : "border-slate-300 bg-white hover:border-indigo-400 hover:bg-indigo-50/30"
          }`}
        >
          <label className="flex flex-col items-center justify-center gap-4 p-14 cursor-pointer">
            <input type="file" accept="image/*" multiple onChange={handleInput} className="hidden" capture="environment" />
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl ${isProcessing ? "bg-indigo-100" : "bg-slate-100"}`}>
              {isProcessing ? "⏳" : "📸"}
            </div>
            <div className="text-center">
              <p className="font-semibold text-slate-700 text-base">
                {isProcessing ? "Processing images…" : "Drop product images here"}
              </p>
              <p className="text-sm text-slate-400 mt-1">
                or <span className="text-indigo-600 font-medium">click to browse</span> · JPG, PNG, WebP · batch upload supported
              </p>
              <div className="flex items-center justify-center gap-3 mt-3 flex-wrap">
                {["Barcode Scan", "Firebase Lookup", "Open Food Facts", "AI Inference", "OCR Fallback"].map((s, i) => (
                  <span key={s} className="flex items-center gap-1.5 text-xs text-slate-400">
                    {i > 0 && <span className="text-slate-200">→</span>}
                    <span className="bg-slate-100 px-2 py-0.5 rounded-md font-medium">{s}</span>
                  </span>
                ))}
              </div>
            </div>
          </label>
          {isProcessing && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-100 rounded-b-2xl overflow-hidden">
              <div className="h-full bg-indigo-500 animate-pulse w-2/3 rounded-full" />
            </div>
          )}
        </div>

        {/* Staging area */}
        {rows.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">

            {/* Toolbar */}
            <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between flex-wrap gap-3">
              <div>
                <span className="text-sm font-bold text-slate-800">Product Intelligence Staging</span>
                <span className="ml-2 text-xs text-slate-400">
                  {rows.length} total · {savedRows.length} saved · {pendingRows.length} pending
                  {rows.filter((r) => r.status === "review").length > 0 && (
                    <span className="ml-1 text-orange-500 font-semibold">
                      · {rows.filter((r) => r.status === "review").length} need review
                    </span>
                  )}
                  {dupeAlerts.length > 0 && (
                    <span className="ml-1 text-amber-600 font-semibold">· {dupeAlerts.length} duplicates</span>
                  )}
                </span>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <label className="cursor-pointer inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded-lg transition-colors">
                  + Add More
                  <input type="file" accept="image/*" multiple onChange={handleInput} className="hidden" />
                </label>
                <button
                  onClick={() => exportCSV(exportable)}
                  disabled={exportable.length === 0}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold bg-emerald-600 text-white px-3 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ⬇ CSV {exportable.length > 0 && <span className="bg-emerald-500 px-1.5 py-0.5 rounded-full">{exportable.length}</span>}
                </button>
                <button
                  onClick={async () => { setExportingXlsx(true); await exportExcel(exportable); setExportingXlsx(false); }}
                  disabled={exportable.length === 0 || exportingXlsx}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {exportingXlsx ? "⏳ Building…" : <>⬇ Excel {exportable.length > 0 && <span className="bg-blue-500 px-1.5 py-0.5 rounded-full">{exportable.length}</span>}</>}
                </button>
                {pendingRows.length > 0 && (
                  <button
                    onClick={saveAll}
                    disabled={savingAll}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold bg-indigo-600 text-white px-3 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {savingAll ? "⏳ Saving…" : <>💾 Save All <span className="bg-indigo-500 px-1.5 py-0.5 rounded-full">{pendingRows.length}</span></>}
                  </button>
                )}
              </div>
            </div>

            {/* Product rows */}
            <div className="divide-y divide-slate-100">
              {rows.map((row, idx) => (
                <div
                  key={row.id}
                  className={`p-5 transition-colors ${
                    row.status === "duplicate" ? "bg-amber-50/40" :
                    row.status === "review"    ? "bg-orange-50/30" :
                    row.status === "saved"     ? "bg-emerald-50/20" :
                    row.status === "error"     ? "bg-red-50/30" : "hover:bg-slate-50/60"
                  }`}
                >
                  {/* Row header */}
                  <div className="flex items-start gap-3">
                    <div className="relative h-14 w-14 shrink-0 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shadow-sm">
                      <Image
                        src={row.product.imageUrl || (row.previewUrls ?? [row.previewUrl])[0]}
                        alt={row.fileName}
                        fill sizes="56px"
                        className="object-contain"
                      />
                    </div>

                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-bold text-slate-300">#{idx + 1}</span>
                          <span className="font-semibold text-slate-900 text-sm truncate">
                            {row.product.productName || row.fileName}
                          </span>
                          {row.product.brand && <span className="text-xs text-slate-400 truncate">· {row.product.brand}</span>}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                          <StatusPill status={row.status} />
                          {row.status !== "processing" && <ConfBadge score={row.product.confidenceScore} />}

                          {row.status === "duplicate" && (
                            <button
                              onClick={() => setDupeAlerts((p) =>
                                p.find((a) => a.rowId === row.id) ? p : [...p, { rowId: row.id, fileName: row.fileName, previewUrl: (row.previewUrls ?? [row.previewUrl])[0], product: row.product }]
                              )}
                              className="text-xs font-semibold bg-amber-500 text-white px-2.5 py-1.5 rounded-lg hover:bg-amber-600 transition-colors"
                            >
                              Resolve →
                            </button>
                          )}

                          {["ready", "review"].includes(row.status) && (
                            <button
                              onClick={() => saveRow(row.id)}
                              className="text-xs font-semibold bg-indigo-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors"
                            >
                              💾 Save
                            </button>
                          )}

                          {/* Toggle knowledge graph */}
                          {row.status !== "processing" && row.status !== "error" && (
                            <button
                              onClick={() => setRows((p) => p.map((r) => r.id === row.id ? { ...r, showGraph: !r.showGraph } : r))}
                              className="text-xs font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2.5 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors"
                            >
                              {row.showGraph ? "Hide" : "🔬 Graph"}
                            </button>
                          )}

                          <button
                            onClick={() => removeRow(row.id)}
                            className="text-xs font-semibold bg-red-50 text-red-500 border border-red-200 px-2 py-1.5 rounded-lg hover:bg-red-100 transition-colors"
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                  {/* Processing progress */}
                      {row.status === "processing" && (
                        <p className="text-xs text-indigo-500 animate-pulse font-medium">{row.progress || "Initialising…"}</p>
                      )}

                      {row.status === "review" && (
                        <p className="text-xs text-orange-600 font-medium">
                          ⚠ Confidence below 80% — review and correct fields, then save
                        </p>
                      )}
                      {row.status === "duplicate" && (
                        <p className="text-xs text-amber-700 font-medium">
                          🔁 Matches existing record — click <strong>Resolve</strong> to keep or discard
                        </p>
                      )}
                      {row.status === "error" && (
                        <p className="text-xs text-red-500 font-medium">{row.errorMsg}</p>
                      )}
                    </div>
                  </div>

                  {/* Knowledge Graph */}
                  {row.showGraph && row.status !== "processing" && row.status !== "error" && (
                    <KnowledgeGraph
                      product={row.product}
                      source={row.source}
                      steps={row.steps}
                      fileName={row.fileName}
                      previewUrl={(row.previewUrls ?? [row.previewUrl])[0]}
                    />
                  )}

                  {/* IMDB fields grid */}
                  {row.status !== "processing" && row.status !== "error" && (
                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-3">
                      {IMDB_FIELDS.map((f) => {
                        const val = (row.product[f.key] as string) ?? "";
                        const fieldConf = row.validation?.fields.find((vf) => vf.field === f.key);
                        const fieldPct  = fieldConf ? Math.round(fieldConf.confidence * 100) : null;
                        const fieldColor = fieldPct == null ? "" :
                          fieldPct >= 80 ? "text-emerald-600" :
                          fieldPct >= 60 ? "text-amber-500"   : "text-red-500";
                        return (
                          <div key={f.key} className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 flex items-center gap-1">
                              {f.label}
                              {!val.trim() && <span className="text-orange-400 text-xs">●</span>}
                              {fieldPct !== null && (
                                <span className={`ml-auto text-[9px] font-bold ${fieldColor}`}>{fieldPct}%</span>
                              )}
                            </label>
                            <input
                              type="text"
                              value={val}
                              disabled={row.status === "saved"}
                              placeholder="—"
                              onChange={(e) => updateField(row.id, f.key, e.target.value)}
                              className={`text-sm py-1 bg-transparent border-b transition-colors focus:outline-none placeholder:text-slate-300
                                ${row.status === "saved"
                                  ? "border-transparent text-slate-400 cursor-default"
                                  : "border-slate-200 hover:border-slate-400 focus:border-indigo-500 text-slate-800"
                                }`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {row.status === "saved" && (
                    <p className="mt-3 text-xs text-emerald-600 font-semibold flex items-center gap-1.5">
                      ✓ Saved to Firestore · Source: {row.source}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Footer stats */}
            <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
              <div className="flex gap-3">
                {rows.filter((r) => r.source === "firebase").length > 0 && (
                  <span>🔥 {rows.filter((r) => r.source === "firebase").length} from Firebase</span>
                )}
                {rows.filter((r) => r.source === "openfoodfacts").length > 0 && (
                  <span>🌍 {rows.filter((r) => r.source === "openfoodfacts").length} from Open Food Facts</span>
                )}
                {rows.filter((r) => r.source === "ocr").length > 0 && (
                  <span>🔤 {rows.filter((r) => r.source === "ocr").length} via OCR</span>
                )}
              </div>
              <span className="font-medium text-slate-500">{savedRows.length} / {rows.length} saved</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
