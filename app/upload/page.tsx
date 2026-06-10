import UploadZone from "@/src/components/UploadZone";

const PIPELINE = [
  { step: "01", icon: "📸", title: "Image Upload",          desc: "Drag, drop, or capture via mobile camera" },
  { step: "02", icon: "📊", title: "Barcode Detection",     desc: "ZXing scans the barcode first" },
  { step: "03", icon: "🔥", title: "Firebase Lookup",       desc: "Checks local cache instantly" },
  { step: "04", icon: "🌍", title: "Open Food Facts",       desc: "3M+ global products database" },
  { step: "05", icon: "🤖", title: "AI Inference",          desc: "LLM interprets label text and standardizes fields" },
  { step: "06", icon: "🔤", title: "OCR Fallback",          desc: "Tesseract + regex extraction" },
  { step: "07", icon: "✏️", title: "Human Review",          desc: "Edit any field before saving" },
  { step: "08", icon: "💾", title: "Save & Learn",          desc: "Corrections improve future scans" },
  { step: "09", icon: "📥", title: "Export IMDB Master",    desc: "One Excel file, all records" },
];

const COLUMNS = [
  "Barcode", "Category Type", "Segment Type", "Manufacturer",
  "Brand", "Product Name", "Weight & Unit", "Packaging Type",
  "Country of Origin", "Marketing Message",
];

export default function UploadPage() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-xl flex items-center justify-center text-white text-xl shadow-sm">
            📦
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Product Resolution Engine</h1>
            <p className="text-slate-500 text-sm">
              Upload product images — the engine resolves all 10 IMDB attributes through a 9-stage AI + OCR pipeline.
            </p>
          </div>
        </div>
      </div>

      {/* Pipeline steps */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {PIPELINE.map((s) => (
          <div key={s.step} className="bg-white border border-slate-200 rounded-xl p-3 flex items-start gap-3 hover:border-indigo-300 hover:shadow-sm transition-all group">
            <div className="w-8 h-8 bg-indigo-50 group-hover:bg-indigo-100 rounded-lg flex items-center justify-center text-base shrink-0 transition-colors">
              {s.icon}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-700 truncate">{s.title}</p>
              <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* IMDB column chips */}
      <div className="flex flex-wrap gap-2">
        {COLUMNS.map((col, i) => (
          <span key={col} className="inline-flex items-center gap-1.5 bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-semibold px-2.5 py-1 rounded-full">
            <span className="w-4 h-4 bg-indigo-600 text-white text-[9px] font-black rounded-full flex items-center justify-center shrink-0">{i + 1}</span>
            {col}
          </span>
        ))}
      </div>

      {/* Main upload zone */}
      <UploadZone />
    </div>
  );
}
