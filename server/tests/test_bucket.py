import pytest
import httpx
import io


class BucketTests:
    """E2E tests for bucket endpoints"""

    def test_upload_file(self, client: httpx.Client):
        """Test uploading a file to the bucket"""
        # Create a test file content
        file_content = b"This is a test file content"
        file_name = "test_file.txt"

        response = client.post(
            "/bucket",
            files={"file": (file_name, io.BytesIO(file_content), "text/plain")},
        )

        assert response.status_code == 200
        data = response.json()
        assert "uid" in data
        assert data["filename"] == file_name
        assert len(data["uid"]) > 0  # Should be a UUID

    def test_upload_file_with_different_extension(self, client: httpx.Client):
        """Test uploading a file with different extension"""
        file_content = b"SQLite database content"
        file_name = "test_database.db"

        response = client.post(
            "/bucket",
            files={
                "file": (
                    file_name,
                    io.BytesIO(file_content),
                    "application/octet-stream",
                )
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["filename"] == file_name
        assert "uid" in data

    def test_upload_file_creates_file_in_bucket(self, client: httpx.Client):
        """Test that uploaded file is actually saved in the bucket directory"""
        from pathlib import Path
        from api.routes import UPLOAD_DIR

        file_content = b"Test content for file persistence"
        file_name = "persistence_test.txt"

        response = client.post(
            "/bucket",
            files={"file": (file_name, io.BytesIO(file_content), "text/plain")},
        )

        assert response.status_code == 200
        data = response.json()
        file_uid = data["uid"]

        # Check that file exists in bucket directory
        # The file should be named as {uid}{extension}
        uploaded_file = UPLOAD_DIR / f"{file_uid}.txt"
        assert uploaded_file.exists()

        # Verify file content
        with open(uploaded_file, "rb") as f:
            assert f.read() == file_content

    def test_upload_multiple_files(self, client: httpx.Client):
        """Test uploading multiple files"""
        files_data = [
            ("file1.txt", b"Content 1"),
            ("file2.txt", b"Content 2"),
            ("file3.db", b"Database content"),
        ]

        uploaded_uids = []
        for file_name, file_content in files_data:
            response = client.post(
                "/bucket",
                files={
                    "file": (
                        file_name,
                        io.BytesIO(file_content),
                        "application/octet-stream",
                    )
                },
            )
            assert response.status_code == 200
            data = response.json()
            uploaded_uids.append(data["uid"])
            assert data["filename"] == file_name

        # All UIDs should be unique
        assert len(set(uploaded_uids)) == len(uploaded_uids)

    def test_upload_file_without_name(self, client: httpx.Client):
        """Test uploading a file without a filename"""
        file_content = b"Content without name"

        response = client.post(
            "/bucket", files={"file": (None, io.BytesIO(file_content), "text/plain")}
        )

        # Should still work, but filename might be None or empty
        assert response.status_code == 200
        data = response.json()
        assert "uid" in data
