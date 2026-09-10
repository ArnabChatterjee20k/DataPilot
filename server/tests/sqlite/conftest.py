"""Fixtures for SQLite adapter tests"""

import io
import sqlite3
import tempfile
from pathlib import Path

import httpx
import pytest

SEED_STATEMENTS = (
    """
    CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT
    )
    """,
    """
    CREATE TABLE products (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        price REAL
    )
    """,
    """
    CREATE TABLE accounts (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        api_token TEXT
    )
    """,
    "CREATE INDEX accounts_username_idx ON accounts (username)",
)

SEED_ROWS = (
    ("INSERT INTO users (name, email) VALUES (?, ?)", ("Alice", "alice@example.com")),
    ("INSERT INTO users (name, email) VALUES (?, ?)", ("Bob", "bob@example.com")),
    ("INSERT INTO products (name, price) VALUES (?, ?)", ("Laptop", 999.99)),
    ("INSERT INTO products (name, price) VALUES (?, ?)", ("Mouse", 29.99)),
    (
        "INSERT INTO accounts (username, password_hash, api_token) VALUES (?, ?, ?)",
        ("alice", "hash-1", "token-1"),
    ),
    (
        "INSERT INTO accounts (username, password_hash, api_token) VALUES (?, ?, ?)",
        ("bob", "hash-2", "token-2"),
    ),
)


@pytest.fixture(scope="function")
def sqlite_db_file():
    """Create a seeded temporary SQLite database file"""
    temp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    temp_db.close()
    db_path = Path(temp_db.name)

    connection = sqlite3.connect(str(db_path))
    cursor = connection.cursor()
    for statement in SEED_STATEMENTS:
        cursor.execute(statement)
    for statement, params in SEED_ROWS:
        cursor.execute(statement, params)
    connection.commit()
    connection.close()

    yield db_path

    db_path.unlink(missing_ok=True)


@pytest.fixture(scope="function")
def sqlite_connection_uri(sqlite_db_file, client: httpx.Client):
    """Upload the SQLite DB to the bucket and return its connection URI"""
    content = sqlite_db_file.read_bytes()

    response = client.post(
        "/bucket",
        files={
            "file": (
                sqlite_db_file.name,
                io.BytesIO(content),
                "application/octet-stream",
            )
        },
    )
    assert response.status_code == 200, response.text

    yield response.json()["connection_uri"]
