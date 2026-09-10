from enum import Enum
from laserorm.storage.mysql import MySQL
from laserorm.storage.postgresql import PostgreSQL
from laserorm.storage.sqlite import SQLite
from dotenv import load_dotenv
from pathlib import Path
import os

load_dotenv(".env")
MODE = os.getenv("MODE", "DEV")
if MODE.upper() == "TESTING":
    load_dotenv(".env.test", override=True)


class AppConfig:
    APP_MODE = MODE
    DB_PATH = os.environ.get("DB_PATH", "./config.db")
    BUCKET_DIR = os.environ.get("BUCKET_DIR", "bucket")
    #: Hard cap on rows returned by a single query, whatever the client asks for.
    MAX_ROWS = int(os.environ.get("MAX_ROWS", "5000"))
    DEFAULT_ROWS = int(os.environ.get("DEFAULT_ROWS", "100"))

    @staticmethod
    def is_testing_mode():
        return MODE == "TESTING"

    @staticmethod
    def is_delete_after_test():
        return os.environ.get("DELETE_AFTER_TEST") == "true"


class SourceConfig(str, Enum):
    POSTGRES = "postgres"
    SQLITE = "sqlite"
    MYSQL = "mysql"
    API = "api"


class Environment(str, Enum):
    """Where a connection points, so the UI can warn before touching production."""

    LOCAL = "local"
    STAGING = "staging"
    PRODUCTION = "production"


class ConnectionRole(str, Enum):
    PRIMARY = "primary"
    REPLICA = "replica"


#: Where uploaded SQLite files live. A SQLite connection stores only the
#: filename; the absolute path is resolved against this directory.
UPLOAD_DIR = Path(AppConfig.BUCKET_DIR)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


ADAPTERS = {
    SourceConfig.POSTGRES: PostgreSQL,
    SourceConfig.SQLITE: SQLite,
    SourceConfig.MYSQL: MySQL,
}


def get_adapter(source: str):
    """Return the storage adapter for a source, or None if unsupported."""
    try:
        source_enum = SourceConfig(source)
    except ValueError:
        raise ValueError(f"Unsupported source: {source}")

    return ADAPTERS.get(source_enum)


#: Backends with a namespace above the table.
SCHEMA_BACKENDS = {SourceConfig.POSTGRES, SourceConfig.MYSQL}


def supports_schemas(source: str) -> bool:
    return SourceConfig(source) in SCHEMA_BACKENDS


__all__ = [
    "AppConfig",
    "UPLOAD_DIR",
    "SourceConfig",
    "Environment",
    "ConnectionRole",
    "get_adapter",
    "supports_schemas",
]
