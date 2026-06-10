# IMDB Vision AI - Backend Service

Python FastAPI backend for rule-based product extraction without Gemini.

## Features

- **PaddleOCR** - High-accuracy text extraction from product images
- **Pyzbar** - Robust barcode scanning (EAN-13, UPC-A, etc.)
- **Rule-Based Extraction** - Regex + keyword matching for all IMDB fields
- **Knowledge Base** - 50+ brands with manufacturer/category mappings
- **Multi-Image Processing** - Process front, back, side, barcode images together
- **Confidence Scoring** - Per-field confidence (0-1) + overall completeness score
- **Field Validation** - Format checking for barcode, weight, country, packaging, etc.
- **Zero Gemini Dependency** - Completely offline extraction

## Installation

### Prerequisites

- Python 3.8+
- Windows, macOS, or Linux

### Setup

1. **Create virtual environment** (recommended):
```bash
cd backend
python -m venv venv

# Activate on Windows
venv\Scripts\activate

# Activate on macOS/Linux
source venv/bin/activate
```

2. **Install dependencies**:
```bash
pip install -r requirements.txt
```

This will install:
- FastAPI & Uvicorn (API server)
- PaddleOCR (text extraction)
- pyzbar (barcode detection)
- OpenCV, Pillow (image processing)
- Pydantic (data validation)

**Installation time**: ~5-10 minutes on first run (PaddleOCR downloads ~100MB models)

## Running the Server

### Development Mode

```bash
python app.py
```

The server will start at `http://localhost:8000`

### Production Mode

```bash
uvicorn app:app --host 0.0.0.0 --port 8000 --workers 2
```

### API Documentation

Once running, visit:
- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`

## API Endpoints

### POST /extract

Extract IMDB fields from product images.

**Request:**
```json
{
  "images": ["base64_image_1", "base64_image_2"],
  "image_types": ["front", "back"],
  "processing": {
    "enable_ocr": true,
    "enable_barcode": true
  }
}
```

**Response:**
```json
{
  "product": {
    "barcode": "5901234123457",
    "brand": "Milo",
    "productName": "Milo Chocolate Malt Drink 400g",
    "weightUnit": "400g",
    "categoryType": "Beverages",
    "segmentType": "Chocolate Malt Drink",
    "manufacturer": "Nestlé",
    "countryOfOrigin": "Malaysia",
    "packagingType": "Tin",
    "marketingMessage": "Extra Strength",
    "confidenceScore": 0.92
  },
  "field_confidences": {
    "barcode": 0.98,
    "brand": 0.95,
    ...
  },
  "completeness_score": 0.95,
  "missing_fields": [],
  "sources": {
    "barcode": "pyzbar/EAN-13",
    "brand": "text_extraction",
    ...
  }
}
```

### POST /ocr

Extract text from a single image.

**Request:** Multipart form with image file

**Response:**
```json
{
  "text": "Milo\nChocolate Malt Drink\n400g\nMade in Malaysia",
  "file_name": "product.jpg",
  "status": "success"
}
```

### POST /barcode

Detect barcode in a single image.

**Request:** Multipart form with image file

**Response:**
```json
{
  "barcode": "5901234123457",
  "file_name": "barcode.jpg",
  "status": "success"
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "service": "Product Extraction Engine"
}
```

## Configuration

### Knowledge Base

Edit `knowledge_base.json` to add or update brands:

```json
{
  "Your Brand": {
    "manufacturer": "Your Company",
    "category": "Beverages",
    "segment": "Chocolate Malt Drink",
    "common_sizes": ["400g", "500g"],
    "common_packaging": ["Tin"],
    "country_origin": "Malaysia"
  }
}
```

### Extraction Rules

Modify `patterns.py` to add new regex patterns or keywords:
- Weight patterns
- Country patterns
- Packaging keywords
- Category/segment keywords
- Marketing message patterns

### Validators

Update `validators.py` to customize validation rules:
- Valid countries database
- Barcode format patterns
- Weight regex
- Packaging types
- Categories

## Performance

- **Single image**: ~2-3 seconds (includes PaddleOCR model load)
- **Multi-image (3 images)**: ~5-7 seconds
- **Memory usage**: ~1.5GB (PaddleOCR model in RAM)

### Tips for Faster Response Times

1. Run in production mode with multiple workers
2. Pre-warm the API with a dummy request on startup
3. Use a dedicated GPU (with CUDA-enabled OpenCV/PaddleOCR)

## Troubleshooting

### PaddleOCR not found
```bash
pip install paddleocr
```

### pyzbar not working on Windows
Install with conda:
```bash
conda install -c conda-forge pyzbar
```

### Port 8000 already in use
Use a different port:
```bash
python app.py --port 8001
```

### Slow OCR on first request
PaddleOCR downloads ~100MB of models on first run. Subsequent requests are faster.

## Architecture

```
app.py
├── FastAPI server + endpoints
├── Image preprocessing (OpenCV)
├── OCR (PaddleOCR)
├── Barcode detection (pyzbar)
│
extraction_engine.py
├── Rule-based field extraction
├── Knowledge base lookup
├── Confidence scoring
├── Completeness calculation
│
patterns.py
├── Regex patterns for each field
├── Keyword matching functions
│
validators.py
├── Field format validators
├── Country database
├── Packaging types
├── Categories
│
knowledge_base.json
├── 50+ brands with metadata
└── Manufacturer/category mappings
```

## Deployment

### Docker

```dockerfile
FROM python:3.9-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Heroku / Cloud Run

Set environment variable:
```bash
PYTHONUNBUFFERED=1
```

### AWS Lambda

Use with API Gateway + Lambda layer for dependencies.

## Contributing

To add new extraction rules:

1. Add regex patterns to `patterns.py`
2. Add validator to `validators.py`
3. Update `extraction_engine.py` extraction logic
4. Test with sample images

## License

Part of IMDB Vision AI - Retail Product Extraction System
