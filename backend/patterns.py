"""
Regex patterns for extracting IMDB fields from OCR text.
"""

import re
from typing import Optional, Tuple

# ─── Weight/Volume Patterns ────────────────────────────────────────────────────

WEIGHT_PATTERNS = [
    # Captures: (number, unit)
    r'(\d+(?:\.\d+)?)\s*(ml|millilitre|milliliter)',
    r'(\d+(?:\.\d+)?)\s*(l|litre|liter)',
    r'(\d+(?:\.\d+)?)\s*(g|gram)',
    r'(\d+(?:\.\d+)?)\s*(kg|kilogram)',
    r'(\d+(?:\.\d+)?)\s*(oz|ounce)',
    r'(\d+(?:\.\d+)?)\s*(lb|pound)',
    r'(\d+(?:\.\d+)?)\s*(cl|centilitre)',
]

# ─── Country of Origin Patterns ────────────────────────────────────────────────

COUNTRY_PATTERNS = [
    r'made\s+in\s+([A-Za-z\s]+?)(?:\.|,|\n|$)',
    r'product\s+of\s+([A-Za-z\s]+?)(?:\.|,|\n|$)',
    r'manufactured\s+in\s+([A-Za-z\s]+?)(?:\.|,|\n|$)',
    r'produced\s+in\s+([A-Za-z\s]+?)(?:\.|,|\n|$)',
    r'origin\s*:?\s*([A-Za-z\s]+?)(?:\.|,|\n|$)',
    r'packed\s+in\s+([A-Za-z\s]+?)(?:\.|,|\n|$)',
]

# ─── Barcode Patterns ──────────────────────────────────────────────────────────

BARCODE_PATTERN = r'\b(\d{8}|\d{12}|\d{13}|\d{14})\b'

# ─── Packaging Type Keywords ──────────────────────────────────────────────────

PACKAGING_KEYWORDS = {
    'bottle': ['bottle', 'bottles', 'bottled'],
    'can': ['can', 'cans', 'tin', 'tins'],
    'box': ['box', 'boxes', 'carton', 'cartons', 'cardboard'],
    'bag': ['bag', 'bags', 'pouch', 'pouches', 'sachet', 'sachets'],
    'jar': ['jar', 'jars', 'pot', 'pots'],
    'tube': ['tube', 'tubes'],
    'tub': ['tub', 'tubs', 'container', 'containers'],
    'pack': ['pack', 'packet', 'packets', 'sleeve', 'blister', 'tray'],
}

# ─── Category Keywords ────────────────────────────────────────────────────────

CATEGORY_KEYWORDS = {
    'Beverages': [
        'beverage', 'drink', 'juice', 'water', 'soda', 'cola', 'beer', 'wine',
        'coffee', 'tea', 'milk', 'smoothie', 'energy drink', 'sports drink',
        'soft drink', 'carbonated', 'chocolate drink', 'malt drink', 'cordial'
    ],
    'Snacks': [
        'snack', 'chip', 'crisp', 'biscuit', 'cookie', 'cracker', 'candy',
        'chocolate', 'wafer', 'pretzel', 'popcorn', 'granola', 'cereal bar',
        'trail mix', 'nut mix'
    ],
    'Dairy': [
        'milk', 'cheese', 'yogurt', 'butter', 'cream', 'ice cream', 'custard',
        'whey', 'dairy', 'lactose'
    ],
    'Personal Care': [
        'shampoo', 'conditioner', 'soap', 'lotion', 'cream', 'body wash',
        'cosmetic', 'skincare', 'beauty', 'moisturizer', 'serum', 'essence',
        'face wash', 'cleanser', 'deodorant'
    ],
    'Oral Care': [
        'toothpaste', 'toothbrush', 'dental', 'mouth wash', 'mouthwash', 'floss',
        'tooth whitening'
    ],
    'Household': [
        'detergent', 'bleach', 'cleaner', 'dishwash', 'laundry', 'degreaser',
        'disinfectant', 'sanitizer', 'wipe', 'fabric softener', 'stain remover'
    ],
    'Grocery': [
        'flour', 'sugar', 'salt', 'rice', 'oil', 'sauce', 'pasta', 'noodle',
        'spice', 'seasoning', 'condiment', 'spread', 'jam', 'honey', 'butter',
        'cooking oil', 'vinegar', 'soy sauce'
    ],
    'Bakery': [
        'bread', 'cake', 'pastry', 'bun', 'biscuit', 'croissant', 'donut',
        'muffin', 'bagel', 'roll'
    ],
    'Healthcare': [
        'medicine', 'tablet', 'capsule', 'syrup', 'cough', 'cold', 'pain relief',
        'vitamin', 'supplement', 'herb', 'medicinal', 'pharmaceutical', 'health'
    ],
    'Confectionery': [
        'chocolate', 'candy', 'sweet', 'lollipop', 'gum', 'caramel', 'toffee',
        'marshmallow', 'fudge'
    ],
}

