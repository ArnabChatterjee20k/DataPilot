from laserorm.storage.storage import StorageSession
from .config import SourceConfig


async def get_columns(session: StorageSession, source: SourceConfig, entity_name: str):
    source = SourceConfig(source)
    match source:
        case SourceConfig.SQLITE:
            return await session.execute(f"PRAGMA table_info({entity_name})")
        case SourceConfig.POSTGRES:
            query = f"""
                SELECT 
                    column_name as name,
                    data_type as type,
                    is_nullable = 'YES' as nullable,
                    column_default as default_value,
                    ordinal_position
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = '{entity_name}'
                ORDER BY ordinal_position
            """
            return await session.execute(query)
