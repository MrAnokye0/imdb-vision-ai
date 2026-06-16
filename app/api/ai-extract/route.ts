import { NextResponse } from "next/server";
import { detectLabels } from "@/src/lib/aws/rekognition";
import { classifyFromLabels, buildCategoryHintText } from "@/src/lib/rekognition-classifier";
import { GoogleGenAI } from "@google/genai";

const BACKEND_URL        = process.env.EXTRACTION_BACKEND_URL ?? "http://localhost:8000/extract";
const BACKEND_TIMEOUT_MS = 7000;   // Python backend hard limit
const REK_TIMEOUT_MS     = 3000;   // Rekognition hard limit

function base64ToBuffer(b64: string): Buffer | null {
  try {
    const raw = b64.includes(",") ? b64.split(",")[1] : b64;
    return raw ? Buffer.from(raw, "base64") : null;
  } catch { return null; }
}

function raceTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fallback), ms))]);
}

const GEMINI_JSON_SCHEMA = {
  type: "OBJECT",
  properties: {
    barcode: {
      type: "OBJECT",
      properties: {
        value: { type: "STRING" },
        confidence: { type: "NUMBER" }
      },
      required: ["value", "confidence"]
    },
    categoryType: {
      type: "OBJECT",
      properties: {
        value: { type: "STRING" },
        confidence: { type: "NUMBER" }
      },
      required: ["value", "confidence"]
    },
    segmentType: {
      type: "OBJECT",
      properties: {
        value: { type: "STRING" },
        confidence: { type: "NUMBER" }
      },
      required: ["value", "confidence"]
    },
    manufacturer: {
      type: "OBJECT",
      properties: {
        value: { type: "STRING" },
        confidence: { type: "NUMBER" }
      },
      required: ["value", "confidence"]
    },
    brand: {
      type: "OBJECT",
      properties: {
        value: { type: "STRING" },
        confidence: { type: "NUMBER" }
      },
      required: ["value", "confidence"]
    },
    productName: {
      type: "OBJECT",
      properties: {
        value: { type: "STRING" },
        confidence: { type: "NUMBER" }
      },
      required: ["value", "confidence"]
    },
    weightUnit: {
      type: "OBJECT",
      properties: {
        value: { type: "STRING" },
        confidence: { type: "NUMBER" }
      },
      required: ["value", "confidence"]
    },
    packagingType: {
      type: "OBJECT",
      properties: {
        value: { type: "STRING" },
        confidence: { type: "NUMBER" }
      },
      required: ["value", "confidence"]
    },
    countryOfOrigin: {
      type: "OBJECT",
      properties: {
        value: { type: "STRING" },
        confidence: { type: "NUMBER" }
      },
      required: ["value", "confidence"]
    },
    marketingMessage: {
      type: "OBJECT",
      properties: {
        value: { type: "STRING" },
        confidence: { type: "NUMBER" }
      },
      required: ["value", "confidence"]
    }
  },
  required: [
    "barcode", "categoryType", "segmentType", "manufacturer", "brand",
    "productName", "weightUnit", "packagingType", "countryOfOrigin", "marketingMessage"
  ]
};

