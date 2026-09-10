from fastapi import APIRouter, HTTPException, UploadFile, status
from pathlib import Path
import uuid

from . import UPLOAD_DIR
from ..models import BucketModel
from ..database.db import DBSession
from ..database.models import Bucket

router = APIRouter(tags=["buckets"])

SQLITE_MAGIC = b"SQLite format 3\x00"
ALLOWED_SUFFIXES = {".db", ".sqlite", ".sqlite3", ".db3"}
CHUNK_SIZE = 1024 * 1024
MAX_UPLOAD_BYTES = 500 * 1024 * 1024


@router.post("/bucket", response_model=BucketModel)
async def upload_file(file: UploadFile, db: DBSession):
    original_name = file.filename or "database.db"
    suffix = Path(original_name).suffix.lower()
    if suffix and suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"'{suffix}' is not a SQLite database. "
                f"Expected one of {', '.join(sorted(ALLOWED_SUFFIXES))}."
            ),
        )

    file_id = str(uuid.uuid4())
    stored_name = f"{file_id}{suffix or '.db'}"
    file_path = UPLOAD_DIR / stored_name

    size = 0
    header = b""
    try:
        with open(file_path, "wb") as destination:
            while chunk := await file.read(CHUNK_SIZE):
                if not header:
                    header = chunk[: len(SQLITE_MAGIC)]
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=(
                            "File is larger than the "
                            f"{MAX_UPLOAD_BYTES // (1024 * 1024)}MB upload limit"
                        ),
                    )
                destination.write(chunk)

        if size == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty"
            )
        if header != SQLITE_MAGIC:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"'{original_name}' is not a valid SQLite database "
                    "(missing the SQLite file header)."
                ),
            )
    except HTTPException:
        file_path.unlink(missing_ok=True)
        raise

    await db.create(
        Bucket(
            uid=file_id,
            metadata={
                "file_size": size,
                "filename": original_name,
                "stored_name": stored_name,
            },
        )
    )
    await db.commit()

    return BucketModel(
        uid=file_id,
        filename=original_name,
        connection_uri=stored_name,
        size=size,
    )
