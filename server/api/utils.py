from laserorm.storage.storage import StorageSession
from .config import SourceConfig


async def get_columns(session: StorageSession, source: SourceConfig, entity_name: str):
    source = SourceConfig(source)
    match source:
        case SourceConfig.SQLITE:
            return await session.execute(f"PRAGMA table_info({entity_name})")
