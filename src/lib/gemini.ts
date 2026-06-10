import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY!,
});

export async function extractProductData(
  base64Image: string,
  mimeType: string
): Promise<string> {
  const prompt = `Analyze this retail product image and extract all visible product information.

Return JSON ONLY — no markdown fences, no explanation, just the raw JSON object:

{
  "barcode": "",
  "categoryType": "",
  "segmentType": "",
  "manufacturer": "",
  "brand": "",
  "productName": "",
  "weightUnit": "",
  "packagingType": "",
  "countryOfOrigin": "",
  "marketingMessage": "",
  "confidenceScore": 0.0,
  "fieldConfidenceScores": {
    "barcode": 0.0,
    "categoryType": 0.0,
    "segmentType": 0.0,
    "manufacturer": 0.0,
    "brand": 0.0,
    "productName": 0.0,
    "weightUnit": 0.0,
    "packagingType": 0.0,
    "countryOfOrigin": 0.0,
    "marketingMessage": 0.0
  }
}

Rules:
- confidenceScore must be the overall confidence (0-1)
- fieldConfidenceScores must contain a confidence value (0-1) for each field
- Use 0.0 for any field you have low confidence in
- Use empty string "" for any field you cannot determine
- Do NOT wrap the response in markdown or code blocks`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              data: base64Image,
              mimeType,
            },
          },
          {
            text: prompt,
          },
        ],
      },
    ],
  });

  const text = response.text ?? "";

  if (!text) {
    throw new Error("Gemini returned an empty response. Check your API key and quota.");
  }

  return text;
}
