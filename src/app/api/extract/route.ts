import { NextRequest, NextResponse } from "next/server";
import { extractProductData } from "@/src/lib/gemini";

export async function POST(req: NextRequest) {
  const body = await req.json();

  const result = await extractProductData(
    body.image,
    body.mimeType
  );

  return NextResponse.json({
    success: true,
    data: result,
  });
}
