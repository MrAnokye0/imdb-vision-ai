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
    extract_weight_str, extract_country, extract_barcode, extract_packaging,
    extract_category, extract_segment, extract_marketing_message,
    classify_image_text, IMAGE_TYPE_FRONT_LABEL, IMAGE_TYPE_MANUFACTURER_SIDE,
    IMAGE_TYPE_BARCODE_SIDE, IMAGE_TYPE_INGREDIENTS_SIDE, IMAGE_TYPE_UNKNOWN,
)
from validators import (
    validate_barcode, validate_weight, validate_country, validate_packaging,
    validate_brand, validate_product_name, validate_manufacturer,
    validate_category, validate_segment, validate_marketing_message,
    get_needs_review_fields, REVIEW_THRESHOLD,
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

    def lookup_brand_name(self, brand: str) -> Optional[str]:
        """Return the canonical brand name key for a brand text."""
        if not brand:
            return None

        normalized = brand.strip()
        if normalized in self.brands:
            return normalized

        brand_lower = normalized.lower()
        for key in self.brands.keys():
            if key.lower() == brand_lower:
                return key

        # Attempt a fuzzy match with noise-tolerant normalization
        search_key = re.sub(r"[^A-Za-z0-9 ]", "", brand_lower)
        candidates = [re.sub(r"[^A-Za-z0-9 ]", "", k.lower()) for k in self.brands.keys()]
        matches = difflib.get_close_matches(search_key, candidates, n=1, cutoff=0.75)
        if matches:
            matched_index = candidates.index(matches[0])
            return list(self.brands.keys())[matched_index]

        matches = difflib.get_close_matches(normalized, self.brands.keys(), n=1, cutoff=0.75)
        if matches:
            return matches[0]

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
        frontend_labels: Optional[List[str]] = None,
        rekognition_hints: Optional[dict] = None,
    ) -> Dict:
        """
        Extract IMDB fields from OCR texts (multiple images).

        Args:
            ocr_texts:           One OCR text string per image.
            ocr_blocks:          Optional structured PaddleOCR blocks per image.
            image_types:         Optional pre-classified pipeline image types.
            barcodes:            Optional pyzbar barcode string per image.
            frontend_labels:     Optional user-assigned labels from the UploadZone
                                 session panel (Front/Back/Barcode/Ingredients/Other).
            rekognition_hints:   Optional dict with keys:
                                   categoryType, segmentType, packagingType, confidence
                                 injected from AWS Rekognition visual classification.
        """
        if barcodes is None:
            barcodes = [None] * len(ocr_texts)
        if ocr_blocks is None:
            ocr_blocks = [[] for _ in ocr_texts]
        if frontend_labels is None:
            frontend_labels = [None] * len(ocr_texts)

        # Classify each image, preferring the explicit frontend label
        if image_types is None or len(image_types) != len(ocr_texts):
            image_types = [
                classify_image_text(
                    text,
                    barcode_detected=bool(barcode),
                    frontend_label=fl,
                )
                for text, barcode, fl in zip(ocr_texts, barcodes, frontend_labels)
            ]

        combined_text = "\n".join(ocr_texts)

        front_texts        = [t for t, tp in zip(ocr_texts, image_types) if tp == IMAGE_TYPE_FRONT_LABEL]
        manufacturer_texts = [t for t, tp in zip(ocr_texts, image_types) if tp == IMAGE_TYPE_MANUFACTURER_SIDE]
        ingredients_texts  = [t for t, tp in zip(ocr_texts, image_types) if tp == IMAGE_TYPE_INGREDIENTS_SIDE]
        front_blocks       = [b for b, tp in zip(ocr_blocks, image_types) if tp == IMAGE_TYPE_FRONT_LABEL]

        front_text        = "\n".join(front_texts).strip()
        manufacturer_text = "\n".join(manufacturer_texts).strip()
        ingredients_text  = "\n".join(ingredients_texts).strip()

        results           : Dict = {}
        field_confidences : Dict = {}
        source_map        : Dict = {'imageTypes': image_types}

        # ── Barcode ────────────────────────────────────────────────────────
        barcode_candidate = next((b.strip() for b in barcodes if b), None)
        if not barcode_candidate:
            # Fall back to regex scan across all texts
            for text in ocr_texts:
                found = extract_barcode(text)
                if found:
                    barcode_candidate = found
                    break

        if barcode_candidate:
            is_valid, fmt, conf = validate_barcode(barcode_candidate)
            results['barcode']             = barcode_candidate
            field_confidences['barcode']   = conf
            source_map['barcode']          = "pyzbar" if any(barcodes) else "regex"
        else:
            results['barcode']             = ""
            field_confidences['barcode']   = 0.0
            source_map['barcode']          = "none"

        # ── Weight/Volume ──────────────────────────────────────────────────
        weight_source = front_text or combined_text
        weight = extract_weight_str(weight_source)
        if not weight and manufacturer_text:
            weight = extract_weight_str(manufacturer_text)
        if weight:
            is_valid, normalized, conf = validate_weight(weight)
            # Boost confidence when the same value appears in multiple images
            corroboration = sum(1 for t in ocr_texts if extract_weight_str(t) == normalized)
            if corroboration >= 2:
                conf = min(1.0, conf + 0.1)
            results['weightUnit']           = normalized
            field_confidences['weightUnit'] = conf
            source_map['weightUnit']        = "front_label" if front_text else "combined"
        else:
            results['weightUnit']           = ""
            field_confidences['weightUnit'] = 0.0
            source_map['weightUnit']        = "none"

        # ── Country of Origin ──────────────────────────────────────────────
        country_source = manufacturer_text or combined_text
        country = extract_country(country_source)
        if country:
            is_valid, normalized, conf = validate_country(country)
            results['countryOfOrigin']           = normalized
            field_confidences['countryOfOrigin'] = conf
            source_map['countryOfOrigin']        = "manufacturer_side" if manufacturer_text else "combined"
        else:
            results['countryOfOrigin']           = ""
            field_confidences['countryOfOrigin'] = 0.0
            source_map['countryOfOrigin']        = "none"

        # ── Packaging Type ─────────────────────────────────────────────────
        # AWS Rekognition hint takes priority when confidence ≥ 0.7
        rek_packaging      = (rekognition_hints or {}).get('packagingType', '')
        rek_packaging_conf = (rekognition_hints or {}).get('confidence', 0) / 100 if rek_packaging else 0

        packaging = None
        pkg_conf  = 0.0
        pkg_src   = "none"

        if rek_packaging and rek_packaging_conf >= 0.70:
            packaging = rek_packaging
            pkg_conf  = rek_packaging_conf
            pkg_src   = "rekognition"
        else:
            packaging_source = front_text or combined_text
            packaging = extract_packaging(packaging_source)
            if packaging:
                _, packaging, pkg_conf = validate_packaging(packaging)
                pkg_src = "front_label"

        results['packagingType']           = packaging or ""
        field_confidences['packagingType'] = pkg_conf
        source_map['packagingType']        = pkg_src

        # ── Category ──────────────────────────────────────────────────────
        # AWS Rekognition hint takes priority when confidence ≥ 0.75
        rek_category      = (rekognition_hints or {}).get('categoryType', '')
        rek_category_conf = (rekognition_hints or {}).get('confidence', 0) / 100 if rek_category else 0

        category = None
        cat_conf = 0.0
        cat_src  = "none"

        if rek_category and rek_category_conf >= 0.75:
            category = rek_category
            cat_conf = rek_category_conf
            cat_src  = "rekognition"
        else:
            category_source = ingredients_text or front_text or combined_text
            category = extract_category(category_source)
            if category:
                is_valid, category, cat_conf = validate_category(category)
                if not is_valid:
                    cat_conf = 0.55
                cat_src = "ingredients_side" if ingredients_text else "combined"

        results['categoryType']           = category or ""
        field_confidences['categoryType'] = cat_conf
        source_map['categoryType']        = cat_src

        # ── Segment ────────────────────────────────────────────────────────
        rek_segment = (rekognition_hints or {}).get('segmentType', '')
        rek_seg_conf = rek_category_conf if rek_segment else 0

        segment = None
        seg_conf = 0.0
        seg_src  = "none"

        if rek_segment and rek_seg_conf >= 0.75:
            segment  = rek_segment
            seg_conf = rek_seg_conf
            seg_src  = "rekognition"
        else:
            segment_source = ingredients_text or front_text or combined_text
            segment = extract_segment(segment_source)
            if segment:
                _, segment, seg_conf = validate_segment(segment)
                seg_src = "ingredients_side" if ingredients_text else "combined"

        results['segmentType']           = segment or ""
        field_confidences['segmentType'] = seg_conf
        source_map['segmentType']        = seg_src

        # ── Marketing Message ──────────────────────────────────────────────
        marketing_source = front_text or ingredients_text or combined_text
        marketing = extract_marketing_message(marketing_source)
        if marketing:
            _, marketing, mkt_conf = validate_marketing_message(marketing)
            results['marketingMessage']           = marketing
            field_confidences['marketingMessage'] = mkt_conf
            source_map['marketingMessage']        = "front_label"
        else:
            results['marketingMessage']           = ""
            field_confidences['marketingMessage'] = 0.0
            source_map['marketingMessage']        = "none"

        # ── Brand ──────────────────────────────────────────────────────────
        brand = self._extract_brand(
            front_texts or ocr_texts,
            front_blocks or ocr_blocks,
        )
        if brand:
            is_valid, normalized, conf = validate_brand(brand)
            if conf >= 0.6:
                results['brand']           = normalized
                field_confidences['brand'] = conf
                source_map['brand']        = "front_label" if front_texts else "text_extraction"
            else:
                results['brand']           = ""
                field_confidences['brand'] = conf
                source_map['brand']        = "low_confidence"
        else:
            results['brand']           = ""
            field_confidences['brand'] = 0.0
            source_map['brand']        = "none"

        # ── Manufacturer ───────────────────────────────────────────────────
        manufacturer      = ""
        manufacturer_conf = 0.0
        if results.get('brand'):
            kb_entry = self.kb.lookup(results['brand'])
            if kb_entry and kb_entry.get('manufacturer'):
                manufacturer      = kb_entry['manufacturer']
                manufacturer_conf = 0.95
                source_map['manufacturer'] = "knowledge_base"

                # Fill category/segment from KB if Rekognition did not already provide them
                if not results.get('categoryType') and kb_entry.get('category'):
                    results['categoryType']           = kb_entry['category']
                    field_confidences['categoryType'] = 0.92
                    source_map['categoryType']        = "knowledge_base"
                if not results.get('segmentType') and kb_entry.get('segment'):
                    results['segmentType']           = kb_entry['segment']
                    field_confidences['segmentType'] = 0.92
                    source_map['segmentType']        = "knowledge_base"

        if not manufacturer and manufacturer_text:
            manufacturer = self._extract_manufacturer_from_text(manufacturer_text)
            if manufacturer:
                _, manufacturer, manufacturer_conf = validate_manufacturer(manufacturer)
                source_map['manufacturer'] = "manufacturer_side"

        results['manufacturer']           = manufacturer
        field_confidences['manufacturer'] = manufacturer_conf

        # ── Product Name ───────────────────────────────────────────────────
        product_name = self._extract_product_name(front_texts, results.get('brand', ''))
        if product_name:
            _, normalized, conf = validate_product_name(product_name)
            results['productName']           = normalized
            field_confidences['productName'] = conf
            source_map['productName']        = "front_label"
        else:
            results['productName']           = ""
            field_confidences['productName'] = 0.0
            source_map['productName']        = "none"

        # ── Weighted overall confidence ────────────────────────────────────
        weights = {
            'barcode':          1.0,
            'brand':            1.2,
            'productName':      1.1,
            'weightUnit':       0.8,
            'categoryType':     0.9,
            'segmentType':      0.7,
            'manufacturer':     0.9,
            'countryOfOrigin':  0.7,
            'packagingType':    0.8,
            'marketingMessage': 0.6,
        }
        total_weight   = sum(weights.values())
        weighted_conf  = sum(
            field_confidences.get(f, 0) * weights.get(f, 1.0) for f in weights
        ) / total_weight

        populated = sum(
            1 for f in results
            if results[f] and str(results[f]).strip() and field_confidences.get(f, 0) >= REVIEW_THRESHOLD
        )
        completeness_score   = min(1.0, populated / 10)
        overall_confidence   = min(1.0, weighted_conf * (0.5 + completeness_score * 0.5))

        missing_fields       = [f for f in results if not results[f] or not str(results[f]).strip()]
        needs_review_fields  = get_needs_review_fields(field_confidences)

        return {
            'product': {
                'barcode':          results.get('barcode', ''),
                'categoryType':     results.get('categoryType', ''),
                'segmentType':      results.get('segmentType', ''),
                'manufacturer':     results.get('manufacturer', ''),
                'brand':            results.get('brand', ''),
                'productName':      results.get('productName', ''),
                'weightUnit':       results.get('weightUnit', ''),
                'packagingType':    results.get('packagingType', ''),
                'countryOfOrigin':  results.get('countryOfOrigin', ''),
                'marketingMessage': results.get('marketingMessage', ''),
                'confidenceScore':  round(overall_confidence, 2),
            },
            'field_confidences':   {k: round(v, 2) for k, v in field_confidences.items()},
            'completeness_score':  round(completeness_score, 2),
            'missing_fields':      missing_fields,
            'needs_review_fields': needs_review_fields,
            'sources':             source_map,
        }

    def _extract_brand(self, ocr_texts: List[str], ocr_blocks: Optional[List[List[dict]]] = None) -> Optional[str]:
        """
        Extract brand name from OCR texts and optional OCR blocks.
        Strategy: Prefer known brands first, then layout/font height rules.
        """
        if not ocr_texts:
            return None

        lines: List[str] = []
        for text in ocr_texts:
            if not text:
                continue
            lines.extend([l.strip() for l in text.split('\n') if l.strip()])

        # Prefer a known brand name from the knowledge base if present.
        for line in lines:
            brand_name = self._brand_text_matches_known_brand(line)
            if brand_name:
                return brand_name

        if ocr_blocks:
            candidate = self._extract_brand_from_blocks(ocr_blocks)
            if candidate and self._is_likely_brand_line(candidate):
                return candidate

        if not lines:
            return None

        scored: List[Tuple[int, str]] = []
        for line in lines:
            normalized = self._normalize_candidate_line(line)
            if not self._is_likely_brand_line(normalized):
                continue

            score = 0
            if normalized.isupper():
                score += 3
            if normalized[0].isupper():
                score += 1
            if len(normalized) <= 20:
                score += 1
            if len(re.findall(r'[A-Za-z]', normalized)) >= 2:
                score += 1
            if ' ' in normalized:
                score += 1
            if re.search(r'\d', normalized):
                score -= 2
            if re.search(r'[~^_+=/\\|]', normalized):
                score -= 4
            if len(normalized) > 30:
                score -= 1
            if score >= 3:
                scored.append((score, normalized))

        if scored:
            scored.sort(key=lambda item: (-item[0], len(item[1])))
            return scored[0][1]

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

                if not self._is_likely_brand_line(text):
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

    def _normalize_candidate_line(self, line: str) -> str:
        return re.sub(r'\s+', ' ', line).strip()

    def _brand_text_matches_known_brand(self, line: str) -> Optional[str]:
        normalized = self._normalize_candidate_line(line)
        return self.kb.lookup_brand_name(normalized)

    def _is_likely_brand_line(self, line: str) -> bool:
        if not line:
            return False

        normalized = self._normalize_candidate_line(line)
        if len(normalized) < 2 or len(normalized) > 60:
            return False
        if self._is_brand_reject_text(normalized):
            return False
        if re.fullmatch(r'^[\W_]+$', normalized):
            return False

        cleaned = re.sub(r"[^A-Za-z0-9 '&\-]", '', normalized)
        if len(cleaned) / max(1, len(normalized)) < 0.75:
            return False
        if re.search(r'[~^_+=/\\|]', normalized):
            return False
        if normalized.isdigit():
            return False

        return True

    def _is_brand_reject_text(self, text: str) -> bool:
        text_lower = text.lower()
        reject_keywords = [
            'ingredients', 'nutrition', 'warning', 'directions', 'preservation',
            'storage', 'address', 'manufactured by', 'distributed by', 'packed by',
            'imported by', 'made in', 'made by', 'country of origin', 'best seller',
            'limited edition', 'sugar free', 'gluten free', 'organic', 'no added sugar',
            'new', 'www.', 'http', 'phone', 'tel', 'fax', 'email', '@', 'street',
            'road', 'lane', 'avenue', 'city', 'postal', 'zip', 'postcode', 'barcode',
            'soap', 'water', 'oil', 'liquid', 'product of', 'distributor', 'expiry', 'exp',
            'mfg', 'batch', 'lot', 'weight', 'net wt', 'net weight', 'volume', 'qty',
            'quantity', 'serving', 'size', 'calories', 'fat', 'cholesterol', 'sodium',
            'carbohydrate', 'protein', 'vitamins', 'calcium', 'iron', 'percent', 'daily value'
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
