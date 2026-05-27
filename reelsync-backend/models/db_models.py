import uuid
from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class OTPVerification(Base):
    """
    Short-lived staging record created by POST /signup-request.
    Holds the hashed password and phone number so /verify-otp can create
    the real User row without the client re-sending credentials.
    Deleted on successful verification, on expiry check, or on max attempts.
    """
    __tablename__ = "otp_verifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)
    email = Column(String(320), nullable=False, index=True, unique=True)
    otp_code = Column(String(6), nullable=False)
    hashed_password = Column(String, nullable=False)
    phone_number = Column(String(20), nullable=True)
    attempt_count = Column(SmallInteger, nullable=False, default=0)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class PasswordResetOTP(Base):
    """
    Short-lived record created by POST /forgot-password-request.
    Holds only the OTP; no credentials. Deleted after successful
    password reset, on expiry, or after max failed attempts.
    """
    __tablename__ = "password_reset_otps"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)
    email = Column(String(320), nullable=False, index=True, unique=True)
    otp_code = Column(String(6), nullable=False)
    attempt_count = Column(SmallInteger, nullable=False, default=0)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class User(Base):
    __tablename__ = "users"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        nullable=False,
    )
    email = Column(
        String(320),
        unique=True,
        nullable=False,
        index=True,
    )
    # Optional at signup; collected later for PhonePe mandate billing.
    # Unique constraint prevents phone number sharing across accounts
    # to block the free-credit farming vector.
    phone_number = Column(
        String(20),
        unique=True,
        nullable=True,
        index=True,
    )
    hashed_password = Column(String, nullable=False)
    credit_minutes = Column(Integer, nullable=False, default=3)
    # Subscription plan key — must be a key in config.PROFITABLE_TIERS
    subscription_plan = Column(String(50), nullable=False, default="free", server_default="free")
    # Running character balance; decremented by actual transcript char count per job.
    # Initialized at signup and topped up with each payment (see routers/auth.py,
    # routers/payments.py). Blocked at 0 by the DENSE_TEXT_LIMIT pipeline guard.
    chars_balance = Column(Integer, nullable=False, default=0, server_default="0")
    profile_picture_url = Column(String(500), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    projects = relationship(
        "Project",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class PaymentTransaction(Base):
    """
    One row per initiated PhonePe payment.
    Created as PENDING at /initiate, updated to COMPLETED by the webhook.
    Used as the authoritative source for credit grants — prevents double-crediting.
    """
    __tablename__ = "payment_transactions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    merchant_txn_id = Column(String(38), nullable=False, unique=True, index=True)
    package_id = Column(String(50), nullable=False)
    credits = Column(Integer, nullable=False)
    amount_paise = Column(Integer, nullable=False)
    status = Column(String(20), nullable=False, default="PENDING")  # PENDING | COMPLETED | FAILED
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=datetime.utcnow,
        nullable=False,
    )


class Project(Base):
    __tablename__ = "projects"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title = Column(String(255), nullable=False)
    original_video_path = Column(String, nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    user = relationship("User", back_populates="projects")
    render_jobs = relationship(
        "RenderJob",
        back_populates="project",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class RenderJob(Base):
    __tablename__ = "render_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    target_language = Column(String(10), nullable=False)
    subtitle_language = Column(String(10), nullable=True)
    status = Column(String(30), nullable=False, default="PENDING")
    progress_percentage = Column(Integer, nullable=False, default=0, server_default="0")
    output_video_path = Column(String, nullable=True)
    error_message = Column(String, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=datetime.utcnow,
        nullable=False,
    )

    project = relationship("Project", back_populates="render_jobs")
