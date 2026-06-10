import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Product Intelligence Platform — IMDB Auto-Fill",
  description:
    "Enterprise-grade AI-driven image-to-IMDB data extraction. Barcode scan → Firebase → Open Food Facts → OCR fallback.",
};

const NAV_LINKS = [
  { href: "/",          label: "Home"      },
  { href: "/upload",    label: "Upload"    },
  { href: "/review",    label: "Review"    },
  { href: "/database",  label: "Database"  },
  { href: "/analytics", label: "Analytics" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={geist.variable}>
      <body className="min-h-screen flex flex-col bg-slate-100 text-slate-900 antialiased">

        {/* ── Top navigation ─────────────────────────────────────────────── */}
        <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-slate-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">

            {/* Brand */}
            <Link href="/" className="flex items-center gap-2.5 font-bold text-slate-900 hover:opacity-80 transition-opacity shrink-0">
              <div className="w-8 h-8 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-lg flex items-center justify-center text-white text-xs font-black shadow-sm">
                AI
              </div>
              <span className="text-sm font-extrabold tracking-tight hidden sm:block">Product Intelligence Platform</span>
              <span className="text-sm font-extrabold tracking-tight sm:hidden">PIP</span>
            </Link>

            {/* Pipeline hint — desktop only */}
            <div className="hidden lg:flex items-center gap-1 text-[10px] text-slate-400">
              {["Barcode", "→", "Firebase", "→", "Open Food Facts", "→", "OCR", "→", "Export"].map((s, i) => (
                <span key={i} className={s === "→" ? "text-slate-300" : "bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 font-medium"}>
                  {s}
                </span>
              ))}
            </div>

            {/* Nav links */}
            <nav className="flex items-center gap-0.5">
              {NAV_LINKS.slice(1).map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-xs sm:text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 px-2 sm:px-3 py-2 rounded-lg transition-colors"
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="/upload"
                className="ml-2 text-xs sm:text-sm font-bold bg-indigo-600 text-white px-3 sm:px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
              >
                Start →
              </Link>
            </nav>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <footer className="border-t border-slate-200 bg-white">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between flex-wrap gap-2 text-xs text-slate-400">
            <span>Product Intelligence Platform · AI-Driven IMDB Auto-Fill</span>
            <div className="flex gap-4">
              {NAV_LINKS.slice(1).map((l) => (
                <Link key={l.href} href={l.href} className="hover:text-slate-600 transition-colors">
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
