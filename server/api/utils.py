from laserorm.storage.storage import ExecutionResult, StorageSession
from .models import QueryResult
from .config import SourceConfig


async def get_columns(session: StorageSession, source: SourceConfig, entity_name: str):
    source = SourceConfig(source)
    match source:
        case SourceConfig.SQLITE:
            return await session.execute(f"PRAGMA table_info({entity_name})")


async def get_initial_rows_query(
    session: StorageSession, source: str, connection_uri: str, entity_name: str
):
    source = SourceConfig(source)
    result: ExecutionResult = None
    query = ""
    match source:
        case SourceConfig.SQLITE:
            # using literal here instead of placeholder(?) as entity_name is a literal
            result = await session.execute(f"SELECT * FROM {entity_name} limit 100")
            query = f"SELECT * FROM {entity_name}"
            if result.description:
                columns_result = await get_columns(session, source, entity_name)
                result.description = columns_result.description
            result.rows = result.rows if result.rows else []
            result.description = result.description if result.description else []
            return QueryResult(
                rows=result.rows,
                columns=result.description,
                connection_id=connection_uri,
                entity_name=entity_name,
                query=query,
            )
