import re
from typing import Optional
from pydantic import BaseModel, EmailStr, field_validator, model_validator

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
    subscription_plan: str = "free"
    credit_limit_minutes: int = 2
    phone_number: Optional[str] = None
    profile_picture_url: Optional[str] = None

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
    created_at: Optional[str] = None          # project upload date
    latest_job_id: Optional[str] = None
    latest_job_status: Optional[str] = None
    latest_job_language: Optional[str] = None
    latest_job_subtitle_language: Optional[str] = None
    latest_job_source_language: Optional[str] = None
    latest_job_scene_name: Optional[str] = None      # user-defined clip/scene label
    latest_job_created_at: Optional[str] = None      # when the latest job was queued
    latest_job_updated_at: Optional[str] = None      # last status change timestamp
    output_video_path: Optional[str] = None
    progress_percentage: int = 0

    class Config:
        from_attributes = True


# ─── Render Jobs ──────────────────────────────────────────────────────────────

# ElevenLabs Dubbing API — confirmed supported language set (32 languages)
_LANG_NAME_TO_CODE: dict[str, str] = {
    "arabic": "ar", "bulgarian": "bg", "chinese": "zh", "croatian": "hr",
    "czech": "cs", "danish": "da", "dutch": "nl", "english": "en",
    "filipino": "fil", "finnish": "fi", "french": "fr", "german": "de",
    "greek": "el", "hindi": "hi", "hungarian": "hu", "indonesian": "id",
    "italian": "it", "japanese": "ja", "korean": "ko", "malay": "ms",
    "norwegian": "no", "polish": "pl", "portuguese": "pt", "romanian": "ro",
    "russian": "ru", "slovak": "sk", "spanish": "es", "swedish": "sv",
    "tamil": "ta", "turkish": "tr", "ukrainian": "uk", "vietnamese": "vi",
}

_SUPPORTED_CODES: set[str] = set(_LANG_NAME_TO_CODE.values())


def _validate_lang_code(v: str) -> str:
    """Validate against ElevenLabs' 32 supported dubbing languages."""
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


# ─── Subtitle language — exact GoogleTranslator (deep-translator) code set ────
# Codes are taken verbatim from the deep-translator error response so they
# match what GoogleTranslator.translate_batch() accepts.  Codes differ from
# ISO 639 / ElevenLabs in a few places (zh-CN not zh, tl not fil, iw not he,
# jw not jv) — normalization is handled in subtitle_translator._normalize_google_lang.

_TRANSLATE_LANG_NAME_TO_CODE: dict[str, str] = {
    "afrikaans": "af",              "albanian": "sq",
    "amharic": "am",                "arabic": "ar",
    "armenian": "hy",               "assamese": "as",
    "aymara": "ay",                 "azerbaijani": "az",
    "bambara": "bm",                "basque": "eu",
    "belarusian": "be",             "bengali": "bn",
    "bhojpuri": "bho",              "bosnian": "bs",
    "bulgarian": "bg",              "catalan": "ca",
    "cebuano": "ceb",               "chichewa": "ny",
    "chinese (simplified)": "zh-CN","chinese (traditional)": "zh-TW",
    "chinese": "zh-CN",             "corsican": "co",
    "croatian": "hr",               "czech": "cs",
    "danish": "da",                 "dhivehi": "dv",
    "dogri": "doi",                 "dutch": "nl",
    "english": "en",                "esperanto": "eo",
    "estonian": "et",               "ewe": "ee",
    "filipino": "tl",               "finnish": "fi",
    "french": "fr",                 "frisian": "fy",
    "galician": "gl",               "georgian": "ka",
    "german": "de",                 "greek": "el",
    "guarani": "gn",                "gujarati": "gu",
    "haitian creole": "ht",         "hausa": "ha",
    "hawaiian": "haw",              "hebrew": "iw",
    "hindi": "hi",                  "hmong": "hmn",
    "hungarian": "hu",              "icelandic": "is",
    "igbo": "ig",                   "ilocano": "ilo",
    "indonesian": "id",             "irish": "ga",
    "italian": "it",                "japanese": "ja",
    "javanese": "jw",               "kannada": "kn",
    "kazakh": "kk",                 "khmer": "km",
    "kinyarwanda": "rw",            "konkani": "gom",
    "korean": "ko",                 "krio": "kri",
    "kurdish (kurmanji)": "ku",     "kurdish (sorani)": "ckb",
    "kyrgyz": "ky",                 "lao": "lo",
    "latin": "la",                  "latvian": "lv",
    "lingala": "ln",                "lithuanian": "lt",
    "luganda": "lg",                "luxembourgish": "lb",
    "macedonian": "mk",             "maithili": "mai",
    "malagasy": "mg",               "malay": "ms",
    "malayalam": "ml",              "maltese": "mt",
    "maori": "mi",                  "marathi": "mr",
    "meiteilon (manipuri)": "mni-Mtei", "mizo": "lus",
    "mongolian": "mn",              "myanmar": "my",
    "nepali": "ne",                 "norwegian": "no",
    "odia (oriya)": "or",           "oromo": "om",
    "pashto": "ps",                 "persian": "fa",
    "polish": "pl",                 "portuguese": "pt",
    "punjabi": "pa",                "quechua": "qu",
    "romanian": "ro",               "russian": "ru",
    "samoan": "sm",                 "sanskrit": "sa",
    "scots gaelic": "gd",           "sepedi": "nso",
    "serbian": "sr",                "sesotho": "st",
    "shona": "sn",                  "sindhi": "sd",
    "sinhala": "si",                "slovak": "sk",
    "slovenian": "sl",              "somali": "so",
    "spanish": "es",                "sundanese": "su",
    "swahili": "sw",                "swedish": "sv",
    "tajik": "tg",                  "tamil": "ta",
    "tatar": "tt",                  "telugu": "te",
    "thai": "th",                   "tigrinya": "ti",
    "tsonga": "ts",                 "turkish": "tr",
    "turkmen": "tk",                "twi": "ak",
    "ukrainian": "uk",              "urdu": "ur",
    "uyghur": "ug",                 "uzbek": "uz",
    "vietnamese": "vi",             "welsh": "cy",
    "xhosa": "xh",                  "yiddish": "yi",
    "yoruba": "yo",                 "zulu": "zu",
}