# ─── Segment Keywords ──────────────────────────────────────────────────────────

SEGMENT_KEYWORDS = {
    'Carbonated Soft Drink': ['carbonated', 'cola', 'lemonade', 'sprite', 'fanta'],
    'Chocolate Malt Drink': ['malt', 'chocolate', 'milo', 'horlicks', 'ovomaltine'],
    'Coffee Beverage': ['coffee', 'espresso', 'latte', 'cappuccino'],
    'Tea Beverage': ['tea', 'black tea', 'green tea', 'herbal tea'],
    'Energy Drink': ['energy drink', 'energy', 'redbull', 'powerade'],
    'Sports Drink': ['sports drink', 'isotonic', 'gatorade', 'powerade'],
    'Juice': ['juice', 'orange juice', 'apple juice', 'concentrate'],
    'Milk-Based': ['milk', 'dairy', 'yogurt', 'ice cream'],
    'Potato Chips': ['potato', 'chip', 'crisp'],
    'Biscuit': ['biscuit', 'cookie', 'cracker', 'wafer'],
    'Chocolate Confectionery': ['chocolate', 'candy', 'sweet'],
    'Cough & Cold Relief': ['cough', 'cold', 'catarrh', 'throat'],
    'Pain Relief': ['pain relief', 'headache', 'paracetamol', 'ibuprofen'],
}

# ─── Marketing Message Patterns ────────────────────────────────────────────────

MARKETING_PATTERNS = [
    r'new\b',
    r'limited\s+edition',
    r'no\s+added\s+sugar',
    r'sugar\s+free',
    r'organic',
    r'gluten\s+free',
    r'buy\s+\d+\s+get\s+\d+',
    r'extra\s+strength',
    r'value\s+pack',
    r'free\s+from',
    r'high\s+protein',
    r'low\s+fat',
    r'natural',
    r'premium',
    r'best\s+seller',
]

# ─── Image Classification Keywords ──────────────────────────────────────────

FRONT_LABEL_KEYWORDS = [
    'net wt', 'net weight', 'weight', 'volume', 'ml', 'g', 'kg', 'l', 'oz',
    'bottle', 'can', 'box', 'pack', 'new', 'limited edition', 'best seller',
    'organic', 'gluten free', 'sugar free'
]
MANUFACTURER_SIDE_KEYWORDS = [
    'manufactured by', 'made in', 'address', 'packed by', 'distributed by',
    'imported by', 'manufactured for', 'factory', 'plant', 'country of origin'
]
INGREDIENTS_SIDE_KEYWORDS = [
    'ingredients', 'directions', 'preservation', 'warning', 'storage',
    'nutrition facts', 'serve', 'use before', 'keep refrigerated', 'allergen'
]

