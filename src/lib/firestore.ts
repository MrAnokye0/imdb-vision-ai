import {
  collection,
  addDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  serverTimestamp,
  orderBy,
  limit,
} from "firebase/firestore";
import { db } from "@/src/lib/firebase";
import type { ProductRecord, SavedProduct, ExtractionSource } from "@/src/types/product";

const COLLECTION = "products";

// ─── Strip undefined only (never strip null — serverTimestamp uses objects) ──

function stripUndefined(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) result[k] = v;
  }
  return result;
}

// ─── Normalize a ProductRecord to safe Firestore values ──────────────────────

function toFirestoreProduct(product: ProductRecord) {
  return {
    barcode:          product.barcode          ?? "",
    categoryType:     product.categoryType     ?? "",
    segmentType:      product.segmentType      ?? "",
    manufacturer:     product.manufacturer     ?? "",
    brand:            product.brand            ?? "",
    productName:      product.productName      ?? "",
    weightUnit:       product.weightUnit       ?? "",
    packagingType:    product.packagingType     ?? "",
    countryOfOrigin:  product.countryOfOrigin  ?? "",
    marketingMessage: product.marketingMessage ?? "",
    confidenceScore:  product.confidenceScore  ?? 0,
    // imageUrl is optional — convert undefined → "" so Firestore accepts it
    imageUrl: product.imageUrl ?? "",
  };
}

// ─── Save ─────────────────────────────────────────────────────────────────────

export async function saveProduct(
  product: ProductRecord,
  source: ExtractionSource = "ocr"
): Promise<string> {
  const data = stripUndefined({
    ...toFirestoreProduct(product),
    source,
    needsReview: (product.confidenceScore ?? 0) < 0.8,
    corrected:   false,
    savedAt:     serverTimestamp(),
  });

  const ref = await addDoc(collection(db, COLLECTION), data);
  return ref.id;
}

// ─── Learning system: save corrected version ─────────────────────────────────

export interface CorrectionPayload extends Partial<ProductRecord> {
  needsReview?: boolean;
  corrected?: boolean;
  updatedAt?: unknown;
}

export async function saveCorrection(
  id: string,
  corrected: CorrectionPayload
): Promise<void> {
  const data = stripUndefined({
    ...corrected,
    imageUrl:    corrected.imageUrl    ?? "",
    corrected:   true,
    needsReview: false,
    updatedAt:   serverTimestamp(),
  });

  await updateDoc(doc(db, COLLECTION, id), data);
}

// ─── Firebase-first barcode lookup ───────────────────────────────────────────

