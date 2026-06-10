import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

function extractJsonBlock(text: string): string {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (jsonMatch) return jsonMatch[1].trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1).trim();
  }
  return text.trim();
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "GEMINI_API_KEY is not set" }, { status: 500 });
  }

  const body = await request.json();
  const ocrText = String(body.ocrText ?? "").trim();
  const images = Array.isArray(body.images) ? body.images : [];

  if (!ocrText && images.length === 0) {
    return NextResponse.json({ ok: false, error: "Missing ocrText or images payload" }, { status: 400 });
  }

  const prompt = `You are an expert retail product metadata extractor. Use the OCR text and product image(s) to extract clean retail metadata.

Extract the following 10 IMDB fields exactly as JSON:
- barcode
- categoryType
- segmentType
- manufacturer
- brand
- productName
- weightUnit
- packagingType
- countryOfOrigin
- marketingMessage

Also return a fieldConfidenceScores object with confidence values between 0.0 and 1.0 for each field if possible.

Return only a valid JSON object with these fields. Use empty string values when a field cannot be determined. Do not add any explanation, markdown fences, or extra content.

OCR text input:
${ocrText}
`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const contentParts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = [];

    for (const img of images) {
      if (img?.data && img?.mimeType) {
        contentParts.push({ inlineData: { data: img.data, mimeType: img.mimeType } });
      }
    }

    contentParts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: contentParts,
        },
      ],
    });

    const raw = response.text ?? "";
    const jsonText = extractJsonBlock(raw);
    let payload: Record<string, unknown> = {};

    try {
      payload = JSON.parse(jsonText);
    } catch {
      return NextResponse.json({ ok: false, error: "AI response was not valid JSON", rawText: raw }, { status: 500 });
    }

    return NextResponse.json({ ok: true, payload, rawText: raw });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
