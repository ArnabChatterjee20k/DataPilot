from fastapi import APIRouter, HTTPException, status
from . import UPLOAD_DIR
from ..config import SourceConfig
from ..models import CreateConnectionsModel, ConnectionsModel, ConnectionsModelList
from ..database.db import DBSession
from ..database.models import Connections

router = APIRouter(tags=['connections'])

@router.post("/connections", response_model=ConnectionsModel)
async def create_connection(connection: CreateConnectionsModel, db: DBSession):
    if connection.source == SourceConfig.SQLITE:
        file_path = UPLOAD_DIR / connection.connection_uri
        if not file_path.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,detail='First upload sqlite to the bucket then add it')

    created = await db.create(Connections(**connection.model_dump()))
    await db.commit()
    created = created.get_values()
    return ConnectionsModel(
        uid=created.get("uid"),
        name=created.get("name"),
        connection_uri=created.get("connection_uri"),
    )

@router.get("/connections", response_model=ConnectionsModelList)
async def list_connections(db: DBSession):
    connections = await db.list(Connections)
    results = []
    for connection in connections:
        results.append(ConnectionsModel(**connection.get_values()))
    return ConnectionsModelList(connections=results,total=len(results))

@router.get("/connections/{connection_uid}", response_model=ConnectionsModel)
async def get_connection(connection_uid:str , db: DBSession):
    connection = await db.get(Connections,filters=Connections.uid == connection_uid)
    if not connection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return ConnectionsModel(**connection.get_values())