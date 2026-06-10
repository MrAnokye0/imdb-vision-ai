"""
Field validators for IMDB data.
"""

import re
from typing import Tuple, Optional

# ─── Country Database ──────────────────────────────────────────────────────────

VALID_COUNTRIES = {
    "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda",
    "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan", "Bahamas",
    "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin",
    "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei",
    "Bulgaria", "Burkina Faso", "Burundi", "Cambodia", "Cameroon", "Canada",
    "Cape Verde", "Central African Republic", "Chad", "Chile", "China", "Colombia",
    "Comoros", "Congo", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czechia",
    "DR Congo", "Côte d'Ivoire", "Denmark", "Djibouti", "Dominica",
    "Dominican Republic", "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea",
    "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland", "France",
    "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada",
    "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti", "Honduras",
    "Hong Kong", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq",
    "Ireland", "Israel", "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan",
    "Kenya", "Kiribati", "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon",
    "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg",
    "Macao", "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta",
    "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia",
    "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique",
    "Myanmar", "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand",
    "Nicaragua", "Niger", "Nigeria", "North Korea", "North Macedonia", "Norway",
    "Oman", "Pakistan", "Palau", "Palestine", "Panama", "Papua New Guinea",
    "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar",
    "Republic of the Congo", "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis",
    "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino",
    "Sao Tome and Principe", "Saudi Arabia", "Senegal", "Serbia", "Seychelles",
    "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands",
    "Somalia", "South Africa", "South Korea", "South Sudan", "Spain", "Sri Lanka",
    "Sudan", "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan",
    "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago",
    "Tunisia", "Turkey", "Turkmenistan", "Tuvalu", "Uganda", "Ukraine",
    "United Arab Emirates", "United Kingdom", "United States", "Uruguay",
    "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen",
    "Zambia", "Zimbabwe"
}

# ─── Barcode Validators ───────────────────────────────────────────────────────

BARCODE_PATTERNS = {
    "EAN-13": r"^\d{13}$",
    "EAN-8": r"^\d{8}$",
    "UPC-A": r"^\d{12}$",
    "UPC-E": r"^\d{8}$",
    "EAN-14": r"^\d{14}$",
}

def validate_barcode(value: str) -> Tuple[bool, Optional[str], float]:
    """
    Validate barcode format.
    Returns: (is_valid, format_name, confidence_score)
    """
    if not value or not value.strip():
        return False, None, 0.0
    
    digits = re.sub(r'\D', '', value)
    if not digits:
        return False, None, 0.0
    
    for fmt, pattern in BARCODE_PATTERNS.items():
        if re.match(pattern, digits):
            return True, fmt, 1.0
    
    # Partial match
    if len(digits) >= 8:
        return True, f"Non-standard ({len(digits)} digits)", 0.6
    
    return False, None, 0.0

# ─── Weight Validators ────────────────────────────────────────────────────────

WEIGHT_REGEX = r"^(\d+(?:\.\d+)?)\s*(g|kg|mg|ml|l|cl|oz|lb)$"

def validate_weight(value: str) -> Tuple[bool, str, float]:
    """
    Validate weight/volume format.
    Returns: (is_valid, normalized_value, confidence_score)
    """
    if not value or not value.strip():
        return False, "", 0.0
    
    # Normalize
    normalized = value.replace(' ', '').lower()
    normalized = normalized.replace('kilogram', 'kg').replace('gram', 'g')
    normalized = normalized.replace('milliliter', 'ml').replace('millilitre', 'ml')
    normalized = normalized.replace('liter', 'l').replace('litre', 'l')
    
    if re.match(WEIGHT_REGEX, normalized):
        return True, normalized, 1.0
    
    # Try to extract value and unit
    match = re.search(r'(\d+(?:\.\d+)?)\s*([a-z]+)', normalized)
    if match:
        return True, f"{match.group(1)}{match.group(2)}", 0.75
    
    return False, value, 0.0

# ─── Country Validators ───────────────────────────────────────────────────────

COUNTRY_ALIASES = {
    "usa": "United States",
    "us": "United States",
    "u.s.": "United States",
    "united states of america": "United States",
    "uk": "United Kingdom",
    "great britain": "United Kingdom",
    "gb": "United Kingdom",
    "uae": "United Arab Emirates",
    "drc": "DR Congo",
    "south korea": "South Korea",
    "korea": "South Korea",
    "ivory coast": "Côte d'Ivoire",
}

