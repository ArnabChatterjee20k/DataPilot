from laserorm.core.model import Model
from uuid import uuid4


# id field automatically added here
class Connections(Model):
    uid: str = lambda: str(uuid4())
    source: str
    name: str
    connection_uri: str


class QueryLogs(Model):
    uid:str = lambda: str(uuid4())
    connection_id: int
    query: str
    metadata: dict

class Bucket(Model):
    uid:str
    metadata:dict

models = [Connections, QueryLogs, Bucket]
