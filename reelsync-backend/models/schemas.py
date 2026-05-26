import re
from typing import Optional
from pydantic import BaseModel, EmailStr, field_validator

# Domains that are either placeholder, disposable, or commonly abused in testing.
# Checked on both signup and login so no blacklisted address can ever authenticate.
_BLOCKED_DOMAINS: frozenset[str] = frozenset({
    "example.com", "example.org", "example.net",
    "test.com", "test.org", "test.net",
    "mailinator.com", "guerrillamail.com", "guerrillamail.org",
    "tempmail.com", "throwaway.email", "yopmail.com",
    "sharklasers.com", "trashmail.com", "dispostable.com",
    "xyz.com", "foo.com", "bar.com",
})

_TYPO_DOMAINS: dict[str, str] = {
    "gamil.com": "gmail.com", "gmai.com": "gmail.com", "gmial.com": "gmail.com",
    "gnail.com": "gmail.com", "gmal.com": "gmail.com", "gmail.co": "gmail.com",
    "gmail.cm": "gmail.com", "gmil.com": "gmail.com", "gimail.com": "gmail.com",
    "yahooo.com": "yahoo.com", "yaho.com": "yahoo.com", "yhoo.com": "yahoo.com",
    "yhaoo.com": "yahoo.com", "yahoo.co": "yahoo.com",
    "hotmial.com": "hotmail.com", "hotmaill.com": "hotmail.com", "hotmal.com": "hotmail.com",
    "hotmai.com": "hotmail.com",
    "outlok.com": "outlook.com", "outloo.com": "outlook.com", "outlook.co": "outlook.com",
}

_EMAIL_RE = re.compile(
    r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$"
)


def _validate_email_domain(email: str) -> str:
    """Shared logic used by both UserCreate and UserLogin validators."""
    email = email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise ValueError(
            "Enter a valid email address (e.g. name@domain.com)."
        )
    domain = email.split("@", 1)[1]
    if domain in _BLOCKED_DOMAINS:
        raise ValueError("This email domain is not permitted.")
    suggestion = _TYPO_DOMAINS.get(domain)
    if suggestion:
        raise ValueError(
            f"Did you mean @{suggestion}? Please check your email address."
        )
    return email


# ─── Auth ─────────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    phone_number: Optional[str] = None

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return _validate_email_domain(v)

    @field_validator("password")
    @classmethod
    def password_length(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("Password must be at least 6 characters.")
        if len(v.encode("utf-8")) > 72:
            raise ValueError("Password must be 72 characters or fewer.")
        return v

    @field_validator("phone_number", mode="before")
    @classmethod
    def normalize_phone(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        cleaned = v.strip()
        if not cleaned:
            return None
        # Strip formatting characters
        digits = re.sub(r"[\s\-().]+", "", cleaned)
        # Accept +91XXXXXXXXXX, 91XXXXXXXXXX, or XXXXXXXXXX
        if digits.startswith("+91"):
            local = digits[3:]
        elif digits.startswith("91") and len(digits) == 12:
            local = digits[2:]
        else:
            local = digits
        if not re.fullmatch(r"[6-9]\d{9}", local):
            raise ValueError(
                "phone_number must be a valid 10-digit Indian mobile number "
                "starting with 6–9 (e.g. '9876543210' or '+919876543210')."
            )
        return f"+91{local}"


class UserLogin(BaseModel):
    email: EmailStr
    password: str

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return _validate_email_domain(v)


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    email: str


class UserOut(BaseModel):
    user_id: str
    email: str
    credit_minutes: int
    phone_number: Optional[str] = None

    class Config:
        from_attributes = True


# ─── Projects ─────────────────────────────────────────────────────────────────

class ProjectUploadResponse(BaseModel):
    project_id: str
    title: str
    local_path: str
    message: str


class ProjectHistoryItem(BaseModel):
    project_id: str
    title: str
    created_at: Optional[str] = None
    latest_job_id: Optional[str] = None
    latest_job_status: Optional[str] = None
    latest_job_language: Optional[str] = None
    output_video_path: Optional[str] = None

    class Config:
        from_attributes = True


# ─── Render Jobs ──────────────────────────────────────────────────────────────

# ElevenLabs Dubbing API supported target languages only
_LANG_NAME_TO_CODE: dict[str, str] = {
    "hindi": "hi", "english": "en", "spanish": "es", "french": "fr",
    "german": "de", "portuguese": "pt", "italian": "it", "japanese": "ja",
    "korean": "ko", "chinese": "zh", "arabic": "ar", "russian": "ru",
    "turkish": "tr", "indonesian": "id", "polish": "pl", "dutch": "nl",
    "swedish": "sv", "filipino": "fil", "malay": "ms", "romanian": "ro",
    "ukrainian": "uk",
}

_SUPPORTED_CODES: set[str] = set(_LANG_NAME_TO_CODE.values())


class VideoProcess(BaseModel):
    target_language: str

    @field_validator("target_language")
    @classmethod
    def validate_lang(cls, v: str) -> str:
        v = v.strip().lower()
        if v in _LANG_NAME_TO_CODE:
            v = _LANG_NAME_TO_CODE[v]
        if v not in _SUPPORTED_CODES:
            supported = ", ".join(sorted(_SUPPORTED_CODES))
            raise ValueError(
                f"'{v}' is not supported by ElevenLabs Dubbing. "
                f"Supported codes: {supported}"
            )
        return v


class OTPVerify(BaseModel):
    email: EmailStr
    otp_code: str

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return _validate_email_domain(v)

    @field_validator("otp_code")
    @classmethod
    def validate_otp_code(cls, v: str) -> str:
        v = v.strip()
        if not re.fullmatch(r"\d{6}", v):
            raise ValueError("OTP must be exactly 6 digits.")
        return v


class ProcessResponse(BaseModel):
    job_id: str
    project_id: str
    target_language: str
    status: str
    message: str


class JobStatusResponse(BaseModel):
    job_id: str
    project_id: str
    status: str
    target_language: str
    output_video_path: Optional[str] = None
    error_message: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