def validate_country(value: str) -> Tuple[bool, str, float]:
    """
    Validate country name against database.
    Returns: (is_valid, normalized_name, confidence_score)
    """
    if not value or not value.strip():
        return False, "", 0.0
    
    value_lower = value.lower().strip()
    
    # Check aliases
    if value_lower in COUNTRY_ALIASES:
        normalized = COUNTRY_ALIASES[value_lower]
        return True, normalized, 1.0
    
    # Check exact match (case-insensitive)
    for country in VALID_COUNTRIES:
        if country.lower() == value_lower:
            return True, country, 1.0
    
    # Check partial match
    for country in VALID_COUNTRIES:
        if value_lower in country.lower() or country.lower() in value_lower:
            return True, country, 0.85
    
    # Unknown country
    return False, value.strip(), 0.3

# ─── Packaging Validators ─────────────────────────────────────────────────────

PACKAGING_TYPES = [
    "Bottle", "Can", "Box", "Bag", "Jar", "Tube", "Tub", "Pack",
    "Sachet", "Pouch", "Carton", "Tin", "Container", "Tray", "Barrel", "Crate"
]

def validate_packaging(value: str) -> Tuple[bool, str, float]:
    """
    Validate packaging type.
    Returns: (is_valid, normalized_type, confidence_score)
    """
    if not value or not value.strip():
        return False, "", 0.0
    
    # Exact match (case-insensitive)
    for pkg in PACKAGING_TYPES:
        if value.lower() == pkg.lower():
            return True, pkg, 1.0
    
    # Partial match
    value_lower = value.lower()
    for pkg in PACKAGING_TYPES:
        if value_lower in pkg.lower():
            return True, pkg, 0.9
    
    return False, value.strip(), 0.4

# ─── Brand Validators ─────────────────────────────────────────────────────────

def validate_brand(value: str) -> Tuple[bool, str, float]:
    """
    Validate brand name format.
    Returns: (is_valid, value, confidence_score)
    """
    if not value or not value.strip():
        return False, "", 0.0
    
    value = value.strip()
    length = len(value)
    
    # Valid brands are 2-60 chars
    if length < 2 or length > 60:
        return False, value, 0.3
    
    return True, value, 0.9

# ─── Product Name Validators ───────────────────────────────────────────────────

def validate_product_name(value: str) -> Tuple[bool, str, float]:
    """
    Validate product name format.
    Returns: (is_valid, value, confidence_score)
    """
    if not value or not value.strip():
        return False, "", 0.0
    
    value = value.strip()
    length = len(value)
    
    # Valid names are 3-200 chars
    if length < 3 or length > 200:
        return False, value, 0.3
    
    return True, value, 0.88

# ─── Manufacturer Validators ───────────────────────────────────────────────────

def validate_manufacturer(value: str) -> Tuple[bool, str, float]:
    """
    Validate manufacturer name.
    Returns: (is_valid, value, confidence_score)
    """
    if not value or not value.strip():
        return False, "", 0.0
    
    value = value.strip()
    if len(value) < 2:
        return False, value, 0.2
    
    return True, value, 0.78

# ─── Category Validators ───────────────────────────────────────────────────────

VALID_CATEGORIES = [
    "Beverages", "Snacks", "Dairy", "Personal Care", "Oral Care",
    "Household", "Grocery", "Bakery", "Healthcare", "Confectionery"
]

def validate_category(value: str) -> Tuple[bool, str, float]:
    """
    Validate category type.
    Returns: (is_valid, normalized_type, confidence_score)
    """
    if not value or not value.strip():
        return False, "", 0.0
    
    for cat in VALID_CATEGORIES:
        if value.lower() == cat.lower():
            return True, cat, 0.95
    
    return False, value.strip(), 0.3

# ─── Segment Validators ────────────────────────────────────────────────────────

def validate_segment(value: str) -> Tuple[bool, str, float]:
    """
    Validate segment type.
    Returns: (is_valid, value, confidence_score)
    """
    if not value or not value.strip():
        return False, "", 0.0
    
    return True, value.strip(), 0.8

# ─── Marketing Message Validators ──────────────────────────────────────────────

def validate_marketing_message(value: str) -> Tuple[bool, str, float]:
    """
    Validate marketing message.
    Returns: (is_valid, value, confidence_score)
    """
    if not value or not value.strip():
        return False, "", 0.0
    
    return True, value.strip(), 0.75
