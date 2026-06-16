"""
Regex patterns for extracting IMDB fields from OCR text.
Enhanced with richer weight/country/barcode patterns and
label-aware image classification (Front/Back/Barcode/Ingredients/Other).
"""

import re
from typing import Optional, Tuple, List

# ─── Weight/Volume Patterns ────────────────────────────────────────────────────
# Each pattern captures (number, unit).  We try multi-unit combos (e.g. 1 kg 500 g)
# before falling back to individual units.

WEIGHT_PATTERNS: List[str] = [
    # Explicit "Net Weight / Net Vol" prefix (highest confidence)
    r'net\s+(?:wt\.?|weight|vol\.?|volume)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(mg|g|kg|ml|cl|l\b|oz|lb|fl\.?\s*oz)',
    # Multi-component: e.g. "1 kg 500 g"  →  take first match
    r'(\d+(?:\.\d+)?)\s*(kg)\s+\d+(?:\.\d+)?\s*g',
    # Standard single unit
    r'(\d+(?:\.\d+)?)\s*(mg)',
    r'(\d+(?:\.\d+)?)\s*(kg)',
    r'(\d+(?:\.\d+)?)\s*(ml)',
    r'(\d+(?:\.\d+)?)\s*(cl)',
    r'(\d+(?:\.\d+)?)\s*(fl\.?\s*oz)',
    r'(\d+(?:\.\d+)?)\s*(oz)',
    r'(\d+(?:\.\d+)?)\s*(lb)',
    r'(\d+(?:\.\d+)?)\s*(g)\b',
    r'(\d+(?:\.\d+)?)\s*(l)\b',
    # Spelled-out units
    r'(\d+(?:\.\d+)?)\s*(?:millilitre|milliliter)s?',
    r'(\d+(?:\.\d+)?)\s*(?:litre|liter)s?',
    r'(\d+(?:\.\d+)?)\s*(?:kilogram)s?',
    r'(\d+(?:\.\d+)?)\s*(?:gram)s?',
    r'(\d+(?:\.\d+)?)\s*(?:ounce)s?',
    r'(\d+(?:\.\d+)?)\s*(?:pound)s?',
]

# Normalised unit map
_UNIT_NORM: dict = {
    "mg": "mg", "g": "g", "kg": "kg",
    "ml": "ml", "cl": "cl",
    "l": "l", "litre": "l", "liter": "l", "millilitre": "ml", "milliliter": "ml",
    "kilogram": "kg", "gram": "g",
    "oz": "oz", "ounce": "oz",
    "lb": "lb", "pound": "lb",
    "fl.oz": "fl oz", "floz": "fl oz", "fl oz": "fl oz",
}

def _normalise_unit(unit: str) -> str:
    key = re.sub(r'\s+', '', unit.lower().strip('.'))
    return _UNIT_NORM.get(key, unit.lower().strip())


# ─── Country of Origin Patterns ────────────────────────────────────────────────

COUNTRY_PATTERNS: List[str] = [
    r'(?:made|manufactured|produced|packed|assembled|bottled|imported)\s+in\s+([A-Za-z ,\-]{2,40})(?:\.|,|;|\n|$)',
    r'product\s+of\s+([A-Za-z ,\-]{2,40})(?:\.|,|;|\n|$)',
    r'country\s+of\s+origin\s*[:\-]?\s*([A-Za-z ,\-]{2,40})(?:\.|,|;|\n|$)',
    r'origin\s*[:\-]\s*([A-Za-z ,\-]{2,40})(?:\.|,|;|\n|$)',
]


# ─── Barcode Patterns ──────────────────────────────────────────────────────────

# Strict word-boundary 8/12/13/14 digit strings; avoid matching phone numbers
# by requiring they are not prefixed by + or common phone patterns.
BARCODE_PATTERN = r'(?<![+\d])(\d{14}|\d{13}|\d{12}|\d{8})(?!\d)'


