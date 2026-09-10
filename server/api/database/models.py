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
    #: `{{name}}` values interpolated into API requests on this connection
    variables: dict | None = None


class ApiRequests(Model):
    """A saved request under an API connection, the way a table sits under a
    database."""

    uid: str = lambda: str(uuid4())
    connection_id: str
    name: str
    method: str = "GET"
    path: str = ""
    #: query params, headers and form fields, each [{key, value, enabled}]
    params: list | None = None
    headers: list | None = None
    body_type: str = "none"
    body: str = ""
    auth: dict | None = None
    position: int = 0


class QueryLogs(Model):
    uid: str = lambda: str(uuid4())
    connection_id: str
    query: str
    metadata: dict


class Bucket(Model):
    uid: str
    metadata: dict


models = [Connections, ApiRequests, QueryLogs, Bucket]
