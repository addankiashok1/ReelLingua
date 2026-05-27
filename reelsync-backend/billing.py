"""
billing.py — Single source of truth for pricing, feature gates, character density
limits, and legal disclaimer text.

Character density baseline: 750 chars/min uniform across all tiers.

Imported by: routers/payments.py, routers/auth.py, routers/videos.py, config.py
"""
import math

CHARS_PER_MINUTE: int = 750

VOICE_CLONE_DISCLAIMER: str = (
    "By using the AI Voice Dubbing feature you confirm that you are the original "
    "voice owner or hold explicit written permission from the rights holder to "
    "reproduce, alter, or synthesise this voice using automated systems. Misuse "
    "of voice cloning to impersonate individuals without consent may violate applicable "
    "laws. ReelSync AI accepts no liability for content generated in breach of these terms."
)

TERMS_OF_SERVICE_URL: str = "https://reelsyncai.com/terms"
PRIVACY_POLICY_URL: str   = "https://reelsyncai.com/privacy"


def _paise(base: float, tax_rate: float, handling_fee: float = 0.0) -> int:
    return math.ceil((base + base * tax_rate + handling_fee) * 100)


FINAL_TIERS: dict[str, dict] = {
    "FREE": {
        "price_display":           "₹0",
        "base_price":              0,
        "tax_rate":                0.0,
        "handling_fee":            0,
        "amount_paise":            0,
        "min_limit":               2,
        "char_limit":              1_500,
        "chars_per_credit_minute": CHARS_PER_MINUTE,
        "quality":                 "720p",
        "allow_download":          False,
        "allow_recording":         False,
        "watermark":               True,
        "cross_subtitles":         False,
        "allow_cloning":           True,
        "allow_priority":          False,
        "label":                   "Free",
        "badge":                   None,
    },
    "STARTER": {
        "price_display":           "₹750",
        "base_price":              750,
        "tax_rate":                0.18,
        "handling_fee":            7.50,
        "amount_paise":            _paise(750, 0.18, 7.50),   # 89_250
        "min_limit":               15,
        "char_limit":              11_250,
        "chars_per_credit_minute": CHARS_PER_MINUTE,
        "quality":                 "1080p",
        "allow_download":          True,
        "allow_recording":         True,
        "watermark":               False,
        "cross_subtitles":         True,
        "allow_cloning":           True,
        "allow_priority":          False,
        "label":                   "Starter",
        "badge":                   None,
    },
    "CREATOR": {
        "price_display":           "₹1,200",
        "base_price":              1_200,
        "tax_rate":                0.18,
        "handling_fee":            0,
        "amount_paise":            _paise(1_200, 0.18, 0),    # 1_41_600
        "min_limit":               40,
        "char_limit":              30_000,
        "chars_per_credit_minute": CHARS_PER_MINUTE,
        "quality":                 "4K",
        "allow_download":          True,
        "allow_recording":         True,
        "watermark":               False,
        "cross_subtitles":         True,
        "allow_cloning":           True,
        "allow_priority":          False,
        "label":                   "Creator",
        "badge":                   "Popular",
    },
    "PRO": {
        "price_display":           "₹10,000",
        "base_price":              10_000,
        "tax_rate":                0.18,
        "handling_fee":            0,
        "amount_paise":            _paise(10_000, 0.18, 0),   # 11_80_000
        "min_limit":               400,
        "char_limit":              300_000,
        "chars_per_credit_minute": CHARS_PER_MINUTE,
        "quality":                 "4K",
        "allow_download":          True,
        "allow_recording":         True,
        "watermark":               False,
        "cross_subtitles":         True,
        "allow_cloning":           True,
        "allow_priority":          True,
        "label":                   "Pro",
        "badge":                   None,
    },
}

# Aliases so existing imports keep working
BILLING_TIERS    = FINAL_TIERS
PROFITABLE_TIERS = {k.lower(): v for k, v in FINAL_TIERS.items()}


def get_tier(plan: str) -> dict:
    return FINAL_TIERS.get(plan.upper(), FINAL_TIERS["FREE"])


def plan_from_db(subscription_plan: str | None) -> str:
    if not subscription_plan:
        return "FREE"
    return subscription_plan.upper()


def breakdown(plan: str) -> dict:
    tier  = get_tier(plan)
    base  = tier["base_price"]
    tax   = round(base * tier["tax_rate"], 2)
    hdl   = tier["handling_fee"]
    total = round(base + tax + hdl, 2)
    return {
        "base_inr":     base,
        "tax_inr":      tax,
        "tax_rate_pct": int(tier["tax_rate"] * 100),
        "handling_inr": hdl,
        "total_inr":    total,
        "amount_paise": tier["amount_paise"],
    }


def compute_total_inr(plan: str) -> float:
    return breakdown(plan)["total_inr"]