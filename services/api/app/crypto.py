from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from .settings import get_settings


def _fernet() -> Fernet:
    settings = get_settings()
    raw = settings.secrets_fernet_key.strip()
    if raw:
        key = raw.encode("utf-8") if not raw.endswith("=") else raw.encode("utf-8")
        try:
            return Fernet(key)
        except Exception:
            # allow passphrase → derive stable key
            digest = hashlib.sha256(raw.encode("utf-8")).digest()
            return Fernet(base64.urlsafe_b64encode(digest))
    # deterministic dev fallback (NOT for production without SECRETS_FERNET_KEY)
    digest = hashlib.sha256(b"xiezuomanju-dev-secrets-fernet").digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(plain: str) -> str:
    if not plain:
        return ""
    return _fernet().encrypt(plain.encode("utf-8")).decode("utf-8")


def decrypt_secret(token: str) -> str:
    if not token:
        return ""
    # migrate legacy "enc:{plain}"
    if token.startswith("enc:"):
        return token[4:]
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return ""


def mask_secret(plain: str) -> str:
    if not plain:
        return "****"
    if len(plain) <= 8:
        return "****"
    return f"{plain[:3]}…{plain[-4:]}"
