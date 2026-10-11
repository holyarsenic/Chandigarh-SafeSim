from collections.abc import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings

# Clean connection URL for asyncpg
raw_url = settings.DATABASE_URL.strip()
if raw_url.startswith("postgresql://"):
    raw_url = raw_url.replace("postgresql://", "postgresql+asyncpg://", 1)

clean_url = raw_url.split("?")[0]

engine = create_async_engine(
    clean_url,
    connect_args={
        "ssl": "require",
        "server_settings": {
            "application_name": "chandigarh_safesim",
            "search_path": "public",
        },
    },
    echo=settings.DEBUG,
    pool_size=5,
    max_overflow=2,
    pool_pre_ping=True,
    pool_recycle=300,
)

async_session_maker = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

class Base(DeclarativeBase):
    pass

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        try:
            yield session
        finally:
            await session.close()