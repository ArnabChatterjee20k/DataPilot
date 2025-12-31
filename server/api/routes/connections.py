from fastapi import APIRouter, HTTPException, status
from . import UPLOAD_DIR
from ..config import SourceConfig
from ..models import CreateConnectionsModel, UpdateConnectionsModel, ConnectionsModel, ConnectionsModelList
from ..database.db import DBSession
from ..database.models import Connections

router = APIRouter(tags=["connections"])


@router.post("/connections", response_model=ConnectionsModel)
async def create_connection(connection: CreateConnectionsModel, db: DBSession):
    if connection.source == SourceConfig.SQLITE.value:
        file_path = UPLOAD_DIR / connection.connection_uri
        if not file_path.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="First upload sqlite to the bucket then add it",
            )

    created = await db.create(Connections(**connection.model_dump()))
    await db.commit()
    created = created.get_values()
    return ConnectionsModel(
        uid=created.get("uid"),
        name=created.get("name"),
        source=created.get("source"),
        connection_uri=created.get("connection_uri"),
    )


@router.get("/connections", response_model=ConnectionsModelList)
async def list_connections(db: DBSession):
    connections = await db.list(Connections)
    results = []
    for connection in connections:
        results.append(ConnectionsModel(**connection.get_values()))
    return ConnectionsModelList(connections=results, total=len(results))


@router.get("/connections/{connection_uid}", response_model=ConnectionsModel)
async def get_connection(connection_uid: str, db: DBSession):
    connection = await db.get(Connections, filters=Connections.uid == connection_uid)
    if not connection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return ConnectionsModel(**connection.get_values())


@router.put("/connections/{connection_uid}", response_model=ConnectionsModel)
async def update_connection(
    connection_uid: str,
    connection_update: UpdateConnectionsModel,
    db: DBSession,
):
    connection = await db.get(Connections, filters=Connections.uid == connection_uid)
    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Connection not found",
        )

    # Validate SQLite file exists if connection_uri is being updated and source is SQLite
    update_data = connection_update.model_dump(exclude_unset=True)
    
    # If source is being changed or connection_uri is being updated, validate
    if "source" in update_data:
        source = update_data["source"]
    else:
        source = connection.source

    if "connection_uri" in update_data:
        connection_uri = update_data["connection_uri"]
    else:
        connection_uri = connection.connection_uri

    if source == SourceConfig.SQLITE.value:
        file_path = UPLOAD_DIR / connection_uri
        if not file_path.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="SQLite file not found. Please upload the file first.",
            )

    # Update the connection fields
    for field, value in update_data.items():
        setattr(connection, field, value)

    await db.update(Connections,Connections.uid == connection.uid, connection.to_dict())
    await db.commit()
    # Get updated values
    updated = connection.get_values()
    return ConnectionsModel(
        uid=updated.get("uid"),
        name=updated.get("name"),
        source=updated.get("source"),
        connection_uri=updated.get("connection_uri"),
    )


@router.delete("/connections/{connection_uid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connection(connection_uid: str, db: DBSession):
    connection = await db.get(Connections, filters=Connections.uid == connection_uid)
    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Connection not found",
        )
    await db.delete(Connections,Connections.uid == connection_uid)
    await db.commit()
    return None