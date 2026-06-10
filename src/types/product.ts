// ─── Core IMDB record ─────────────────────────────────────────────────────────

export interface ProductRecord {
  barcode: string;
  categoryType: string;
  segmentType: string;
  manufacturer: string;
  brand: string;
  productName: string;
  weightUnit: string;
  packagingType: string;
  countryOfOrigin: string;
  marketingMessage: string;
  confidenceScore: number;
  fieldConfidenceScores?: Record<string, number>; // Per-field confidence (0-1)
  completenessScore?: number;
  imageUrl?: string;
  imageUrls?: string[];
}

// ─── Saved record (includes Firestore metadata) ───────────────────────────────

export interface SavedProduct extends ProductRecord {
  id: string;
  savedAt: string;
  source: ExtractionSource;
  needsReview: boolean;
  corrected?: boolean; // true if a user has manually edited this record
}

// ─── Extraction source tracking ───────────────────────────────────────────────

export type ExtractionSource =
  | "firebase"       // found in local Firestore cache
  | "openfoodfacts"  // found via Open Food Facts API
  | "ocr"            // OCR + regex fallback
  | "ai"             // AI / LLM extraction over OCR text
  | "manual";        // user-created/corrected

// ─── Pipeline step for progress tracking ─────────────────────────────────────

export interface PipelineStep {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "skipped" | "error";
  detail?: string;
}

// ─── Session stats (displayed in dashboard) ───────────────────────────────────

export interface SessionStats {
  totalProcessed: number;
  foundByBarcode: number;
  foundByOCR: number;
  foundInFirebase: number;
  foundInOpenFoodFacts: number;
  duplicatesPrevented: number;
  readyForExport: number;
  needsReview: number;
}

export interface DashboardActivityEntry {
  id: string;
  description: string;
  timestamp: string;
}

export interface DashboardStats {
  totalUploads: number;
  totalProducts: number;
  pendingProducts: number;
  validatedProducts: number;
  errorProducts: number;
  recentActivity: DashboardActivityEntry[];
}
