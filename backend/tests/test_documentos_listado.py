"""Listado documental: metadatos paginados, no binarios."""
from fastapi import HTTPException

from app.api.v1.endpoints.documentos import (
    MOTIVO_CAMBIO_MAX,
    MOTIVO_CAMBIO_MIN,
    _detalle_cambio_metadatos,
    _linea_cambio_metadatos,
    _normalize_categoria,
    _parse_motivo_cambio,
    _validar_motivo_nueva_version,
)
from app.core.config import settings


def test_normalize_categoria_vacia():
    assert _normalize_categoria(None) is None
    assert _normalize_categoria("") is None
    assert _normalize_categoria("   ") is None


def test_normalize_categoria_recorta():
    assert _normalize_categoria("  Manuales  ") == "Manuales"


def test_page_size_servidor_acota_listados():
    assert int(settings.MAX_PAGE_SIZE) >= 50
    assert int(settings.MAX_PAGE_SIZE) <= 500


def test_parse_motivo_cambio_vacio():
    assert _parse_motivo_cambio(None) is None
    assert _parse_motivo_cambio("") is None
    assert _parse_motivo_cambio("   ") is None


def test_parse_motivo_cambio_recorta_maximo():
    largo = "x" * (MOTIVO_CAMBIO_MAX + 20)
    assert _parse_motivo_cambio(f"  {largo}  ") == "x" * MOTIVO_CAMBIO_MAX


def test_validar_motivo_nueva_version_obligatorio():
    try:
        _validar_motivo_nueva_version(None)
        raise AssertionError("debía rechazar motivo vacío")
    except HTTPException as e:
        assert e.status_code == 400


def test_validar_motivo_nueva_version_minimo():
    try:
        _validar_motivo_nueva_version("corto")
        raise AssertionError("debía rechazar motivo corto")
    except HTTPException as e:
        assert e.status_code == 400


def test_validar_motivo_nueva_version_ok():
    texto = "Factura ilegible; se reemplaza por el PDF del proveedor."
    assert len(texto) >= MOTIVO_CAMBIO_MIN
    assert _validar_motivo_nueva_version(f"  {texto}  ") == texto


def test_linea_cambio_metadatos_igual_omite():
    assert _linea_cambio_metadatos("Categoría", "CARTERA", "CARTERA") is None


def test_linea_cambio_metadatos_diferente():
    assert _linea_cambio_metadatos("Categoría", "CARTERA", "GASTOS") == "Categoría: CARTERA → GASTOS"


def test_detalle_cambio_metadatos_sin_cambios():
    assert _detalle_cambio_metadatos(titulo_actual="Factura", partes=[None, None]) is None


def test_detalle_cambio_metadatos_prefija_si_titulo_no_cambia():
    detalle = _detalle_cambio_metadatos(
        titulo_actual="CAMILO SUAREZ",
        partes=[None, "Categoría: CARTERA → GASTOS", None],
    )
    assert detalle == "«CAMILO SUAREZ». Categoría: CARTERA → GASTOS"


def test_detalle_cambio_metadatos_titulo_sin_prefijo_extra():
    detalle = _detalle_cambio_metadatos(
        titulo_actual="Nuevo",
        partes=["Título: «Viejo» → «Nuevo»", None],
    )
    assert detalle == "Título: «Viejo» → «Nuevo»"
