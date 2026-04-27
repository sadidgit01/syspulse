from __future__ import annotations

import base64
import hashlib
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Agent, CertStore

settings = get_settings()


@dataclass(frozen=True)
class CABundle:
    ca_cert_pem: str
    ca_key_pem: str


@dataclass(frozen=True)
class AgentCertBundle:
    agent_cert_pem: str
    agent_key_pem: str
    ca_cert_pem: str
    expires_at: datetime
    fingerprint: str


class CertManager:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_ca(self, org_id: uuid.UUID) -> CABundle:
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=4096)
        subject = issuer = x509.Name(
            [
                x509.NameAttribute(NameOID.ORGANIZATION_NAME, "SysPulse"),
                x509.NameAttribute(NameOID.COMMON_NAME, f"SysPulse Org CA {org_id}"),
            ]
        )
        now = datetime.now(timezone.utc)
        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(private_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=5))
            .not_valid_after(now + timedelta(days=3650))
            .add_extension(x509.BasicConstraints(ca=True, path_length=1), critical=True)
            .add_extension(
                x509.KeyUsage(
                    digital_signature=True,
                    key_encipherment=False,
                    content_commitment=False,
                    data_encipherment=False,
                    key_agreement=False,
                    key_cert_sign=True,
                    crl_sign=True,
                    encipher_only=False,
                    decipher_only=False,
                ),
                critical=True,
            )
            .sign(private_key, hashes.SHA256())
        )

        ca_cert_pem = _cert_to_pem(cert)
        ca_key_pem = _key_to_pem(private_key)
        self.session.add(
            CertStore(
                org_id=org_id,
                agent_id=None,
                cert_pem=ca_cert_pem,
                key_pem=_encrypt_pem(ca_key_pem),
                fingerprint=_fingerprint_cert(cert),
                expires_at=cert.not_valid_after_utc,
            )
        )
        await self.session.flush()
        return CABundle(ca_cert_pem=ca_cert_pem, ca_key_pem=ca_key_pem)

    async def issue_agent_cert(
        self,
        org_id: uuid.UUID,
        agent_id: uuid.UUID,
        hostname: str,
    ) -> AgentCertBundle:
        ca = await self._get_or_create_ca(org_id)
        ca_cert = x509.load_pem_x509_certificate(ca.ca_cert_pem.encode("utf-8"))
        ca_key = serialization.load_pem_private_key(ca.ca_key_pem.encode("utf-8"), password=None)

        agent_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, str(agent_id))])
        now = datetime.now(timezone.utc)
        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(ca_cert.subject)
            .public_key(agent_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=5))
            .not_valid_after(now + timedelta(days=365))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName(hostname)]), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(
                x509.KeyUsage(
                    digital_signature=True,
                    key_encipherment=True,
                    content_commitment=False,
                    data_encipherment=False,
                    key_agreement=False,
                    key_cert_sign=False,
                    crl_sign=False,
                    encipher_only=False,
                    decipher_only=False,
                ),
                critical=True,
            )
            .add_extension(
                x509.ExtendedKeyUsage([ExtendedKeyUsageOID.CLIENT_AUTH]),
                critical=False,
            )
            .sign(ca_key, hashes.SHA256())
        )

        agent_cert_pem = _cert_to_pem(cert)
        agent_key_pem = _key_to_pem(agent_key)
        fingerprint = _fingerprint_cert(cert)

        self.session.add(
            CertStore(
                org_id=org_id,
                agent_id=agent_id,
                cert_pem=agent_cert_pem,
                key_pem=_encrypt_pem(agent_key_pem),
                fingerprint=fingerprint,
                expires_at=cert.not_valid_after_utc,
            )
        )
        agent = await self.session.scalar(
            select(Agent).where(Agent.id == agent_id, Agent.org_id == org_id)
        )
        if agent is not None:
            agent.cert_fingerprint = fingerprint
        await self.session.flush()

        return AgentCertBundle(
            agent_cert_pem=agent_cert_pem,
            agent_key_pem=agent_key_pem,
            ca_cert_pem=ca.ca_cert_pem,
            expires_at=cert.not_valid_after_utc,
            fingerprint=fingerprint,
        )

    async def get_or_issue_agent_cert(
        self,
        org_id: uuid.UUID,
        agent_id: uuid.UUID,
        hostname: str,
    ) -> AgentCertBundle:
        now = datetime.now(timezone.utc)
        cert_record = await self.session.scalar(
            select(CertStore)
            .where(
                CertStore.org_id == org_id,
                CertStore.agent_id == agent_id,
                CertStore.expires_at > now + timedelta(days=7),
            )
            .order_by(CertStore.created_at.desc())
        )
        ca = await self._get_or_create_ca(org_id)
        if cert_record is None:
            return await self.issue_agent_cert(org_id, agent_id, hostname)
        return AgentCertBundle(
            agent_cert_pem=cert_record.cert_pem,
            agent_key_pem=_decrypt_pem(cert_record.key_pem),
            ca_cert_pem=ca.ca_cert_pem,
            expires_at=cert_record.expires_at,
            fingerprint=cert_record.fingerprint,
        )

    async def verify_cert_fingerprint(self, agent_id: uuid.UUID, cert_pem: str) -> bool:
        cert = x509.load_pem_x509_certificate(cert_pem.encode("utf-8"))
        fingerprint = _fingerprint_cert(cert)
        agent = await self.session.scalar(select(Agent).where(Agent.id == agent_id))
        return agent is not None and agent.cert_fingerprint == fingerprint

    async def _get_or_create_ca(self, org_id: uuid.UUID) -> CABundle:
        record = await self.session.scalar(
            select(CertStore)
            .where(CertStore.org_id == org_id, CertStore.agent_id.is_(None))
            .order_by(CertStore.created_at.desc())
        )
        if record is not None:
            return CABundle(ca_cert_pem=record.cert_pem, ca_key_pem=_decrypt_pem(record.key_pem))
        return await self.create_ca(org_id)


def _cert_to_pem(cert: x509.Certificate) -> str:
    return cert.public_bytes(serialization.Encoding.PEM).decode("utf-8")


def _key_to_pem(private_key: rsa.RSAPrivateKey) -> str:
    return private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode("utf-8")


def _fingerprint_cert(cert: x509.Certificate) -> str:
    return cert.fingerprint(hashes.SHA256()).hex()


def _encryption_key() -> bytes:
    return hashlib.sha256(settings.secret_key.encode("utf-8")).digest()


def _encrypt_pem(pem: str) -> str:
    aesgcm = AESGCM(_encryption_key())
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, pem.encode("utf-8"), None)
    return (
        "aesgcm:"
        + base64.b64encode(nonce).decode("ascii")
        + ":"
        + base64.b64encode(ciphertext).decode("ascii")
    )


def _decrypt_pem(value: str) -> str:
    if not value.startswith("aesgcm:"):
        return value
    _, nonce_b64, ciphertext_b64 = value.split(":", 2)
    aesgcm = AESGCM(_encryption_key())
    plaintext = aesgcm.decrypt(
        base64.b64decode(nonce_b64),
        base64.b64decode(ciphertext_b64),
        None,
    )
    return plaintext.decode("utf-8")
