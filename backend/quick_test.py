"""
QUICK START: Test OCR in 60 seconds
Usage: python quick_test.py <image_path>
"""

import sys
import cv2
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

try:
    from paddleocr import PaddleOCR
except ImportError:
    logger.error("❌ PaddleOCR not installed")
    logger.info("Run: pip install paddleocr")
    sys.exit(1)

def quick_test(image_path):
    """Run OCR on image and show results."""
    if not Path(image_path).exists():
        logger.error(f"❌ File not found: {image_path}")
        return
    
    logger.info("Loading image...")
    img = cv2.imread(image_path)
    if img is None:
        logger.error(f"❌ Cannot read image: {image_path}")
        return
    
    h, w = img.shape[:2]
    logger.info(f"✓ Image loaded: {w}x{h}px")
    
    logger.info("Loading OCR model...")
    ocr = PaddleOCR(use_angle_cls=True, lang='en')
    logger.info("✓ OCR ready")
    
    logger.info("\n🔍 Running OCR...\n")
    result = ocr.ocr(img, cls=True)
    
    if result and result[0]:
        logger.info(f"📄 Found {len(result[0])} text blocks:\n")
        texts = []
        for i, line in enumerate(result[0], 1):
            text = line[1][0]
            conf = line[1][1]
            texts.append(text)
            logger.info(f"  {i}. [{conf*100:.0f}%] {text}")
        
        logger.info(f"\n✓ Combined text:\n  {' '.join(texts)}\n")
        return True
    else:
        logger.warning("\n⚠️  No text detected by OCR\n")
        return False

if __name__ == "__main__":
    if len(sys.argv) < 2:
        logger.error("Usage: python quick_test.py <image_path>")
        logger.info("Example: python quick_test.py photo.jpg")
        sys.exit(1)
    
    success = quick_test(sys.argv[1])
    sys.exit(0 if success else 1)
