"""Fixtures for MySQL adapter tests"""

import os

import pymysql
import pytest

SEED_STATEMENTS = (
    "DROP TABLE IF EXISTS users, products, accounts, nullable, typed",
    """
    CREATE TABLE users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255)
    )
    """,
    """
    CREATE TABLE products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        price DECIMAL(10, 2)
    )
    """,
    """
    CREATE TABLE accounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        api_token VARCHAR(255)
    )
    """,
    "CREATE INDEX accounts_username_idx ON accounts (username)",
    """
    CREATE TABLE nullable (
        id INT AUTO_INCREMENT PRIMARY KEY,
        note VARCHAR(255),
        category VARCHAR(255)
    )
    """,
    """
    CREATE TABLE typed (
        id INT AUTO_INCREMENT PRIMARY KEY,
        created_at DATETIME(6),
        payload JSON,
        amount DECIMAL(10, 2)
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
    (
        "INSERT INTO accounts (username, password_hash, api_token) VALUES (%s, %s, %s)",
        ("alice", "hash-3", None),
    ),
    ("INSERT INTO nullable (note, category) VALUES (%s, %s)", ("first", "a")),
    ("INSERT INTO nullable (note, category) VALUES (%s, %s)", (None, "a")),
    ("INSERT INTO nullable (note, category) VALUES (%s, %s)", (None, "a")),
    ("INSERT INTO nullable (note, category) VALUES (%s, %s)", ("fourth", "b")),
    (
        "INSERT INTO typed (created_at, payload, amount) VALUES (%s, %s, %s)",
        ("2024-01-02 03:04:05", '{"a": 1}', 12.5),
    ),
)


@pytest.fixture(scope="function")
def mysql_connection_uri():
    """Create and seed the test database, yielding its connection URI"""
    host = os.getenv("TEST_MYSQL_HOST", "localhost")
    port = int(os.getenv("TEST_MYSQL_PORT", "3306"))
    user = os.getenv("TEST_MYSQL_USER", "root")
    password = os.getenv("TEST_MYSQL_PASSWORD", "root")
    database = os.getenv("TEST_MYSQL_DB", "test_datapilot")

    credentials = dict(host=host, port=port, user=user, password=password)

    try:
        admin = pymysql.connect(**credentials, autocommit=True)
        with admin.cursor() as cursor:
            cursor.execute(f"CREATE DATABASE IF NOT EXISTS `{database}`")
        admin.close()

        connection = pymysql.connect(**credentials, database=database, autocommit=True)
        with connection.cursor() as cursor:
            for statement in SEED_STATEMENTS:
                cursor.execute(statement)
            for statement, params in SEED_ROWS:
                cursor.execute(statement, params)
        connection.close()
    except pymysql.Error as error:
        pytest.skip(f"MySQL not available or setup failed: {error}")

    yield f"mysql://{user}:{password}@{host}:{port}/{database}"
