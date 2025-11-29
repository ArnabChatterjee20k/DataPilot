import pytest
import httpx
from pathlib import Path
import tempfile
import shutil
import os
import asyncio
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
        test_db_path.unlink()
        print(f"Test database cleaned up: {test_db_path}")


@pytest.fixture(scope="session", autouse=True)
def test_bucket_dir():
    test_bucket_path = Path(AppConfig.BUCKET_DIR)

    if test_bucket_path.exists():
        shutil.rmtree(test_bucket_path)
    test_bucket_path.mkdir(parents=True, exist_ok=True)

    yield test_bucket_path

    shutil.rmtree(test_bucket_path)


@pytest.fixture(scope="function")
def client():
    """Create an httpx client for making real HTTP requests to the running server

    The server should be started manually with TEST_DB_PATH and TEST_BUCKET_DIR set:
        TEST_DB_PATH=./test_config.db TEST_BUCKET_DIR=./test_bucket fastapi dev

    Default server URL: http://127.0.0.1:8000
    Can be overridden with TEST_SERVER_URL environment variable

    Note: This fixture depends on test_db_path and test_bucket_dir, which create
    the test database and bucket directory. Make sure your server is started with:
    TEST_DB_PATH=./test_config.db TEST_BUCKET_DIR=./test_bucket
    """
    base_url = os.getenv("TEST_SERVER_URL", "http://127.0.0.1:8000")

    try:
        with httpx.Client(timeout=5.0) as verify_client:
            verify_response = verify_client.get(f"{base_url}/health")
            if verify_response.status_code != 200:
                raise RuntimeError(
                    f"Server health check failed: {verify_response.status_code}. "
                    f"Make sure the server is running at {base_url}. "
                    f"Start it with: fastapi dev"
                )
    except httpx.ConnectError:
        raise RuntimeError(
            f"Cannot connect to server at {base_url}. "
            f"Make sure the server is running. Start it with: fastapi dev"
        )

    # Create client with base_url for convenience
    with httpx.Client(base_url=base_url, timeout=30.0, follow_redirects=True) as client:
        yield client
