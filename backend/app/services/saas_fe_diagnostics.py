from __future__ import annotations

import re


def extract_saas_fe_reference_code(error_message: str | None) -> str | None:
    s = (error_message or "").strip()
    if not s:
        return None
    m = re.search(r"\bref:(saas-sub-[a-z0-9]+)\b", s, flags=re.IGNORECASE)
    if not m:
        return None
    return m.group(1)


def categorize_saas_fe_error(
    *,
    status: str | None,
    error_message: str | None,
) -> str:
    st = (status or "").strip().lower()
    msg = (error_message or "").strip().lower()

    if st == "ok":
        return "ok"
    if st == "skipped":
        return "skipped"
    if st == "":
        return "pending"

    if "pendiente" in msg and "dian" in msg:
        return "pending_dian"
    if "fak24" in msg or "dv del nit" in msg:
        return "nit_dv"
    if "faj43b" in msg or "rut" in msg:
        return "rut_name"
    if "habilite saas_billing_factus_enabled" in msg or "credenciales emisor" in msg:
        return "config"
    if "validación" in msg or "validacion" in msg:
        return "validation"
    return "error"
