import { NextResponse } from "next/server";
import { repairUndefinedFieldsInProducts } from "@/src/lib/firestore";

export async function POST() {
  try {
    const updated = await repairUndefinedFieldsInProducts();
    return NextResponse.json({ success: true, updatedCount: updated.length, updated });
  } catch (err) {
    console.error("Repair endpoint failed:", err);
    return NextResponse.json({ success: false, error: String(err) });
  }
}
