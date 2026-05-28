import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
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
    __tablename__ = "otp_verifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)
    email = Column(String(320), nullable=False, index=True, unique=True)
    otp_code = Column(String(6), nullable=False)
    hashed_password = Column(String, nullable=False)
    phone_number = Column(String(20), nullable=True)
    attempt_count = Column(SmallInteger, nullable=False, default=0)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PasswordResetOTP(Base):
    __tablename__ = "password_reset_otps"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)
    email = Column(String(320), nullable=False, index=True, unique=True)
    otp_code = Column(String(6), nullable=False)
    attempt_count = Column(SmallInteger, nullable=False, default=0)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)
    email = Column(String(320), unique=True, nullable=False, index=True)
    phone_number = Column(String(20), unique=True, nullable=True, index=True)
    hashed_password = Column(String, nullable=False)
    credit_minutes = Column(Integer, nullable=False, default=3)
    subscription_plan = Column(String(50), nullable=False, default="free", server_default="free")
    chars_balance = Column(Integer, nullable=False, default=0, server_default="0")
    profile_picture_url = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    folders = relationship(
        "Folder",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    projects = relationship(
        "Project",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class PaymentTransaction(Base):
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
    status = Column(String(20), nullable=False, default="PENDING")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=datetime.utcnow,
        nullable=False,
    )


class Folder(Base):
    """
    Organisational container.  A folder belongs to one user and can hold many
    projects.  Projects at root level have folder_id = NULL.
    """
    __tablename__ = "folders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User", back_populates="folders")
    projects = relationship(
        "Project",
        back_populates="folder",
        # When a folder is deleted, projects are moved to root (folder_id → NULL)
        # by the DELETE endpoint before deleting the folder row, so no cascade needed.
        passive_deletes=True,
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
    # Nullable so workspace-created projects can exist before a video is attached.
    folder_id = Column(
        UUID(as_uuid=True),
        ForeignKey("folders.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    title = Column(String(255), nullable=False)
    # True = created from the Projects workspace; False = created from the dashboard upload flow.
    # Keeps Recent Renders and the Projects workspace completely separate.
    is_workspace = Column(Boolean, nullable=False, default=False, server_default="false")
    original_video_path = Column(String, nullable=True)  # NULL until video is uploaded
    # Language defaults set when the project is created in the workspace.
    # Overridden per render-job at submission time.
    target_voice_lang = Column(String(10), nullable=True)
    target_subtitle_lang = Column(String(10), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User", back_populates="projects")
    folder = relationship("Folder", back_populates="projects")
    explorer_folders = relationship(
        "ExplorerFolder",
        back_populates="project",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
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
    scene_name = Column(String(255), nullable=True)
    target_language = Column(String(10), nullable=False)
    subtitle_language = Column(String(10), nullable=True)
    source_language = Column(String(10), nullable=True)
    status = Column(String(30), nullable=False, default="PENDING")
    progress_percentage = Column(Integer, nullable=False, default=0, server_default="0")
    input_video_path = Column(String, nullable=True)   # per-scene source; falls back to project.original_video_path
    output_video_path = Column(String, nullable=True)
    error_message = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=datetime.utcnow,
        nullable=False,
    )

    # nullable FK to an ExplorerFolder; NULL = lives at project root level
    folder_id = Column(
        UUID(as_uuid=True),
        ForeignKey("explorer_folders.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    project = relationship("Project", back_populates="render_jobs")
    explorer_folder = relationship("ExplorerFolder", back_populates="scenes", foreign_keys=[folder_id])


class ExplorerFolder(Base):
    """
    Self-referential folder node inside a workspace Project.
    parent_id = NULL  →  folder lives at project root level.
    Deleting a folder cascades to all child folders and their scenes (render_jobs).
    """
    __tablename__ = "explorer_folders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    parent_id = Column(
        UUID(as_uuid=True),
        ForeignKey("explorer_folders.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    name = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    project = relationship("Project", back_populates="explorer_folders")

    # Many-to-one: this folder's direct parent
    parent = relationship(
        "ExplorerFolder",
        back_populates="children",
        remote_side=[id],
        foreign_keys=[parent_id],
    )
    # One-to-many: direct children (recursive cascade handled by DB ON DELETE CASCADE)
    children = relationship(
        "ExplorerFolder",
        back_populates="parent",
        foreign_keys=[parent_id],
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    # Scenes (render_jobs) stored directly inside this folder
    scenes = relationship(
        "RenderJob",
        back_populates="explorer_folder",
        foreign_keys="[RenderJob.folder_id]",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
