"use client";

import {
  useState, useCallback, useRef, useEffect, type ChangeEvent, type DragEvent,
} from "react";
import Image from "next/image";
import { extractFromImage, extractFromImages, type ExtractionResult } from "@/src/lib/extract-client";
import { saveProduct, findDuplicates, saveCorrection, type DuplicateMatch } from "@/src/lib/firestore";
import { exportCSV, exportExcel } from "@/src/lib/export";
import CameraCapture from "@/src/components/CameraCapture";
import KnowledgeGraph from "@/src/components/KnowledgeGraph";
import type { ProductRecord, PipelineStep, ExtractionSource } from "@/src/types/product";
import type { ValidationReport } from "@/src/lib/validation";

// ─── Image label types ────────────────────────────────────────────────────────

export type ImageLabel = "Front" | "Back" | "Barcode" | "Ingredients" | "Other";

const CAPTURE_STEPS: Array<{
  label: ImageLabel;
  icon: string;
  color: string;
  border: string;
  bg: string;
  hint: string;
  priority: string;
  required: boolean;
}> = [
  { label: "Front",       icon: "🏷️", color: "text-indigo-700",  border: "border-indigo-300",  bg: "bg-indigo-50",  hint: "Main product face",         priority: "Brand · Product Name",                  required: true  },
  { label: "Back",        icon: "🔄", color: "text-slate-700",   border: "border-slate-300",   bg: "bg-slate-50",   hint: "Back panel",               priority: "Manufacturer · Country",               required: false },
  { label: "Barcode",     icon: "📊", color: "text-amber-700",   border: "border-amber-300",   bg: "bg-amber-50",   hint: "Barcode / QR code",        priority: "Barcode (enables instant lookup)",      required: true  },
  { label: "Ingredients", icon: "🧪", color: "text-emerald-700", border: "border-emerald-300", bg: "bg-emerald-50", hint: "Ingredients / nutrition",   priority: "Category · Segment · Weight",           required: false },
];

const LABEL_META: Record<ImageLabel, { icon: string; color: string }> = {
  Front:       { icon: "🏷️", color: "bg-indigo-100  text-indigo-700  border-indigo-200"  },
  Back:        { icon: "🔄", color: "bg-slate-100   text-slate-700   border-slate-200"   },
  Barcode:     { icon: "📊", color: "bg-amber-100   text-amber-700   border-amber-200"   },
  Ingredients: { icon: "🧪", color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  Other:       { icon: "📷", color: "bg-violet-100  text-violet-700  border-violet-200"  },
};

// ─── Internal types ───────────────────────────────────────────────────────────

interface SessionImage {
  id: string;
  file: File;
  url: string;
  label: ImageLabel;
}

type RowStatus = "processing" | "review" | "ready" | "duplicate" | "saved" | "error";

interface StagedRow {
  id: string;
  fileName: string;
  previewUrl: string;
  previewUrls?: string[];
  preprocessedUrl?: string;
  imageDataUrl?: string;       // stable data URL for Firebase Storage upload
  status: RowStatus;
  progress: string;
  product: ProductRecord;
  source: ExtractionSource;
  steps: PipelineStep[];
  validation?: ValidationReport;
  showGraph: boolean;
  errorMsg?: string;
  timingMs?: number;
  telemetry?: any;
}

interface DuplicateAlert {
  rowId: string;
  fileName: string;
  previewUrl: string;
  product: ProductRecord;
  duplicates: DuplicateMatch[];
}

const IMDB_FIELDS: { key: keyof ProductRecord; label: string; icon: string }[] = [
  { key: "barcode",          label: "Barcode",           icon: "📊" },
  { key: "categoryType",     label: "Category Type",     icon: "🏷️" },
  { key: "segmentType",      label: "Segment Type",      icon: "📂" },
  { key: "manufacturer",     label: "Manufacturer",      icon: "🏭" },
  { key: "brand",            label: "Brand",             icon: "⭐" },
  { key: "productName",      label: "Product Name",      icon: "📝" },
  { key: "weightUnit",       label: "Weight & Unit",     icon: "⚖️" },
  { key: "packagingType",    label: "Packaging Type",    icon: "📦" },
  { key: "countryOfOrigin",  label: "Country of Origin", icon: "🌍" },
  { key: "marketingMessage", label: "Marketing Message", icon: "📣" },
];

function emptyProduct(): ProductRecord {
  return {
    barcode: "", categoryType: "", segmentType: "", manufacturer: "",
    brand: "", productName: "", weightUnit: "", packagingType: "",
    countryOfOrigin: "", marketingMessage: "", confidenceScore: 0,
  };
}

// ─── Micro components ─────────────────────────────────────────────────────────

function StatusPill({ status }: { status: RowStatus }) {
  const map: Record<RowStatus, { cls: string; label: string }> = {
    processing: { cls: "bg-indigo-100 text-indigo-700",   label: "⏳ Processing"   },
    review:     { cls: "bg-orange-100 text-orange-700",   label: "⚠ Needs Review" },
    ready:      { cls: "bg-slate-100  text-slate-600",    label: "✎ Ready"        },
    duplicate:  { cls: "bg-amber-100  text-amber-800",    label: "🔁 Duplicate"   },
    saved:      { cls: "bg-emerald-100 text-emerald-700", label: "✓ Saved"        },
    error:      { cls: "bg-red-100    text-red-600",      label: "✗ Error"        },
  };
  const { cls, label } = map[status];
  return <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${cls}`}>{label}</span>;
}

function ConfBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const cls = pct >= 80 ? "text-emerald-600 bg-emerald-50 border-emerald-200"
            : pct >= 60 ? "text-amber-600   bg-amber-50   border-amber-200"
            :             "text-red-600     bg-red-50     border-red-200";
  return <span className={`text-xs font-bold border px-2 py-0.5 rounded-full ${cls}`}>{pct}%</span>;
}

function FieldBar({ conf }: { conf: number | null }) {
  if (conf === null) return null;
  const pct = Math.round(conf * 100);
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-1.5 mt-0.5">
      <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[9px] font-bold tabular-nums ${
        pct >= 80 ? "text-emerald-600" : pct >= 60 ? "text-amber-500" : "text-red-500"
      }`}>{pct}%</span>
    </div>
  );
}

