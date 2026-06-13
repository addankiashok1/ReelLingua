"""
billing.py - Single source of truth for pricing, plan limits, roles, and cycle usage.

ReelSync AI operates as a proxy SaaS on top of a single wholesale utility pool.
The backend therefore enforces protected customer allocations directly in raw
seconds and protected plan credits so the application, not the client, remains
the authoritative quota source of truth.
"""

from __future__ import annotations

import logging
from fastapi import HTTPException, status

from models.db_models import UserRole

PROFIT_MARGIN_PERCENT: int = 70

# Native platform bundles mapped to ReelSync's protected customer allocations.
# We keep the authoritative allowance in raw seconds so execution checks never
# depend on floating-point minute comparisons.
APP_PLAN_TIMERS: dict[str, dict[str, int | bool]] = {
    "FREE": {
        "advertised_mins": 1,
        "ui_display_minutes": 1,
        "advertised_credits": 7_000,
        "allowed_seconds": 60,
        "allowed_credits": 7_000,
        "is_recurring": False,
    },
    "STARTER": {
        "advertised_mins": 21,
        "ui_display_minutes": 21,
        "advertised_credits": 21_000,
        "allowed_seconds": 1_260,
        "allowed_credits": 21_000,
        "is_recurring": True,
    },
    "CREATOR": {
        "advertised_mins": 84,
        "ui_display_minutes": 84,
        "advertised_credits": 84_700,
        "allowed_seconds": 5_082,
        "allowed_credits": 84_700,
        "is_recurring": True,
    },
    "PRO": {
        "advertised_mins": 420,
        "ui_display_minutes": 420,
        "advertised_credits": 420_000,
        "allowed_seconds": 25_200,
        "allowed_credits": 420_000,
        "is_recurring": True,
    },
}

PLAN_OUTPUT_HEIGHT_CAPS: dict[str, int] = {
    "FREE": 420,
    "STARTER": 1080,
    "CREATOR": 2160,
    "PRO": 2160,
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
PRIVILEGED_BILLING_ROLES: frozenset[UserRole] = frozenset({UserRole.ADMIN, UserRole.ROOT})


def _paise(final_price_inr: float) -> int:
    return int(round(final_price_inr * 100))


def seconds_to_display_minutes(seconds: int | None) -> int:
    total = max(int(seconds or 0), 0)
    if total == 0:
        return 0
    if total < 60:
        return 1
    return total // 60


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


def normalize_user_role(role: UserRole | str | None) -> UserRole:
    if isinstance(role, UserRole):
        return role
    try:
        return UserRole((role or UserRole.USER.value).strip().upper())
    except ValueError:
        return UserRole.USER


def is_privileged_billing_role(role: UserRole | str | None) -> bool:
    return normalize_user_role(role) in PRIVILEGED_BILLING_ROLES


def get_plan_timers(plan: str | None) -> dict[str, int | bool]:
    return APP_PLAN_TIMERS.get(plan_from_db(plan), APP_PLAN_TIMERS["FREE"])


def get_plan_credit_limit(plan: str | None) -> int:
    return get_plan_timers(plan)["allowed_credits"]


def get_plan_output_height_cap(plan: str | None) -> int:
    return PLAN_OUTPUT_HEIGHT_CAPS.get(plan_from_db(plan), PLAN_OUTPUT_HEIGHT_CAPS["FREE"])


def plan_has_workspace_access(plan: str | None) -> bool:
    return bool(FINAL_TIERS[plan_from_db(plan)]["project_access"])


def get_plan_workspace_project_limit(plan: str | None) -> int:
    return int(FINAL_TIERS[plan_from_db(plan)]["workspace_project_limit"])


def clamp_render_output_height(
    plan: str | None,
    requested_height: int | None,
    native_height: int | None,
    *,
    allow_upscale: bool,
) -> int:
    """
    Enforce the plan-specific maximum output height.

    `requested_height == 0` means "match source", but oversized source videos still
    need to be capped down to the plan ceiling.
    """
    plan_cap = get_plan_output_height_cap(plan)
    requested = max(int(requested_height or 0), 0)
    native = max(int(native_height or 0), 0)

    if requested == 0:
        if native > plan_cap:
            return plan_cap
        return 0

    capped_request = min(requested, plan_cap)
    if allow_upscale or native <= 0:
        return capped_request
    return min(capped_request, native)


def get_cycle_allocation(plan: str | None) -> dict[str, int | bool]:
    timers = get_plan_timers(plan)
    allowed_seconds = int(timers["allowed_seconds"])
    return {
        "advertised_mins": int(timers["advertised_mins"]),
        "ui_display_minutes": int(timers["ui_display_minutes"]),
        "advertised_credits": int(timers["advertised_credits"]),
        "allowed_minutes": int(timers["ui_display_minutes"]),
        "allowed_seconds": allowed_seconds,
        "allowed_credits": int(timers["allowed_credits"]),
        "credit_minutes": int(timers["ui_display_minutes"]),
        "seconds_balance": allowed_seconds,
        "chars_balance": 0,
        "is_recurring": bool(timers["is_recurring"]),
    }


def sync_display_minutes(seconds_balance: int | None) -> int:
    return seconds_to_display_minutes(seconds_balance)


def seconds_to_credit_balance(
    plan: str | None,
    seconds_balance: int | None,
) -> int:
    timers = get_plan_timers(plan)
    allowed_seconds = max(int(timers["allowed_seconds"]), 1)
    allowed_credits = max(int(timers["allowed_credits"]), 0)
    normalized_seconds = max(min(int(seconds_balance or 0), allowed_seconds), 0)
    return round((normalized_seconds / allowed_seconds) * allowed_credits)


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
        if normalized == "FREE":
            return (
                "Your one-time Free allocation is exhausted. "
                "Upgrade with PhonePe to continue processing."
            )
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


def verify_generation_access(
    *,
    current_user,
    incoming_video_duration: int,
    logger: logging.Logger,
) -> None:
    role = normalize_user_role(getattr(current_user, "role", None))
    if role in PRIVILEGED_BILLING_ROLES:
        logger.info(
            "Privileged account '%s' verified for %s. Bypassing billing walls.",
            role.value,
            getattr(current_user, "email", "unknown"),
        )
        return

    plan = getattr(current_user, "subscription_plan", None)
    generation_block_reason = get_generation_block_reason(
        plan,
        getattr(current_user, "seconds_balance", 0),
        incoming_video_duration,
    )
    if generation_block_reason:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=generation_block_reason,
        )


