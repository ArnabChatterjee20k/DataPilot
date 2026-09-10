from laserorm.core.model import Model
from uuid import uuid4

from ..config import ConnectionRole, Environment


# id field automatically added here
class Connections(Model):
    # todo attach a playground id as well for getting unique connection id
    uid: str = lambda: str(uuid4())
    source: str
    name: str
    connection_uri: str
    environment: str = Environment.LOCAL.value
    role: str = ConnectionRole.PRIMARY.value
    read_only: bool = True


class QueryLogs(Model):
    uid: str = lambda: str(uuid4())
    connection_id: str
    query: str
    metadata: dict


class Bucket(Model):
    uid: str
    metadata: dict


models = [Connections, QueryLogs, Bucket]