// ─── Image Adjuster Modal ────────────────────────────────────────────────────

interface ImageAdjusterModalProps {
  image: SessionImage;
  onSave: (adjustedFile: File) => void;
  onCancel: () => void;
}

function ImageAdjusterModal({ image, onSave, onCancel }: ImageAdjusterModalProps) {
  const [brightness, setBrightness] = useState(0); // -100 to 100
  const [contrast, setContrast] = useState(1.0); // 0.5 to 2.5
  const [rotation, setRotation] = useState(0); // 0, 90, 180, 270
  const [sharpen, setSharpen] = useState(false);
  const [resizeDim, setResizeDim] = useState("1200"); // "800" | "1200" | "1600" | "original"
  const [isProcessing, setIsProcessing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let active = true;
    const img = new window.Image();
    img.src = image.url;
    img.onload = () => {
      if (!active) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const origW = img.naturalWidth;
      const origH = img.naturalHeight;
      let maxDim = 1200;
      if (resizeDim === "800") maxDim = 800;
      else if (resizeDim === "1600") maxDim = 1600;
      else if (resizeDim === "original") maxDim = Math.max(origW, origH);

      const scale = Math.min(1, maxDim / Math.max(origW, origH));
      const w = Math.round(origW * scale);
      const h = Math.round(origH * scale);

      if (rotation === 90 || rotation === 270) {
        canvas.width = h;
        canvas.height = w;
      } else {
        canvas.width = w;
        canvas.height = h;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Contrast + Brightness
      for (let i = 0; i < data.length; i += 4) {
        data[i]     = Math.min(255, Math.max(0, (data[i]     - 128) * contrast + 128 + brightness));
        data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] - 128) * contrast + 128 + brightness));
        data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] - 128) * contrast + 128 + brightness));
      }

      // Sharpen (laplacian kernel approximation)
      if (sharpen) {
        const temp = new Uint8ClampedArray(data);
        const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
        const width = canvas.width;
        const height = canvas.height;

        for (let y = 1; y < height - 1; y++) {
          for (let x = 1; x < width - 1; x++) {
            for (let c = 0; c < 3; c++) {
              let sum = 0;
              let kIdx = 0;
              for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                  const pIdx = ((y + ky) * width + (x + kx)) * 4 + c;
                  sum += temp[pIdx] * kernel[kIdx++];
                }
              }
              const idx = (y * width + x) * 4 + c;
              data[idx] = Math.min(255, Math.max(0, sum));
            }
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);
    };
    return () => { active = false; };
  }, [image.url, brightness, contrast, rotation, sharpen, resizeDim]);

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsProcessing(true);
    canvas.toBlob((blob) => {
      setIsProcessing(false);
      if (blob) {
        const file = new File([blob], image.file.name, { type: "image/jpeg" });
        onSave(file);
      }
    }, "image/jpeg", 0.92);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white border border-slate-200 shadow-2xl rounded-2xl max-w-3xl w-full overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-bold text-slate-800 text-sm">Image Adjustment Console · {image.label}</h3>
            <p className="text-xs text-slate-400 mt-0.5">Apply brightness, contrast, rotation, sharpening, and resizing filters</p>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 font-semibold text-lg">✕</button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          {/* Canvas Preview */}
          <div className="flex flex-col items-center justify-center border border-slate-100 rounded-xl p-4 bg-slate-50/50 h-[40vh]">
            <canvas ref={canvasRef} className="max-h-full max-w-full object-contain rounded border shadow-sm bg-white" />
          </div>

          {/* Controls */}
          <div className="space-y-4">
            {/* Brightness */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-bold text-slate-500">
                <span>Brightness ({brightness > 0 ? `+${brightness}` : brightness})</span>
              </div>
              <input
                type="range"
                min="-100"
                max="100"
                value={brightness}
                onChange={(e) => setBrightness(Number(e.target.value))}
                className="w-full h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
            </div>

            {/* Contrast */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-bold text-slate-500">
                <span>Contrast ({contrast.toFixed(1)}x)</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.5"
                step="0.1"
                value={contrast}
                onChange={(e) => setContrast(Number(e.target.value))}
                className="w-full h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
            </div>

            {/* Rotation & Sharpen */}
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="text-xs font-bold py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors flex items-center justify-center gap-1.5"
              >
                <span>🔄</span> Rotate 90°
              </button>
              <label className="flex items-center justify-center gap-2 cursor-pointer bg-slate-50 border border-slate-200 rounded-xl py-2 hover:bg-slate-100 transition-colors select-none">
                <input
                  type="checkbox"
                  checked={sharpen}
                  onChange={(e) => setSharpen(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                />
                <span className="text-xs font-bold text-slate-600">✨ Sharpen</span>
              </label>
            </div>

            {/* Resize Option */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 block">📐 Scale Max Dimension</label>
              <select
                value={resizeDim}
                onChange={(e) => setResizeDim(e.target.value)}
                className="w-full text-xs font-semibold px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-600"
              >
                <option value="800">Compact (Max 800px)</option>
                <option value="1200">Standard (Max 1200px)</option>
                <option value="1600">Ultra (Max 1600px)</option>
                <option value="original">Original Size</option>
              </select>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 bg-slate-50 px-6 py-4 flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-xs font-bold text-slate-500 border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isProcessing}
            className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 transition-colors shadow-sm"
          >
            {isProcessing ? "Applying..." : "Apply Adjustments"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Guided capture wizard ────────────────────────────────────────────────────

function GuidedCapture({
  captured,
  onCapture,
  onRemove,
}: {
  captured: Partial<Record<ImageLabel, SessionImage>>;
  onCapture: (label: ImageLabel, file: File) => void;
  onRemove: (label: ImageLabel) => void;
}) {
  const [cameraFor, setCameraFor]   = useState<ImageLabel | null>(null);
  const [editImage, setEditImage]   = useState<SessionImage | null>(null);
  const fileRefs = useRef<Record<ImageLabel, HTMLInputElement | null>>({
    Front: null, Back: null, Barcode: null, Ingredients: null, Other: null,
  });

  const doneCount   = CAPTURE_STEPS.filter((s) => captured[s.label]).length;
  const requiredDone = CAPTURE_STEPS.filter((s) => s.required).every((s) => captured[s.label]);

  return (
    <>
      {cameraFor && (
        <CameraCapture
          title={`Capture ${cameraFor}`}
          detail={CAPTURE_STEPS.find((s) => s.label === cameraFor)?.hint ?? ""}
          onCapture={(blob) => {
            const file = new File([blob], `capture-${cameraFor}-${Date.now()}.jpg`, { type: "image/jpeg" });
            onCapture(cameraFor!, file);
            setCameraFor(null);
          }}
          onCancel={() => setCameraFor(null)}
        />
      )}

      {editImage && (
        <ImageAdjusterModal
          image={editImage}
          onCancel={() => setEditImage(null)}
          onSave={(file) => {
            onCapture(editImage.label, file);
            setEditImage(null);
          }}
        />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {CAPTURE_STEPS.map((step) => {
          const img = captured[step.label];
          return (
            <div
              key={step.label}
              className={`relative rounded-2xl border-2 overflow-hidden transition-all ${
                img
                  ? "border-emerald-400 shadow-sm"
                  : step.required
                    ? `${step.border} border-dashed`
                    : "border-slate-200 border-dashed"
              }`}
            >
              {/* Step header */}
              <div className={`px-3 py-2 flex items-center gap-2 ${img ? "bg-emerald-50" : step.bg}`}>
                <span className="text-base">{step.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-bold truncate ${step.color}`}>
                    {step.label}
                    {step.required && !img && <span className="ml-1 text-red-400">*</span>}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">{step.priority}</p>
                </div>
                {img && (
                  <button
                    onClick={() => onRemove(step.label)}
                    className="w-5 h-5 rounded-full bg-red-100 text-red-500 text-xs flex items-center justify-center hover:bg-red-200 transition-colors shrink-0"
                  >✕</button>
                )}
              </div>

              {/* Preview or empty state */}
              {img ? (
                <div className="h-28 flex items-center justify-center overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={step.label} className="max-h-28 max-w-full object-contain bg-white" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                </div>
              ) : (
                <div className="h-28 flex flex-col items-center justify-center gap-2 px-2">
                  <p className="text-xs text-slate-400 text-center leading-tight">{step.hint}</p>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setCameraFor(step.label)}
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg ${step.bg} ${step.color} border ${step.border} hover:opacity-80 transition-opacity`}
                    >
                      📷 Camera
                    </button>
                    <button
                      onClick={() => fileRefs.current[step.label]?.click()}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
                    >
                      📁 File
                    </button>
                  </div>
                </div>
              )}

              {/* Action buttons when captured */}
              {img && (
                <div className="px-2 pb-2 pt-1 flex flex-col gap-1">
                  <div className="flex gap-1">
                    <button
                      onClick={() => setCameraFor(step.label)}
                      className="flex-1 text-[10px] font-semibold py-1 rounded-md bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
                    >
                      🔄 Retake
                    </button>
                    <button
                      onClick={() => fileRefs.current[step.label]?.click()}
                      className="flex-1 text-[10px] font-semibold py-1 rounded-md bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
                    >
                      📁 Replace
                    </button>
                  </div>
                  <button
                    onClick={() => setEditImage(img)}
                    className="w-full text-[10px] font-bold py-1 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 transition-colors flex items-center justify-center gap-1"
                  >
                    🎨 Adjust Image
                  </button>
                </div>
              )}

              <input
                ref={(el) => { fileRefs.current[step.label] = el; }}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onCapture(step.label, file);
                  e.target.value = "";
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-3 mt-3">
        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 rounded-full transition-all duration-500"
            style={{ width: `${(doneCount / CAPTURE_STEPS.length) * 100}%` }}
          />
        </div>
        <span className="text-xs text-slate-500 font-medium shrink-0">{doneCount}/{CAPTURE_STEPS.length} captured</span>
      </div>

      {!requiredDone && doneCount > 0 && (
        <p className="text-xs text-amber-600 mt-1">
          ⚠ Front and Barcode images are required for best results.
        </p>
      )}
    </>
  );
}

// ─── Duplicate modal ──────────────────────────────────────────────────────────

function DuplicateModal({
  alerts, onKeep, onRemove, onKeepAll, onRemoveAll, onMerge,
}: {
  alerts: DuplicateAlert[];
  onKeep: (id: string) => void;
  onRemove: (id: string) => void;
  onKeepAll: () => void;
  onRemoveAll: () => void;
  onMerge: (rowId: string, existingId: string, mergedProduct: ProductRecord) => void;
}) {
  const cur = alerts[0];
  const primaryDup = cur?.duplicates[0]?.product;

  // Hooks MUST be called before any conditional return
  const [merged, setMerged] = useState<ProductRecord>(() => {
    if (!cur) return {
      barcode: "", categoryType: "", segmentType: "", manufacturer: "",
      brand: "", productName: "", weightUnit: "", packagingType: "",
      countryOfOrigin: "", marketingMessage: "", confidenceScore: 0,
    };
    if (primaryDup) {
      return {
        barcode:          cur.product.barcode || primaryDup.barcode || "",
        categoryType:     cur.product.categoryType || primaryDup.categoryType || "",
        segmentType:      cur.product.segmentType || primaryDup.segmentType || "",
        manufacturer:     cur.product.manufacturer || primaryDup.manufacturer || "",
        brand:            cur.product.brand || primaryDup.brand || "",
        productName:      cur.product.productName || primaryDup.productName || "",
        weightUnit:       cur.product.weightUnit || primaryDup.weightUnit || "",
        packagingType:    cur.product.packagingType || primaryDup.packagingType || "",
        countryOfOrigin:  cur.product.countryOfOrigin || primaryDup.countryOfOrigin || "",
        marketingMessage: cur.product.marketingMessage || primaryDup.marketingMessage || "",
        confidenceScore:  cur.product.confidenceScore || primaryDup.confidenceScore || 0,
      };
    }
    return { ...cur.product };
  });

  useEffect(() => {
    if (!cur) return;
    if (primaryDup) {
      setMerged({
        barcode:          cur.product.barcode || primaryDup.barcode || "",
        categoryType:     cur.product.categoryType || primaryDup.categoryType || "",
        segmentType:      cur.product.segmentType || primaryDup.segmentType || "",
        manufacturer:     cur.product.manufacturer || primaryDup.manufacturer || "",
        brand:            cur.product.brand || primaryDup.brand || "",
        productName:      cur.product.productName || primaryDup.productName || "",
        weightUnit:       cur.product.weightUnit || primaryDup.weightUnit || "",
        packagingType:    cur.product.packagingType || primaryDup.packagingType || "",
        countryOfOrigin:  cur.product.countryOfOrigin || primaryDup.countryOfOrigin || "",
        marketingMessage: cur.product.marketingMessage || primaryDup.marketingMessage || "",
        confidenceScore:  cur.product.confidenceScore || primaryDup.confidenceScore || 0,
      });
    } else {
      setMerged({ ...cur.product });
    }
  }, [cur, primaryDup]);

  // Early return AFTER all hooks
  if (!alerts.length || !cur) return null;

  if (!primaryDup) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="bg-white rounded-2xl p-6 shadow-xl max-w-md w-full text-center">
          <p className="font-bold text-slate-800">Duplicate detected but database record not loaded.</p>
          <div className="mt-4 flex gap-2 justify-center">
            <button onClick={() => onRemove(cur.rowId)} className="bg-red-500 text-white px-4 py-2 rounded-xl text-sm font-semibold">Discard</button>
            <button onClick={() => onKeep(cur.rowId)} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-semibold">Keep</button>
          </div>
        </div>
      </div>
    );
  }

  const handleFieldSelect = (fieldKey: keyof ProductRecord, val: string) => {
    setMerged((prev) => ({ ...prev, [fieldKey]: val }));
  };

  const handleInputChange = (fieldKey: keyof ProductRecord, val: string) => {
    setMerged((prev) => ({ ...prev, [fieldKey]: val }));
  };

  const handleMergeSave = () => {
    onMerge(cur.rowId, primaryDup.id, merged);
  };

  const stagedPct = Math.round((cur.product.confidenceScore ?? 0) * 100);
  const existingPct = Math.round((primaryDup.confidenceScore ?? 0) * 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-4 flex items-start gap-3 shrink-0">
          <span className="text-2xl mt-0.5">🔁</span>
          <div className="flex-1">
            <p className="font-bold text-slate-900 text-lg">IMDB Duplicate Matching & Merge Console</p>
            <p className="text-xs text-amber-700 mt-0.5">
              An existing record in the database has a matching barcode or name. Review values side-by-side, select which attributes to keep, or edit the merged result below.
            </p>
          </div>
        </div>

        {/* Comparison Console */}
        <div className="overflow-y-auto flex-1 p-6 space-y-6">
          {/* Large Image Comparison */}
          <div className="grid grid-cols-2 gap-6 bg-gradient-to-b from-slate-50 to-transparent p-4 rounded-2xl border border-slate-200/50">
            {/* Staged Image */}
            <div className="flex flex-col items-center gap-3">
              <div className="relative w-64 h-64 rounded-xl overflow-hidden bg-slate-100 border-2 border-indigo-300 shadow-lg flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cur.previewUrl} alt="new" className="max-h-full max-w-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              </div>
              <div className="text-center">
                <span className="text-xs uppercase font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full border border-indigo-200">New Scan</span>
                <p className="font-semibold text-sm text-slate-900 mt-2">{cur.product.productName || cur.fileName}</p>
                <p className="text-xs text-slate-500 mt-1">Confidence: {stagedPct}%</p>
              </div>
            </div>

            {/* Database Image */}
            <div className="flex flex-col items-center gap-3">
              <div className="relative w-64 h-64 rounded-xl overflow-hidden bg-slate-100 border-2 border-emerald-300 shadow-lg flex items-center justify-center">
                {/* Use database image if available, otherwise fall back to new scan image
                    (duplicate products are the same item — showing one helps visual comparison) */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={primaryDup.imageUrl || cur.previewUrl}
                  alt="existing"
                  className="max-h-full max-w-full object-contain"
                  onError={(e) => {
                    const img = e.target as HTMLImageElement;
                    // If the primary src fails, try the fallback
                    if (img.src !== cur.previewUrl) {
                      img.src = cur.previewUrl;
                    } else {
                      img.style.display = "none";
                    }
                  }}
                />
                {!primaryDup.imageUrl && (
                  <div className="absolute bottom-2 left-0 right-0 flex justify-center">
                    <span className="text-[10px] bg-slate-700/60 text-white px-2 py-0.5 rounded-full">
                      No stored image — showing new scan
                    </span>
                  </div>
                )}
              </div>
              <div className="text-center">
                <span className="text-xs uppercase font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-200">Database</span>
                <p className="font-semibold text-sm text-slate-900 mt-2">{primaryDup.productName}</p>
                <p className="text-xs text-slate-500 mt-1">Confidence: {existingPct}%</p>
              </div>
            </div>
          </div>

          {/* Small Summary Cards */}
          <div className="grid grid-cols-2 gap-4">
            {/* Staged Summary */}
            <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-3.5 flex items-start gap-3">
              <div className="w-12 h-12 rounded-lg overflow-hidden bg-white border shrink-0 flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cur.previewUrl} alt="new" className="max-h-full max-w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[10px] uppercase font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">Staged Scan</span>
                <p className="font-bold text-sm text-slate-900 truncate mt-1">{cur.product.productName || cur.fileName}</p>
                <p className="text-[10px] text-slate-500 font-mono mt-0.5">Barcode: {cur.product.barcode || "N/A"} · Conf: {stagedPct}%</p>
              </div>
            </div>

            {/* Database Summary */}
            <div className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-3.5 flex items-start gap-3">
              <div className="w-12 h-12 rounded-lg overflow-hidden bg-white border shrink-0 flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={primaryDup.imageUrl || cur.previewUrl}
                  alt="existing"
                  className="max-h-full max-w-full object-cover"
                  onError={(e) => {
                    const img = e.target as HTMLImageElement;
                    if (img.src !== cur.previewUrl) { img.src = cur.previewUrl; }
                    else { img.style.display = "none"; }
                  }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[10px] uppercase font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">Existing Database Record</span>
                <p className="font-bold text-sm text-slate-900 truncate mt-1">{primaryDup.productName}</p>
                <p className="text-[10px] text-slate-500 font-mono mt-0.5">Barcode: {primaryDup.barcode || "N/A"} · Conf: {existingPct}%</p>
              </div>
            </div>
          </div>

          {/* Merge Grid Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50 text-xs">
            <div className="grid grid-cols-12 bg-slate-200/60 px-4 py-2.5 font-bold text-slate-700 border-b border-slate-200">
              <div className="col-span-3">Attribute</div>
              <div className="col-span-3">Staged (New Scan)</div>
              <div className="col-span-3">Database (Existing)</div>
              <div className="col-span-3">Merged Output (Editable)</div>
            </div>
            <div className="divide-y divide-slate-200 overflow-y-auto max-h-[42vh] bg-white">
              {IMDB_FIELDS.map((f) => {
                const stagedVal = (cur.product[f.key] as string) ?? "";
                const dbVal     = (primaryDup[f.key] as string) ?? "";
                const mergedVal = (merged[f.key] as string) ?? "";
                const isDiff    = stagedVal.trim().toLowerCase() !== dbVal.trim().toLowerCase();

                return (
                  <div key={f.key} className={`grid grid-cols-12 px-4 py-2.5 items-center gap-4 ${isDiff ? "bg-amber-50/20" : ""}`}>
                    {/* 1. Field Label */}
                    <div className="col-span-3 font-semibold text-slate-700 flex items-center gap-1.5 min-w-0">
                      <span>{f.icon}</span>
                      <span className="truncate">{f.label}</span>
                      {isDiff && <span className="text-[8px] bg-amber-100 text-amber-800 border border-amber-200 px-1 rounded-md shrink-0">Diff</span>}
                    </div>

                    {/* 2. Staged Option */}
                    <div
                      onClick={() => handleFieldSelect(f.key, stagedVal)}
                      className={`col-span-3 p-2 rounded-lg border cursor-pointer select-none truncate transition-colors text-[11px] ${
                        mergedVal === stagedVal && stagedVal.trim() !== ""
                          ? "bg-indigo-50 border-indigo-300 text-indigo-800 font-medium"
                          : "bg-slate-50/50 border-slate-200 text-slate-600 hover:bg-slate-100/70"
                      }`}
                      title="Click to select Staged Value"
                    >
                      {stagedVal || <span className="text-slate-300 italic">(empty)</span>}
                    </div>

                    {/* 3. Database Option */}
                    <div
                      onClick={() => handleFieldSelect(f.key, dbVal)}
                      className={`col-span-3 p-2 rounded-lg border cursor-pointer select-none truncate transition-colors text-[11px] ${
                        mergedVal === dbVal && dbVal.trim() !== ""
                          ? "bg-emerald-50 border-emerald-300 text-emerald-800 font-medium"
                          : "bg-slate-50/50 border-slate-200 text-slate-600 hover:bg-slate-100/70"
                      }`}
                      title="Click to select Database Value"
                    >
                      {dbVal || <span className="text-slate-300 italic">(empty)</span>}
                    </div>

                    {/* 4. Custom Merged Input */}
                    <div className="col-span-3">
                      <input
                        type="text"
                        value={mergedVal}
                        onChange={(e) => handleInputChange(f.key, e.target.value)}
                        className="w-full text-[11px] px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-800 font-medium"
                        placeholder="Merged output value..."
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 bg-slate-50 p-4 shrink-0 flex items-center justify-between">
          <div className="flex gap-2">
            <button onClick={() => onRemove(cur.rowId)}
              className="px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 font-semibold text-sm hover:bg-red-100 transition-colors">
              🗑 Discard Staged Scan
            </button>
            <button onClick={() => onKeep(cur.rowId)}
              className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors">
              ➕ Keep Both (Skip Merge)
            </button>
          </div>

          <div className="flex gap-2">
            {alerts.length > 1 && (
              <span className="text-xs text-slate-400 self-center font-medium mr-2">
                1 of {alerts.length} duplicates
              </span>
            )}
            <button onClick={handleMergeSave}
              className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 active:scale-95 transition-all shadow-md shadow-indigo-100 flex items-center gap-1.5">
              <span>🔀</span> Merge & Save Database
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main UploadZone ──────────────────────────────────────────────────────────

export default function UploadZone() {
  // Guided capture state
  const [captured, setCaptured]   = useState<Partial<Record<ImageLabel, SessionImage>>>({});
  const [dragOver, setDragOver]   = useState(false);

  // Staged rows
  const [rows, setRows]               = useState<StagedRow[]>([]);
  const [dupeAlerts, setDupeAlerts]   = useState<DuplicateAlert[]>([]);
  const [savingAll, setSavingAll]     = useState(false);
  const [exportingXlsx, setExportingXlsx] = useState(false);

  const dropInputRef = useRef<HTMLInputElement>(null);

  const isProcessing = rows.some((r) => r.status === "processing");
  const capturedImages = Object.values(captured).filter(Boolean) as SessionImage[];
  const pendingRows    = rows.filter((r) => ["ready", "review", "duplicate"].includes(r.status));
  const savedRows      = rows.filter((r) => r.status === "saved");
  const exportable     = rows.filter((r) => !["processing", "error"].includes(r.status)).map((r) => r.product);

  // ── Capture helpers ────────────────────────────────────────────────────────

  function captureImage(label: ImageLabel, file: File) {
    setCaptured((prev) => {
      if (prev[label]) URL.revokeObjectURL(prev[label]!.url);
      return {
        ...prev,
        [label]: { id: `${label}-${Date.now()}`, file, url: URL.createObjectURL(file), label },
      };
    });
  }

  function removeCapture(label: ImageLabel) {
    setCaptured((prev) => {
      if (prev[label]) URL.revokeObjectURL(prev[label]!.url);
      const next = { ...prev };
      delete next[label];
      return next;
    });
  }

  function clearCaptures() {
    // Revoke all blob URLs and clear state
    Object.values(captured).forEach((img) => img && URL.revokeObjectURL(img.url));
    setCaptured({});
  }

  function clearCapturesUI() {
    // Clear the UI state WITHOUT revoking blob URLs
    // Use this when extraction still needs the URLs
    setCaptured({});
  }

  // ── Drag-and-drop assigns labels by position ───────────────────────────────

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    const labelOrder: ImageLabel[] = ["Front", "Back", "Barcode", "Ingredients", "Other"];
    files.forEach((file, i) => {
      const label = labelOrder[i] ?? "Other";
      captureImage(label, file);
    });
  }

  function handleDropInput(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
    const labelOrder: ImageLabel[] = ["Front", "Back", "Barcode", "Ingredients", "Other"];
    files.forEach((file, i) => captureImage(labelOrder[i] ?? "Other", file));
    e.target.value = "";
  }

  // ── Extract session ────────────────────────────────────────────────────────

  async function extractSession() {
    if (capturedImages.length === 0) return;

    // Order: Barcode first (ZXing scan priority), then Front, Back, Ingredients, Other
    const ordered = (["Barcode", "Front", "Back", "Ingredients", "Other"] as ImageLabel[])
      .map((l) => captured[l])
      .filter(Boolean) as SessionImage[];

    const urls   = ordered.map((img) => img.url);
    const labels = ordered.map((img) => img.label);
    const name   = captured.Front?.file.name ?? captured.Barcode?.file.name ?? `product-${Date.now()}.jpg`;
    const labelSummary = labels.map((l) => `${LABEL_META[l].icon}${l}`).join(" ");

    // Convert the front/first image File → data URL NOW, before any blob revocation.
    // File objects never expire — this is the only safe time to do this.
    const previewFile = (captured.Front ?? ordered[0])?.file ?? null;
    let earlyDataUrl  = "";
    if (previewFile) {
      try {
        earlyDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload  = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(previewFile);
        });
      } catch { /* fall through — earlyDataUrl stays "" */ }
    }

    const newRow: StagedRow = {
      id:           `${Date.now()}-${Math.random()}`,
      fileName:     `${name} [${labelSummary}]`,
      previewUrl:   earlyDataUrl || captured.Front?.url || urls[0],
      previewUrls:  urls,
      imageDataUrl: earlyDataUrl || undefined,
      status:       "processing",
      progress:     "Starting extraction…",
      product:      emptyProduct(),
      source:       "ocr",
      steps:        [],
      showGraph:    false,
    };

    setRows((prev) => [...prev, newRow]);
    // Clear the UI immediately so user can start a new session,
    // but DON'T revoke the blob URLs yet — extraction still needs them.
    // Revocation happens after extraction completes in the finally block.
    setCaptured({});
    try {
      const result: ExtractionResult = urls.length > 1
        ? await extractFromImages(
            urls,
            (_msg, steps) => setRows((p) => p.map((r) => r.id === newRow.id ? { ...r, steps, progress: _msg } : r)),
            labels
          )
        : await extractFromImage(
            urls[0],
            (_msg, steps) => setRows((p) => p.map((r) => r.id === newRow.id ? { ...r, steps, progress: _msg } : r)),
            labels
          );

      const { product, source, steps, needsReview, preprocessedUrl, validation, timingMs, telemetry } = result;

      let duplicates: DuplicateMatch[] = [];
      try { duplicates = await findDuplicates(product); } catch { /* skip */ }

      const isDupe     = duplicates.length > 0;
      const rowStatus: RowStatus = isDupe ? "duplicate" : needsReview ? "review" : "ready";

      // earlyDataUrl was captured from the File before any blob revocation — always valid
      const stablePreviewUrl = earlyDataUrl || newRow.previewUrl;

      setRows((p) => p.map((r) =>
        r.id === newRow.id
          ? { ...r, status: rowStatus, progress: "", product, source, steps, validation, preprocessedUrl: stablePreviewUrl, showGraph: true, timingMs, telemetry, previewUrl: stablePreviewUrl, imageDataUrl: stablePreviewUrl }
          : r
      ));

      if (isDupe) {
        setDupeAlerts((p) => [...p, {
          rowId: newRow.id, fileName: newRow.fileName,
          previewUrl: stablePreviewUrl, product, duplicates,
        }]);
      }
    } catch (err) {
      setRows((p) => p.map((r) =>
        r.id === newRow.id
          ? { ...r, status: "error", progress: "", errorMsg: err instanceof Error ? err.message : "Extraction failed" }
          : r
      ));
    } finally {
      // Now safe to revoke — extraction has finished reading the blob URLs
      urls.forEach((u) => { try { URL.revokeObjectURL(u); } catch { /* ignore */ } });
    }
  }

  // ── Duplicate handlers ─────────────────────────────────────────────────────

  const handleMerge = useCallback(async (rowId: string, existingId: string, mergedProduct: ProductRecord) => {
    setRows((p) => p.map((r) => r.id === rowId ? { ...r, status: "processing", progress: "Merging record…" } : r));
    setDupeAlerts((p) => p.filter((a) => a.rowId !== rowId));
    try {
      // Upload the new scan's image to Storage so the merged record has a photo
      const row = rows.find((r) => r.id === rowId);
      let imageUrl = mergedProduct.imageUrl ?? "";
      if (row?.imageDataUrl && !imageUrl) {
        const { uploadProductImage } = await import("@/src/lib/firestore");
        const uploaded = await uploadProductImage(existingId, row.imageDataUrl);
        if (uploaded) imageUrl = uploaded;
      }
      await saveCorrection(existingId, { ...mergedProduct, imageUrl });
      setRows((p) => p.map((r) => r.id === rowId ? { ...r, status: "saved", product: { ...mergedProduct, imageUrl }, progress: "" } : r));
    } catch (err) {
      setRows((p) => p.map((r) =>
        r.id === rowId ? { ...r, status: "error", progress: "", errorMsg: err instanceof Error ? err.message : "Merge failed" } : r
      ));
    }
  }, []);

  const handleKeep = useCallback((id: string) => {
    setRows((p) => p.map((r) => r.id === id ? { ...r, status: "ready" } : r));
    setDupeAlerts((p) => p.filter((a) => a.rowId !== id));
  }, []);

  const handleRemove = useCallback((id: string) => {
    setRows((p) => {
      const r = p.find((x) => x.id === id);
      if (r) (r.previewUrls ?? [r.previewUrl]).forEach((u) => URL.revokeObjectURL(u));
      return p.filter((x) => x.id !== id);
    });
    setDupeAlerts((p) => p.filter((a) => a.rowId !== id));
  }, []);

  const handleKeepAll = useCallback(() => {
    setRows((p) => p.map((r) => dupeAlerts.some((a) => a.rowId === r.id) ? { ...r, status: "ready" } : r));
    setDupeAlerts([]);
  }, [dupeAlerts]);

  const handleRemoveAll = useCallback(() => {
    const ids = dupeAlerts.map((a) => a.rowId);
    setRows((p) => {
      p.filter((r) => ids.includes(r.id)).forEach((r) =>
        (r.previewUrls ?? [r.previewUrl]).forEach((u) => URL.revokeObjectURL(u))
      );
      return p.filter((r) => !ids.includes(r.id));
    });
    setDupeAlerts([]);
  }, [dupeAlerts]);

  // ── Row helpers ────────────────────────────────────────────────────────────

  function updateField(id: string, field: keyof ProductRecord, value: string) {
    setRows((p) => p.map((r) => r.id === id ? { ...r, product: { ...r.product, [field]: value } } : r));
  }

  function removeRow(id: string) {
    setRows((p) => {
      const r = p.find((x) => x.id === id);
      if (r) (r.previewUrls ?? [r.previewUrl]).forEach((u) => URL.revokeObjectURL(u));
      return p.filter((x) => x.id !== id);
    });
  }

  async function saveRow(id: string) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    setRows((p) => p.map((r) => r.id === id ? { ...r, status: "processing", progress: "Saving to Firestore…" } : r));
    try {
      await saveProduct(row.product, row.source, row.imageDataUrl);
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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <DuplicateModal
        alerts={dupeAlerts}
        onKeep={handleKeep}
        onRemove={handleRemove}
        onKeepAll={handleKeepAll}
        onRemoveAll={handleRemoveAll}
        onMerge={handleMerge}
      />

      <div className="space-y-6">

        {/* ── Guided capture card ───────────────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Guided Product Capture</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Capture each image to maximise extraction accuracy · starred fields required
              </p>
            </div>
            <div className="flex items-center gap-3">
              {capturedImages.length > 0 && (
                <button
                  onClick={clearCaptures}
                  className="text-xs font-semibold text-slate-400 hover:text-red-500 transition-colors px-2 py-1"
                >
                  Clear
                </button>
              )}
              <button
                onClick={extractSession}
                disabled={capturedImages.length === 0 || isProcessing}
                className="inline-flex items-center gap-2 text-sm font-bold bg-indigo-600 text-white px-5 py-2 rounded-xl hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 transition-colors shadow-sm"
              >
                {isProcessing ? "⏳ Processing…" : "⚡ Extract IMDB"}
              </button>
            </div>
          </div>

          <div className="p-5 space-y-4">
            <GuidedCapture
              captured={captured}
              onCapture={captureImage}
              onRemove={removeCapture}
            />
          </div>
        </div>

        {/* ── Drop zone ─────────────────────────────────────────────────── */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          className={`relative border-2 border-dashed rounded-2xl transition-all duration-200 ${
            dragOver
              ? "border-indigo-500 bg-indigo-50/80 scale-[1.01]"
              : "border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/20"
          }`}
        >
          <label className="flex flex-col items-center justify-center gap-3 py-8 cursor-pointer">
            <input ref={dropInputRef} type="file" accept="image/*" multiple onChange={handleDropInput} className="hidden" />
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-colors ${dragOver ? "bg-indigo-100" : "bg-slate-100"}`}>
              {dragOver ? "📂" : "📸"}
            </div>
            <div className="text-center">
              <p className="font-semibold text-slate-600 text-sm">
                {dragOver ? "Drop to auto-assign labels" : "Or drop images here to quick-add"}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                First file → Front · Second → Back · Third → Barcode · and so on
              </p>
            </div>
          </label>
        </div>

        {/* ── Staging area ──────────────────────────────────────────────── */}
        {rows.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">

            {/* Toolbar */}
            <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-slate-800">Results</span>
                <span className="text-xs text-slate-400">
                  {rows.length} total · {savedRows.length} saved · {pendingRows.length} pending
                </span>
                {rows.filter((r) => r.status === "review").length > 0 && (
                  <span className="text-xs text-orange-500 font-semibold bg-orange-50 px-2 py-0.5 rounded-full border border-orange-200">
                    ⚠ {rows.filter((r) => r.status === "review").length} need review
                  </span>
                )}
                {dupeAlerts.length > 0 && (
                  <span className="text-xs text-amber-600 font-semibold bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                    🔁 {dupeAlerts.length} duplicates
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={async () => { setExportingXlsx(true); await exportExcel(exportable); setExportingXlsx(false); }}
                  disabled={!exportable.length || exportingXlsx}
                  className="inline-flex items-center gap-1.5 text-xs font-bold bg-indigo-600 text-white px-3 py-2.5 rounded-xl hover:bg-indigo-700 disabled:opacity-40 transition-all shadow-sm active:scale-95"
                >
                  {exportingXlsx ? "⏳ Building…" : `📊 Export Styled Excel${exportable.length > 0 ? ` (${exportable.length})` : ""}`}
                </button>
                <button
                  onClick={() => exportCSV(exportable)}
                  disabled={!exportable.length}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold bg-white text-slate-600 border border-slate-200 px-3 py-2.5 rounded-xl hover:bg-slate-50 disabled:opacity-40 transition-colors"
                >
                  📄 Export Raw CSV
                </button>
                {pendingRows.length > 0 && (
                  <button
                    onClick={saveAll}
                    disabled={savingAll}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold bg-indigo-600 text-white px-3 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {savingAll ? "⏳ Saving…" : `💾 Save All (${pendingRows.length})`}
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
                    row.status === "duplicate" ? "bg-amber-50/30"   :
                    row.status === "review"    ? "bg-orange-50/20"  :
                    row.status === "saved"     ? "bg-emerald-50/20" :
                    row.status === "error"     ? "bg-red-50/20"     : "hover:bg-slate-50/50"
                  }`}
                >
                  {/* Row header */}
                  <div className="flex items-start gap-3">
                    {/* Thumbnail strip */}
                    <div className="flex gap-1 shrink-0">
                      {(row.previewUrls ?? [row.previewUrl]).slice(0, 3).map((url, i) => (
                        <div key={i} className="h-14 w-14 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shadow-sm flex items-center justify-center">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={row.product.imageUrl || url} alt={row.fileName} className="max-h-full max-w-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        </div>
                      ))}
                      {(row.previewUrls?.length ?? 1) > 3 && (
                        <div className="h-14 w-14 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-xs font-bold text-slate-400">
                          +{(row.previewUrls?.length ?? 1) - 3}
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs text-slate-300 font-bold">#{idx + 1}</span>
                          <span className="font-semibold text-slate-900 text-sm truncate">
                            {row.product.productName || row.fileName}
                          </span>
                          {row.product.brand && <span className="text-xs text-slate-400">· {row.product.brand}</span>}
                          {(row.previewUrls?.length ?? 1) > 1 && (
                            <span className="text-xs text-indigo-500 font-semibold bg-indigo-50 px-1.5 py-0.5 rounded-full">
                              {row.previewUrls?.length} imgs
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                          <StatusPill status={row.status} />
                          {row.status !== "processing" && <ConfBadge score={row.product.confidenceScore} />}
                          {row.timingMs && (
                            <span className="text-[10px] text-slate-400 font-medium bg-slate-100 px-2 py-0.5 rounded-full">
                              {row.timingMs < 1000 ? `${row.timingMs}ms` : `${(row.timingMs / 1000).toFixed(1)}s`}
                            </span>
                          )}

                          {row.status === "duplicate" && (
                            <button
                              onClick={() => setDupeAlerts((p) =>
                                p.find((a) => a.rowId === row.id) ? p
                                  : [...p, { rowId: row.id, fileName: row.fileName, previewUrl: (row.previewUrls ?? [row.previewUrl])[0], product: row.product, duplicates: [] }]
                              )}
                              className="text-xs font-semibold bg-amber-500 text-white px-2.5 py-1.5 rounded-lg hover:bg-amber-600 transition-colors"
                            >Resolve →</button>
                          )}

                          {["ready", "review"].includes(row.status) && (
                            <button
                              onClick={() => saveRow(row.id)}
                              className="text-xs font-semibold bg-indigo-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors"
                            >💾 Save</button>
                          )}

                          {row.status !== "processing" && row.status !== "error" && (
                            <button
                              onClick={() => setRows((p) => p.map((r) => r.id === row.id ? { ...r, showGraph: !r.showGraph } : r))}
                              className="text-xs font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2.5 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors"
                            >{row.showGraph ? "Hide" : "🔬 Details"}</button>
                          )}

                          <button
                            onClick={() => removeRow(row.id)}
                            className="text-xs font-semibold bg-red-50 text-red-500 border border-red-200 px-2 py-1.5 rounded-lg hover:bg-red-100 transition-colors"
                          >✕</button>
                        </div>
                      </div>

                      {row.status === "processing" && (
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
                          <p className="text-xs text-indigo-500 font-medium">{row.progress || "Initialising…"}</p>
                        </div>
                      )}
                      {row.status === "review" && (
                        <p className="text-xs text-orange-600 font-medium">⚠ Low confidence — review highlighted fields before saving</p>
                      )}
                      {row.status === "duplicate" && (
                        <p className="text-xs text-amber-700 font-medium">🔁 Matches existing record — click Resolve to decide</p>
                      )}
                      {row.status === "error" && (
                        <p className="text-xs text-red-500 font-medium">{row.errorMsg}</p>
                      )}
                    </div>
                  </div>

                  {/* Knowledge graph */}
                  {row.showGraph && row.status !== "processing" && row.status !== "error" && (
                    <KnowledgeGraph
                      product={row.product}
                      source={row.source}
                      steps={row.steps}
                      fileName={row.fileName}
                      previewUrl={(row.previewUrls ?? [row.previewUrl])[0]}
                      telemetry={row.telemetry}
                    />
                  )}

                  {/* IMDB fields grid with per-field confidence bars */}
                  {row.status !== "processing" && row.status !== "error" && (
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-4">
                      {IMDB_FIELDS.map((f) => {
                        const val       = (row.product[f.key] as string) ?? "";
                        const fieldConf = row.validation?.fields.find((vf) => vf.field === f.key);
                        const conf      = fieldConf ? fieldConf.confidence : null;
                        const isEmpty   = !val.trim();
                        const isLow     = conf !== null && conf < 0.80;

                        return (
                          <div
                            key={f.key}
                            className={`flex flex-col gap-0.5 rounded-lg px-2 py-1.5 transition-colors ${
                              isLow && !isEmpty ? "bg-orange-50 border border-orange-100" :
                              isEmpty           ? "bg-red-50/50 border border-red-100/60" : "bg-transparent"
                            }`}
                          >
                            <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 flex items-center gap-1">
                              <span>{f.icon}</span>
                              <span className="truncate">{f.label}</span>
                              {isEmpty && <span className="text-red-400 ml-auto shrink-0">●</span>}
                            </label>
                            <input
                              type="text"
                              value={val}
                              disabled={row.status === "saved"}
                              placeholder="—"
                              onChange={(e) => updateField(row.id, f.key, e.target.value)}
                              className={`text-sm bg-transparent border-b focus:outline-none placeholder:text-slate-300 w-full transition-colors ${
                                row.status === "saved"
                                  ? "border-transparent text-slate-400 cursor-default"
                                  : isLow
                                    ? "border-orange-300 hover:border-orange-400 focus:border-orange-500 text-slate-800"
                                    : "border-slate-200 hover:border-slate-400 focus:border-indigo-500 text-slate-800"
                              }`}
                            />
                            <FieldBar conf={conf} />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {row.status === "saved" && (
                    <p className="mt-3 text-xs text-emerald-600 font-semibold">
                      ✓ Saved to Firestore · Source: {row.source}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400 flex-wrap gap-2">
              <div className="flex gap-3 flex-wrap">
                {rows.filter((r) => r.source === "firebase").length      > 0 && <span>🔥 {rows.filter((r) => r.source === "firebase").length} Firebase</span>}
                {rows.filter((r) => r.source === "openfoodfacts").length > 0 && <span>🌍 {rows.filter((r) => r.source === "openfoodfacts").length} Open Food Facts</span>}
                {rows.filter((r) => r.source === "ocr").length           > 0 && <span>🔤 {rows.filter((r) => r.source === "ocr").length} OCR</span>}
                {rows.filter((r) => r.source === "ai").length            > 0 && <span>🤖 {rows.filter((r) => r.source === "ai").length} AI</span>}
              </div>
              <span className="font-medium text-slate-500">{savedRows.length}/{rows.length} saved</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
