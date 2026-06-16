import os
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"

import asyncio
import logging
import base64
import re
from io import BytesIO
from typing import List, Optional
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import cv2
import numpy as np
from PIL import Image

try:
    from paddleocr import PaddleOCR
except ImportError:
    PaddleOCR = None

try:
    from pyzbar.pyzbar import decode
except (ImportError, FileNotFoundError, OSError):
    decode = None

from extraction_engine import ExtractionEngine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Thread pool for CPU-bound image work ─────────────────────────────────────
_executor = ThreadPoolExecutor(max_workers=4)

# ─── FastAPI App ──────────────────────────────────────────────────────────

app = FastAPI(
    title="Product Extraction Engine",
    description="Extract IMDB fields from product images using OCR and rule-based extraction",
    version="1.0.0",
)

# ─── CORS ──────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Initialize Services ──────────────────────────────────────────────────

# PaddleOCR (lazy load to avoid startup delays)
_paddle_ocr = None

def get_ocr():
    """Lazy load PaddleOCR model."""
    global _paddle_ocr
    if _paddle_ocr is None:
        if PaddleOCR is None:
            raise RuntimeError("PaddleOCR not installed. Install with: pip install paddleocr")
        logger.info("Loading PaddleOCR model...")
        _paddle_ocr = PaddleOCR(use_angle_cls=True, lang='en')
        logger.info("PaddleOCR model loaded successfully")
    return _paddle_ocr

# Extraction engine
extraction_engine = ExtractionEngine()

# ─── Request/Response Models ──────────────────────────────────────────────

class ExtractionRequest(BaseModel):
    images: List[str] = []              # List of base64-encoded images
    ocrText: Optional[str] = None
    image_types: Optional[List[str]] = None    # Legacy: front, back, side, barcode
    image_labels: Optional[List[str]] = None   # New: Front, Back, Barcode, Ingredients, Other
    rekognition_hints: Optional[dict] = None   # AWS Rekognition visual classification hints
    processing: Optional[dict] = None

class ExtractionResponse(BaseModel):
    product: dict
    field_confidences: dict
    completeness_score: float
    missing_fields: List[str]
    needs_review_fields: List[str]
    sources: dict
    telemetry: Optional[dict] = None

# ─── Utility Functions ────────────────────────────────────────────────────

def base64_to_image(base64_str: str) -> np.ndarray:
    """Convert base64 string to OpenCV image."""
    try:
        # Remove data URI prefix if present
        if ',' in base64_str:
            base64_str = base64_str.split(',')[1]
        
        # Decode base64
        image_bytes = base64.b64decode(base64_str)
        image = Image.open(BytesIO(image_bytes))
        
        # Convert PIL to OpenCV (BGR)
        image_cv = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
        return image_cv
    except Exception as e:
        logger.error(f"Failed to decode base64 image: {e}")
        raise ValueError(f"Invalid base64 image: {str(e)}")

def preprocess_image(image: np.ndarray) -> np.ndarray:
    """
    Fast preprocessing: resize to max 1024px, basic CLAHE contrast.
    Kept lightweight so OCR still starts within 1-2s per image.
    """
    h, w = image.shape[:2]
    max_dim = 1024
    if max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        image = cv2.resize(image, (int(w * scale), int(h * scale)),
                           interpolation=cv2.INTER_AREA)

    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l = clahe.apply(l)
    image = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)
    return image

def detect_barcode(image: np.ndarray) -> Optional[str]:
    """Detect barcode in image using pyzbar."""
    if decode is None:
        logger.warning("pyzbar not installed, skipping barcode detection")
        return None
    
    try:
        # Convert BGR to grayscale
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        # Detect barcodes
        barcodes = decode(gray)
        if barcodes:
            # Return first detected barcode
            return barcodes[0].data.decode('utf-8')
        
        return None
    except Exception as e:
        logger.error(f"Barcode detection failed: {e}")
        return None

