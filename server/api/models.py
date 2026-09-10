from pydantic import BaseModel, ConfigDict, Field
from typing import Any, Literal, Optional

from .config import ConnectionRole, Environment, SourceConfig


# Connections
class CreateConnectionsModel(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    source: SourceConfig
    name: str
    connection_uri: str
    environment: Environment = Environment.LOCAL
    role: ConnectionRole = ConnectionRole.PRIMARY
    read_only: bool = True


class UpdateConnectionsModel(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    name: Optional[str] = None
    connection_uri: Optional[str] = None
    source: Optional[SourceConfig] = None
    environment: Optional[Environment] = None
    role: Optional[ConnectionRole] = None
    read_only: Optional[bool] = None


class ConnectionsModel(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    uid: str
    name: str
    connection_uri: str
    source: SourceConfig
    environment: Environment = Environment.LOCAL
    role: ConnectionRole = ConnectionRole.PRIMARY
    read_only: bool = True
    supports_schemas: bool = False


class ConnectionsModelList(BaseModel):
    connections: list[ConnectionsModel]
    total: int


class TestConnectionModel(BaseModel):
    """Enough to dial a connection that has not been saved yet."""

    model_config = ConfigDict(use_enum_values=True)

    source: SourceConfig
    connection_uri: str


class ConnectionProbeModel(BaseModel):
    reachable: bool
    detail: Optional[str] = None
    latency_ms: Optional[float] = None
    server_version: Optional[str] = None


class ConnectionStatusModel(BaseModel):
    """Result of dialling a connection without running a user query."""

    uid: str
    reachable: bool
    detail: Optional[str] = None
    latency_ms: Optional[float] = None
    server_version: Optional[str] = None


# Entities
class EntityModel(BaseModel):
    name: str


class EntityModelList(BaseModel):
    entities: list[EntityModel]
    total: int


# Bucket
class BucketModel(BaseModel):
    uid: str
    filename: str
    #: What to pass back as a SQLite connection's `connection_uri`.
    connection_uri: str
    size: Optional[int] = None


# Columns
ColumnKind = Literal[
    "uuid", "text", "number", "boolean", "timestamp", "json", "binary"
]


class ColumnModel(BaseModel):
    name: str
    type: Optional[str] = None
    #: Coarse kind the UI renders against, derived from `type`.
    kind: ColumnKind = "text"
    nullable: bool = True
    default: Optional[str] = None
    primary_key: bool = False
    indexed: bool = False
    #: Name matches a credential-ish pattern, so values should be masked.
    sensitive: bool = False
    monospace: bool = False
    position: int = 0


class IndexModel(BaseModel):
    name: str
    columns: list[str]
    unique: bool = False
    primary: bool = False


class TableSchemaModel(BaseModel):
    connection_id: str
    entity_name: str
    schema_name: Optional[str] = None
    columns: list[ColumnModel]
    indexes: list[IndexModel]
    primary_key: list[str]
    row_count: Optional[int] = None
    total: int


# Queries
class QueryRiskModel(BaseModel):
    level: Literal["safe", "caution", "dangerous"] = "safe"
    statement: str = "UNKNOWN"
    read_only: bool = True
    statement_count: int = 0
    warnings: list[str] = Field(default_factory=list)


class QueryResult(BaseModel):
    query: str
    connection_id: str
    entity_name: str
    limit: Optional[int] = None
    offset: Optional[int] = None
    rows: list[Any]
    columns: list[ColumnModel]
    row_count: int = 0
    rows_affected: int = 0
    returns_rows: bool = False
    truncated: bool = False
    execution_time_ms: float = 0.0
    risk: QueryRiskModel = Field(default_factory=QueryRiskModel)


class RowPageModel(BaseModel):
    """A page of rows fetched through the deterministic pagination endpoint."""

    connection_id: str
    entity_name: str
    schema_name: Optional[str] = None
    rows: list[Any]
    columns: list[ColumnModel]
    row_count: int
    total_rows: Optional[int] = None
    limit: int
    offset: Optional[int] = None
    #: Cursor to pass back as `after` for the next page; null when exhausted.
    next_cursor: Optional[str] = None
    cursor_column: Optional[str] = None
    #: True when the page came from a keyset scan rather than OFFSET.
    keyset: bool = False
    query: str
    execution_time_ms: float = 0.0
    warnings: list[str] = Field(default_factory=list)


# Insights
class ScanModel(BaseModel):
    table: Optional[str] = None
    type: str
    index: Optional[str] = None
    detail: str = ""
    estimated_rows: Optional[int] = None


class QueryInsightModel(BaseModel):
    """What the planner intends to do, without running the query."""

    connection_id: str
    query: str
    supported: bool = True
    scans: list[ScanModel] = Field(default_factory=list)
    estimated_rows: Optional[int] = None
    estimated_cost: Optional[float] = None
    speed: Optional[Literal["fast", "medium", "slow"]] = None
    uses_index: bool = False
    warnings: list[str] = Field(default_factory=list)
    plan: list[Any] = Field(default_factory=list)


class ValueCountModel(BaseModel):
    value: Any = None
    count: int


class ColumnStatsModel(BaseModel):
    name: str
    kind: ColumnKind = "text"
    null_count: int = 0
    null_percent: float = 0.0
    distinct_count: Optional[int] = None
    top_values: list[ValueCountModel] = Field(default_factory=list)


class TableStatsModel(BaseModel):
    connection_id: str
    entity_name: str
    schema_name: Optional[str] = None
    row_count: int = 0
    scanned_rows: int = 0
    #: True when stats came from a bounded sample rather than the whole table.
    sampled: bool = False
    columns: list[ColumnStatsModel] = Field(default_factory=list)
    execution_time_ms: float = 0.0


# API client
HttpMethod = Literal[
    "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"
]
BodyType = Literal["none", "json", "form", "text"]
AuthType = Literal["none", "bearer", "basic", "header"]


class KeyValueModel(BaseModel):
    key: str
    value: str = ""
    enabled: bool = True


class AuthModel(BaseModel):
    type: AuthType = "none"
    token: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    name: Optional[str] = None
    value: Optional[str] = None


class RequestSpecModel(BaseModel):
    """What to send. A saved request stores exactly this."""

    name: str = "Untitled request"
    method: HttpMethod = "GET"
    #: relative to the connection's base URL, or an absolute http(s) URL
    path: str = ""
    params: list[KeyValueModel] = Field(default_factory=list)
    headers: list[KeyValueModel] = Field(default_factory=list)
    body_type: BodyType = "none"
    body: Any = ""
    auth: Optional[AuthModel] = None
    timeout: float = 30.0
    follow_redirects: bool = True
    verify_tls: bool = True


class SavedRequestModel(RequestSpecModel):
    uid: str
    connection_id: str
    position: int = 0


class SavedRequestListModel(BaseModel):
    requests: list[SavedRequestModel]
    total: int


class SentRequestModel(BaseModel):
    method: str
    url: str
    headers: list[dict[str, Any]] = Field(default_factory=list)
    body: Optional[str] = None


class ResponseModel(BaseModel):
    status: int
    reason: str = ""
    headers: list[dict[str, Any]] = Field(default_factory=list)
    body: str = ""
    #: False when the body is binary and therefore base64 encoded
    is_text: bool = True
    size: int = 0
    truncated: bool = False
    elapsed_ms: float = 0.0
    content_type: Optional[str] = None


class RequestResultModel(BaseModel):
    connection_id: str
    request: SentRequestModel
    response: ResponseModel


class VariablesModel(BaseModel):
    variables: dict[str, str] = Field(default_factory=dict)
    #: names whose values are masked wherever they are displayed
    secret: list[str] = Field(default_factory=list)


# Tables
class TableModel(BaseModel):
    name: str


class TableModelList(BaseModel):
    tables: list[TableModel]
    total: int


# Schemas
class SchemaModel(BaseModel):
    name: str


class SchemaModelList(BaseModel):
    schemas: list[SchemaModel]
    total: int
