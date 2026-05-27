import logging
import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession

from config import STORAGE_DIR, settings
from database import get_db
from models.db_models import User
from models.schemas import ChangePassword
from routers.auth import ALGORITHM, get_current_user, hash_password, verify_password

logger = logging.getLogger(__name__)
router = APIRouter()

_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/jpg", "image/png"}
_MAX_BYTES = 2 * 1024 * 1024  # 2 MB


def _valid_image_magic(data: bytes) -> bool:
    return data[:8] == b"\x89PNG\r\n\x1a\n" or data[:3] == b"\xff\xd8\xff"


# ─── POST /profile-picture ────────────────────────────────────────────────────

@router.post(
    "/profile-picture",
    summary="Upload or replace the authenticated user's profile picture",
)
async def upload_profile_picture(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if file.content_type not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only PNG, JPG, or JPEG images are accepted.",
        )

    contents = await file.read()

    if not contents:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )
    if len(contents) > _MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image must be 2 MB or smaller.",
        )
    if not _valid_image_magic(contents):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="File does not appear to be a valid PNG or JPEG image.",
        )

    user_id = str(current_user.id)
    profile_dir = os.path.join(STORAGE_DIR, "profiles", user_id)
    os.makedirs(profile_dir, exist_ok=True)

    dest = os.path.join(profile_dir, "avatar.png")
    with open(dest, "wb") as fh:
        fh.write(contents)

    url = f"/profiles/{user_id}/avatar.png"
    current_user.profile_picture_url = url
    db.add(current_user)
    await db.commit()

    logger.info(f"[profile-picture] saved for user_id={user_id}")
    return {"profile_picture_url": url}


# ─── DELETE /profile-picture ──────────────────────────────────────────────────

@router.delete(
    "/profile-picture",
    summary="Delete the authenticated user's profile picture",
)
async def delete_profile_picture(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = str(current_user.id)
    avatar_path = os.path.join(STORAGE_DIR, "profiles", user_id, "avatar.png")

    if os.path.isfile(avatar_path):
        os.remove(avatar_path)
        logger.info(f"[profile-picture] deleted file for user_id={user_id}")

    current_user.profile_picture_url = None
    db.add(current_user)
    await db.commit()

    return {"message": "Profile picture removed.", "profile_picture_url": None}


# ─── GET /profile-picture/{user_id} ──────────────────────────────────────────

@router.get(
    "/profile-picture/{user_id}",
    summary="Stream a user's profile picture (JWT required as query param)",
)
async def get_profile_picture(
    user_id: str,
    token: str = Query(..., description="JWT access token"),
    db: AsyncSession = Depends(get_db),
):
    """
    Authenticated image endpoint used by <img> tags and next/image.
    Accepts the JWT as ?token= so the browser can load it directly.
    Any authenticated user can fetch any profile picture by user_id —
    UUIDs provide sufficient obscurity for non-sensitive avatars.
    """
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[ALGORITHM])
        if not payload.get("sub"):
            raise JWTError("missing sub")
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
        )

    try:
        uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid user ID.",
        )

    avatar_path = os.path.join(STORAGE_DIR, "profiles", user_id, "avatar.png")
    if not os.path.isfile(avatar_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile picture not found.",
        )

    return FileResponse(
        avatar_path,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=3600"},
    )


# ─── POST /change-password ────────────────────────────────────────────────────

@router.post(
    "/change-password",
    summary="Update the authenticated user's password",
)
async def change_password(
    body: ChangePassword,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect current password.",
        )

    current_user.hashed_password = hash_password(body.new_password)
    db.add(current_user)
    await db.commit()

    logger.info(f"[change-password] updated for user_id={current_user.id}")
    return {"message": "Password updated successfully."}