# ─── Packaging Type Keywords ──────────────────────────────────────────────────

PACKAGING_KEYWORDS: dict = {
    'Bottle':    ['bottle', 'bottles', 'bottled', 'flask'],
    'Can':       ['can', 'cans', 'tin', 'tins', 'aluminium can', 'aluminum can'],
    'Carton':    ['box', 'boxes', 'carton', 'cartons', 'cardboard', 'paperboard'],
    'Bag':       ['bag', 'bags', 'foil bag', 'resealable bag'],
    'Pouch':     ['pouch', 'pouches', 'stand-up pouch', 'doy pack'],
    'Sachet':    ['sachet', 'sachets', 'single serve', 'single-serve', 'packet', 'packets'],
    'Jar':       ['jar', 'jars', 'glass jar', 'pot', 'pots'],
    'Tube':      ['tube', 'tubes', 'squeeze tube'],
    'Tub':       ['tub', 'tubs', 'container', 'containers', 'plastic container'],
    'Blister':   ['blister', 'blister pack', 'blister packaging'],
    'Pack':      ['pack', 'sleeve', 'tray'],
}


# ─── Category Keywords ────────────────────────────────────────────────────────

CATEGORY_KEYWORDS: dict = {
    'Beverages': [
        'beverage', 'drink', 'juice', 'water', 'soda', 'cola', 'beer', 'wine',
        'coffee', 'tea', 'smoothie', 'energy drink', 'sports drink',
        'soft drink', 'carbonated', 'chocolate drink', 'malt drink', 'cordial',
        'fruit drink', 'squash', 'nectar',
    ],
    'Snacks': [
        'snack', 'chip', 'crisp', 'biscuit', 'cookie', 'cracker', 'candy',
        'chocolate', 'wafer', 'pretzel', 'popcorn', 'granola', 'cereal bar',
        'trail mix', 'nut mix', 'peanut', 'cashew',
    ],
    'Dairy': [
        'milk', 'cheese', 'yogurt', 'yoghurt', 'butter', 'cream', 'ice cream',
        'custard', 'whey', 'dairy', 'lactose', 'ghee',
    ],
    'Personal Care': [
        'shampoo', 'conditioner', 'soap', 'lotion', 'cream', 'body wash',
        'cosmetic', 'skincare', 'beauty', 'moisturizer', 'moisturiser',
        'serum', 'essence', 'face wash', 'cleanser', 'deodorant', 'antiperspirant',
        'sunscreen', 'sunblock', 'hair oil', 'hair cream',
    ],
    'Oral Care': [
        'toothpaste', 'toothbrush', 'dental', 'mouth wash', 'mouthwash', 'floss',
        'tooth whitening', 'tooth gel', 'gum care',
    ],
    'Household': [
        'detergent', 'bleach', 'cleaner', 'dishwash', 'laundry', 'degreaser',
        'disinfectant', 'sanitizer', 'sanitiser', 'wipe', 'fabric softener',
        'stain remover', 'floor cleaner', 'toilet cleaner',
    ],
    'Grocery': [
        'flour', 'sugar', 'salt', 'rice', 'oil', 'sauce', 'pasta', 'noodle',
        'noodles', 'spice', 'seasoning', 'condiment', 'spread', 'jam', 'honey',
        'cooking oil', 'vinegar', 'soy sauce', 'tomato paste', 'stock cube',
        'cereal', 'oats', 'grain', 'pulses', 'lentils', 'beans', 'canned food',
    ],
    'Bakery': [
        'bread', 'cake', 'pastry', 'bun', 'croissant', 'donut', 'doughnut',
        'muffin', 'bagel', 'roll', 'loaf',
    ],
    'Healthcare': [
        'medicine', 'tablet', 'capsule', 'syrup', 'cough', 'cold', 'pain relief',
        'vitamin', 'supplement', 'herb', 'medicinal', 'pharmaceutical', 'health',
        'antibiotic', 'antifungal', 'antiseptic', 'paracetamol', 'ibuprofen',
    ],
    'Confectionery': [
        'chocolate', 'candy', 'sweet', 'sweets', 'lollipop', 'gum', 'caramel',
        'toffee', 'marshmallow', 'fudge', 'nougat',
    ],
    'Baby Products': [
        'baby', 'infant', 'diaper', 'nappy', 'formula', 'baby food', 'baby wipe',
    ],
    'Pet Care': [
        'pet food', 'dog food', 'cat food', 'kibble', 'animal feed', 'pet',
    ],
}


