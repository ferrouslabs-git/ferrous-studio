"""S3 access for project documents.

Presigning is a local signature computation (no network), so those helpers
are plain functions. The object operations block on the network and run in a
thread, the same way ``email_service`` calls SES.

Addressing is forced to virtual-hosted, regional (``bucket.s3.<region>.
amazonaws.com``): that is the host the frontend's CSP ``connect-src`` allows,
so a path-style or global-endpoint URL would be signed correctly and still be
blocked by the browser.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from functools import lru_cache

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.config import get_settings


class StorageNotConfigured(RuntimeError):
    pass


class ObjectMissing(LookupError):
    pass


@dataclass(frozen=True)
class ObjectInfo:
    size: int
    content_type: str | None


@lru_cache(maxsize=1)
def _client():
    settings = get_settings()
    return boto3.client(
        "s3",
        region_name=settings.aws_region,
        config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
    )


def bucket() -> str:
    name = get_settings().documents_bucket
    if not name:
        raise StorageNotConfigured("DOCUMENTS_BUCKET is not set")
    return name


def presign_put(key: str, content_type: str, content_length: int, expires: int) -> str:
    """URL the browser PUTs the file to. Content-Type and Content-Length are
    part of the signature, so S3 rejects a different type or size with 403."""
    return _client().generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket(), "Key": key, "ContentType": content_type, "ContentLength": content_length},
        ExpiresIn=expires,
        HttpMethod="PUT",
    )


def presign_get(key: str, filename: str, expires: int) -> str:
    """Download URL that forces an attachment so nothing renders inline."""
    safe = filename.replace('"', "")
    return _client().generate_presigned_url(
        "get_object",
        Params={
            "Bucket": bucket(),
            "Key": key,
            "ResponseContentDisposition": f'attachment; filename="{safe}"',
        },
        ExpiresIn=expires,
    )


def _is_missing(err: ClientError) -> bool:
    code = err.response.get("Error", {}).get("Code", "")
    return code in {"404", "NoSuchKey", "NotFound"}


async def head_object(key: str) -> ObjectInfo:
    def run() -> ObjectInfo:
        try:
            r = _client().head_object(Bucket=bucket(), Key=key)
        except ClientError as err:
            if _is_missing(err):
                raise ObjectMissing(key) from err
            raise
        return ObjectInfo(size=int(r["ContentLength"]), content_type=r.get("ContentType"))

    return await asyncio.to_thread(run)


async def read_object(key: str, byte_range: tuple[int, int] | None = None) -> bytes:
    """Whole object, or ``bytes=a-b`` inclusive when ``byte_range`` is given."""

    def run() -> bytes:
        params = {"Bucket": bucket(), "Key": key}
        if byte_range is not None:
            params["Range"] = f"bytes={byte_range[0]}-{byte_range[1]}"
        try:
            return _client().get_object(**params)["Body"].read()
        except ClientError as err:
            if _is_missing(err):
                raise ObjectMissing(key) from err
            raise

    return await asyncio.to_thread(run)


async def copy_object(source_key: str, dest_key: str) -> None:
    """Duplicate an object inside the bucket, server-side.

    Versioning a project copies its documents so deleting a file in one version
    cannot touch another. ``copy_object`` is a single atomic call up to 5 GB and
    ``DOCUMENTS_MAX_BYTES`` caps a file far below that, so the multipart
    ``UploadPartCopy`` dance is never needed here.
    """

    def run() -> None:
        name = bucket()
        try:
            _client().copy_object(Bucket=name, Key=dest_key, CopySource={"Bucket": name, "Key": source_key})
        except ClientError as err:
            if _is_missing(err):
                raise ObjectMissing(source_key) from err
            raise

    await asyncio.to_thread(run)


async def delete_object(key: str) -> None:
    def run() -> None:
        try:
            _client().delete_object(Bucket=bucket(), Key=key)
        except ClientError as err:
            if not _is_missing(err):
                raise

    await asyncio.to_thread(run)