def verify_workspace_access(
    *,
    current_user,
    logger: logging.Logger,
    action: str = "access the Projects workspace",
) -> None:
    role = normalize_user_role(getattr(current_user, "role", None))
    if role in PRIVILEGED_BILLING_ROLES:
        logger.info(
            "Privileged account '%s' verified for %s. Bypassing workspace access walls.",
            role.value,
            getattr(current_user, "email", "unknown"),
        )
        return

    plan = getattr(current_user, "subscription_plan", None)
    normalized_plan = plan_from_db(plan)
    tier = FINAL_TIERS[normalized_plan]
    if not tier["project_access"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Your {tier['label']} plan does not include Projects workspace access. "
                f"Upgrade to Starter or above to {action}."
            ),
        )


def verify_workspace_project_quota(
    *,
    current_user,
    current_project_count: int,
    logger: logging.Logger,
) -> None:
    role = normalize_user_role(getattr(current_user, "role", None))
    if role in PRIVILEGED_BILLING_ROLES:
        logger.info(
            "Privileged account '%s' verified for %s. Bypassing workspace project quota.",
            role.value,
            getattr(current_user, "email", "unknown"),
        )
        return

    plan = getattr(current_user, "subscription_plan", None)
    normalized_plan = plan_from_db(plan)
    tier = FINAL_TIERS[normalized_plan]
    limit = int(tier["workspace_project_limit"])

    if current_project_count >= limit:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Your {tier['label']} plan allows up to {limit} workspace projects. "
                "Upgrade your plan to create more."
            ),
        )


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
        "ui_display_minutes": get_cycle_allocation("FREE")["ui_display_minutes"],
        "advertised_credits": get_cycle_allocation("FREE")["advertised_credits"],
        "allowed_credits": get_cycle_allocation("FREE")["allowed_credits"],
        "credits_display": "7k credits total",
        "minutes_display": "1 min total",
        "profit_margin_percent": PROFIT_MARGIN_PERCENT,
        "quality": "Up to 420p",
        "max_output_height": get_plan_output_height_cap("FREE"),
        "allow_download": False,
        "allow_recording": False,
        "watermark": True,
        "cross_subtitles": False,
        "allow_cloning": True,
        "allow_priority": False,
        "project_access": False,
        "workspace_project_limit": 0,
        "is_recurring": get_cycle_allocation("FREE")["is_recurring"],
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
        "ui_display_minutes": get_cycle_allocation("STARTER")["ui_display_minutes"],
        "advertised_credits": get_cycle_allocation("STARTER")["advertised_credits"],
        "allowed_credits": get_cycle_allocation("STARTER")["allowed_credits"],
        "credits_display": "21k credits /mo",
        "minutes_display": "21 min /mo",
        "profit_margin_percent": PROFIT_MARGIN_PERCENT,
        "quality": "Up to 1080p",
        "max_output_height": get_plan_output_height_cap("STARTER"),
        "allow_download": True,
        "allow_recording": True,
        "watermark": False,
        "cross_subtitles": True,
        "allow_cloning": True,
        "allow_priority": False,
        "project_access": True,
        "workspace_project_limit": 20,
        "is_recurring": get_cycle_allocation("STARTER")["is_recurring"],
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
        "ui_display_minutes": get_cycle_allocation("CREATOR")["ui_display_minutes"],
        "advertised_credits": get_cycle_allocation("CREATOR")["advertised_credits"],
        "allowed_credits": get_cycle_allocation("CREATOR")["allowed_credits"],
        "credits_display": "84.7k credits /mo",
        "minutes_display": "84 min /mo",
        "profit_margin_percent": PROFIT_MARGIN_PERCENT,
        "quality": "Up to 2160p",
        "max_output_height": get_plan_output_height_cap("CREATOR"),
        "allow_download": True,
        "allow_recording": True,
        "watermark": False,
        "cross_subtitles": True,
        "allow_cloning": True,
        "allow_priority": False,
        "project_access": True,
        "workspace_project_limit": 1000,
        "is_recurring": get_cycle_allocation("CREATOR")["is_recurring"],
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
        "ui_display_minutes": get_cycle_allocation("PRO")["ui_display_minutes"],
        "advertised_credits": get_cycle_allocation("PRO")["advertised_credits"],
        "allowed_credits": get_cycle_allocation("PRO")["allowed_credits"],
        "credits_display": "420k credits /mo",
        "minutes_display": "420 min /mo",
        "profit_margin_percent": PROFIT_MARGIN_PERCENT,
        "quality": "Up to 2160p",
        "max_output_height": get_plan_output_height_cap("PRO"),
        "allow_download": True,
        "allow_recording": True,
        "watermark": False,
        "cross_subtitles": True,
        "allow_cloning": True,
        "allow_priority": True,
        "project_access": True,
        "workspace_project_limit": 3000,
        "is_recurring": get_cycle_allocation("PRO")["is_recurring"],
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
