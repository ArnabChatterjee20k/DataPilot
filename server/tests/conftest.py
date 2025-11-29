import pytest
import httpx
from pathlib import Path
import shutil
import os
from fastapi.testclient import TestClient
from main import api
from api.config import AppConfig
from api.database.db import init_schema


# setups and teardowns
@pytest.fixture(scope="session", autouse=True)
def ensure_testing_mode():
    if not AppConfig.is_testing_mode():
        pytest.exit("Tests aborted: App not running in TESTING mode.")


@pytest.fixture(scope="session", autouse=True)
async def test_db_path():
    test_db_path = Path(AppConfig.DB_PATH)
    # api can take a bit of time to set the config db up
    # so setting it manually here
    await init_schema()
    yield test_db_path
    # teardown
    if test_db_path.exists():
        if AppConfig.is_delete_after_test():
            while test_db_path.exists():
                test_db_path.unlink()
        print(f"Test database cleaned up: {test_db_path}")


@pytest.fixture(scope="session", autouse=True)
def test_bucket_dir():
    test_bucket_path = Path(AppConfig.BUCKET_DIR)

    if test_bucket_path.exists():
        if AppConfig.is_delete_after_test():
            shutil.rmtree(test_bucket_path)
    test_bucket_path.mkdir(parents=True, exist_ok=True)

    yield test_bucket_path

    if AppConfig.is_delete_after_test():
        shutil.rmtree(test_bucket_path)


@pytest.fixture(scope="function")
def client():
    return TestClient(api)
