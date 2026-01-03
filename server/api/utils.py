from laserorm.storage.storage import StorageSession
from .config import SourceConfig


async def get_columns(session: StorageSession, source: SourceConfig, entity_name: str, schema_name: str = None):
    source = SourceConfig(source)
    match source:
        case SourceConfig.SQLITE:
            return await session.execute(f"PRAGMA table_info({entity_name})")
        case SourceConfig.POSTGRES:
            # If entity_name contains schema (format: schema.table), parse it
            if '.' in entity_name:
                schema_name, table_name = entity_name.split('.', 1)
            else:
                table_name = entity_name
                schema_name = schema_name or 'public'
            
            query = f"""
                SELECT 
                    column_name as name,
                    data_type as type,
                    is_nullable = 'YES' as nullable,
                    column_default as default_value,
                    ordinal_position
                FROM information_schema.columns
                WHERE table_schema = '{schema_name}' AND table_name = '{table_name}'
                ORDER BY ordinal_position
            """
            return await session.execute(query)