export async function POST(request: Request) {
  try {
    const body                  = await request.json();
    const images: string[]      = Array.isArray(body.images) ? body.images : [];
    const ocrText: string       = body.ocrText     ?? "";
    const imageLabels: string[] = body.imageLabels ?? [];
    if (images.length === 0 && !ocrText.trim()) {
      return NextResponse.json({ ok: false, error: "No images or OCR text provided" }, { status: 400 });
    }

    // ─── Standard AWS Rekognition + Python Backend Pipeline ─────────────────
    // Rekognition uses the FRONT-labelled image if present, else the first image.
    const frontIdx = imageLabels.findIndex((l) => l === "Front");
    const rekB64   = images[frontIdx >= 0 ? frontIdx : 0];
    const rekBuf   = rekB64 ? base64ToBuffer(rekB64) : null;

    type RekResult = { categoryType: string; segmentType: string; packagingType: string; confidence: number; labels: string[]; hintText: string } | null;

    const rekPromise: Promise<RekResult> = rekBuf
      ? raceTimeout(
          detectLabels(rekBuf)
            .then((r) => {
              const h = classifyFromLabels(r.labels);
              return { categoryType: h.categoryType, segmentType: h.segmentType, packagingType: h.packagingType, confidence: h.confidence, labels: h.contributingLabels, hintText: buildCategoryHintText(h) };
            })
            .catch((err) => {
              console.error("Rekognition failed in API route:", err);
              return null;
            }),
          REK_TIMEOUT_MS,
          null
        )
      : Promise.resolve(null);

    // Start backend immediately with whatever we have — we'll merge Rekognition results after
    const backendPromise = raceTimeout(
      fetch(BACKEND_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images, ocrText, image_labels: imageLabels, rekognition_hints: {} }),
      })
      .catch((err) => {
        console.error("Backend fetch failed in API route:", err);
        return null;
      }),
      BACKEND_TIMEOUT_MS,
      null
    );

    // Wait for both concurrently
    const [rekResult, backendResp] = await Promise.all([rekPromise, backendPromise]);

    // Build normalised payload
    const payload: Record<string, any> = {};

    // Inject Rekognition hints (highest priority for category/packaging)
    if (rekResult) {
      if (rekResult.categoryType)  payload.categoryType  = rekResult.categoryType;
      if (rekResult.segmentType)   payload.segmentType   = rekResult.segmentType;
      if (rekResult.packagingType) payload.packagingType = rekResult.packagingType;
    }

    // Attempt to parse backend response
    let backendSuccess = false;
    if (backendResp?.ok) {
      const json = await backendResp.json().catch(() => ({}));
      if (json.product) {
        Object.assign(payload, json.product);   // backend overwrites Rekognition for text fields
        backendSuccess = true;
      }
      if (json.field_confidences)   payload.fieldConfidenceScores  = json.field_confidences;
      if (json.needs_review_fields) payload.needsReviewFields       = json.needs_review_fields;
      if (json.completeness_score != null) payload.completenessScore = json.completeness_score;
      if (json.telemetry)           payload.telemetry              = json.telemetry;

      // But Rekognition category/packaging take priority back if backend left them empty
      if (rekResult) {
        if (!payload.categoryType  && rekResult.categoryType)  payload.categoryType  = rekResult.categoryType;
        if (!payload.segmentType   && rekResult.segmentType)   payload.segmentType   = rekResult.segmentType;
        if (!payload.packagingType && rekResult.packagingType) payload.packagingType = rekResult.packagingType;
      }
    }

    // ─── Gemini Fallback ───────────────────────────────────────────────────
    // If Python backend is down or failed, use Gemini for extraction
    const apiKey = process.env.GEMINI_API_KEY;
    if (!backendSuccess && apiKey) {
      try {
        console.log("Python backend not available or failed. Falling back to Gemini...");
        const ai = new GoogleGenAI({ apiKey });
        
        const parts: any[] = [
          {
            text: `You are an expert product data extraction AI. Extract structured metadata from the provided product images.
Fill in all the required fields of the schema.
If any field is not visible or cannot be determined, return an empty string or null for its value, with a low confidence (e.g. 0.0 or 0.1).
Do not guess or invent data. If a barcode is visible, extract it.
${ocrText ? `Additional OCR text extracted from the product:\n${ocrText}` : ""}`
          }
        ];

        // Add images as inlineData parts
        for (const imgB64 of images) {
          const raw = imgB64.includes(",") ? imgB64.split(",")[1] : imgB64;
          if (raw) {
            parts.push({
              inlineData: {
                data: raw,
                mimeType: "image/jpeg"
              }
            });
          }
        }

        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: [{
            role: "user",
            parts: parts
          }],
          config: {
            responseMimeType: "application/json",
            responseSchema: GEMINI_JSON_SCHEMA
          }
        });

        const textResponse = response.text;
        if (textResponse) {
          const geminiData = JSON.parse(textResponse);
          console.log("Gemini extraction successful:", geminiData);
          
          const product: Record<string, any> = {};
          const fieldConfidenceScores: Record<string, number> = {};
          const needsReviewFields: string[] = [];
          
          let filledCount = 0;
          const schemaProperties = GEMINI_JSON_SCHEMA.properties as Record<string, any>;
          const totalFields = Object.keys(schemaProperties).length;

          for (const key of Object.keys(schemaProperties)) {
            const fieldVal = geminiData[key];
            if (fieldVal) {
              const val = fieldVal.value ?? "";
              const conf = typeof fieldVal.confidence === "number" ? fieldVal.confidence : 0.8;
              
              product[key] = val;
              fieldConfidenceScores[key] = conf;
              
              if (val.trim()) {
                filledCount++;
              }
              
              if (conf < 0.7) {
                needsReviewFields.push(key);
              }
            } else {
              product[key] = "";
              fieldConfidenceScores[key] = 0.0;
              needsReviewFields.push(key);
            }
          }

          const completenessScore = totalFields > 0 ? filledCount / totalFields : 0.0;

          // Merge Gemini extraction results
          Object.assign(payload, product);
          payload.fieldConfidenceScores = fieldConfidenceScores;
          payload.needsReviewFields = needsReviewFields;
          payload.completenessScore = completenessScore;
          payload.telemetry = {
            source: "gemini",
            model: "gemini-3.5-flash"
          };

          // Apply Rekognition hints fallback
          if (rekResult) {
            if (!payload.categoryType  && rekResult.categoryType)  payload.categoryType  = rekResult.categoryType;
            if (!payload.segmentType   && rekResult.segmentType)   payload.segmentType   = rekResult.segmentType;
            if (!payload.packagingType && rekResult.packagingType) payload.packagingType = rekResult.packagingType;
          }
        }
      } catch (geminiErr) {
        console.error("Gemini fallback extraction failed:", geminiErr);
      }
    }

    if (rekResult) {
      if (!payload.telemetry) payload.telemetry = {};
      payload.telemetry.rekognition_hints = {
        categoryType: rekResult.categoryType,
        segmentType: rekResult.segmentType,
        packagingType: rekResult.packagingType,
        confidence: rekResult.confidence,
        labels: rekResult.labels,
      };
    }

    return NextResponse.json({ ok: true, payload, rawText: "{}" });

  } catch (err) {
    console.error("Error in ai-extract API route:", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