# ─── Segment Keywords ──────────────────────────────────────────────────────────

SEGMENT_KEYWORDS: dict = {
    'Carbonated Soft Drink':    ['carbonated', 'cola', 'lemonade', 'fanta', 'sprite', 'soda'],
    'Chocolate Malt Drink':     ['malt', 'milo', 'horlicks', 'ovomaltine', 'ovaltine'],
    'Coffee Beverage':          ['coffee', 'espresso', 'latte', 'cappuccino', 'americano'],
    'Tea Beverage':             ['tea', 'black tea', 'green tea', 'herbal tea', 'chai'],
    'Energy Drink':             ['energy drink', 'energy', 'redbull', 'red bull', 'monster'],
    'Sports Drink':             ['sports drink', 'isotonic', 'gatorade', 'powerade', 'electrolyte'],
    'Fruit Juice':              ['juice', 'orange juice', 'apple juice', 'concentrate', 'nectar'],
    'Milk-Based Beverage':      ['milk', 'dairy drink', 'milkshake'],
    'Potato Chips':             ['potato', 'chip', 'crisp', 'pringles'],
    'Biscuit / Cookie':         ['biscuit', 'cookie', 'cracker', 'wafer'],
    'Chocolate Confectionery':  ['chocolate bar', 'chocolate slab'],
    'Cough & Cold Relief':      ['cough', 'cold', 'catarrh', 'throat', 'nasal', 'flu'],
    'Pain Relief':              ['pain relief', 'headache', 'paracetamol', 'ibuprofen', 'aspirin'],
    'Vitamin & Supplement':     ['vitamin', 'supplement', 'mineral', 'zinc', 'iron'],
    'Laundry Detergent':        ['laundry', 'washing powder', 'fabric wash', 'washing liquid'],
    'Dish Washing':             ['dishwash', 'dish soap', 'washing up'],
}


# ─── Marketing Message Patterns ────────────────────────────────────────────────

MARKETING_PATTERNS: List[str] = [
    r'new\s+(?:and\s+improved|formula|recipe|look)',
    r'new\b',
    r'limited\s+edition',
    r'no\s+added\s+(?:sugar|salt|preservatives)',
    r'sugar[-\s]free',
    r'salt[-\s]free',
    r'organic',
    r'gluten[-\s]free',
    r'dairy[-\s]free',
    r'vegan',
    r'buy\s+\d+\s+get\s+\d+\s+(?:free)?',
    r'extra\s+strength',
    r'value\s+pack',
    r'free\s+from',
    r'high\s+(?:protein|fibre|fiber|calcium)',
    r'low\s+(?:fat|sugar|calorie|sodium)',
    r'100\s*%\s+(?:natural|pure|real)',
    r'fortified\s+with',
    r'enriched\s+with',
    r'best\s+seller',
    r'award\s+winning',
    r'clinically\s+(?:proven|tested)',
    r'dermatologically\s+tested',
    r'premium',
    r'natural',
]


# ─── Image Classification ──────────────────────────────────────────────────────
# Labels sent from the UploadZone session panel (Front/Back/Barcode/Ingredients/Other)
# map directly to the internal pipeline image types.

