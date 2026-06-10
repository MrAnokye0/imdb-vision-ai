import { NextRequest, NextResponse } from "next/server";

// Proxy single-image extract requests to the Python backend
// This replaces Gemini-based extraction with the local rule-based service.

const BACKEND_URL = process.env.EXTRACTION_BACKEND_URL ?? "http://localhost:8000/extract";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.image || !body.mimeType) {
      return NextResponse.json({ success: true, data: {} });
    }

    // Forward as images array with one element
    const payload = { images: [body.image] };
    const resp = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json({ success: false, error: `Backend error ${resp.status}`, data: {} });
    }

    const json = await resp.json();
    // Adapt backend product to previous contract
    const product = json.product ?? {};
    return NextResponse.json({ success: true, data: product });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Extract API proxy error]:", msg);
    return NextResponse.json({ success: false, error: msg, data: {} });
  }
}