# Aliases so users can still type zh, fil, he, jv etc.
_GOOGLE_SUBTITLE_ALIASES: dict[str, str] = {
    "zh": "zh-CN", "zh-cn": "zh-CN", "zh-tw": "zh-TW",
    "fil": "tl", "he": "iw", "jv": "jw",
    "pt-br": "pt", "pt-pt": "pt",
}

_TRANSLATE_LANG_CODES: frozenset[str] = frozenset(_TRANSLATE_LANG_NAME_TO_CODE.values())


def _validate_subtitle_lang_code(v: str) -> str:
    """Validate against the exact code set that deep-translator (GoogleTranslator) accepts."""
    v = v.strip().lower()
    # Check full name first (e.g. "hindi" → "hi")
    if v in _TRANSLATE_LANG_NAME_TO_CODE:
        return _TRANSLATE_LANG_NAME_TO_CODE[v]
    # Normalize aliases (zh→zh-CN, fil→tl, he→iw, jv→jw, etc.)
    v = _GOOGLE_SUBTITLE_ALIASES.get(v, v)
    if v not in _TRANSLATE_LANG_CODES:
        raise ValueError(
            f"'{v}' is not a supported subtitle language. "
            "Use a language name (e.g. 'hindi') or its code (e.g. 'hi', 'zh-CN')."
        )
    return v


