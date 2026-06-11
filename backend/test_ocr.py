"""
Diagnostic script to test OCR on local images.
Run with: python test_ocr.py <image_path>
"""

import sys
import cv2
import numpy as np
import logging
from pathlib import Path
from io import BytesIO
from PIL import Image

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

try:
    from paddleocr import PaddleOCR
except ImportError:
    logger.error("PaddleOCR not installed. Run: pip install paddleocr")
    sys.exit(1)

# Initialize OCR
logger.info("Loading PaddleOCR model (this may take a minute on first run)...")
ocr = PaddleOCR(use_angle_cls=True, lang='en')
logger.info("✓ PaddleOCR loaded")

def preprocess_image(image: np.ndarray, debug: bool = True) -> np.ndarray:
    """Preprocess image for better OCR accuracy."""
    h, w = image.shape[:2]
    logger.info(f"Original image size: {w}x{h}")
    
    # Resize
    max_dim = 1600
    if max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        new_w, new_h = int(w * scale), int(h * scale)
        image = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)
        logger.info(f"Resized to: {new_w}x{new_h}")
    
    # CLAHE
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(16, 16))
    l = clahe.apply(l)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    l = cv2.morphologyEx(l, cv2.MORPH_CLOSE, kernel, iterations=1)
    image = cv2.merge([l, a, b])
    image = cv2.cvtColor(image, cv2.COLOR_LAB2BGR)
    logger.info("Applied: CLAHE contrast enhancement")
    
    # Bilateral filter
    image = cv2.bilateralFilter(image, 9, 75, 75)
    logger.info("Applied: Bilateral filter (noise reduction)")
    
    # Brightness
    image = cv2.convertScaleAbs(image, alpha=1.1, beta=20)
    logger.info("Applied: Brightness boost (+20)")
    
    # Sharpen
    kernel = np.array([[-1, -1, -1],
                       [-1, 13, -1],
                       [-1, -1, -1]]) / 1.0
    image = cv2.filter2D(image, -1, kernel)
    logger.info("Applied: Sharpening filter")
    
    # Dilate
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2, 2))
    image = cv2.dilate(image, kernel, iterations=1)
    logger.info("Applied: Dilation")
    
    return image

def test_ocr(image_path: str):
    """Test OCR on a local image."""
    logger.info(f"\n{'='*70}")
    logger.info(f"Testing OCR on: {image_path}")
    logger.info(f"{'='*70}\n")
    
    # Load image
    if not Path(image_path).exists():
        logger.error(f"✗ File not found: {image_path}")
        return
    
    try:
        image = cv2.imread(image_path)
        if image is None:
            logger.error(f"✗ Failed to load image: {image_path}")
            return
        
        logger.info("✓ Image loaded successfully")
        
        # Test 1: OCR on original image
        logger.info("\n[TEST 1] OCR on ORIGINAL image")
        logger.info("-" * 70)
        result_original = ocr.ocr(image, cls=True)
        
        if result_original and result_original[0]:
            logger.info(f"Found {len(result_original[0])} text blocks:")
            full_text = []
            for i, line in enumerate(result_original[0]):
                text = line[1][0]
                conf = line[1][1]
                full_text.append(text)
                logger.info(f"  Block {i+1}: [{conf:.2%}] {text}")
            
            combined = " ".join(full_text)
            logger.info(f"\nCombined text:\n{combined}\n")
        else:
            logger.warning("✗ No text detected in original image")
        
        # Test 2: OCR on preprocessed image
        logger.info("\n[TEST 2] OCR on PREPROCESSED image")
        logger.info("-" * 70)
        preprocessed = preprocess_image(image, debug=True)
        result_preproc = ocr.ocr(preprocessed, cls=True)
        
        if result_preproc and result_preproc[0]:
            logger.info(f"Found {len(result_preproc[0])} text blocks:")
            full_text = []
            for i, line in enumerate(result_preproc[0]):
                text = line[1][0]
                conf = line[1][1]
                full_text.append(text)
                logger.info(f"  Block {i+1}: [{conf:.2%}] {text}")
            
            combined = " ".join(full_text)
            logger.info(f"\nCombined text:\n{combined}\n")
        else:
            logger.warning("✗ No text detected in preprocessed image")
        
        # Save preprocessed image for inspection
        output_path = Path(image_path).stem + "_preprocessed.jpg"
        cv2.imwrite(output_path, preprocessed)
        logger.info(f"✓ Saved preprocessed image to: {output_path}")
        
        logger.info(f"\n{'='*70}")
        logger.info("RECOMMENDATIONS:")
        logger.info("  • If preprocessed is better: use new preprocessing")
        logger.info("  • If both fail: image quality may be too low")
        logger.info("  • Check saved _preprocessed.jpg to see what OCR sees")
        logger.info(f"{'='*70}\n")
        
    except Exception as e:
        logger.error(f"✗ Error during OCR test: {e}", exc_info=True)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        logger.error("Usage: python test_ocr.py <image_path>")
        logger.info("\nExample:")
        logger.info("  python test_ocr.py ~/photo.jpg")
        logger.info("  python test_ocr.py C:\\Users\\You\\Downloads\\product.png")
        sys.exit(1)
    
    image_path = sys.argv[1]
    test_ocr(image_path)
