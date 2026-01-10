from fastapi import APIRouter, Query, HTTPException, status
from typing import Annotated, Optional
import asyncpg
from ..config import get_adapter, SourceConfig
from . import UPLOAD_DIR
from ..models import QueryResult, TableModelList, TableModel, SchemaModelList, SchemaModel
from ..database.db import DBSession
from ..database.models import Connections

router = APIRouter(tags=["queries"])


@router.get(
    "/connection/{connection_id}/entitities/{entity_name}/queries",
    response_model=QueryResult,
)
async def execute_query(
    connection_id: str,
    entity_name: str,
    db: DBSession,
    query: Annotated[str, Query()],
    limit: Annotated[Optional[int], Query()] = None,
    offset: Annotated[Optional[int], Query()] = None,
):
    connection = await db.get(Connections, filters=Connections.uid == connection_id)
    if connection.source == SourceConfig.SQLITE.value:
        connection.connection_uri = UPLOAD_DIR / connection.connection_uri
    Adapter = get_adapter(connection.source)
    storage = Adapter(connection_uri=connection.connection_uri)
    
    try:
        async with storage.session() as session:
            # Execute query as-is (frontend controls pagination in SQL)
            result = await session.execute(query, force_commit=True)
            return QueryResult(
                rows=result.rows,
                columns=result.description or [],
                entity_name=entity_name,
                connection_id=connection_id,
                query=query,
                limit=limit,
                offset=offset,
            )
    except asyncpg.exceptions.InternalServerError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"PostgreSQL connection error: {str(e)}. Please check your connection URI and credentials.",
        )
    except asyncpg.exceptions.InvalidPasswordError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"PostgreSQL authentication failed: {str(e)}. Please check your password.",
        )
    except asyncpg.exceptions.InvalidCatalogNameError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"PostgreSQL database not found: {str(e)}. Please check your database name.",
        )
    except (asyncpg.exceptions.PostgresError, ConnectionError, OSError) as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database connection error: {str(e)}. Please check your connection settings and ensure the database server is running.",
        )
    except AttributeError as e:
        if "'NoneType' object has no attribute 'close'" in str(e):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Database connection failed. Please check your connection URI and credentials.",
            )
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error executing query: {str(e)}",
        )


def get_tables_query(connection_type: str, schema_name: Optional[str] = None) -> str:
    """Get the query to fetch tables based on connection type."""
    source = SourceConfig(connection_type)
    match source:
        case SourceConfig.SQLITE:
            return "SELECT name FROM sqlite_master WHERE type='table'"
        case SourceConfig.POSTGRES:
            schema = schema_name or 'public'
            return f"SELECT table_name as name FROM information_schema.tables WHERE table_schema = '{schema}'"
        case SourceConfig.MYSQL:
            return "SELECT table_name as name FROM information_schema.tables WHERE table_schema = DATABASE()"
        case _:
            return "SELECT name FROM sqlite_master WHERE type='table'"


def get_schemas_query() -> str:
    """Get the query to fetch schemas (PostgreSQL only)."""
    return """SELECT nspname AS schema_name
FROM pg_catalog.pg_namespace
WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'"""


@router.get(
    "/connection/{connection_id}/table",
    response_model=TableModelList,
)
async def get_tables(
    connection_id: str,
    db: DBSession,
    schema: Annotated[Optional[str], Query()] = None,
):
    """Get list of tables for a connection."""
    connection = await db.get(Connections, filters=Connections.uid == connection_id)
    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Connection {connection_id} not found",
        )
    
    if connection.source == SourceConfig.SQLITE.value:
        connection.connection_uri = UPLOAD_DIR / connection.connection_uri
    Adapter = get_adapter(connection.source)
    storage = Adapter(connection_uri=connection.connection_uri)
    
    try:
        async with storage.session() as session:
            query = get_tables_query(connection.source, schema)
            result = await session.execute(query, force_commit=True)
            tables = []
            for row in result.rows:
                # Handle both dict and tuple/list row formats
                if isinstance(row, dict):
                    name = row.get("name")
                elif isinstance(row, (list, tuple)) and len(row) > 0:
                    name = row[0]
                else:
                    name = str(row)
                if name:
                    tables.append(TableModel(name=name))
            return TableModelList(tables=tables, total=len(tables))
    except asyncpg.exceptions.InternalServerError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"PostgreSQL connection error: {str(e)}. Please check your connection URI and credentials.",
        )
    except asyncpg.exceptions.InvalidPasswordError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"PostgreSQL authentication failed: {str(e)}. Please check your password.",
        )
    except asyncpg.exceptions.InvalidCatalogNameError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"PostgreSQL database not found: {str(e)}. Please check your database name.",
        )
    except (asyncpg.exceptions.PostgresError, ConnectionError, OSError) as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database connection error: {str(e)}. Please check your connection settings and ensure the database server is running.",
        )
    except AttributeError as e:
        if "'NoneType' object has no attribute 'close'" in str(e):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Database connection failed. Please check your connection URI and credentials.",
            )
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching tables: {str(e)}",
        )


@router.get(
    "/connection/{connection_id}/schema",
    response_model=SchemaModelList,
)
async def get_schemas(
    connection_id: str,
    db: DBSession,
):
    """Get list of schemas for a connection (PostgreSQL only)."""
    connection = await db.get(Connections, filters=Connections.uid == connection_id)
    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Connection {connection_id} not found",
        )
    
    # Only PostgreSQL supports schemas
    if connection.source != SourceConfig.POSTGRES.value:
        return SchemaModelList(schemas=[], total=0)
    
    if connection.source == SourceConfig.SQLITE.value:
        connection.connection_uri = UPLOAD_DIR / connection.connection_uri
    Adapter = get_adapter(connection.source)
    storage = Adapter(connection_uri=connection.connection_uri)
    
    try:
        async with storage.session() as session:
            query = get_schemas_query()
            result = await session.execute(query, force_commit=True)
            schemas = []
            for row in result.rows:
                # Handle both dict and tuple/list row formats
                if isinstance(row, dict):
                    name = row.get("schema_name")
                elif isinstance(row, (list, tuple)) and len(row) > 0:
                    name = row[0]
                else:
                    name = str(row)
                if name:
                    schemas.append(SchemaModel(name=name))
            return SchemaModelList(schemas=schemas, total=len(schemas))
    except asyncpg.exceptions.InternalServerError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"PostgreSQL connection error: {str(e)}. Please check your connection URI and credentials.",
        )
    except asyncpg.exceptions.InvalidPasswordError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"PostgreSQL authentication failed: {str(e)}. Please check your password.",
        )
    except asyncpg.exceptions.InvalidCatalogNameError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"PostgreSQL database not found: {str(e)}. Please check your database name.",
        )
    except (asyncpg.exceptions.PostgresError, ConnectionError, OSError) as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database connection error: {str(e)}. Please check your connection settings and ensure the database server is running.",
        )
    except AttributeError as e:
        if "'NoneType' object has no attribute 'close'" in str(e):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Database connection failed. Please check your connection URI and credentials.",
            )
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching schemas: {str(e)}",
        )
