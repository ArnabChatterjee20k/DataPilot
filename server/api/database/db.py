from laserorm.storage.sqlite import SQLite
from laserorm.storage.storage import StorageSession
from fastapi import Depends
from typing import Annotated
from .models import models

# should be from the .env
storage = SQLite("./config.db")


async def get_db():
    async with storage.session() as session:
        yield session


# doing with depends to close the connection after the requests completes and response is sent
DBSession = Annotated[StorageSession, Depends(get_db)]


async def init_schema():
    import asyncio

    async with storage.session() as session:
        await asyncio.gather(*(session.init_schema(model) for model in models))