# Internal pipeline types
IMAGE_TYPE_FRONT_LABEL         = 'Front Label'
IMAGE_TYPE_MANUFACTURER_SIDE   = 'Manufacturer Side'
IMAGE_TYPE_BARCODE_SIDE        = 'Barcode Side'
IMAGE_TYPE_INGREDIENTS_SIDE    = 'Ingredients Side'
IMAGE_TYPE_UNKNOWN             = 'Unknown'

# Map from frontend label strings to internal types
_FRONTEND_LABEL_MAP: dict = {
    'front':       IMAGE_TYPE_FRONT_LABEL,
    'Front':       IMAGE_TYPE_FRONT_LABEL,
    'back':        IMAGE_TYPE_MANUFACTURER_SIDE,
    'Back':        IMAGE_TYPE_MANUFACTURER_SIDE,
    'barcode':     IMAGE_TYPE_BARCODE_SIDE,
    'Barcode':     IMAGE_TYPE_BARCODE_SIDE,
    'ingredients': IMAGE_TYPE_INGREDIENTS_SIDE,
    'Ingredients': IMAGE_TYPE_INGREDIENTS_SIDE,
    'other':       IMAGE_TYPE_UNKNOWN,
    'Other':       IMAGE_TYPE_UNKNOWN,
    # Legacy scan-workflow labels
    'front_label':      IMAGE_TYPE_FRONT_LABEL,
    'back_label':       IMAGE_TYPE_MANUFACTURER_SIDE,
    'side':             IMAGE_TYPE_MANUFACTURER_SIDE,
    'barcode_side':     IMAGE_TYPE_BARCODE_SIDE,
}

# Keywords used for heuristic classification when no explicit label is given
_FRONT_LABEL_KW         = ['net wt', 'net weight', 'net vol', 'volume', 'ml', ' g ', 'kg', 'oz',
                            'bottle', 'can', 'box', 'pack', 'new', 'organic', 'premium']
_MANUFACTURER_SIDE_KW   = ['manufactured by', 'manufactured for', 'made in', 'address',
                            'packed by', 'distributed by', 'imported by', 'factory',
                            'country of origin', 'tel', 'fax', 'email', 'www.']
_INGREDIENTS_SIDE_KW    = ['ingredients', 'contains', 'directions', 'preservation', 'warning',
                            'storage', 'nutrition facts', 'nutritional information',
                            'serve', 'use before', 'keep refrigerated', 'allergen',
                            'allergy advice', 'may contain']


def map_frontend_label(label: str) -> str:
    """Convert a frontend session image label to an internal pipeline type."""
    return _FRONTEND_LABEL_MAP.get(label, IMAGE_TYPE_UNKNOWN)


def classify_image_text(text: str, barcode_detected: bool = False,
                        frontend_label: Optional[str] = None) -> str:
    """
    Classify an image into a pipeline image type.

    Priority:
    1. Explicit frontend label (most reliable — user has already tagged it).
    2. Barcode detected by pyzbar.
    3. Heuristic keyword matching on OCR text.
    """
    # 1. Trust the explicit frontend label
    if frontend_label:
        mapped = map_frontend_label(frontend_label)
        if mapped != IMAGE_TYPE_UNKNOWN:
            return mapped

    # 2. Barcode scanner result
    if barcode_detected:
        return IMAGE_TYPE_BARCODE_SIDE

    if not text:
        return IMAGE_TYPE_UNKNOWN

    text_lower = text.lower()

    # 3. Barcode pattern in OCR text
    if re.search(BARCODE_PATTERN, text):
        return IMAGE_TYPE_BARCODE_SIDE

    # Score each type
    scores = {
        IMAGE_TYPE_MANUFACTURER_SIDE: sum(1 for kw in _MANUFACTURER_SIDE_KW if kw in text_lower),
        IMAGE_TYPE_INGREDIENTS_SIDE:  sum(1 for kw in _INGREDIENTS_SIDE_KW  if kw in text_lower),
        IMAGE_TYPE_FRONT_LABEL:       sum(1 for kw in _FRONT_LABEL_KW        if kw in text_lower),
    }
    best = max(scores, key=lambda k: scores[k])
    if scores[best] > 0:
        return best

    return IMAGE_TYPE_UNKNOWN


