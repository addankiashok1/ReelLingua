import asyncio

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from config import settings
from models.db_models import ROOT_BOOTSTRAP_EMAIL, User, UserRole


engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def seed_root_user() -> None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(User).where(func.lower(User.email) == ROOT_BOOTSTRAP_EMAIL.lower())
        )
        user = result.scalar_one_or_none()

        if not user:
            raise SystemExit(
                f"User '{ROOT_BOOTSTRAP_EMAIL}' was not found. "
                "Create the account first, then run this script again."
            )

        user.role = UserRole.ROOT
        await session.commit()
        await session.refresh(user)

        print(
            f"Updated account '{user.email}' to role '{getattr(user.role, 'value', user.role)}'."
        )


async def main() -> None:
    try:
        await seed_root_user()
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
