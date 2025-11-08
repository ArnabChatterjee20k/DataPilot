from enum import Enum
from laserorm.storage.postgresql import PostgreSQL
from laserorm.storage.sqlite import SQLite


class SourceConfig(Enum):
    POSTGRES = "postgres"
    SQLITE = "sqlite"
    MYSQL = "mysql"
    API = "api"


def get_adapter(source: str):
    try:
        source_enum = SourceConfig(source)
    except ValueError:
        raise ValueError(f"Unsupported source: {source}")

    match source_enum:
        case SourceConfig.POSTGRES:
            return PostgreSQL
        case SourceConfig.SQLITE:
            return SQLite