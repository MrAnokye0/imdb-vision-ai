import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap", // Prevents preload warning
});

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
    <html lang="en" className={geist.variable} data-scroll-behavior="smooth">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="min-h-screen flex flex-col bg-slate-100 text-slate-900 antialiased">

        {/* ── Top navigation ─────────────────────────────────────────────── */}
        <header className="sticky top-0 z-50 liquid-nav border-b border-slate-200/70 shadow-lg">
          <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-2.5 sm:py-3 h-auto flex flex-col gap-2.5 sm:gap-3 sm:flex-row sm:items-center sm:justify-between relative">

            {/* Brand */}
            <Link href="/" className="flex items-center gap-2 sm:gap-2.5 font-bold text-slate-900 hover:opacity-80 transition-opacity shrink-0">
              <div className="w-7 sm:w-8 h-7 sm:h-8 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-lg flex items-center justify-center text-white text-xs font-black shadow-sm">
                AI
              </div>
              <span className="text-xs sm:text-sm font-extrabold tracking-tight hidden sm:block">Product Intelligence Platform</span>
              <span className="text-xs sm:text-sm font-extrabold tracking-tight sm:hidden">PIP</span>
            </Link>

            {/* Pipeline hint — desktop only */}
            <div className="hidden lg:flex items-center gap-0.5 text-[9px] text-slate-400">
              {["Barcode", "→", "Firebase", "→", "Open Food Facts", "→", "OCR", "→", "Export"].map((s, i) => (
                <span key={i} className={s === "→" ? "text-slate-300" : "bg-slate-100 px-1 sm:px-1.5 py-0.5 rounded text-slate-500 font-medium"}>
                  {s}
                </span>
              ))}
            </div>

            {/* Nav links — responsive */}
            <nav className="flex flex-wrap items-center justify-start sm:justify-center gap-1 sm:gap-2 overflow-x-auto pb-0.5 no-scrollbar w-full sm:w-auto">
              {NAV_LINKS.slice(1).map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="liquid-nav-link text-xs sm:text-sm whitespace-nowrap"
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="/upload"
                className="ml-1 sm:ml-2 liquid-nav-cta text-xs sm:text-sm whitespace-nowrap"
              >
                Start →
              </Link>
            </nav>
          </div>
        </header>

        <main className="flex-1 w-full overflow-x-hidden">{children}</main>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <footer className="border-t border-slate-200 bg-white">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row items-center justify-between flex-wrap gap-2 text-[11px] sm:text-xs text-slate-400">
            <span className="text-center sm:text-left w-full sm:w-auto">Product Intelligence Platform · AI-Driven IMDB Auto-Fill</span>
            <div className="flex gap-3 sm:gap-4 justify-center sm:justify-end w-full sm:w-auto">
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