class VideoProcess(BaseModel):
    scene_name: Optional[str] = None        # user-defined clip/scene label; drives output filename
    target_voice_language: str
    target_subtitle_language: str = "en"
    source_language: str = "auto"   # "auto" lets ElevenLabs detect; or pass BCP-47 code

    @field_validator("target_voice_language")
    @classmethod
    def validate_voice_lang(cls, v: str) -> str:
        return _validate_lang_code(v)

    @field_validator("target_subtitle_language")
    @classmethod
    def validate_subtitle_lang(cls, v: str) -> str:
        return _validate_subtitle_lang_code(v)

    @field_validator("source_language")
    @classmethod
    def validate_source_lang(cls, v: str) -> str:
        v = v.strip().lower()
        if v == "auto":
            return v
        # Accept any ElevenLabs or Google Translate code when explicitly supplied
        if v in _TRANSLATE_LANG_NAME_TO_CODE:
            v = _TRANSLATE_LANG_NAME_TO_CODE[v]
        if v not in _TRANSLATE_LANG_CODES:
            raise ValueError(
                f"'{v}' is not a recognised language code. "
                "Use 'auto' for auto-detection or a standard ISO 639-1 code."
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


class InitiatePaymentRequest(BaseModel):
    package_id: str

    @field_validator("package_id")
    @classmethod
    def validate_package(cls, v: str) -> str:
        allowed = {"starter", "creator"}
        if v not in allowed:
            raise ValueError(f"package_id must be one of: {sorted(allowed)}")
        return v


class ForgotPasswordRequest(BaseModel):
    email: EmailStr

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return _validate_email_domain(v)


class ResetPasswordVerify(BaseModel):
    email: EmailStr
    otp_code: str
    new_password: str
    confirm_new_password: str

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

    @field_validator("new_password")
    @classmethod
    def new_password_length(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("Password must be at least 6 characters.")
        if len(v.encode("utf-8")) > 72:
            raise ValueError("Password must be 72 characters or fewer.")
        return v

    @model_validator(mode="after")
    def passwords_match(self) -> "ResetPasswordVerify":
        if self.new_password != self.confirm_new_password:
            raise ValueError("New passwords do not match.")
        return self


class SubscribeRequest(BaseModel):
    target_plan: str

    @field_validator("target_plan")
    @classmethod
    def validate_plan(cls, v: str) -> str:
        allowed = {"FREE", "STARTER", "CREATOR", "PRO"}
        v = v.strip().upper()
        if v not in allowed:
            raise ValueError(f"target_plan must be one of: {sorted(allowed)}")
        return v


class ChangePassword(BaseModel):
    current_password: str
    new_password: str
    confirm_new_password: str

    @field_validator("new_password")
    @classmethod
    def new_password_length(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("New password must be at least 6 characters.")
        if len(v.encode("utf-8")) > 72:
            raise ValueError("New password must be 72 characters or fewer.")
        return v

    @model_validator(mode="after")
    def passwords_match(self) -> "ChangePassword":
        if self.new_password != self.confirm_new_password:
            raise ValueError("New passwords do not match.")
        return self


class ProcessResponse(BaseModel):
    job_id: str
    project_id: str
    target_language: str
    status: str
    message: str
    new_project_title: Optional[str] = None  # set by /rework endpoint


class JobStatusResponse(BaseModel):
    job_id: str
    project_id: str
    status: str
    scene_name: Optional[str] = None
    target_language: str
    source_language: Optional[str] = None
    output_video_path: Optional[str] = None
    error_message: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    progress_percentage: int = 0


# ─── Workspace: Folders ───────────────────────────────────────────────────────

class FolderCreate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Folder name cannot be empty.")
        return v


class FolderRename(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Folder name cannot be empty.")
        return v


class FolderResponse(BaseModel):
    folder_id: str
    name: str
    created_at: str
    project_count: int = 0


# ─── Workspace: Projects ──────────────────────────────────────────────────────

class WorkspaceProjectCreate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Folder name cannot be empty.")
        return v


class WorkspaceProjectRename(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Folder name cannot be empty.")
        return v


class WorkspaceProjectResponse(BaseModel):
    project_id: str
    name: str
    created_at: str


class WorkspaceRootResponse(BaseModel):
    folders: list[FolderResponse]
    projects: list[WorkspaceProjectResponse]


# ─── Workspace: Scene / Render-job detail ─────────────────────────────────────

class SceneItem(BaseModel):
    job_id: str
    project_id: str
    folder_id: Optional[str] = None       # explorer folder this scene lives in; None = project root
    scene_name: Optional[str] = None
    target_voice_lang: str
    target_subtitle_lang: Optional[str] = None
    source_language: Optional[str] = None
    status: str
    progress_percentage: int = 0
    output_video_path: Optional[str] = None
    error_message: Optional[str] = None
    created_at: str
    updated_at: str


class ProjectDetailResponse(BaseModel):
    project_id: str
    name: str
    folder_id: Optional[str] = None
    target_voice_lang: Optional[str] = None
    target_subtitle_lang: Optional[str] = None
    created_at: str
    scenes: list[SceneItem]


# ─── Explorer: recursive folder + scene system ────────────────────────────────

class ExplorerFolderItem(BaseModel):
    folder_id: str
    project_id: str
    parent_id: Optional[str] = None
    name: str
    created_at: str


class ExplorerContentsResponse(BaseModel):
    project_id: str
    project_name: str
    current_folder_id: Optional[str] = None
    folders: list[ExplorerFolderItem]
    scenes: list[SceneItem]


class ExplorerFolderCreate(BaseModel):
    project_id: str
    parent_id: Optional[str] = None
    name: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Folder name cannot be empty.")
        return v


class ExplorerFolderRename(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Folder name cannot be empty.")
        return v


class SceneRename(BaseModel):
    scene_name: str

    @field_validator("scene_name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Scene name cannot be empty.")
        return v
