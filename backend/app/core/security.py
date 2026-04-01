"""
Utilidades de seguridad: JWT, hashing de contraseñas
"""
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
from jose import JWTError, jwt
from passlib.context import CryptContext
from app.core.config import settings

# Contexto para hashing de contraseñas (usando sha256_crypt por compatibilidad)
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verificar contraseña contra hash"""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Generar hash de contraseña"""
    return pwd_context.hash(password)


def validate_password_strength(password: str, min_length: int = 10) -> None:
    """
    Valida política de contraseña robusta.
    Lanza ValueError con mensaje de negocio si no cumple.
    """
    if len(password or "") < min_length:
        raise ValueError(f"La contraseña debe tener mínimo {min_length} caracteres")
    if not any(c.isupper() for c in password):
        raise ValueError("La contraseña debe incluir al menos una mayúscula")
    if not any(c.islower() for c in password):
        raise ValueError("La contraseña debe incluir al menos una minúscula")
    if not any(c.isdigit() for c in password):
        raise ValueError("La contraseña debe incluir al menos un número")
    if not any(c in "!@#$%^&*()-_=+[]{};:,.?/|" for c in password):
        raise ValueError("La contraseña debe incluir al menos un carácter especial")


def create_access_token(data: Dict[str, Any]) -> str:
    """
    Crear token de acceso JWT
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({
        "exp": expire,
        "type": "access"
    })
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def create_refresh_token(data: Dict[str, Any]) -> str:
    """
    Crear token de refresco JWT
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({
        "exp": expire,
        "type": "refresh"
    })
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def decode_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Decodificar y validar token JWT
    """
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except JWTError:
        return None