def extract_text_with_ocr(image: np.ndarray, debug: bool = False) -> list[dict]:
    """Extract structured OCR blocks from image using PaddleOCR."""
    try:
        ocr = get_ocr()

        # Run OCR with angle detection
        result = ocr.ocr(image, cls=True)
        blocks = []

        if not result or not result[0]:
            logger.warning("OCR returned empty result")
            return blocks

        for page in result:
            for line in page:
                try:
                    box = line[0]
                    text = line[1][0] if line[1] else ""
                    confidence = float(line[1][1]) if line[1] and line[1][1] is not None else 0.0
                    
                    if text:
                        # Clean text: remove excessive spaces, newlines
                        cleaned_text = re.sub(r'\s+', ' ', text.strip())
                        
                        # Skip very short or very noisy text
                        if len(cleaned_text) < 2:
                            continue
                        
                        # Check if text is mostly gibberish (rare unicode chars)
                        non_ascii = sum(1 for c in cleaned_text if ord(c) > 127)
                        if non_ascii / len(cleaned_text) > 0.3:
                            if debug:
                                logger.warning(f"Skipping gibberish text: {cleaned_text}")
                            continue
                        
                        blocks.append({
                            'text': cleaned_text,
                            'confidence': confidence,
                            'box': box,
                        })
                        
                        if debug:
                            logger.info(f"OCR block (conf={confidence:.2f}): {cleaned_text[:60]}")
                
                except Exception as e:
                    logger.warning(f"Error parsing OCR line: {e}")
                    continue

        if debug:
            logger.info(f"Total OCR blocks extracted: {len(blocks)}")
        
        return blocks
    except Exception as e:
        logger.error(f"OCR extraction failed: {e}")
        raise


def flatten_ocr_text(blocks: list[dict]) -> str:
    """Flatten structured OCR blocks into plain text."""
    return '\n'.join(block['text'] for block in blocks if block.get('text')).strip()

# ─── API Endpoints ────────────────────────────────────────────────────────

@app.get("/health", tags=["Health"])
async def health():
    """Health check endpoint."""
    return {"status": "ok", "service": "Product Extraction Engine"}

