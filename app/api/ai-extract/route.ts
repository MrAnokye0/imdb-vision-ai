import { NextResponse } from "next/server";

// Proxy to local Python extraction backend (PaddleOCR + pyzbar + rule-based engine)
// This keeps the frontend unchanged while delegating heavy extraction to the backend service.

const BACKEND_URL = process.env.EXTRACTION_BACKEND_URL ?? "http://localhost:8000/extract";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    // forward payload to backend
    const resp = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images: body.images ?? [], ocrText: body.ocrText ?? "" }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json({ ok: false, error: `Backend error: ${resp.status}`, rawText: text }, { status: 502 });
    }

    const json = await resp.json();

    // Normalize backend response keys to the old AI route contract
    // Expecting backend to return: { product: {...}, field_confidences: {...}, completeness_score, missing_fields, sources }
    const payload: Record<string, unknown> = {};
    if (json.product) {
      Object.assign(payload, json.product);
    }
    // map field confidences to fieldConfidenceScores
    if (json.field_confidences) {
      // @ts-ignore
      payload.fieldConfidenceScores = json.field_confidences;
    }

    return NextResponse.json({ ok: true, payload, rawText: JSON.stringify(json) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
