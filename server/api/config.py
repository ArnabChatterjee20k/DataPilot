from enum import Enum
from laserorm.storage.postgresql import PostgreSQL
from laserorm.storage.sqlite import SQLite
from dotenv import load_dotenv
import os

load_dotenv(".env")
MODE = os.getenv("MODE", "DEV")
if MODE.upper() == "TESTING":
    load_dotenv(".env.test", override=True)


class AppConfig:
    APP_MODE = MODE
    DB_PATH = os.environ.get("DB_PATH")
    BUCKET_DIR = os.environ.get("BUCKET_DIR")

    @staticmethod
    def is_testing_mode():
        return MODE == "TESTING"

    @staticmethod
    def is_delete_after_test():
        return os.environ.get("DELETE_AFTER_TEST") == "true"


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


__all__ = [AppConfig, SourceConfig, get_adapter]
