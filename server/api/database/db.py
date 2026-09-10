import asyncio

from fastapi import Depends
from laserorm.storage.sqlite import SQLite
from laserorm.storage.storage import StorageSession
from laserorm.storage.sql import is_json_type, is_nullable_type
from typing import Annotated

from .models import models
from ..config import AppConfig

storage = SQLite(AppConfig.DB_PATH)


async def get_db():
    async with storage.session() as session:
        yield session


# doing with depends to close the connection after the requests completes and response is sent
DBSession = Annotated[StorageSession, Depends(get_db)]


async def sync_columns(session: StorageSession, model) -> list[str]:
    """Add columns a model declares but the existing table is missing.

    LaserORM has no migrations and `CREATE TABLE IF NOT EXISTS` leaves an older
    table untouched, so a config database created before a field was added would
    otherwise fail every read.
    """
    table = model.__name__.lower()
    existing = {column.name for column in await session.get_columns(table)}
    if not existing:
        return []

    added = []
    for name, info in model.get_schema().items():
        if name in existing:
            continue
        column_type = session.python_to_sqltype(info["type"])
        clause = f"{name} {column_type}"
        if not is_nullable_type(info["type"]) and not is_json_type(info["type"]):
            default = session.get_default_sql(info["default"], info["type"])
            if default:
                clause += f" {default}"
        await session.execute(f"ALTER TABLE {table} ADD COLUMN {clause}")
        added.append(name)

    if added:
        await session.commit()
    return added


async def init_schema():
    async with storage.session() as session:
        await asyncio.gather(*(session.init_schema(model) for model in models))
        for model in models:
            await sync_columns(session, model)
