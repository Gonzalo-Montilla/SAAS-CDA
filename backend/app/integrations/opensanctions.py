"""
Integración OpenSanctions para screening SARLAFT.
"""
from __future__ import annotations

from typing import Any
from urllib.parse import quote, urljoin

import httpx

from app.core.config import settings


class OpenSanctionsError(Exception):
    def __init__(self, message: str, status_code: int | None = None, body: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


def _safe_json(resp: httpx.Response) -> Any:
    try:
        return resp.json()
    except Exception:
        return (resp.text or "")[:2000]


def _build_query_entity(
    *,
    schema: str,
    full_name: str,
    document_number: str | None = None,
    id_number: str | None = None,
    tax_number: str | None = None,
    registration_number: str | None = None,
    birth_date: str | None = None,
    nationality: str | None = None,
    jurisdiction: str | None = None,
    country: str | None = None,
) -> dict[str, Any]:
    schema_norm = (schema or "").strip().lower()
    props: dict[str, list[str]] = {"name": [full_name]}
    # Compatibilidad: document_number se interpreta como idNumber en persona y taxNumber en company.
    normalized_id = (id_number or "").strip() or None
    normalized_tax = (tax_number or "").strip() or None
    if document_number and not normalized_id and not normalized_tax:
        if schema_norm in {"company", "legalentity", "organization"}:
            normalized_tax = document_number
        else:
            normalized_id = document_number
    if normalized_id:
        props["idNumber"] = [normalized_id]
    if normalized_tax:
        props["taxNumber"] = [normalized_tax]
    if registration_number:
        props["registrationNumber"] = [registration_number]
    if birth_date:
        props["birthDate"] = [birth_date]
    if nationality:
        props["nationality"] = [nationality]
    if jurisdiction:
        props["jurisdiction"] = [jurisdiction]
    if country:
        props["country"] = [country]
    elif nationality:
        props["country"] = [nationality]
    return {
        "schema": schema,
        "properties": props,
    }


def open_sanctions_match(
    *,
    schema: str,
    full_name: str,
    document_number: str | None = None,
    id_number: str | None = None,
    tax_number: str | None = None,
    registration_number: str | None = None,
    birth_date: str | None = None,
    nationality: str | None = None,
    jurisdiction: str | None = None,
    country: str | None = None,
    dataset: str | None = None,
    algorithm: str | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    if not settings.OPENSANCTIONS_ENABLED:
        raise OpenSanctionsError(
            "OpenSanctions deshabilitado. Configure OPENSANCTIONS_ENABLED=true."
        )
    api_key = (settings.OPENSANCTIONS_API_KEY or "").strip()
    if not api_key:
        raise OpenSanctionsError("OPENSANCTIONS_API_KEY no configurado.")

    name = (full_name or "").strip()
    if not name:
        raise OpenSanctionsError("full_name es obligatorio para screening.")

    schema_norm = (schema or "Person").strip() or "Person"
    ds = (dataset or settings.OPENSANCTIONS_MATCH_DATASET or "default").strip() or "default"
    algo = (algorithm or settings.OPENSANCTIONS_MATCH_ALGORITHM or "best").strip() or "best"
    top_n = int(limit or settings.OPENSANCTIONS_MATCH_LIMIT or 5)
    if top_n < 1:
        top_n = 1
    if top_n > 20:
        top_n = 20

    query = _build_query_entity(
        schema=schema_norm,
        full_name=name,
        document_number=(document_number or "").strip() or None,
        id_number=(id_number or "").strip() or None,
        tax_number=(tax_number or "").strip() or None,
        registration_number=(registration_number or "").strip() or None,
        birth_date=(birth_date or "").strip() or None,
        nationality=(nationality or "").strip() or None,
        jurisdiction=(jurisdiction or "").strip() or None,
        country=(country or "").strip() or None,
    )
    payload = {"queries": {"q1": query}}
    base_url = (settings.OPENSANCTIONS_BASE_URL or "https://api.opensanctions.org").rstrip("/") + "/"
    endpoint = f"match/{quote(ds, safe='')}"
    url = urljoin(base_url, endpoint)
    headers = {
        "Authorization": f"ApiKey {api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    params = {"algorithm": algo, "limit": str(top_n)}

    timeout = float(settings.OPENSANCTIONS_TIMEOUT_SECONDS or 20.0)
    with httpx.Client(timeout=timeout) as client:
        resp = client.post(url, headers=headers, params=params, json=payload)
        raw = _safe_json(resp)
        if resp.status_code >= 400:
            message = "OpenSanctions rechazó la consulta."
            if isinstance(raw, dict):
                detail = raw.get("detail") or raw.get("message")
                if detail:
                    message = str(detail)
            raise OpenSanctionsError(message, status_code=resp.status_code, body=raw)

    if not isinstance(raw, dict):
        raise OpenSanctionsError("Respuesta inválida de OpenSanctions.", body=raw)

    responses = raw.get("responses")
    if not isinstance(responses, dict):
        raise OpenSanctionsError("La respuesta no incluye 'responses'.", body=raw)
    q1 = responses.get("q1")
    if not isinstance(q1, dict):
        raise OpenSanctionsError("La respuesta no incluye resultados para q1.", body=raw)

    return {
        "provider": "opensanctions",
        "dataset": ds,
        "algorithm": algo,
        "query": q1.get("query"),
        "results": q1.get("results") or [],
        "raw": raw,
    }
