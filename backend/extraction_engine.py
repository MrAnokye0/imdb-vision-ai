"""
Rule-based extraction engine for IMDB fields.
Uses OCR output + keyword matching + regex patterns.
"""

import json
import logging
import re
from typing import Dict, Optional, List, Tuple
from pathlib import Path
import difflib

from patterns import (
    extract_weight, extract_country, extract_barcode, extract_packaging,
    extract_category, extract_segment, extract_marketing_message,
    classify_image_text, IMAGE_TYPE_FRONT_LABEL, IMAGE_TYPE_MANUFACTURER_SIDE,
    IMAGE_TYPE_BARCODE_SIDE, IMAGE_TYPE_INGREDIENTS_SIDE, IMAGE_TYPE_UNKNOWN
)
from validators import (
    validate_barcode, validate_weight, validate_country, validate_packaging,
    validate_brand, validate_product_name, validate_manufacturer,
    validate_category, validate_segment, validate_marketing_message
)

logger = logging.getLogger(__name__)

# ─── Knowledge Base ───────────────────────────────────────────────────────────

class KnowledgeBase:
    def __init__(self, json_path: str = "knowledge_base.json"):
        self.brands: Dict = {}
        self._load(json_path)
    
    def _load(self, json_path: str):
        """Load knowledge base from JSON file."""
        try:
            if Path(json_path).exists():
                with open(json_path, 'r', encoding='utf-8') as f:
                    self.brands = json.load(f)
                logger.info(f"Loaded {len(self.brands)} brands from knowledge base")
        except Exception as e:
            logger.warning(f"Failed to load knowledge base: {e}")
    
    def lookup(self, brand: str) -> Optional[Dict]:
        """Look up brand metadata."""
        if not brand:
            return None
        
        # Exact match
        if brand in self.brands:
            return self.brands[brand]
        
        # Case-insensitive match
        brand_lower = brand.lower()
        for key, value in self.brands.items():
            if key.lower() == brand_lower:
                return value
        
        # Fuzzy match (using difflib)
        matches = difflib.get_close_matches(brand, self.brands.keys(), n=1, cutoff=0.85)
        if matches:
            return self.brands[matches[0]]
        
        return None

# ─── Extraction Engine ────────────────────────────────────────────────────────

