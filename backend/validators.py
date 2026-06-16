"""
Field validators for IMDB data.
Each validator returns (is_valid, normalized_value, confidence_score).
Fields whose confidence falls below REVIEW_THRESHOLD are flagged for human review.
"""

import re
from typing import Tuple, Optional, List

# ─── Review threshold ─────────────────────────────────────────────────────────

# Any field with confidence below this value will be included in `needs_review_fields`.
REVIEW_THRESHOLD = 0.80

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
    "Zambia", "Zimbabwe",
}

# ─── Barcode ──────────────────────────────────────────────────────────────────

BARCODE_FORMATS = {
    "EAN-13": r"^\d{13}$",
    "EAN-8":  r"^\d{8}$",
    "UPC-A":  r"^\d{12}$",
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
    for fmt, pattern in BARCODE_FORMATS.items():
        if re.match(pattern, digits):
            return True, fmt, 1.0
    if len(digits) >= 8:
        return True, f"Non-standard ({len(digits)} digits)", 0.55
    return False, None, 0.0

# ─── Weight ───────────────────────────────────────────────────────────────────

WEIGHT_REGEX = r"^(\d+(?:\.\d+)?)\s*(g|kg|mg|ml|l|cl|oz|lb|fl\s*oz)$"

def validate_weight(value: str) -> Tuple[bool, str, float]:
    """
    Validate weight/volume string.
    Returns: (is_valid, normalized_value, confidence_score)
    """
    if not value or not value.strip():
        return False, "", 0.0
    normalized = re.sub(r'\s+', '', value.lower().strip())
    normalized = (normalized
                  .replace('kilogram', 'kg').replace('gram', 'g')
                  .replace('milliliter', 'ml').replace('millilitre', 'ml')
                  .replace('liter', 'l').replace('litre', 'l')
                  .replace('ounce', 'oz').replace('pound', 'lb'))
    if re.match(WEIGHT_REGEX, normalized):
        return True, normalized, 1.0
    match = re.search(r'(\d+(?:\.\d+)?)\s*([a-z]+)', normalized)
    if match:
        return True, f"{match.group(1)}{match.group(2)}", 0.75
    return False, value.strip(), 0.3

# ─── Country ──────────────────────────────────────────────────────────────────

COUNTRY_ALIASES: dict = {
    "usa":                       "United States",
    "us":                        "United States",
    "u.s.":                      "United States",
    "united states of america":  "United States",
    "uk":                        "United Kingdom",
    "great britain":             "United Kingdom",
    "england":                   "United Kingdom",
    "scotland":                  "United Kingdom",
    "wales":                     "United Kingdom",
    "gb":                        "United Kingdom",
    "uae":                       "United Arab Emirates",
    "drc":                       "DR Congo",
    "south korea":               "South Korea",
    "korea":                     "South Korea",
    "republic of korea":         "South Korea",
    "ivory coast":               "Côte d'Ivoire",
    "côte d'ivoire":             "Côte d'Ivoire",
    "republic of ireland":       "Ireland",
    "holland":                   "Netherlands",
    "czech republic":            "Czechia",
}

def validate_country(value: str) -> Tuple[bool, str, float]:
    """
    Validate and normalise country name.
    Returns: (is_valid, normalized_name, confidence_score)
    """
    if not value or not value.strip():
        return False, "", 0.0
    value_lower = value.lower().strip()
    # Alias table
    if value_lower in COUNTRY_ALIASES:
        return True, COUNTRY_ALIASES[value_lower], 1.0
    # Exact match
    for country in VALID_COUNTRIES:
        if country.lower() == value_lower:
            return True, country, 1.0
    # Partial match
    for country in VALID_COUNTRIES:
        if value_lower in country.lower() or country.lower() in value_lower:
            return True, country, 0.8
    # Unknown — return as-is with low confidence
    return False, value.strip().title(), 0.3

# ─── Packaging ────────────────────────────────────────────────────────────────

PACKAGING_TYPES: List[str] = [
    "Bottle", "Can", "Box", "Bag", "Pouch", "Sachet", "Jar", "Tube",
    "Tub", "Blister", "Pack", "Carton", "Tin", "Container", "Tray",
    "Barrel", "Crate",
]

def validate_packaging(value: str) -> Tuple[bool, str, float]:
    if not value or not value.strip():
        return False, "", 0.0
    for pkg in PACKAGING_TYPES:
        if value.lower() == pkg.lower():
            return True, pkg, 1.0
    for pkg in PACKAGING_TYPES:
        if value.lower() in pkg.lower() or pkg.lower() in value.lower():
            return True, pkg, 0.85
    return False, value.strip().title(), 0.4

# ─── Brand ────────────────────────────────────────────────────────────────────

def validate_brand(value: str) -> Tuple[bool, str, float]:
    if not value or not value.strip():
        return False, "", 0.0
    value = value.strip()
    if len(value) < 2 or len(value) > 60:
        return False, value, 0.3
    cleaned = re.sub(r"[^A-Za-z0-9 '&\-]", '', value)
    noise_ratio = len(cleaned) / max(1, len(value))
    if noise_ratio < 0.75:
        return True, value, 0.5
    if re.search(r'[~^_+=/\\|@#\$%&*]', value):
        return True, value, 0.5
    return True, value, 0.9

# ─── Product Name ─────────────────────────────────────────────────────────────

def validate_product_name(value: str) -> Tuple[bool, str, float]:
    if not value or not value.strip():
        return False, "", 0.0
    value = value.strip()
    if len(value) < 3 or len(value) > 200:
        return False, value, 0.3
    return True, value, 0.88

# ─── Manufacturer ─────────────────────────────────────────────────────────────

def validate_manufacturer(value: str) -> Tuple[bool, str, float]:
    if not value or not value.strip():
        return False, "", 0.0
    value = value.strip()
    if len(value) < 2:
        return False, value, 0.2
    return True, value, 0.78

# ─── Category ─────────────────────────────────────────────────────────────────

VALID_CATEGORIES: List[str] = [
    "Beverages", "Snacks", "Dairy", "Personal Care", "Oral Care",
    "Household", "Grocery", "Bakery", "Healthcare", "Confectionery",
    "Baby Products", "Pet Care",
]

def validate_category(value: str) -> Tuple[bool, str, float]:
    if not value or not value.strip():
        return False, "", 0.0
    for cat in VALID_CATEGORIES:
        if value.lower() == cat.lower():
            return True, cat, 0.95
    return False, value.strip().title(), 0.4

# ─── Segment ──────────────────────────────────────────────────────────────────

def validate_segment(value: str) -> Tuple[bool, str, float]:
    if not value or not value.strip():
        return False, "", 0.0
    return True, value.strip(), 0.8

# ─── Marketing Message ────────────────────────────────────────────────────────

def validate_marketing_message(value: str) -> Tuple[bool, str, float]:
    if not value or not value.strip():
        return False, "", 0.0
    value = value.strip()
    # Length sanity: marketing messages should be short phrases
    if len(value) > 120:
        return True, value[:120], 0.6
    return True, value, 0.75

# ─── Review flagging ──────────────────────────────────────────────────────────

def get_needs_review_fields(field_confidences: dict) -> List[str]:
    """
    Return a list of field names whose confidence is below REVIEW_THRESHOLD
    or whose value is empty (confidence == 0).
    """
    return [
        field
        for field, conf in field_confidences.items()
        if conf < REVIEW_THRESHOLD
    ]