@app.post("/extract", response_model=ExtractionResponse, tags=["Extraction"])
async def extract_product(request: ExtractionRequest):
    """
    Extract IMDB fields from product images.
    
    Request body:
    {
      "images": ["base64_image_1", "base64_image_2"],
      "image_types": ["front", "back"],
      "processing": {"enable_ocr": true, "enable_barcode": true}
    }
    
    Returns:
    {
      "product": {...},
      "field_confidences": {...},
      "completeness_score": 0.85,
      "missing_fields": [...],
      "sources": {...}
    }
    """
    try:
        if not request.images and not request.ocrText:
            raise HTTPException(status_code=400, detail="No images or OCR text provided")
        
        # Convert base64 to images and preprocess
        images = []
        ocr_texts = []
        ocr_blocks_per_image = []
        barcodes = []

        if not request.images and request.ocrText:
            ocr_texts = [request.ocrText]
            ocr_blocks_per_image = [[]]
            barcodes = [None]
        else:
            # ── Process all images in parallel ────────────────────────────
            def process_one(args):
                i, base64_str = args
                try:
                    image     = base64_to_image(base64_str)
                    processed = preprocess_image(image)
                    blocks    = extract_text_with_ocr(processed)
                    text      = flatten_ocr_text(blocks)
                    barcode   = detect_barcode(processed)
                    if barcode:
                        logger.info(f"Image {i+1}: barcode={barcode}")
                    return blocks, text, barcode
                except Exception as e:
                    logger.error(f"Error processing image {i+1}: {e}")
                    return [], "", None

            loop    = asyncio.get_event_loop()
            results_list = await loop.run_in_executor(
                _executor,
                lambda: list(map(process_one, enumerate(request.images)))
            )

            for blocks, text, barcode in results_list:
                ocr_blocks_per_image.append(blocks)
                ocr_texts.append(text)
                barcodes.append(barcode)

            # Inject any detected barcode into first OCR text if missing
            for bc in [b for b in barcodes if b]:
                if not any(bc in t for t in ocr_texts):
                    ocr_texts[0] = f"{ocr_texts[0]}\n{bc}"
        
        logger.info(f"Extracted {len(ocr_texts)} OCR texts")
        
        # Extract fields using rule-based engine
        logger.info("Running rule-based extraction...")
        result = extraction_engine.extract_from_ocr(
            ocr_texts,
            ocr_blocks=ocr_blocks_per_image,
            image_types=request.image_types,
            barcodes=barcodes,
            frontend_labels=request.image_labels,
            rekognition_hints=request.rekognition_hints,
        )

        # Construct telemetry
        raw_ocr_per_image = []
        labels = request.image_labels or []
        for idx, (text, blocks) in enumerate(zip(ocr_texts, ocr_blocks_per_image)):
            label = labels[idx] if idx < len(labels) else "Other"
            raw_ocr_per_image.append({
                "label": label,
                "text": text,
                "blocks": [{"text": b.get("text", ""), "confidence": b.get("confidence", 0.0), "box": b.get("box", [])} for b in blocks]
            })

        telemetry = {
            "raw_ocr_per_image": raw_ocr_per_image,
            "barcodes_detected": [b for b in barcodes if b],
            "merged_text": "\n\n".join(ocr_texts),
        }
        
        return ExtractionResponse(
            product=result['product'],
            field_confidences=result['field_confidences'],
            completeness_score=result['completeness_score'],
            missing_fields=result['missing_fields'],
            needs_review_fields=result.get('needs_review_fields', []),
            sources=result['sources'],
            telemetry=telemetry,
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        raise HTTPException(status_code=500, detail=f"Extraction failed: {str(e)}")

@app.post("/ocr", tags=["OCR"])
async def run_ocr(file: UploadFile = File(...)):
    """
    Extract text from a single image using PaddleOCR.
    """
    try:
        # Read uploaded file
        contents = await file.read()
        image = Image.open(BytesIO(contents))
        image_cv = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
        
        # Preprocess
        processed = preprocess_image(image_cv)
        
        # Extract text
        blocks = extract_text_with_ocr(processed)
        text = flatten_ocr_text(blocks)
        
        return {
            "text": text,
            "file_name": file.filename,
            "status": "success"
        }
    
    except Exception as e:
        logger.error(f"OCR failed: {e}")
        raise HTTPException(status_code=500, detail=f"OCR failed: {str(e)}")

@app.post("/barcode", tags=["Barcode"])
async def detect_barcode_endpoint(file: UploadFile = File(...)):
    """
    Detect barcode in a single image using pyzbar.
    """
    try:
        # Read uploaded file
        contents = await file.read()
        image = Image.open(BytesIO(contents))
        image_cv = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
        
        # Detect barcode
        barcode = detect_barcode(image_cv)
        
        return {
            "barcode": barcode or "",
            "file_name": file.filename,
            "status": "success"
        }
    
    except Exception as e:
        logger.error(f"Barcode detection failed: {e}")
        raise HTTPException(status_code=500, detail=f"Barcode detection failed: {str(e)}")

# ─── Error Handlers ───────────────────────────────────────────────────────

@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    """Handle unexpected exceptions."""
    logger.error(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )

# ─── Startup/Shutdown Events ──────────────────────────────────────────────

@app.on_event("startup")
async def startup_event():
    """Pre-warm PaddleOCR on startup so the first request is fast."""
    logger.info("Starting Product Extraction Engine…")
    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(_executor, get_ocr)
        logger.info("PaddleOCR pre-warmed successfully")
    except Exception as e:
        logger.warning(f"PaddleOCR pre-warm failed (will load on first request): {e}")

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown."""
    logger.info("Shutting down Product Extraction Engine...")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
