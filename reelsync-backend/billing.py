"""
billing.py - Single source of truth for pricing, plan limits, and cycle usage.

The public plan cards advertise native minute bundles, but the backend only
unlocks 70% of that capacity for each billing cycle. We track the protected
allowance in raw seconds so usage enforcement remains exact even for fractional
minute tiers such as 84.7 minutes.
"""

from __future__ import annotations

import math

PROFIT_MARGIN_FACTOR: float = 0.70

# Mapped directly from the official minute tiers.
# allowed_seconds = (advertised_mins * 60) * 0.70
APP_PLAN_TIMERS: dict[str, dict[str, int]] = {
    "FREE": {"advertised_mins": 10, "allowed_seconds": 420},
    "STARTER": {"advertised_mins": 30, "allowed_seconds": 1_260},
    "CREATOR": {"advertised_mins": 121, "allowed_seconds": 5_082},
    "PRO": {"advertised_mins": 600, "allowed_seconds": 25_200},
}

# Legacy base minute balances from the older character-throttle release.
# Used only to migrate existing rows without discarding purchased top-up minutes.
LEGACY_BASE_MINUTES: dict[str, int] = {
    "FREE": 10,
    "STARTER": 28,
    "CREATOR": 113,
    "PRO": 560,
}

VOICE_CLONE_DISCLAIMER: str = (
    "By using the AI Voice Dubbing feature you confirm that you are the original "
    "voice owner or hold explicit written permission from the rights holder to "
    "reproduce, alter, or synthesise this voice using automated systems. Misuse "
    "of voice cloning to impersonate individuals without consent may violate applicable "
    "laws. ReelSync AI accepts no liability for content generated in breach of these terms."
)

TERMS_OF_SERVICE_URL: str = "https://reelsyncai.com/terms"
PRIVACY_POLICY_URL: str = "https://reelsyncai.com/privacy"


def _paise(final_price_inr: float) -> int:
    return int(round(final_price_inr * 100))


def seconds_to_display_minutes(seconds: int | None) -> int:
    if not seconds or seconds <= 0:
        return 0
    return math.ceil(seconds / 60)


def seconds_to_decimal_minutes(seconds: int | None) -> float:
    if not seconds or seconds <= 0:
        return 0.0
    return round(seconds / 60, 1)


def minutes_to_seconds(minutes: int | None) -> int:
    return max(int(minutes or 0), 0) * 60


def format_seconds(seconds: int | None) -> str:
    total = max(int(seconds or 0), 0)
    minutes, remainder = divmod(total, 60)
    if minutes and remainder:
        return f"{minutes}m {remainder}s"
    if minutes:
        return f"{minutes}m"
    return f"{remainder}s"


def plan_from_db(subscription_plan: str | None) -> str:
    if not subscription_plan:
        return "FREE"
    return subscription_plan.strip().upper()


def get_plan_timers(plan: str | None) -> dict[str, int]:
    return APP_PLAN_TIMERS.get(plan_from_db(plan), APP_PLAN_TIMERS["FREE"])


def get_cycle_allocation(plan: str | None) -> dict[str, int | float]:
    timers = get_plan_timers(plan)
    allowed_seconds = timers["allowed_seconds"]
    return {
        "advertised_mins": timers["advertised_mins"],
        "allowed_minutes": seconds_to_decimal_minutes(allowed_seconds),
        "allowed_seconds": allowed_seconds,
        "credit_minutes": seconds_to_display_minutes(allowed_seconds),
        "seconds_balance": allowed_seconds,
        "chars_balance": 0,
    }


def sync_display_minutes(seconds_balance: int | None) -> int:
    return seconds_to_display_minutes(seconds_balance)


def get_generation_block_reason(
    plan: str | None,
    seconds_balance: int | None,
    required_seconds: int = 1,
) -> str | None:
    normalized = plan_from_db(plan)
    tier = FINAL_TIERS[normalized]
    remaining_seconds = max(int(seconds_balance or 0), 0)
    required_seconds = max(int(required_seconds or 0), 1)

    if remaining_seconds < required_seconds:
        if remaining_seconds <= 0:
            return (
                f"Your {tier['label']} cycle usage allowance is exhausted "
                f"(0 / {tier['allowed_seconds']} seconds remaining). "
                "Upgrade or purchase additional minutes to continue."
            )

        return (
            f"This render needs {format_seconds(required_seconds)}, but only "
            f"{format_seconds(remaining_seconds)} remain in your {tier['label']} cycle. "
            "Upgrade or purchase additional minutes to continue."
        )

    return None


