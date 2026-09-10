import io
import sqlite3
import tempfile
from pathlib import Path

import httpx
import pytest

from api.config import UPLOAD_DIR


def make_sqlite_bytes() -> bytes:
    temp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    temp.close()
    path = Path(temp.name)
    connection = sqlite3.connect(str(path))
    connection.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)")
    connection.commit()
    connection.close()
    content = path.read_bytes()
    path.unlink(missing_ok=True)
    return content


def upload(client: httpx.Client, filename: str, content: bytes):
    return client.post(
        "/bucket",
        files={"file": (filename, io.BytesIO(content), "application/octet-stream")},
    )


class BucketTests:
    """E2E tests for the bucket endpoint"""

    def test_upload_sqlite_file(self, client: httpx.Client):
        content = make_sqlite_bytes()

        response = upload(client, "test_database.db", content)

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["filename"] == "test_database.db"
        assert data["size"] == len(content)
        assert data["connection_uri"] == f"{data['uid']}.db"

    def test_uploaded_file_lands_in_the_bucket(self, client: httpx.Client):
        content = make_sqlite_bytes()

        data = upload(client, "persistence_test.db", content).json()

        stored = UPLOAD_DIR / data["connection_uri"]
        assert stored.exists()
        assert stored.read_bytes() == content

    def test_uids_are_unique(self, client: httpx.Client):
        content = make_sqlite_bytes()

        uids = [
            upload(client, f"db_{index}.sqlite", content).json()["uid"]
            for index in range(3)
        ]

        assert len(set(uids)) == 3

    @pytest.mark.parametrize("suffix", [".db", ".sqlite", ".sqlite3", ".db3"])
    def test_accepted_extensions(self, client: httpx.Client, suffix):
        response = upload(client, f"database{suffix}", make_sqlite_bytes())
        assert response.status_code == 200

    def test_rejects_non_sqlite_extension(self, client: httpx.Client):
        response = upload(client, "notes.txt", b"hello")

        assert response.status_code == 400
        assert ".txt" in response.json()["detail"]

    def test_rejects_file_that_is_not_a_sqlite_database(self, client: httpx.Client):
        response = upload(client, "fake.db", b"definitely not a database")

        assert response.status_code == 400
        assert "not a valid SQLite database" in response.json()["detail"]

    def test_rejects_empty_file(self, client: httpx.Client):
        response = upload(client, "empty.db", b"")

        assert response.status_code == 400
        assert "empty" in response.json()["detail"].lower()

    def test_rejected_upload_leaves_no_file_behind(self, client: httpx.Client):
        before = set(UPLOAD_DIR.iterdir())

        assert upload(client, "fake.db", b"nope").status_code == 400

        assert set(UPLOAD_DIR.iterdir()) == before

    def test_missing_file_is_rejected(self, client: httpx.Client):
        assert client.post("/bucket").status_code == 422
