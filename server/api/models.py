from pydantic import BaseModel
from typing import Optional
from .config import SourceConfig


# Connections
class CreateConnectionsModel(BaseModel):
    source: SourceConfig
    name: str
    connection_uri: str

    class Config:
        use_enum_values = True


class ConnectionsModel(BaseModel):
    uid: str
    name: str
    connection_uri: str
    source: SourceConfig

    class Config:
        use_enum_values = True


# Entities
class EntityModel(BaseModel):
    name: str


class EntityModelList(BaseModel):
    entities: list[EntityModel]
    total: int


class ConnectionsModelList(BaseModel):
    connections: list[ConnectionsModel]
    total: int


# Bucket
class BucketModel(BaseModel):
    uid: str
    filename: str


class QueryResult(BaseModel):
    query: str
    connection_id: str
    entity_name: str
    limit: Optional[int] = 100
    offset: Optional[int] = 100
    rows: list
    columns: list
