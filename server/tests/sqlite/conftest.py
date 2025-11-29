"""Fixtures for SQLite adapter tests"""

import pytest
import httpx
import tempfile
import shutil
from pathlib import Path
import sqlite3
import io
from api.routes import UPLOAD_DIR


@pytest.fixture(scope="function")
def sqlite_db_file():
    """Create a temporary SQLite database file for testing"""
    # Create a temporary SQLite database
    temp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    temp_db.close()
    db_path = Path(temp_db.name)

    # Initialize with a simple schema
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()

    # Create test tables
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT
        )
    """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            price REAL
        )
    """
    )

    # Insert some test data
    cursor.execute(
        "INSERT INTO users (name, email) VALUES (?, ?)", ("Alice", "alice@example.com")
    )
    cursor.execute(
        "INSERT INTO users (name, email) VALUES (?, ?)", ("Bob", "bob@example.com")
    )
    cursor.execute(
        "INSERT INTO products (name, price) VALUES (?, ?)", ("Laptop", 999.99)
    )
    cursor.execute("INSERT INTO products (name, price) VALUES (?, ?)", ("Mouse", 29.99))

    conn.commit()
    conn.close()

    yield db_path

    # Cleanup
    if db_path.exists():
        db_path.unlink()


@pytest.fixture(scope="function")
def sqlite_connection_uri(sqlite_db_file, client: httpx.Client):
    """Upload SQLite DB to bucket and return connection URI (filename)"""
    # Read the database file
    with open(sqlite_db_file, "rb") as f:
        db_content = f.read()

    # Upload to bucket
    db_filename = sqlite_db_file.name
    response = client.post(
        "/bucket",
        files={
            "file": (db_filename, io.BytesIO(db_content), "application/octet-stream")
        },
    )

    assert response.status_code == 200
    upload_data = response.json()
    file_uid = upload_data["uid"]

    # The connection URI should be the filename: {uid}{ext}
    # Based on bucket.py, the file is saved as {file_id}{ext}
    connection_uri = f"{file_uid}.db"

    yield connection_uri

    # Cleanup: The bucket cleanup is handled by test_bucket_dir fixture


@pytest.fixture(scope="function", autouse=True)
def sqlite_test_setup(sqlite_db_file, sqlite_connection_uri):
    """Setup fixture that runs before each test"""
    # Setup is done in sqlite_db_file and sqlite_connection_uri fixtures
    yield
    # Teardown is handled by those fixtures
