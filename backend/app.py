"""
FastAPI server for product extraction engine.
Exposes endpoints for OCR, barcode detection, and extraction.
"""

import logging
import base64
from io import BytesIO
from typing import List, Optional
from pathlib import Path

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
except ImportError:
    decode = None

from extraction_engine import ExtractionEngine

# ─── Logging ───────────────────────────────────────────────────────────────

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
    images: List[str]  # List of base64-encoded images
    image_types: Optional[List[str]] = None  # Optional: front, back, side, barcode
    processing: Optional[dict] = None  # Optional: enable_ocr, enable_barcode, etc.

class ExtractionResponse(BaseModel):
    product: dict
    field_confidences: dict
    completeness_score: float
    missing_fields: List[str]
    sources: dict

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
    """Preprocess image for better OCR accuracy."""
    # Resize to standard size
    max_dim = 1200
    h, w = image.shape[:2]
    if max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        new_w, new_h = int(w * scale), int(h * scale)
        image = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)
    
    # Increase contrast
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l = clahe.apply(l)
    image = cv2.merge([l, a, b])
    image = cv2.cvtColor(image, cv2.COLOR_LAB2BGR)
    
    # Sharpen
    kernel = np.array([[-1, -1, -1],
                       [-1,  9, -1],
                       [-1, -1, -1]]) / 1.0
    image = cv2.filter2D(image, -1, kernel)
    
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

def extract_text_with_ocr(image: np.ndarray) -> list[dict]:
    """Extract structured OCR blocks from image using PaddleOCR."""
    try:
        ocr = get_ocr()

        result = ocr.ocr(image, cls=True)
        blocks = []

        if not result:
            return blocks

        for page in result:
            for line in page:
                try:
                    box = line[0]
                    text = line[1][0] if line[1] else ""
                    confidence = float(line[1][1]) if line[1] and line[1][1] is not None else 0.0
                    if text:
                        blocks.append({
                            'text': text.strip(),
                            'confidence': confidence,
                            'box': box,
                        })
                except Exception:
                    continue

        return blocks
    except Exception as e:
        logger.error(f"OCR extraction failed: {e}")
        return []


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
        if not request.images:
            raise HTTPException(status_code=400, detail="No images provided")
        
        # Convert base64 to images and preprocess
        images = []
        ocr_texts = []
        ocr_blocks_per_image = []
        barcodes = []
        
        for i, base64_str in enumerate(request.images):
            try:
                # Decode image
                image = base64_to_image(base64_str)
                
                # Preprocess
                processed = preprocess_image(image)
                images.append(processed)
                
                # Extract text
                logger.info(f"Extracting text from image {i+1}/{len(request.images)}...")
                blocks = extract_text_with_ocr(processed)
                ocr_blocks_per_image.append(blocks)
                ocr_texts.append(flatten_ocr_text(blocks))
                
                # Detect barcode
                logger.info(f"Detecting barcode in image {i+1}/{len(request.images)}...")
                barcode = detect_barcode(processed)
                barcodes.append(barcode)
                if barcode:
                    logger.info(f"Barcode detected: {barcode}")
                
            except Exception as e:
                logger.error(f"Error processing image {i+1}: {e}")
                raise HTTPException(status_code=400, detail=f"Error processing image {i+1}: {str(e)}")
        
        # Add barcodes to OCR text if found (but not in OCR already)
        for barcode in [b for b in barcodes if b]:
            if not any(barcode in text for text in ocr_texts):
                ocr_texts[0] = f"{ocr_texts[0]}\n{barcode}"
        
        logger.info(f"Extracted {len(ocr_texts)} OCR texts")
        
        # Extract fields using rule-based engine
        logger.info("Running rule-based extraction...")
        result = extraction_engine.extract_from_ocr(
            ocr_texts,
            ocr_blocks=ocr_blocks_per_image,
            image_types=request.image_types,
            barcodes=barcodes,
        )
        
        return ExtractionResponse(
            product=result['product'],
            field_confidences=result['field_confidences'],
            completeness_score=result['completeness_score'],
            missing_fields=result['missing_fields'],
            sources=result['sources'],
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
    """Initialize services on startup."""
    logger.info("Starting Product Extraction Engine...")
    logger.info("Services initialized and ready")

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown."""
    logger.info("Shutting down Product Extraction Engine...")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
