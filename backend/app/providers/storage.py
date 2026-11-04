"""Armazenamento privado de objetos (MinIO/S3) com alternativa local para testes."""

from __future__ import annotations

import io
import os
import shutil
from collections.abc import Iterator
from pathlib import Path
from typing import BinaryIO, Protocol

from app.core.config import settings
from app.core.logging import get_logger

log = get_logger(__name__)


class ObjectStorage(Protocol):
    def put(self, key: str, data: BinaryIO, size: int, content_type: str) -> None: ...
    def get_stream(self, key: str, chunk_size: int = 1024 * 256) -> Iterator[bytes]: ...
    def get_bytes(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...
    def exists(self, key: str) -> bool: ...
    def healthcheck(self) -> bool: ...


class MinioStorage:
    def __init__(self) -> None:
        from minio import Minio

        self._client = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_root_user,
            secret_key=settings.minio_root_password,
            secure=settings.minio_secure,
        )
        self._bucket = settings.minio_bucket
        self._ensured = False

    def _ensure_bucket(self) -> None:
        if self._ensured:
            return
        if not self._client.bucket_exists(self._bucket):
            self._client.make_bucket(self._bucket)
            log.info("storage_bucket_created", bucket=self._bucket)
        self._ensured = True

    def put(self, key: str, data: BinaryIO, size: int, content_type: str) -> None:
        self._ensure_bucket()
        self._client.put_object(self._bucket, key, data, length=size, content_type=content_type)

    def get_stream(self, key: str, chunk_size: int = 1024 * 256) -> Iterator[bytes]:
        self._ensure_bucket()
        resp = self._client.get_object(self._bucket, key)
        try:
            yield from resp.stream(chunk_size)
        finally:
            resp.close()
            resp.release_conn()

    def get_bytes(self, key: str) -> bytes:
        return b"".join(self.get_stream(key))

    def delete(self, key: str) -> None:
        self._ensure_bucket()
        self._client.remove_object(self._bucket, key)

    def exists(self, key: str) -> bool:
        from minio.error import S3Error

        self._ensure_bucket()
        try:
            self._client.stat_object(self._bucket, key)
            return True
        except S3Error:
            return False

    def healthcheck(self) -> bool:
        try:
            self._client.bucket_exists(self._bucket)
            return True
        except Exception:
            return False


class LocalFileStorage:
    """Armazenamento em disco local — usado em testes e desenvolvimento sem MinIO."""

    def __init__(self, root: str | os.PathLike[str]) -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        safe = key.replace("..", "").lstrip("/\\")
        return self._root / safe

    def put(self, key: str, data: BinaryIO, size: int, content_type: str) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as fh:
            shutil.copyfileobj(data, fh)

    def get_stream(self, key: str, chunk_size: int = 1024 * 256) -> Iterator[bytes]:
        with open(self._path(key), "rb") as fh:
            while True:
                block = fh.read(chunk_size)
                if not block:
                    break
                yield block

    def get_bytes(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        p = self._path(key)
        if p.exists():
            p.unlink()

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def healthcheck(self) -> bool:
        return self._root.exists()


class InMemoryStorage:
    """Armazenamento em memória para testes unitários."""

    def __init__(self) -> None:
        self._data: dict[str, bytes] = {}

    def put(self, key: str, data: BinaryIO, size: int, content_type: str) -> None:
        self._data[key] = data.read()

    def get_stream(self, key: str, chunk_size: int = 1024 * 256) -> Iterator[bytes]:
        buf = io.BytesIO(self._data[key])
        while True:
            block = buf.read(chunk_size)
            if not block:
                break
            yield block

    def get_bytes(self, key: str) -> bytes:
        return self._data[key]

    def delete(self, key: str) -> None:
        self._data.pop(key, None)

    def exists(self, key: str) -> bool:
        return key in self._data

    def healthcheck(self) -> bool:
        return True


_storage: ObjectStorage | None = None


def get_storage() -> ObjectStorage:
    global _storage
    if _storage is None:
        backend = "memory" if settings.app_env == "test" else settings.storage_backend
        if backend == "memory":
            _storage = InMemoryStorage()
        elif backend == "local":
            _storage = LocalFileStorage(settings.local_storage_dir)
        else:
            _storage = MinioStorage()
    return _storage


def set_storage(storage: ObjectStorage | None) -> None:
    """Permite injetar outro armazenamento (testes)."""
    global _storage
    _storage = storage