FINAL_TIERS: dict[str, dict] = {
    "FREE": {
        "price_display": "Rs 0",
        "base_price": 0,
        "tax_rate": 0.0,
        "handling_fee": 0,
        "amount_paise": 0,
        "min_limit": get_cycle_allocation("FREE")["credit_minutes"],
        "allowed_minutes": get_cycle_allocation("FREE")["allowed_minutes"],
        "allowed_seconds": get_cycle_allocation("FREE")["allowed_seconds"],
        "advertised_mins": get_cycle_allocation("FREE")["advertised_mins"],
        "profit_margin_factor": PROFIT_MARGIN_FACTOR,
        "quality": "720p",
        "allow_download": False,
        "allow_recording": False,
        "watermark": True,
        "cross_subtitles": False,
        "allow_cloning": True,
        "allow_priority": False,
        "label": "Free",
        "badge": None,
    },
    "STARTER": {
        "price_display": "Rs 528",
        "base_price": 528,
        "tax_rate": 0.0,
        "handling_fee": 0,
        "amount_paise": _paise(528),
        "min_limit": get_cycle_allocation("STARTER")["credit_minutes"],
        "allowed_minutes": get_cycle_allocation("STARTER")["allowed_minutes"],
        "allowed_seconds": get_cycle_allocation("STARTER")["allowed_seconds"],
        "advertised_mins": get_cycle_allocation("STARTER")["advertised_mins"],
        "profit_margin_factor": PROFIT_MARGIN_FACTOR,
        "quality": "1080p",
        "allow_download": True,
        "allow_recording": True,
        "watermark": False,
        "cross_subtitles": True,
        "allow_cloning": True,
        "allow_priority": False,
        "label": "Starter",
        "badge": None,
    },
    "CREATOR": {
        "price_display": "Rs 1,936",
        "base_price": 1_936,
        "tax_rate": 0.0,
        "handling_fee": 0,
        "amount_paise": _paise(1_936),
        "min_limit": get_cycle_allocation("CREATOR")["credit_minutes"],
        "allowed_minutes": get_cycle_allocation("CREATOR")["allowed_minutes"],
        "allowed_seconds": get_cycle_allocation("CREATOR")["allowed_seconds"],
        "advertised_mins": get_cycle_allocation("CREATOR")["advertised_mins"],
        "profit_margin_factor": PROFIT_MARGIN_FACTOR,
        "quality": "4K",
        "allow_download": True,
        "allow_recording": True,
        "watermark": False,
        "cross_subtitles": True,
        "allow_cloning": True,
        "allow_priority": False,
        "label": "Creator",
        "badge": "Popular",
    },
    "PRO": {
        "price_display": "Rs 8,712",
        "base_price": 8_712,
        "tax_rate": 0.0,
        "handling_fee": 0,
        "amount_paise": _paise(8_712),
        "min_limit": get_cycle_allocation("PRO")["credit_minutes"],
        "allowed_minutes": get_cycle_allocation("PRO")["allowed_minutes"],
        "allowed_seconds": get_cycle_allocation("PRO")["allowed_seconds"],
        "advertised_mins": get_cycle_allocation("PRO")["advertised_mins"],
        "profit_margin_factor": PROFIT_MARGIN_FACTOR,
        "quality": "4K",
        "allow_download": True,
        "allow_recording": True,
        "watermark": False,
        "cross_subtitles": True,
        "allow_cloning": True,
        "allow_priority": True,
        "label": "Pro",
        "badge": None,
    },
}

BILLING_TIERS = FINAL_TIERS
PROFITABLE_TIERS = {k.lower(): v for k, v in FINAL_TIERS.items()}


def get_tier(plan: str) -> dict:
    return FINAL_TIERS.get(plan.upper(), FINAL_TIERS["FREE"])


def breakdown(plan: str) -> dict:
    tier = get_tier(plan)
    base = tier["base_price"]
    tax = round(base * tier["tax_rate"], 2)
    hdl = tier["handling_fee"]
    total = round(base + tax + hdl, 2)
    return {
        "base_inr": base,
        "tax_inr": tax,
        "tax_rate_pct": int(tier["tax_rate"] * 100),
        "handling_inr": hdl,
        "total_inr": total,
        "amount_paise": tier["amount_paise"],
    }


def compute_total_inr(plan: str) -> float:
    return breakdown(plan)["total_inr"]
