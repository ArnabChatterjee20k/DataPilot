"""Fixtures for Postgres adapter tests"""

import pytest
import os
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT


@pytest.fixture(scope="function")
def postgres_connection_uri():
    """Get or create Postgres connection URI for testing"""
    # Get connection details from environment variables
    # Default to a test database if not provided
    db_host = os.getenv("TEST_POSTGRES_HOST", "localhost")
    db_port = os.getenv("TEST_POSTGRES_PORT", "5432")
    db_user = os.getenv("TEST_POSTGRES_USER", "postgres")
    db_password = os.getenv("TEST_POSTGRES_PASSWORD", "postgres")
    db_name = os.getenv("TEST_POSTGRES_DB", "test_datapilot")

    # Construct connection URI
    connection_uri = (
        f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"
    )

    # Setup: Create test database and tables if they don't exist
    try:
        # Connect to postgres database to create test database
        admin_conn = psycopg2.connect(
            host=db_host,
            port=db_port,
            user=db_user,
            password=db_password,
            database="postgres",  # Connect to default postgres DB
        )
        admin_conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        admin_cursor = admin_conn.cursor()

        # Create test database if it doesn't exist
        admin_cursor.execute(f"SELECT 1 FROM pg_database WHERE datname = '{db_name}'")
        exists = admin_cursor.fetchone()
        if not exists:
            admin_cursor.execute(f"CREATE DATABASE {db_name}")

        admin_cursor.close()
        admin_conn.close()

        # Connect to test database and create tables
        test_conn = psycopg2.connect(
            host=db_host,
            port=db_port,
            user=db_user,
            password=db_password,
            database=db_name,
        )
        test_cursor = test_conn.cursor()

        # Create test tables
        test_cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255)
            )
        """
        )

        test_cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                price DECIMAL(10, 2)
            )
        """
        )

        # Clear existing data and insert test data
        test_cursor.execute("TRUNCATE TABLE users, products RESTART IDENTITY CASCADE")
        test_cursor.execute(
            "INSERT INTO users (name, email) VALUES (%s, %s)",
            ("Alice", "alice@example.com"),
        )
        test_cursor.execute(
            "INSERT INTO users (name, email) VALUES (%s, %s)",
            ("Bob", "bob@example.com"),
        )
        test_cursor.execute(
            "INSERT INTO products (name, price) VALUES (%s, %s)", ("Laptop", 999.99)
        )
        test_cursor.execute(
            "INSERT INTO products (name, price) VALUES (%s, %s)", ("Mouse", 29.99)
        )

        test_conn.commit()
        test_cursor.close()
        test_conn.close()

    except psycopg2.Error as e:
        pytest.skip(f"Postgres not available or setup failed: {e}")

    yield connection_uri

    # Teardown: Clean up test data (but keep database and tables)
    try:
        cleanup_conn = psycopg2.connect(
            host=db_host,
            port=db_port,
            user=db_user,
            password=db_password,
            database=db_name,
        )
        cleanup_cursor = cleanup_conn.cursor()
        cleanup_cursor.execute(
            "TRUNCATE TABLE users, products RESTART IDENTITY CASCADE"
        )
        cleanup_conn.commit()
        cleanup_cursor.close()
        cleanup_conn.close()
    except psycopg2.Error:
        pass  # Ignore cleanup errors


@pytest.fixture(scope="function", autouse=True)
def postgres_test_setup(postgres_connection_uri):
    """Setup fixture that runs before each test"""
    # Setup is done in postgres_connection_uri fixture
    yield
    # Teardown is handled by postgres_connection_uri fixture