class ExtractionEngine:
    def __init__(self, knowledge_base_path: str = "knowledge_base.json"):
        self.kb = KnowledgeBase(knowledge_base_path)
    
    def extract_from_ocr(
        self,
        ocr_texts: List[str],
        ocr_blocks: Optional[List[List[dict]]] = None,
        image_types: Optional[List[str]] = None,
        barcodes: Optional[List[str]] = None,
    ) -> Dict:
        """
        Extract IMDB fields from OCR texts (multiple images).
        
        Args:
            ocr_texts: List of OCR text outputs, one per image
            ocr_blocks: Optional structured OCR blocks per image
            image_types: Optional list of pre-classified image types
            barcodes: Optional list of barcode strings detected per image
        
        Returns:
            Dictionary with extracted fields and confidence scores
        """
        if barcodes is None:
            barcodes = [None] * len(ocr_texts)

        if ocr_blocks is None:
            ocr_blocks = [[] for _ in ocr_texts]

        if image_types is None or len(image_types) != len(ocr_texts):
            image_types = [
                classify_image_text(text, barcode_detected=bool(barcode))
                for text, barcode in zip(ocr_texts, barcodes)
            ]

        combined_text = "\n".join(ocr_texts)
        combined_lower = combined_text.lower()

        front_texts = [text for text, t in zip(ocr_texts, image_types) if t == IMAGE_TYPE_FRONT_LABEL]
        manufacturer_texts = [text for text, t in zip(ocr_texts, image_types) if t == IMAGE_TYPE_MANUFACTURER_SIDE]
        barcode_texts = [text for text, t in zip(ocr_texts, image_types) if t == IMAGE_TYPE_BARCODE_SIDE]
        ingredients_texts = [text for text, t in zip(ocr_texts, image_types) if t == IMAGE_TYPE_INGREDIENTS_SIDE]
        unknown_texts = [text for text, t in zip(ocr_texts, image_types) if t == IMAGE_TYPE_UNKNOWN]

        front_blocks = [blocks for blocks, t in zip(ocr_blocks, image_types) if t == IMAGE_TYPE_FRONT_LABEL]

        front_text = "\n".join(front_texts).strip()
        manufacturer_text = "\n".join(manufacturer_texts).strip()
        barcode_text = "\n".join(barcode_texts).strip()
        ingredients_text = "\n".join(ingredients_texts).strip()
        unknown_text = "\n".join(unknown_texts).strip()

        # Extract all fields
        results = {}
        field_confidences = {}
        source_map = {}

        source_map['imageTypes'] = image_types

        # ─── Barcode ──────────────────────────────────────────────────────
        barcode_candidate = None
        for barcode in barcodes:
            if barcode:
                barcode_candidate = barcode.strip()
                break

        if barcode_candidate:
            is_valid, fmt, conf = validate_barcode(barcode_candidate)
            if is_valid:
                results['barcode'] = barcode_candidate
                field_confidences['barcode'] = 1.0
                source_map['barcode'] = "pyzbar"
            else:
                results['barcode'] = barcode_candidate
                field_confidences['barcode'] = 0.0
                source_map['barcode'] = "pyzbar_invalid_length"
        else:
            results['barcode'] = ""
            field_confidences['barcode'] = 0.0
            source_map['barcode'] = "none"

        # ─── Weight/Volume ────────────────────────────────────────────────
        weight_source = front_text or combined_text
        weight = extract_weight(weight_source)
        if weight:
            is_valid, normalized, conf = validate_weight(weight)
            results['weightUnit'] = normalized
            field_confidences['weightUnit'] = conf
            source_map['weightUnit'] = "front_label" if front_text else "combined"

            weight_count = sum(1 for text in ocr_texts if extract_weight(text))
            if weight_count >= 2:
                field_confidences['weightUnit'] = min(1.0, conf + 0.1)
        else:
            results['weightUnit'] = ""
            field_confidences['weightUnit'] = 0.0
            source_map['weightUnit'] = "none"

        # ─── Country of Origin ────────────────────────────────────────────
        country_source = manufacturer_text or combined_text
        country = extract_country(country_source)
        if country:
            is_valid, normalized, conf = validate_country(country)
            results['countryOfOrigin'] = normalized
            field_confidences['countryOfOrigin'] = conf
            source_map['countryOfOrigin'] = "manufacturer_side" if manufacturer_text else "combined"
        else:
            results['countryOfOrigin'] = ""
            field_confidences['countryOfOrigin'] = 0.0
            source_map['countryOfOrigin'] = "none"

        # ─── Packaging Type ───────────────────────────────────────────────
        packaging_source = front_text or unknown_text or combined_text
        packaging = extract_packaging(packaging_source)
        if packaging:
            is_valid, normalized, conf = validate_packaging(packaging)
            results['packagingType'] = normalized
            field_confidences['packagingType'] = conf
            source_map['packagingType'] = "front_label"
        else:
            results['packagingType'] = ""
            field_confidences['packagingType'] = 0.0
            source_map['packagingType'] = "none"

        # ─── Category ─────────────────────────────────────────────────────
        category_source = ingredients_text or front_text or combined_text
        category = extract_category(category_source)
        if category:
            is_valid, normalized, conf = validate_category(category)
            results['categoryType'] = normalized
            field_confidences['categoryType'] = conf if is_valid else 0.6
            source_map['categoryType'] = "ingredients_side" if ingredients_text else "combined"
        else:
            results['categoryType'] = ""
            field_confidences['categoryType'] = 0.0
            source_map['categoryType'] = "none"

        # ─── Segment ──────────────────────────────────────────────────────
        segment_source = ingredients_text or front_text or combined_text
        segment = extract_segment(segment_source)
        if segment:
            is_valid, normalized, conf = validate_segment(segment)
            results['segmentType'] = normalized
            field_confidences['segmentType'] = conf
            source_map['segmentType'] = "ingredients_side"
        else:
            results['segmentType'] = ""
            field_confidences['segmentType'] = 0.0
            source_map['segmentType'] = "none"

        # ─── Marketing Message ────────────────────────────────────────────
        marketing_source = front_text or ingredients_text or combined_text
        marketing = extract_marketing_message(marketing_source)
        if marketing:
            is_valid, normalized, conf = validate_marketing_message(marketing)
            results['marketingMessage'] = normalized
            field_confidences['marketingMessage'] = conf
            source_map['marketingMessage'] = "front_label"
        else:
            results['marketingMessage'] = ""
            field_confidences['marketingMessage'] = 0.0
            source_map['marketingMessage'] = "none"

        # ─── Brand ──────────────────────────────────────────────────────
        brand = self._extract_brand(
            front_texts or ocr_texts,
            front_blocks or ocr_blocks,
        )
        if brand:
            is_valid, normalized, conf = validate_brand(brand)
            results['brand'] = normalized
            field_confidences['brand'] = conf
            source_map['brand'] = "front_label" if front_texts else "text_extraction"
        else:
            results['brand'] = ""
            field_confidences['brand'] = 0.0
            source_map['brand'] = "none"

        # ─── Manufacturer (from knowledge base) ────────────────────────────
        manufacturer = ""
        manufacturer_conf = 0.0
        if results.get('brand'):
            kb_entry = self.kb.lookup(results['brand'])
            if kb_entry and kb_entry.get('manufacturer'):
                manufacturer = kb_entry['manufacturer']
                manufacturer_conf = 0.95
                source_map['manufacturer'] = "knowledge_base"

                if not results.get('categoryType') and kb_entry.get('category'):
                    results['categoryType'] = kb_entry['category']
                    field_confidences['categoryType'] = 0.92
                    source_map['categoryType'] = "knowledge_base"

                if not results.get('segmentType') and kb_entry.get('segment'):
                    results['segmentType'] = kb_entry['segment']
                    field_confidences['segmentType'] = 0.92
                    source_map['segmentType'] = "knowledge_base"

        if not manufacturer and manufacturer_text:
            manufacturer = self._extract_manufacturer_from_text(manufacturer_text)
            if manufacturer:
                is_valid, normalized, conf = validate_manufacturer(manufacturer)
                manufacturer = normalized
                manufacturer_conf = conf
                source_map['manufacturer'] = "manufacturer_side"

        results['manufacturer'] = manufacturer
        field_confidences['manufacturer'] = manufacturer_conf

        # ─── Product Name ─────────────────────────────────────────────────
        product_name = self._extract_product_name(front_texts, results.get('brand', ''))
        if product_name:
            is_valid, normalized, conf = validate_product_name(product_name)
            results['productName'] = normalized
            field_confidences['productName'] = conf
            source_map['productName'] = "front_label"
        else:
            results['productName'] = ""
            field_confidences['productName'] = 0.0
            source_map['productName'] = "none"

        # Overall confidence (weighted average)
        weights = {
            'barcode': 1.0,
            'brand': 1.2,
            'productName': 1.1,
            'weightUnit': 0.8,
            'categoryType': 0.9,
            'segmentType': 0.7,
            'manufacturer': 0.9,
            'countryOfOrigin': 0.7,
            'packagingType': 0.8,
            'marketingMessage': 0.6,
        }
        
        total_weight = sum(weights.values())
        weighted_conf = sum(
            field_confidences.get(field, 0) * weights.get(field, 1.0)
            for field in weights
        ) / total_weight
        
        # Completeness score (0-1)
        populated_fields = sum(
            1 for field in results
            if results[field] and results[field].strip() and field_confidences.get(field, 0) > 0.3
        )
        completeness_score = min(1.0, populated_fields / 10)
        
        # Overall confidence = weighted avg * completeness
        overall_confidence = min(1.0, weighted_conf * (0.5 + completeness_score * 0.5))
        
        # Missing fields
        missing_fields = [
            field for field in results
            if not results[field] or not results[field].strip()
        ]
        
        return {
            'product': {
                'barcode': results.get('barcode', ''),
                'categoryType': results.get('categoryType', ''),
                'segmentType': results.get('segmentType', ''),
                'manufacturer': results.get('manufacturer', ''),
                'brand': results.get('brand', ''),
                'productName': results.get('productName', ''),
                'weightUnit': results.get('weightUnit', ''),
                'packagingType': results.get('packagingType', ''),
                'countryOfOrigin': results.get('countryOfOrigin', ''),
                'marketingMessage': results.get('marketingMessage', ''),
                'confidenceScore': round(overall_confidence, 2),
            },
            'field_confidences': {
                k: round(v, 2) for k, v in field_confidences.items()
            },
            'completeness_score': round(completeness_score, 2),
            'missing_fields': missing_fields,
            'sources': source_map,
        }
    
    def _extract_brand(self, ocr_texts: List[str], ocr_blocks: Optional[List[List[dict]]] = None) -> Optional[str]:
        """
        Extract brand name from OCR texts and optional OCR blocks.
        Strategy: Prefer large front image blocks in the top 30% of the image,
        excluding marketing, ingredient, and address text.
        """
        if ocr_blocks:
            candidate = self._extract_brand_from_blocks(ocr_blocks)
            if candidate:
                return candidate

        if not ocr_texts:
            return None
        
        for text in ocr_texts:
            if not text:
                continue
            
            # Split into lines
            lines = text.split('\n')
            lines = [l.strip() for l in lines if l.strip()]
            
            if not lines:
                continue
            
            candidates = [
                line for line in lines[:5]
                if line and (line.isupper() or (line[0].isupper() and len(line) >= 2))
                and not self._is_brand_reject_text(line)
            ]
            
            if candidates:
                return candidates[0]
            
            for line in lines:
                if not self._is_brand_reject_text(line):
                    return line
        
        return None

    def _extract_brand_from_blocks(self, ocr_blocks_per_image: List[List[dict]]) -> Optional[str]:
        candidates = []

        for blocks in ocr_blocks_per_image:
            if not blocks:
                continue

            image_height = 0
            for block in blocks:
                box = block.get('box', [])
                if box:
                    ys = [point[1] for point in box]
                    image_height = max(image_height, max(ys))

            if image_height <= 0:
                continue

            for block in blocks:
                text = str(block.get('text', '')).strip()
                if not text or self._is_brand_reject_text(text):
                    continue

                box = block.get('box', [])
                if len(box) != 4:
                    continue

                ys = [point[1] for point in box]
                xs = [point[0] for point in box]
                center_y = sum(ys) / len(ys)
                width = max(xs) - min(xs)
                height = max(ys) - min(ys)
                area = max(width * height, 1)
                top_region = center_y <= image_height * 0.3

                candidates.append({
                    'text': text,
                    'area': area,
                    'top': top_region,
                    'center_y': center_y,
                })

        if not candidates:
            return None

        top_candidates = [c for c in candidates if c['top']]
        chosen = None
        if top_candidates:
            chosen = max(top_candidates, key=lambda x: x['area'])
        else:
            chosen = max(candidates, key=lambda x: x['area'])

        return chosen['text'] if chosen else None

    def _is_brand_reject_text(self, text: str) -> bool:
        text_lower = text.lower()
        reject_keywords = [
            'ingredients', 'nutrition', 'warning', 'directions', 'preservation',
            'storage', 'address', 'manufactured by', 'distributed by', 'packed by',
            'imported by', 'made in', 'made by', 'country of origin', 'best seller',
            'limited edition', 'sugar free', 'gluten free', 'organic', 'no added sugar',
            'new', 'www.', 'http', 'phone', 'tel', 'fax', 'email', '@', 'street',
            'road', 'lane', 'avenue', 'city', 'postal', 'zip', 'postcode', 'barcode'
        ]
        return any(keyword in text_lower for keyword in reject_keywords)

    def _extract_manufacturer_from_text(self, text: str) -> Optional[str]:
        """Extract manufacturer/company name from manufacturer side text."""
        if not text:
            return None

        lines = [line.strip() for line in text.split('\n') if line.strip()]
        label_patterns = [
            r'manufactured by',
            r'manufactured for',
            r'manufacturer',
            r'packed by',
            r'distributed by',
            r'imported by',
            r'made by',
            r'made in',
        ]
        label_regex = re.compile(rf"^(?:{'|'.join(label_patterns)})\s*[:\-]?\s*(.*)$", re.IGNORECASE)

        # Prefer company on the same line after the label
        for line in lines:
            match = label_regex.match(line)
            if match:
                candidate = match.group(1).strip(' .,-')
                if candidate:
                    return candidate

        # Then prefer company on the next line after a label-only line
        for index, line in enumerate(lines):
            if any(re.search(rf"\b{pattern}\b", line, re.IGNORECASE) for pattern in label_patterns):
                if index + 1 < len(lines):
                    next_line = lines[index + 1].strip(' .,-')
                    if next_line and not re.search(r'\b(?:address|phone|tel|fax|website|www|http|barcode)\b', next_line, re.IGNORECASE):
                        return next_line

        # Fallback: first clean line that is not an address or contact block
        for line in lines:
            if len(line) > 3 and not re.search(r'\b(?:address|phone|tel|fax|website|www|http)\b', line, re.IGNORECASE):
                return line

        return None

    def _extract_product_name(self, ocr_texts: List[str], brand: str) -> Optional[str]:
        """
        Extract product name from front label text only.
        Strategy: derive a product title from brand + variant lines while
        excluding ingredient, marketing, address, and preservation text.
        """
        if not ocr_texts:
            return None

        def is_reject_line(line: str) -> bool:
            reject_keywords = [
                'ingredient', 'nutrition', 'warning', 'caution', 'directions',
                'preservation', 'storage', 'manufacturer', 'manufactured by',
                'manufactured for', 'distributed by', 'packed by', 'imported by',
                'made in', 'address', 'best seller', 'limited edition',
                'sugar free', 'gluten free', 'organic', 'new', 'buy', 'free',
                'www.', 'http', 'phone', 'tel', 'fax', 'email', '@', 'street',
                'road', 'lane', 'avenue', 'city', 'postal', 'zip', 'postcode',
                'barcode', 'net wt', 'net weight'
            ]
            line_lower = line.lower()
            return any(keyword in line_lower for keyword in reject_keywords)

        for text in ocr_texts:
            if not text:
                continue

            lines = [l.strip() for l in text.split('\n') if l.strip() and len(l.strip()) >= 2]
            if not lines:
                continue

            # Build candidate lines only from non-reject lines
            product_lines = []
            for line in lines:
                if not line:
                    continue
                if is_reject_line(line):
                    continue
                if brand and line.lower() == brand.lower():
                    product_lines.append(line)
                    continue
                # Skip pure numeric or single-character lines that are not informative
                if len(line) < 3 or re.fullmatch(r'[\W\d]+', line):
                    continue
                product_lines.append(line)

            if not product_lines:
                continue

            # If brand is present, keep it first and add following variant lines
            selected = []
            normalized_brand = brand.strip() if brand else ''
            if normalized_brand:
                for line in product_lines:
                    if line.lower() == normalized_brand.lower():
                        selected.append(line)
                        continue
                    if selected:
                        selected.append(line)
                    else:
                        # allow brand-like first line if the brand isn't matched exactly
                        if len(selected) == 0 and line[0].isupper():
                            selected.append(line)
                if selected:
                    return ' '.join(dict.fromkeys(selected))

            # Otherwise use first 2-3 candidate lines from front label
            selected = []
            for line in product_lines:
                if len(selected) >= 3:
                    break
                selected.append(line)

            if selected:
                return ' '.join(dict.fromkeys(selected))

        return None
