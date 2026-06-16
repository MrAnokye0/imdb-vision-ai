/**
 * AWS Rekognition Service
 * Server-side only — do not import in client components.
 *
 * Reads credentials from environment variables:
 *   AWS_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY
 *   AWS_REGION
 */

import {
  RekognitionClient,
  DetectLabelsCommand,
  DetectTextCommand,
  DetectModerationLabelsCommand,
  type DetectLabelsCommandOutput,
  type DetectTextCommandOutput,
  type DetectModerationLabelsCommandOutput,
} from "@aws-sdk/client-rekognition";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RekognitionLabel {
  name: string;
  confidence: number;       // 0–100
  parents: string[];        // parent category names
  aliases: string[];
}

export interface RekognitionTextLine {
  text: string;
  confidence: number;
  type: "LINE" | "WORD";
  geometry?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export interface RekognitionModerationLabel {
  name: string;
  confidence: number;
  parentName: string;
}

export interface DetectLabelsResult {
  labels: RekognitionLabel[];
  confidence: number;       // average confidence across all labels
  raw: DetectLabelsCommandOutput;
}

export interface DetectTextResult {
  lines: RekognitionTextLine[];
  fullText: string;         // all LINE-type detections joined
  confidence: number;       // average confidence
  raw: DetectTextCommandOutput;
}

export interface DetectModerationResult {
  labels: RekognitionModerationLabel[];
  isSafe: boolean;          // true when no moderation labels found
  confidence: number;
  raw: DetectModerationLabelsCommandOutput;
}

// ─── Client factory (lazy singleton) ─────────────────────────────────────────

let _client: RekognitionClient | null = null;

function getClient(): RekognitionClient {
  if (_client) return _client;

  const accessKeyId     = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region          = process.env.AWS_REGION ?? "eu-west-1";

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "AWS credentials not configured. " +
      "Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env.local"
    );
  }

  _client = new RekognitionClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  return _client;
}

// ─── Retry helper ─────────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  backoffMs = 500
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);

      // Don't retry on auth / validation errors
      const isRetryable =
        msg.includes("ThrottlingException") ||
        msg.includes("ProvisionedThroughputExceededException") ||
        msg.includes("RequestTimeout") ||
        msg.includes("ServiceUnavailable") ||
        msg.includes("InternalError");

      if (!isRetryable || attempt === retries) break;

      const wait = backoffMs * Math.pow(2, attempt - 1);
      console.warn(`[Rekognition] Attempt ${attempt} failed — retrying in ${wait}ms: ${msg}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  throw lastError;
}

// ─── detectLabels ─────────────────────────────────────────────────────────────

/**
 * Detect objects, scenes, and concepts in an image.
 * Useful for: categoryType, segmentType, packagingType inference.
 */
export async function detectLabels(
  imageBuffer: Buffer,
  maxLabels = 20,
  minConfidence = 60
): Promise<DetectLabelsResult> {
  const client = getClient();

  const raw = await withRetry(() =>
    client.send(
      new DetectLabelsCommand({
        Image:          { Bytes: imageBuffer },
        MaxLabels:      maxLabels,
        MinConfidence:  minConfidence,
        Features:       ["GENERAL_LABELS"],
      })
    )
  );

  const labels: RekognitionLabel[] = (raw.Labels ?? []).map((l) => ({
    name:       l.Name       ?? "",
    confidence: l.Confidence ?? 0,
    parents:    (l.Parents   ?? []).map((p) => p.Name ?? "").filter(Boolean),
    aliases:    (l.Aliases   ?? []).map((a) => a.Name ?? "").filter(Boolean),
  }));

  const confidence =
    labels.length > 0
      ? labels.reduce((s, l) => s + l.confidence, 0) / labels.length
      : 0;

  return { labels, confidence, raw };
}

// ─── detectText ───────────────────────────────────────────────────────────────

/**
 * Extract all text visible in the image using AWS Rekognition OCR.
 * Useful as a higher-accuracy alternative / complement to Tesseract.js.
 */
export async function detectText(
  imageBuffer: Buffer
): Promise<DetectTextResult> {
  const client = getClient();

  const raw = await withRetry(() =>
    client.send(
      new DetectTextCommand({
        Image: { Bytes: imageBuffer },
        Filters: {
          WordFilter: { MinConfidence: 50 },
        },
      })
    )
  );

  const detections = raw.TextDetections ?? [];

  const lines: RekognitionTextLine[] = detections.map((d) => ({
    text:       d.DetectedText ?? "",
    confidence: d.Confidence   ?? 0,
    type:       (d.Type        ?? "WORD") as "LINE" | "WORD",
    geometry:   d.Geometry?.BoundingBox
      ? {
          left:   d.Geometry.BoundingBox.Left   ?? 0,
          top:    d.Geometry.BoundingBox.Top    ?? 0,
          width:  d.Geometry.BoundingBox.Width  ?? 0,
          height: d.Geometry.BoundingBox.Height ?? 0,
        }
      : undefined,
  }));

  // Join LINE detections only for the fullText string
  const fullText = lines
    .filter((l) => l.type === "LINE")
    .map((l) => l.text)
    .join("\n");

  const confidence =
    lines.length > 0
      ? lines.reduce((s, l) => s + l.confidence, 0) / lines.length
      : 0;

  return { lines, fullText, confidence, raw };
}

// ─── detectModeration ─────────────────────────────────────────────────────────

/**
 * Check an image for inappropriate or unsafe content.
 * Returns isSafe=true when no moderation labels are found.
 */
export async function detectModeration(
  imageBuffer: Buffer,
  minConfidence = 60
): Promise<DetectModerationResult> {
  const client = getClient();

  const raw = await withRetry(() =>
    client.send(
      new DetectModerationLabelsCommand({
        Image:         { Bytes: imageBuffer },
        MinConfidence: minConfidence,
      })
    )
  );

  const labels: RekognitionModerationLabel[] = (raw.ModerationLabels ?? []).map((l) => ({
    name:       l.Name       ?? "",
    confidence: l.Confidence ?? 0,
    parentName: l.ParentName ?? "",
  }));

  const confidence =
    labels.length > 0
      ? labels.reduce((s, l) => s + l.confidence, 0) / labels.length
      : 100; // no moderation labels = 100% safe

  return {
    labels,
    isSafe:     labels.length === 0,
    confidence,
    raw,
  };
}
