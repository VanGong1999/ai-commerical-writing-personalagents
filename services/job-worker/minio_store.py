from __future__ import annotations

import io
import logging

from app.settings import get_settings

logger = logging.getLogger("minio_store")
_client = None


def get_client():
    global _client
    if _client is not None:
        return _client
    from minio import Minio

    s = get_settings()
    _client = Minio(
        s.minio_endpoint,
        access_key=s.minio_access_key,
        secret_key=s.minio_secret_key,
        secure=s.minio_secure,
    )
    bucket = s.minio_bucket
    if not _client.bucket_exists(bucket):
        _client.make_bucket(bucket)
    return _client


def upload_bytes(object_name: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    s = get_settings()
    client = get_client()
    client.put_object(
        s.minio_bucket,
        object_name,
        io.BytesIO(data),
        length=len(data),
        content_type=content_type,
    )
    return f"minio://{s.minio_bucket}/{object_name}"


def delete_object(object_name: str) -> bool:
    """Best-effort 删除对象；不存在或 MinIO 不可用时返回 False，不抛出。"""
    try:
        s = get_settings()
        client = get_client()
        client.remove_object(s.minio_bucket, object_name)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("minio delete failed for %s: %s", object_name, exc)
        return False


def download_bytes(object_name: str) -> bytes:
    s = get_settings()
    client = get_client()
    resp = client.get_object(s.minio_bucket, object_name)
    try:
        return resp.read()
    finally:
        resp.close()
        resp.release_conn()
