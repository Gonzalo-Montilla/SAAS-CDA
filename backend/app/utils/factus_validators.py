"""Validaciones ligeras compartidas Factus/DIAN (sin dependencias de emisión ni settings)."""
from __future__ import annotations

import re


def solo_digitos(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def normalizar_base_nit_persona_natural_colombia(ident_digits: str) -> str:
    """
    Base numérica del NIT en persona natural (cédula/T.I. como NIT ante DIAN): suele llevar
    ceros a la izquierda hasta **9 dígitos** cuando el número tiene longitud ≤ 9. Si se omite
    ese relleno, el DV calculado puede coincidir en ambas series de pesos y aun así no ser el
    del RUT (DSAJ24b). Cédulas de más de 9 dígitos se dejan como están.
    """
    d = solo_digitos(ident_digits)[:20]
    if not d:
        return d
    if len(d) > 9:
        return d
    core = d.lstrip("0")
    if not core:
        return d
    return core.zfill(9)


def parse_nit_colombiano_identificacion_y_dv(raw: str | None) -> tuple[str, int | None]:
    """
    Separa base numérica y DV si el usuario escribió «123456789-5». Si no hay guion, DV es None.
    """
    s = (raw or "").strip()
    if "-" in s:
        left, _, right = s.rpartition("-")
        base = solo_digitos(left)
        rd = solo_digitos(right)
        if base and rd and len(rd) <= 2:
            return base[:20], int(rd[0])
    return solo_digitos(s)[:20], None


def digito_verificacion_nit_colombia(nit_sin_dv: str) -> int:
    """
    DV NIT — módulo 11 con pesos **71, 67, 59, …, 3** (desde el dígito de menor orden).
    Es la forma más citada en anexos DIAN y en validadores tipo Factus; ej. base 900123456 → DV 8.
    """
    pesos = [71, 67, 59, 53, 47, 43, 41, 37, 29, 23, 19, 17, 13, 7, 3]
    rev = solo_digitos(nit_sin_dv)[::-1]
    if not rev:
        return 0
    total = sum(int(rev[i]) * pesos[i % len(pesos)] for i in range(len(rev)))
    r = total % 11
    return r if r < 2 else 11 - r


def digito_verificacion_nit_colombia_serie_37(nit_sin_dv: str) -> int:
    """
    Otra convención módulo 11 (pesos **3, 7, 13, …, 71** desde el dígito de menor orden).
    En algunos números coincide con la serie 71,67,…; en otros **no** — la DIAN puede rechazar si se elige mal (DSAJ24b).
    """
    pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71]
    rev = solo_digitos(nit_sin_dv)[::-1]
    if not rev:
        return 0
    total = sum(int(rev[i]) * pesos[i % len(pesos)] for i in range(len(rev)))
    r = total % 11
    return r if r < 2 else 11 - r


def email_valido_factus(email_raw: str | None) -> bool:
    s = (email_raw or "").strip().lower()
    if not s or "@" not in s:
        return False
    dom = s.split("@", 1)[-1]
    return "." in dom and len(dom) >= 3
