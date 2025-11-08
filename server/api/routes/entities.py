from fastapi import APIRouter
from ..config import get_adapter, SourceConfig
from . import UPLOAD_DIR
from ..models import EntityModel
from ..database.db import DBSession
from ..database.models import Connections

router = APIRouter(tags=['entities'])

@router.get('/connections/{connection_id}/entities', response_model=EntityModel)
async def get_entities(connection_id:str, db:DBSession):
    connection = await db.get(Connections,filters=Connections.uid == connection_id)
    if connection.source == SourceConfig.SQLITE.value:
        connection.connection_uri = UPLOAD_DIR/connection.connection_uri
    Adapter = get_adapter(connection.source)
    storage = Adapter(connection_uri=connection.connection_uri)
    async with storage.session() as session:
        result = await session.execute('SELECT * FROM sqlite_master WHERE type=?',('table',))