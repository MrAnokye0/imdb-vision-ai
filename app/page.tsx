import Link from "next/link";

const STEPS = [
  { n: "01", icon: "📸", title: "Upload Images",  desc: "Drop one or many product photos — JPG, PNG or WebP" },
  { n: "02", icon: "🔍", title: "Auto-Extract",   desc: "Barcode + OCR fills all 10 IMDB fields instantly" },
  { n: "03", icon: "✏️", title: "Review & Edit",  desc: "Edit any field inline before committing" },
  { n: "04", icon: "📥", title: "Export",         desc: "Download CSV or Excel ready for database import" },
];

const FEATURES = [
  { icon: "🎯", title: "Confidence Scoring",   desc: "Every extraction scored 0–100%. Low scores flagged for human review." },
  { icon: "🔁", title: "Duplicate Detection",  desc: "Matches barcode + brand + weight — remove all dupes in one click." },
  { icon: "✏️", title: "Inline Editing",       desc: "Edit all 10 IMDB fields before saving. Nothing committed without approval." },
  { icon: "📤", title: "Bulk Upload",          desc: "Process many images at once — all results in one shared staging table." },
  { icon: "📊", title: "CSV & Excel Export",   desc: "One-click export with proper IMDB column headers for database import." },
  { icon: "🔥", title: "Firestore Sync",       desc: "Persist validated records for cross-session access and team sharing." },
];

const COLUMNS = [
  "Barcode", "Category Type", "Segment Type", "Manufacturer",
  "Brand", "Product Name", "Weight & Unit", "Packaging Type",
  "Country of Origin", "Marketing Message",
];

export default function Home() {
  return (
    <div className="bg-white">

      {/* ── Hero ──────────────────────────────────────────────────────────────── */}
      <section className="bg-gradient-to-b from-slate-50 to-white border-b border-slate-100">
        <div className="max-w-4xl mx-auto px-6 py-20 sm:py-24 text-center space-y-8">

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-slate-900 leading-tight tracking-tight">
            AI-Driven IMDB<br />
            <span className="text-indigo-600">Auto-Fill</span>
          </h1>

          <p className="text-slate-500 text-xl max-w-2xl mx-auto leading-relaxed">
            Upload retail product images and automatically extract all
            <strong className="text-slate-700"> 10 Item Master Database</strong> attributes.
            Review, edit, then export a database-ready file in seconds.
          </p>

          <div className="flex flex-col items-center gap-3 justify-center sm:flex-row sm:flex-wrap">
            <Link
              href="/upload"
              className="inline-flex items-center gap-2 bg-indigo-600 text-white font-bold px-6 py-4 rounded-xl text-base hover:bg-indigo-700 active:scale-95 transition-all shadow-lg shadow-indigo-200"
            >
              Start Extraction →
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 bg-white text-slate-700 font-semibold px-6 py-4 rounded-xl text-base border border-slate-300 hover:border-slate-400 hover:bg-slate-50 transition-all"
            >
              View Dashboard
            </Link>
          </div>

          {/* Trust badges */}
          <div className="flex items-center justify-center gap-6 flex-wrap pt-2">
            {["Works offline", "No API key needed", "Export CSV & Excel", "Duplicate detection"].map((b) => (
              <span key={b} className="flex items-center gap-1.5 text-sm text-slate-500">
                <svg className="w-4 h-4 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                {b}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 py-20 space-y-10">
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-extrabold text-slate-900">How it works</h2>
          <p className="text-slate-500">Four steps from image to database-ready export</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {STEPS.map((s, i) => (
            <div key={s.n} className="relative bg-white border border-slate-200 rounded-2xl p-6 space-y-4 hover:border-indigo-300 hover:shadow-md transition-all group">
              {/* Connector line */}
              {i < STEPS.length - 1 && (
                <div className="hidden sm:block absolute top-8 -right-2.5 w-5 h-px bg-slate-200 z-10" />
              )}
              <div className="flex items-center justify-between">
                <span className="w-10 h-10 rounded-xl bg-indigo-50 group-hover:bg-indigo-100 flex items-center justify-center text-xl transition-colors">
                  {s.icon}
                </span>
                <span className="text-2xl font-black text-slate-100 group-hover:text-indigo-100 transition-colors">{s.n}</span>
              </div>
              <div>
                <p className="font-bold text-slate-800">{s.title}</p>
                <p className="text-sm text-slate-500 mt-1 leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── IMDB columns ──────────────────────────────────────────────────────── */}
      <section className="bg-slate-50 border-y border-slate-100">
        <div className="max-w-5xl mx-auto px-6 py-20 space-y-10">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-extrabold text-slate-900">All 10 IMDB Columns Auto-Filled</h2>
            <p className="text-slate-500">Every attribute extracted, validated, and ready for your database</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {COLUMNS.map((col, i) => (
              <div key={col} className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 hover:border-indigo-300 hover:shadow-sm transition-all group">
                <span className="w-6 h-6 rounded-lg bg-indigo-600 text-white text-xs font-black flex items-center justify-center shrink-0 group-hover:bg-indigo-700 transition-colors">
                  {i + 1}
                </span>
                <span className="text-xs font-semibold text-slate-700">{col}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 py-20 space-y-10">
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-extrabold text-slate-900">Key Features</h2>
          <p className="text-slate-500">Powerful tools to automate your data extraction workflow</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3 hover:border-indigo-300 hover:shadow-md transition-all">
              <span className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-xl">{f.icon}</span>
              <p className="font-bold text-slate-800">{f.title}</p>
              <p className="text-sm text-slate-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="bg-indigo-600 rounded-3xl px-6 py-12 sm:px-10 sm:py-14 text-center text-white space-y-5 relative overflow-hidden">
          {/* Background glow */}
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-indigo-500 rounded-full opacity-30 blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-violet-600 rounded-full opacity-30 blur-3xl" />

          <p className="relative text-indigo-200 text-sm font-semibold uppercase tracking-widest">Ready to start?</p>
          <h2 className="relative text-3xl font-extrabold">Eliminate manual data entry today</h2>
          <p className="relative text-indigo-200 max-w-md mx-auto leading-relaxed">
            Upload your first product image and see all 10 IMDB fields filled in seconds.
          </p>
          <Link
            href="/upload"
            className="relative inline-block bg-white text-indigo-600 font-extrabold px-10 py-4 rounded-xl hover:bg-indigo-50 transition-colors text-base shadow-xl"
          >
            Start Now →
          </Link>
        </div>
      </section>

    </div>
  );
}