# ─── Extraction helpers ────────────────────────────────────────────────────────

def extract_weight(text: str) -> Optional[Tuple[str, str]]:
    """
    Extract weight/volume from text.
    Returns (value, normalised_unit) or None.
    """
    if not text:
        return None
    text_lower = text.lower()
    for pattern in WEIGHT_PATTERNS:
        match = re.search(pattern, text_lower, re.IGNORECASE)
        if match:
            groups = match.groups()
            if len(groups) >= 2:
                value, unit = groups[0], groups[1]
            else:
                # Spelled-out unit patterns only capture value
                value = groups[0]
                # derive unit from the pattern keyword
                if 'millilitre' in pattern or 'milliliter' in pattern:
                    unit = 'ml'
                elif 'litre' in pattern or 'liter' in pattern:
                    unit = 'l'
                elif 'kilogram' in pattern:
                    unit = 'kg'
                elif 'gram' in pattern:
                    unit = 'g'
                elif 'ounce' in pattern:
                    unit = 'oz'
                elif 'pound' in pattern:
                    unit = 'lb'
                else:
                    unit = ''
            if value and unit:
                return value.strip(), _normalise_unit(unit)
    return None


def extract_weight_str(text: str) -> Optional[str]:
    """Return weight as a formatted string e.g. '500ml', '1.5kg'."""
    result = extract_weight(text)
    if result:
        return f"{result[0]}{result[1]}"
    return None


def extract_country(text: str) -> Optional[str]:
    """Extract country of origin from text."""
    if not text:
        return None
    for pattern in COUNTRY_PATTERNS:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            country = match.group(1).strip()
            country = re.sub(r'[.,;:\s]+$', '', country)
            # Reject obviously wrong matches (e.g. partial address lines)
            if len(country) < 2 or len(country) > 50:
                continue
            # Drop if it contains digits (likely an address line)
            if re.search(r'\d', country):
                continue
            return country
    return None


def extract_barcode(text: str) -> Optional[str]:
    """Extract barcode from plain OCR text using regex."""
    if not text:
        return None
    match = re.search(BARCODE_PATTERN, text)
    if match:
        return match.group(1)
    return None


def extract_packaging(text: str) -> Optional[str]:
    """Extract packaging type from text."""
    if not text:
        return None
    text_lower = text.lower()
    for pkg_type, keywords in PACKAGING_KEYWORDS.items():
        for keyword in keywords:
            if re.search(r'\b' + re.escape(keyword) + r'\b', text_lower):
                return pkg_type
    return None


def extract_category(text: str) -> Optional[str]:
    """Extract product category from text. Returns highest-scoring category."""
    if not text:
        return None
    text_lower = text.lower()
    scores: dict = {}
    for category, keywords in CATEGORY_KEYWORDS.items():
        count = sum(1 for kw in keywords if re.search(r'\b' + re.escape(kw) + r'\b', text_lower))
        if count > 0:
            scores[category] = count
    if scores:
        return max(scores, key=lambda k: scores[k])
    return None


def extract_segment(text: str) -> Optional[str]:
    """Extract product segment from text."""
    if not text:
        return None
    text_lower = text.lower()
    for segment, keywords in SEGMENT_KEYWORDS.items():
        for keyword in keywords:
            if re.search(r'\b' + re.escape(keyword) + r'\b', text_lower):
                return segment
    return None


def extract_marketing_message(text: str) -> Optional[str]:
    """Extract marketing message from text. Returns the first match."""
    if not text:
        return None
    for pattern in MARKETING_PATTERNS:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(0).strip()
    return None
