import uuid
from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


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
    status = Column(String(20), nullable=False, default="PENDING")
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
