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
    #: The variables a saved connection would carry, so a broker that only
    #: accepts an authenticated session - Appwrite's MQTT push broker asks for
    #: a session or JWT over MQTT 5 enhanced authentication - can be tested
    #: before it is saved, the same way it will really be used.
    variables: Optional[dict[str, Any]] = None


class ConnectionProbeModel(BaseModel):
    reachable: bool
    detail: Optional[str] = None
    latency_ms: Optional[float] = None
    server_version: Optional[str] = None


class AppwriteJWTRequest(BaseModel):
    """Provision a broker credential from an Appwrite project.

    Appwrite's MQTT push broker authenticates a client against a real session
    or JWT, so testing it needs one. Given the project and an API key with the
    users scope, the server mints a throwaway user's JWT - the credential the
    broker accepts - so the person does not have to leave DataPilot to sign in.
    """

    endpoint: str
    project: str
    api_key: str
    #: Reuse a specific user instead of creating a throwaway one; a fresh test
    #: user is created when this is left blank.
    email: Optional[str] = None
    password: Optional[str] = None


class AppwriteJWTResult(BaseModel):
    user_id: str
    jwt: str
    project: str


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
    #: The plan as the database's own client would print it, for checking the
    #: summary above rather than taking it on trust.
    plan_text: str = ""


class SlowQueryModel(BaseModel):
    """One statement the server itself recorded, whatever backend it came from."""

    digest: str
    statement: str
    calls: int = 0
    total_ms: float = 0.0
    mean_ms: float = 0.0
    max_ms: Optional[float] = None
    rows: int = 0
    rows_per_call: float = 0.0
    rows_examined: Optional[int] = None
    first_seen: Optional[str] = None
    last_seen: Optional[str] = None


class SlowQueryReportModel(BaseModel):
    connection_id: str
    source: str
    available: bool = True
    queries: list[SlowQueryModel] = Field(default_factory=list)
    #: Why there is nothing to show, and what to do about it.
    detail: str = ""
    origin: str = ""


class SnapshotModel(BaseModel):
    """A stored reading, so a comparison survives the counters being reset."""

    uid: str
    connection_id: str
    taken_at: str
    source: str
    query_count: int = 0
    total_ms: float = 0.0
    note: str = ""


class SnapshotListModel(BaseModel):
    snapshots: list[SnapshotModel] = Field(default_factory=list)
    total: int = 0


class SnapshotDetailModel(BaseModel):
    snapshot: SnapshotModel
    queries: list[SlowQueryModel] = Field(default_factory=list)


class SnapshotComparisonModel(BaseModel):
    """What happened between two readings, as the difference in each counter."""

    connection_id: str
    before: SnapshotModel
    after: SnapshotModel
    queries: list[SlowQueryModel] = Field(default_factory=list)


class RedisKeyModel(BaseModel):
    key: str
    type: str
    label: str
    #: -1 means no expiry, which is not the same as expired.
    ttl: Optional[int] = None
    size: Optional[int] = None


class RedisKeyListModel(BaseModel):
    connection_id: str
    pattern: str = "*"
    keys: list[RedisKeyModel] = Field(default_factory=list)
    #: Pass back to ask for the next page; 0 means the scan finished.
    cursor: int = 0
    complete: bool = True


class RedisKeyValueModel(BaseModel):
    """One key's contents. Which fields are filled depends on its type."""

    connection_id: str
    key: str
    type: str
    label: str
    ttl: Optional[int] = None
    size: Optional[int] = None
    encoding: Optional[str] = None
    value: Optional[str] = None
    is_text: bool = True
    entries: list[dict] = Field(default_factory=list)
    members: list[str] = Field(default_factory=list)
    truncated: bool = False


class RedisInfoModel(BaseModel):
    connection_id: str
    server: str
    fields: list[dict] = Field(default_factory=list)
    keyspace: list[dict] = Field(default_factory=list)
    hit_rate: Optional[float] = None
    pattern_subscriptions: int = 0


class RedisChannelListModel(BaseModel):
    connection_id: str
    channels: list[dict] = Field(default_factory=list)
    pattern_subscriptions: int = 0


class RedisPublishResultModel(BaseModel):
    connection_id: str
    channel: str
    #: How many subscribers received it, which is the part worth knowing.
    received_by: int = 0


class FlowSpecModel(BaseModel):
    """A node graph as it was drawn."""

    name: str = "Untitled flow"
    graph: dict = Field(default_factory=lambda: {"nodes": [], "edges": []})


class FlowModel(BaseModel):
    uid: str
    name: str
    graph: dict = Field(default_factory=lambda: {"nodes": [], "edges": []})


class FlowListModel(BaseModel):
    flows: list[FlowModel] = Field(default_factory=list)
    total: int = 0


class NodeRunModel(BaseModel):
    """One node's outcome, the same shape the live run reports."""

    id: str
    name: str
    kind: str
    state: str
    elapsed_ms: Optional[float] = None
    summary: str = ""
    result: Any = None
    error: str = ""
    warnings: list[str] = Field(default_factory=list)
    blocked_by: list[str] = Field(default_factory=list)


class NodeReferenceModel(BaseModel):
    """A `{{...}}` someone can copy, and what it holds right now."""

    reference: str
    value: str = ""


class NodeReferenceGroupModel(BaseModel):
    """The references one upstream node offers."""

    node: str
    kind: str
    references: list[NodeReferenceModel] = Field(default_factory=list)


class NodeTestModel(BaseModel):
    """Testing one node: what it produced, and what it was actually sent."""

    node: NodeRunModel
    #: The query after `{{...}}` was replaced, or the request as it went out.
    resolved_query: str = ""
    resolved_request: Optional[dict] = None
    #: Nodes that had to run first for this one to have any input.
    upstream: list[NodeRunModel] = Field(default_factory=list)
    #: What this node can refer to, ready to copy into a query or a body.
    available: list[NodeReferenceGroupModel] = Field(default_factory=list)
    #: How a node after this one refers to what this one just produced.
    offers: list[NodeReferenceModel] = Field(default_factory=list)


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
