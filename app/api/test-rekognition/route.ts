import { NextRequest, NextResponse } from "next/server";
import { detectLabels } from "@/src/lib/aws/rekognition";

/**
 * POST /api/test-rekognition
 *
 * Accepts a multipart/form-data upload with a single field named "image".
 * Runs AWS Rekognition detectLabels and returns the label results as JSON.
 *
 * Example response:
 * {
 *   ok: true,
 *   labels: [{ name: "Bottle", confidence: 98.4, parents: ["Container"], aliases: [] }, ...]
 * }
 */
export async function POST(req: NextRequest) {
  try {
    // ── Parse multipart form ──────────────────────────────────────────────────
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Request must be multipart/form-data" },
        { status: 400 }
      );
    }

    const file = formData.get("image");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { ok: false, error: 'Missing required field "image" (must be a file)' },
        { status: 400 }
      );
    }

    // ── Convert Blob → Buffer ─────────────────────────────────────────────────
    const arrayBuffer = await file.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    if (imageBuffer.byteLength === 0) {
      return NextResponse.json(
        { ok: false, error: "Uploaded file is empty" },
        { status: 400 }
      );
    }

    // ── Call Rekognition ──────────────────────────────────────────────────────
    const result = await detectLabels(imageBuffer);

    return NextResponse.json({
      ok: true,
      labels: result.labels,
      confidence: result.confidence,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[test-rekognition] Error:", message);

    // Surface credential/config errors clearly during development
    if (message.includes("AWS credentials not configured")) {
      return NextResponse.json(
        { ok: false, error: message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