IMAGE_TYPE_FRONT_LABEL = 'Front Label'
IMAGE_TYPE_MANUFACTURER_SIDE = 'Manufacturer Side'
IMAGE_TYPE_BARCODE_SIDE = 'Barcode Side'
IMAGE_TYPE_INGREDIENTS_SIDE = 'Ingredients Side'
IMAGE_TYPE_UNKNOWN = 'Unknown'


def classify_image_text(text: str, barcode_detected: bool = False) -> str:
    """Classify an image based on OCR text and barcode presence."""
    if barcode_detected:
        return IMAGE_TYPE_BARCODE_SIDE

    if not text:
        return IMAGE_TYPE_UNKNOWN

    text_lower = text.lower()

    if re.search(BARCODE_PATTERN, text):
        return IMAGE_TYPE_BARCODE_SIDE

    for keyword in MANUFACTURER_SIDE_KEYWORDS:
        if keyword in text_lower:
            return IMAGE_TYPE_MANUFACTURER_SIDE

    for keyword in INGREDIENTS_SIDE_KEYWORDS:
        if keyword in text_lower:
            return IMAGE_TYPE_INGREDIENTS_SIDE

    # Front label tends to contain brand/product markers and volume/weight.
    if any(keyword in text_lower for keyword in FRONT_LABEL_KEYWORDS):
        return IMAGE_TYPE_FRONT_LABEL

    return IMAGE_TYPE_UNKNOWN


# ─── Utility Functions ─────────────────────────────────────────────────────────

def extract_weight(text: str) -> Optional[str]:
    """Extract weight/volume from text. Returns normalized format."""
    if not text:
        return None
    
    text_lower = text.lower()
    for pattern in WEIGHT_PATTERNS:
        match = re.search(pattern, text_lower, re.IGNORECASE)
        if match:
            value, unit = match.groups()
            # Normalize units
            unit_normalized = unit.lower().replace(' ', '')
            if 'ml' in unit_normalized or 'millilitre' in unit_normalized or 'milliliter' in unit_normalized:
                return f"{value}ml"
            elif unit_normalized == 'l' or 'litre' in unit_normalized or 'liter' in unit_normalized:
                return f"{value}l"
            elif 'g' in unit_normalized or 'gram' in unit_normalized:
                return f"{value}g"
            elif 'kg' in unit_normalized or 'kilogram' in unit_normalized:
                return f"{value}kg"
            elif 'oz' in unit_normalized or 'ounce' in unit_normalized:
                return f"{value}oz"
            elif 'lb' in unit_normalized or 'pound' in unit_normalized:
                return f"{value}lb"
            elif 'cl' in unit_normalized or 'centilitre' in unit_normalized:
                return f"{value}cl"
    return None

def extract_country(text: str) -> Optional[str]:
    """Extract country of origin from text."""
    if not text:
        return None
    
    for pattern in COUNTRY_PATTERNS:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            country = match.group(1).strip()
            # Remove trailing punctuation
            country = re.sub(r'[.,;:\s]+$', '', country)
            return country
    return None

def extract_barcode(text: str) -> Optional[str]:
    """Extract barcode from text."""
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
            if keyword in text_lower:
                return pkg_type
    return None

def extract_category(text: str) -> Optional[str]:
    """Extract product category from text."""
    if not text:
        return None
    
    text_lower = text.lower()
    for category, keywords in CATEGORY_KEYWORDS.items():
        for keyword in keywords:
            if keyword in text_lower:
                return category
    return None

def extract_segment(text: str) -> Optional[str]:
    """Extract product segment from text."""
    if not text:
        return None
    
    text_lower = text.lower()
    for segment, keywords in SEGMENT_KEYWORDS.items():
        for keyword in keywords:
            if keyword in text_lower:
                return segment
    return None

def extract_marketing_message(text: str) -> Optional[str]:
    """Extract marketing message from text."""
    if not text:
        return None
    
    for pattern in MARKETING_PATTERNS:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(0).strip()
    return None
