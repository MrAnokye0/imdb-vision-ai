import UploadZone from "@/src/components/UploadZone";

const PIPELINE = [
  { icon: "📊", title: "ZXing Barcode",    desc: "Scans all images in parallel"       },
  { icon: "🔥", title: "Firebase Cache",   desc: "Instant lookup by barcode"          },
  { icon: "🌍", title: "Open Food Facts",  desc: "3 M+ global products"               },
  { icon: "🤖", title: "PaddleOCR + AI",   desc: "Multi-image text extraction"        },
  { icon: "👁️", title: "AWS Rekognition", desc: "Visual category classification"     },
  { icon: "🔀", title: "Smart Merge",      desc: "Source-weighted field prioritisation"},
  { icon: "✅", title: "Validation",       desc: "Per-field confidence scoring"        },
  { icon: "📥", title: "Export",           desc: "Excel · CSV · Firestore"             },
];

const FIELDS = [
  { n: "01", label: "Barcode"          },
  { n: "02", label: "Category Type"   },
  { n: "03", label: "Segment Type"    },
  { n: "04", label: "Manufacturer"    },
  { n: "05", label: "Brand"           },
  { n: "06", label: "Product Name"    },
  { n: "07", label: "Weight & Unit"   },
  { n: "08", label: "Packaging Type"  },
  { n: "09", label: "Country of Origin"},
  { n: "10", label: "Marketing Message"},
];

export default function UploadPage() {
  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 md:px-6 py-6 sm:py-8 space-y-5 sm:space-y-7">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-indigo-600 to-violet-600 rounded-2xl px-4 sm:px-6 py-4 sm:py-6 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3 sm:gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 sm:gap-3 mb-1.5 sm:mb-2">
              <div className="w-8 sm:w-10 h-8 sm:h-10 bg-white/20 rounded-xl flex items-center justify-center text-lg sm:text-xl">📦</div>
              <h1 className="text-lg sm:text-xl font-extrabold tracking-tight">Product Intelligence Engine</h1>
            </div>
            <p className="text-indigo-200 text-xs sm:text-sm max-w-lg leading-relaxed">
              Capture product images guided by label type. The engine runs PaddleOCR,
              ZXing and AWS Rekognition concurrently to resolve all 10 IMDB attributes
              in under 10 seconds.
            </p>
          </div>
          <div className="flex flex-col gap-1 text-right text-[10px] sm:text-xs text-indigo-200 shrink-0">
            <span className="font-semibold text-white text-xs">10 IMDB Attributes</span>
            <span>Multi-source merge</span>
            <span>Per-field confidence</span>
            <span>Excel · CSV export</span>
          </div>
        </div>
      </div>

      {/* ── Pipeline overview ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-1.5 sm:gap-2">
        {PIPELINE.map((s, i) => (
          <div key={s.title} className="bg-white border border-slate-200 rounded-xl p-2 sm:p-3 flex flex-col gap-1 hover:border-indigo-300 hover:shadow-sm transition-all group">
            <div className="flex items-center gap-1.5">
              <div className="w-6 sm:w-7 h-6 sm:h-7 bg-indigo-50 group-hover:bg-indigo-100 rounded-lg flex items-center justify-center text-xs sm:text-sm shrink-0 transition-colors">
                {s.icon}
              </div>
              <span className="text-[8px] sm:text-[10px] text-slate-300 font-bold">0{i + 1}</span>
            </div>
            <p className="text-[10px] sm:text-[11px] font-bold text-slate-700 leading-tight">{s.title}</p>
            <p className="text-[9px] sm:text-[10px] text-slate-400 leading-tight hidden sm:block">{s.desc}</p>
          </div>
        ))}
      </div>

      {/* ── IMDB attribute chips ───────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5 sm:gap-2">
        {FIELDS.map((f) => (
          <span key={f.n} className="inline-flex items-center gap-1.5 bg-white border border-slate-200 text-slate-600 text-[10px] sm:text-xs font-semibold px-2 sm:px-3 py-1 sm:py-1.5 rounded-full shadow-sm">
            <span className="w-3.5 sm:w-4 h-3.5 sm:h-4 bg-indigo-600 text-white text-[8px] sm:text-[9px] font-black rounded-full flex items-center justify-center shrink-0">{f.n}</span>
            <span className="hidden sm:inline">{f.label}</span>
            <span className="inline sm:hidden text-[9px]">{f.label.split(' ')[0]}</span>
          </span>
        ))}
      </div>

      {/* ── Main upload zone ───────────────────────────────────────────── */}
      <UploadZone />
    </div>
  );
}
