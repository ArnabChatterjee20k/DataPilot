from pydantic import BaseModel
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
    entities:list['EntityModel'] = []

# Entities
class EntityModel(BaseModel):
    name:str

class ConnectionsModelList(BaseModel):
    connections: list[ConnectionsModel]
    total: int

# Bucket
class BucketModel(BaseModel):
    uid:str
    filename:str