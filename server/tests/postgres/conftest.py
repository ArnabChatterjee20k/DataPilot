"""Fixtures for Postgres adapter tests"""

import os

import psycopg2
import pytest
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

SEED_STATEMENTS = (
    "DROP TABLE IF EXISTS users, products, accounts, nullable, typed CASCADE",
    """
    CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255)
    )
    """,
    """
    CREATE TABLE products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        price DECIMAL(10, 2)
    )
    """,
    """
    CREATE TABLE accounts (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        api_token VARCHAR(255)
    )
    """,
    "CREATE INDEX accounts_username_idx ON accounts (username)",
    """
    CREATE TABLE nullable (
        id SERIAL PRIMARY KEY,
        note VARCHAR(255),
        category VARCHAR(255)
    )
    """,
    """
    CREATE TABLE typed (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMP,
        payload JSONB,
        amount NUMERIC(10, 2)
    )
    """,
)

SEED_ROWS = (
    ("INSERT INTO users (name, email) VALUES (%s, %s)", ("Alice", "alice@example.com")),
    ("INSERT INTO users (name, email) VALUES (%s, %s)", ("Bob", "bob@example.com")),
    ("INSERT INTO products (name, price) VALUES (%s, %s)", ("Laptop", 999.99)),
    ("INSERT INTO products (name, price) VALUES (%s, %s)", ("Mouse", 29.99)),
    (
        "INSERT INTO accounts (username, password_hash, api_token) VALUES (%s, %s, %s)",
        ("alice", "hash-1", "token-1"),
    ),
    (
        "INSERT INTO accounts (username, password_hash, api_token) VALUES (%s, %s, %s)",
        ("bob", "hash-2", "token-2"),
    ),
    ("INSERT INTO nullable (note, category) VALUES (%s, %s)", ("first", "a")),
    ("INSERT INTO nullable (note, category) VALUES (%s, %s)", (None, "a")),
    ("INSERT INTO nullable (note, category) VALUES (%s, %s)", (None, "a")),
    ("INSERT INTO nullable (note, category) VALUES (%s, %s)", ("fourth", "b")),
    (
        "INSERT INTO typed (created_at, payload, amount) VALUES (%s, %s, %s)",
        ("2024-01-02T03:04:05", '{"a": 1}', 12.5),
    ),
)


@pytest.fixture(scope="function")
def postgres_connection_uri():
    """Create and seed the test database, yielding its connection URI"""
    host = os.getenv("TEST_POSTGRES_HOST", "localhost")
    port = os.getenv("TEST_POSTGRES_PORT", "5432")
    user = os.getenv("TEST_POSTGRES_USER", "postgres")
    password = os.getenv("TEST_POSTGRES_PASSWORD", "postgres")
    database = os.getenv("TEST_POSTGRES_DB", "test_datapilot")

    credentials = dict(host=host, port=port, user=user, password=password)

    try:
        admin = psycopg2.connect(database="postgres", **credentials)
        admin.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        with admin.cursor() as cursor:
            cursor.execute("SELECT 1 FROM pg_database WHERE datname = %s", (database,))
            if not cursor.fetchone():
                cursor.execute(f'CREATE DATABASE "{database}"')
        admin.close()

        connection = psycopg2.connect(database=database, **credentials)
        with connection.cursor() as cursor:
            for statement in SEED_STATEMENTS:
                cursor.execute(statement)
            for statement, params in SEED_ROWS:
                cursor.execute(statement, params)
        connection.commit()
        connection.close()
    except psycopg2.Error as error:
        pytest.skip(f"Postgres not available or setup failed: {error}")

    yield f"postgresql://{user}:{password}@{host}:{port}/{database}"
