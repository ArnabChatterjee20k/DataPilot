from fastapi import APIRouter, Query, HTTPException, status
from typing import Annotated, Optional
import asyncpg
from ..config import get_adapter, SourceConfig
from . import UPLOAD_DIR
from ..models import QueryResult
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