export async function findByBarcode(barcode: string): Promise<SavedProduct | null> {
  if (!barcode) return null;
  try {
    const q = query(
      collection(db, COLLECTION),
      where("barcode", "==", barcode),
      orderBy("savedAt", "desc"),
      limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return mapDoc(snap.docs[0].id, snap.docs[0].data() as Record<string, unknown>);
  } catch {
    return null;
  }
}

// ─── Duplicate detection ──────────────────────────────────────────────────────

export async function isDuplicate(product: ProductRecord): Promise<boolean> {
  if (!product.barcode && !product.brand) return false;
  try {
    const q = query(
      collection(db, COLLECTION),
      where("barcode", "==", product.barcode ?? ""),
      where("brand",   "==", product.brand   ?? ""),
      where("weightUnit", "==", product.weightUnit ?? "")
    );
    const snap = await getDocs(q);
    return !snap.empty;
  } catch {
    return false;
  }
}

export async function findSimilarProducts(product: ProductRecord): Promise<SavedProduct[]> {
  if (!product.barcode && !product.brand) return [];

  try {
    if (product.barcode) {
      const q = query(
        collection(db, COLLECTION),
        where("barcode", "==", product.barcode),
        orderBy("savedAt", "desc"),
        limit(10)
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => mapDoc(d.id, d.data() as Record<string, unknown>));
    }

    const q = query(
      collection(db, COLLECTION),
      where("brand", "==", product.brand ?? ""),
      where("weightUnit", "==", product.weightUnit ?? ""),
      orderBy("savedAt", "desc"),
      limit(10)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => mapDoc(d.id, d.data() as Record<string, unknown>));
  } catch {
    return [];
  }
}

// ─── Find exact duplicates (compares barcode, brand, product name, weight) ────

export interface DuplicateMatch {
  product: SavedProduct;
  matchFields: {
    barcode: boolean;
    brand: boolean;
    productName: boolean;
    weight: boolean;
  };
  confidence: number; // 0-1, higher = more likely duplicate
}

export async function findDuplicates(product: ProductRecord): Promise<DuplicateMatch[]> {
  if (!product.barcode && !product.brand) return [];

  try {
    const allProducts = await getAllProducts();
    const matches: DuplicateMatch[] = [];

    for (const existing of allProducts) {
      const matchFields = {
        barcode: Boolean(product.barcode && product.barcode === existing.barcode && product.barcode !== ""),
        brand: Boolean(product.brand && product.brand === existing.brand && product.brand !== ""),
        productName: Boolean(product.productName && product.productName === existing.productName && product.productName !== ""),
        weight: Boolean(product.weightUnit && product.weightUnit === existing.weightUnit && product.weightUnit !== ""),
      };

      // Count matching fields
      const matchCount = Object.values(matchFields).filter(Boolean).length;
      
      // A match is considered duplicate if:
      // - Barcode matches (exact duplicate), OR
      // - At least 3 other fields match (brand, product name, weight)
      if (matchFields.barcode || matchCount >= 3) {
        const confidence = matchFields.barcode ? 1.0 : matchCount / 4;
        matches.push({
          product: existing,
          matchFields,
          confidence,
        });
      }
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  } catch {
    return [];
  }
}

// ─── Fetch all ────────────────────────────────────────────────────────────────

export async function getAllProducts(): Promise<SavedProduct[]> {
  try {
    const snap = await getDocs(
      query(collection(db, COLLECTION), orderBy("savedAt", "desc"))
    );
    return snap.docs.map((d) => mapDoc(d.id, d.data() as Record<string, unknown>));
  } catch {
    return [];
  }
}

export async function repairUndefinedFieldsInProducts(): Promise<SavedProduct[]> {
  const products = await getAllProducts();
  const updated: SavedProduct[] = [];

  for (const product of products) {
    const data = stripUndefined({
      barcode:          product.barcode ?? "",
      categoryType:     product.categoryType ?? "",
      segmentType:      product.segmentType ?? "",
      manufacturer:     product.manufacturer ?? "",
      brand:            product.brand ?? "",
      productName:      product.productName ?? "",
      weightUnit:       product.weightUnit ?? "",
      packagingType:    product.packagingType ?? "",
      countryOfOrigin:  product.countryOfOrigin ?? "",
      marketingMessage: product.marketingMessage ?? "",
      confidenceScore:  product.confidenceScore ?? 0,
      imageUrl:         product.imageUrl ?? "",
      source:           product.source ?? "ocr",
      needsReview:      product.needsReview ?? false,
      corrected:        product.corrected ?? false,
      savedAt:          serverTimestamp(),
    });

    await updateDoc(doc(db, COLLECTION, product.id), data);
    updated.push(product);
  }

  return updated;
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteProduct(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
}

// ─── Map Firestore doc → SavedProduct ────────────────────────────────────────

function mapDoc(id: string, d: Record<string, unknown>): SavedProduct {
  return {
    id,
    barcode:          String(d.barcode          ?? ""),
    categoryType:     String(d.categoryType     ?? ""),
    segmentType:      String(d.segmentType      ?? ""),
    manufacturer:     String(d.manufacturer     ?? ""),
    brand:            String(d.brand            ?? ""),
    productName:      String(d.productName      ?? ""),
    weightUnit:       String(d.weightUnit       ?? ""),
    packagingType:    String(d.packagingType     ?? ""),
    countryOfOrigin:  String(d.countryOfOrigin  ?? ""),
    marketingMessage: String(d.marketingMessage ?? ""),
    confidenceScore:  Number(d.confidenceScore  ?? 0),
    imageUrl:         String(d.imageUrl         ?? ""),
    source:           (String(d.source  ?? "ocr")) as SavedProduct["source"],
    needsReview:      Boolean(d.needsReview ?? false),
    corrected:        Boolean(d.corrected   ?? false),
    savedAt:          (d.savedAt as { toDate?: () => Date })?.toDate?.()?.toISOString() ?? "",
  };
}
