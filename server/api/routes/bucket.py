from fastapi import UploadFile, APIRouter
from pathlib import Path
import uuid
from . import router, UPLOAD_DIR
from ..models import BucketModel
from ..database.db import DBSession
from ..database.models import Bucket

router = APIRouter(tags=['buckets'])

@router.post('/bucket',response_model=BucketModel)
async def upload_file(file:UploadFile,db:DBSession):
    file_id = str(uuid.uuid4())

    ext = Path(file.filename).suffix or ""

    new_filename = f"{file_id}{ext}"
    file_path = UPLOAD_DIR / new_filename
    with open(file_path, 'wb') as f:
        f.write(await file.read())

    await db.create(Bucket(uid=file_id,metadata={
        'file_size':file.size,
        'filename':file.filename
    }))
    await db.commit()
    return BucketModel(uid=file_id,filename=file.filename)