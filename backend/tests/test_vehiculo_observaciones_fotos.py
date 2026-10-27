"""Detalle de edición: no enviar fotos base64; al guardar no borrar las de DB."""
import json

from app.api.v1.endpoints.vehiculos import (
    _extract_fotos_from_observaciones,
    _merge_observaciones_preserving_fotos,
    _observaciones_respuesta_sin_fotos,
    _parse_observaciones_payload,
)


def test_parse_json_con_fotos():
    raw = json.dumps({"texto": "rayon puerta", "fotos": ["data:image/jpeg;base64,AAA", ""]})
    texto, fotos, was_json = _parse_observaciones_payload(raw)
    assert was_json is True
    assert texto == "rayon puerta"
    assert fotos == ["data:image/jpeg;base64,AAA"]


def test_parse_texto_plano_legacy():
    texto, fotos, was_json = _parse_observaciones_payload("nota libre")
    assert was_json is False
    assert texto == "nota libre"
    assert fotos == []


def test_extract_fotos_sigue_igual():
    raw = json.dumps({"texto": "x", "fotos": ["  a  ", 1, None, "b"]})
    assert _extract_fotos_from_observaciones(raw) == ["a", "b"]
    assert _extract_fotos_from_observaciones("no json") == []
    assert _extract_fotos_from_observaciones(None) == []


def test_respuesta_sin_fotos_deja_texto_y_conteo():
    blob = "x" * 2000
    raw = json.dumps({"texto": "ok", "fotos": [f"data:image/jpeg;base64,{blob}"]})
    slim, total = _observaciones_respuesta_sin_fotos(raw)
    assert total == 1
    parsed = json.loads(slim)
    assert parsed["texto"] == "ok"
    assert parsed["fotos"] == []
    assert blob not in slim
    assert len(slim) < 80


def test_respuesta_sin_fotos_texto_plano():
    slim, total = _observaciones_respuesta_sin_fotos("solo texto")
    assert slim == "solo texto"
    assert total == 0


def test_merge_edit_sin_fotos_conserva_las_de_db():
    existing = json.dumps({"texto": "viejo", "fotos": ["data:image/jpeg;base64,FOTO1"]})
    incoming = json.dumps({"texto": "nuevo comentario", "fotos": []})
    merged = json.loads(_merge_observaciones_preserving_fotos(existing, incoming))
    assert merged["texto"] == "nuevo comentario"
    assert merged["fotos"] == ["data:image/jpeg;base64,FOTO1"]


def test_merge_con_fotos_nuevas_reemplaza():
    existing = json.dumps({"texto": "a", "fotos": ["old"]})
    incoming = json.dumps({"texto": "a", "fotos": ["new1", "new2"]})
    merged = json.loads(_merge_observaciones_preserving_fotos(existing, incoming))
    assert merged["fotos"] == ["new1", "new2"]


def test_merge_incoming_none_no_toca_db():
    existing = json.dumps({"texto": "a", "fotos": ["old"]})
    assert _merge_observaciones_preserving_fotos(existing, None) == existing


def test_respuesta_cobro_tampoco_lleva_fotos():
    """El POST /cobrar devolvía el ORM completo; Caja en Putumayo timeout con reintento QHS611."""
    blob = "y" * 4000
    raw = json.dumps({"texto": "reingreso", "fotos": [f"data:image/jpeg;base64,{blob}", blob]})
    slim, total = _observaciones_respuesta_sin_fotos(raw)
    assert total == 2
    assert blob not in (slim or "")
    assert "reingreso" in (slim or "")
