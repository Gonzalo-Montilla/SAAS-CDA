"""Asistente de entrada WhatsApp.

CDASoft decide datos (tarifas, sedes, documentos, enlace de agendar, medios de pago).
Grok solo redacta esos hechos; si falla, se envía el texto base.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import re
import uuid

from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.integrations.whatsapp_client import build_text_payload
from app.models.sucursal import Sucursal
from app.models.tenant import Tenant
from app.models.whatsapp import (
    TenantWhatsAppConversacion,
    TenantWhatsAppMensaje,
    TenantWhatsAppSettings,
)
from app.services.tarifas_resolver import resolver_tarifa_vigente
from app.services.whatsapp_tenant import _cda, _enviar_con_row, creds_listas, enlace_agendar_publico
from app.utils.nombres import formatear_nombre_comercial
from app.utils.whatsapp_phone import normalizar_celular_co

INTENT_DOCUMENTOS = "documentos"
INTENT_AGENDAR = "agendar"
INTENT_PRECIO = "precio"
INTENT_PAGO = "pago"
INTENT_LUGAR = "lugar"
INTENT_SALUDO = "saludo"
INTENT_HUMANO = "humano"
INTENT_CIERRE = "cierre"
INTENT_ACK = "ack"

_PRECIO_TTL_SEGUNDOS = 2 * 3600

_RECLAMO = (
    "reclamo",
    "queja",
    "abogado",
    "estafa",
    "demanda",
    "superintendencia",
    "me cobraron",
    "mal servicio",
    "péssimo",
    "pesimo",
)
_DOCS = (
    "documento",
    "documentos",
    "qué debo llevar",
    "que debo llevar",
    "qué llevo",
    "que llevo",
    "qué traer",
    "que traer",
    "soat",
    "tarjeta de propiedad",
    "licencia de tránsito",
    "licencia de transito",
    "cédula",
    "cedula",
)
_AGENDAR = ("agend", "cita", "cupo", "reserv", "turno")
_PRECIO = (
    "precio",
    "cuesta",
    "tarifa",
    "cobran",
    "cuánto",
    "cuanto",
    "valor",
    "costo",
    "cómo vale",
    "como vale",
    "cuánto vale",
    "cuanto vale",
)
_PAGO = (
    "pagar",
    "pago",
    "medios de pago",
    "efectivo",
    "tarjeta",
    "tarjeta débito",
    "tarjeta debito",
    "tarjeta crédito",
    "tarjeta credito",
    "con tarjeta",
    "transferencia",
    "billetera",
    "nequi",
    "daviplata",
    "pse",
    "crédito",
    "credito",
    "credismart",
    "sistecredito",
)
_LUGAR = ("horario", "abren", "dirección", "direccion", "dónde", "donde", "sede", "ubicación", "ubicacion")
_SALUDO = (
    "hola",
    "buenos días",
    "buenos dias",
    "buen día",
    "buen dia",
    "buenas tardes",
    "buenas noches",
    "buenas",
    "cómo estás",
    "como estas",
    "cómo esta",
    "como esta",
    "qué tal",
    "que tal",
    "qué más",
    "que mas",
    "una pregunta",
    "tengo una pregunta",
    "quisiera preguntar",
)
_ACK = {
    "ok",
    "okay",
    "vale",
    "dale",
    "bueno",
    "de una",
    "sí",
    "si",
    "no",
}
_CIERRE_FRASES = {
    "de acuerdo",
    "deacuerdo",
    "listo",
    "perfecto",
    "ok gracias",
}


@dataclass
class InboundWa:
    wa_id: str
    from_e164: str
    texto: str
    phone_number_id: str | None
    display_phone: str | None


def _texto_cierre_norm(texto: str) -> str:
    t = (texto or "").strip().lower()
    t = re.sub(r"[^\wáéíóúñü\s]", " ", t, flags=re.IGNORECASE)
    return " ".join(t.split())


def clasificar_intencion(texto: str, last_intent: str | None = None) -> str:
    t = (texto or "").strip().lower()
    if not t:
        return INTENT_HUMANO
    norm = _texto_cierre_norm(t)
    if norm in _ACK:
        return INTENT_ACK
    if any(k in t for k in _RECLAMO):
        return INTENT_HUMANO
    if any(k in t for k in _DOCS):
        return INTENT_DOCUMENTOS
    if any(k in t for k in _PRECIO):
        return INTENT_PRECIO
    if any(k in t for k in _PAGO):
        return INTENT_PAGO
    if any(k in t for k in _AGENDAR):
        return INTENT_AGENDAR
    if any(k in t for k in _LUGAR):
        return INTENT_LUGAR
    if last_intent == INTENT_PRECIO:
        tipo, ano = extraer_tipo_y_ano(t)
        if tipo or ano:
            return INTENT_PRECIO
    if norm in _CIERRE_FRASES or "gracias" in norm:
        return INTENT_CIERRE
    if any(k in t for k in _SALUDO):
        return INTENT_SALUDO
    return INTENT_HUMANO


def extraer_tipo_y_ano(texto: str) -> tuple[str | None, int | None]:
    t = (texto or "").lower()
    tipo = None
    if "moto" in t or "motocicleta" in t:
        tipo = "moto"
    elif "pesado" in t or "camion" in t or "camión" in t:
        tipo = "pesado_publico" if "público" in t or "publico" in t else "pesado_particular"
    elif "público" in t or "publico" in t:
        tipo = "liviano_publico"
    elif "liviano" in t or "carro" in t or "auto" in t or "particular" in t:
        tipo = "liviano_particular"
    ano = None
    m = re.search(r"\b((?:19|20)\d{2})\b", t)
    if m:
        ano = int(m.group(1))
        actual = datetime.now().year
        if ano < 1950 or ano > actual + 1:
            ano = None
    return tipo, ano


def extraer_mensajes_inbound(payload: dict) -> list[InboundWa]:
    out: list[InboundWa] = []
    if not isinstance(payload, dict):
        return out
    entries = payload.get("entry") or payload.get("entries") or []
    if isinstance(payload.get("messages"), list) and not entries:
        entries = [{"changes": [{"value": payload}]}]
    if not isinstance(entries, list):
        return out
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        changes = entry.get("changes") or []
        if not isinstance(changes, list):
            continue
        for change in changes:
            if not isinstance(change, dict):
                continue
            value = change.get("value") or change
            if not isinstance(value, dict):
                continue
            meta = value.get("metadata") if isinstance(value.get("metadata"), dict) else {}
            phone_number_id = str(meta.get("phone_number_id") or "").strip() or None
            display_phone = str(meta.get("display_phone_number") or "").strip() or None
            messages = value.get("messages") or []
            if not isinstance(messages, list):
                continue
            for msg in messages:
                if not isinstance(msg, dict):
                    continue
                if (msg.get("type") or "text") != "text":
                    continue
                texto = ""
                text_obj = msg.get("text")
                if isinstance(text_obj, dict):
                    texto = str(text_obj.get("body") or "")
                wa_id = str(msg.get("id") or "").strip()
                origen = normalizar_celular_co(str(msg.get("from") or ""))
                if not wa_id or not origen or not texto.strip():
                    continue
                out.append(
                    InboundWa(
                        wa_id=wa_id,
                        from_e164=origen,
                        texto=texto.strip(),
                        phone_number_id=phone_number_id,
                        display_phone=display_phone,
                    )
                )
    return out


def resolver_tenant_settings(
    db: Session,
    *,
    tenant_id: uuid.UUID | None,
    phone_number_id: str | None,
    display_phone: str | None,
) -> TenantWhatsAppSettings | None:
    if tenant_id is not None:
        row = (
            db.query(TenantWhatsAppSettings)
            .filter(TenantWhatsAppSettings.tenant_id == tenant_id)
            .first()
        )
        if row is None:
            return None
        esperado_pid = (row.phone_number_id or "").strip()
        if esperado_pid:
            if not phone_number_id or phone_number_id.strip() != esperado_pid:
                return None
        esperado_tel = normalizar_celular_co(row.display_phone_e164)
        visto_tel = normalizar_celular_co(display_phone)
        if esperado_tel and visto_tel and visto_tel != esperado_tel:
            return None
        return row
    if phone_number_id:
        rows = (
            db.query(TenantWhatsAppSettings)
            .filter(TenantWhatsAppSettings.phone_number_id == phone_number_id.strip())
            .all()
        )
        if len(rows) == 1:
            return rows[0]
    destino = normalizar_celular_co(display_phone)
    if destino:
        rows = (
            db.query(TenantWhatsAppSettings)
            .filter(TenantWhatsAppSettings.display_phone_e164 == destino)
            .all()
        )
        if len(rows) == 1:
            return rows[0]
    return None


def _formato_cop(value) -> str:
    try:
        amount = round(float(value))
    except Exception:
        amount = 0
    return f"${amount:,.0f}".replace(",", ".")


def _texto_documentos(nombre_cda: str) -> str:
    return (
        f"Para la revisión técnico-mecánica en {nombre_cda} lo obligatorio es "
        "la licencia de tránsito (tarjeta de propiedad) y el vehículo limpio. "
        "El SOAT no es obligatorio. Si es servicio público, con la tarjeta de propiedad basta."
    )


def _texto_agendar(nombre_cda: str, url: str) -> str:
    return f"Con gusto. En {nombre_cda} puede agendar aquí, elige sede y horario: {url}"


def _texto_lugar(nombre_cda: str, sedes: list[Sucursal], url: str) -> str:
    if not sedes:
        return f"En {nombre_cda} puede confirmar sede y horario al agendar aquí: {url}"
    lineas = []
    for s in sedes:
        nombre = formatear_nombre_comercial(s.nombre, s.nombre)
        extra = " · ".join(p for p in [(s.ciudad or "").strip(), (s.direccion or "").strip()] if p)
        lineas.append(f"{nombre}" + (f" ({extra})" if extra else ""))
    listado = "; ".join(lineas)
    return f"{nombre_cda} atiende en: {listado}. Agende aquí: {url}"


def _texto_precio(db: Session, tenant: Tenant, texto: str, url: str) -> str:
    nombre = _cda(tenant.nombre_comercial or tenant.nombre)
    tipo, ano = extraer_tipo_y_ano(texto)
    if not tipo or not ano:
        return (
            f"Con gusto. Para decirle el valor en {nombre} le pido el tipo de vehículo "
            f"(moto, liviano o pesado, particular o público) y el año modelo. "
            f"Es aproximado y se confirma en caja. También puede verlo al agendar: {url}"
        )
    tarifa = resolver_tarifa_vigente(
        db,
        tenant_id=tenant.id,
        tipo_vehiculo=tipo,
        ano_modelo=ano,
    )
    if tarifa is None:
        return (
            f"En {nombre} no tengo esa tarifa a la mano para ese tipo y año. "
            f"Agende aquí y en caja se lo confirman: {url}"
        )
    return (
        f"En {nombre}, para {tipo.replace('_', ' ')} {ano} el valor aproximado de RTM es "
        f"{_formato_cop(tarifa.valor_total)}. Es un estimado; en caja se lo confirman "
        f"al presentar el vehículo. Si desea, puede agendar aquí: {url}"
    )


def _texto_pago(nombre_cda: str) -> str:
    return (
        f"En {nombre_cda} puede pagar en caja con efectivo, tarjeta débito, tarjeta crédito, "
        "transferencia o billeteras digitales, y crédito si la sede lo ofrece. "
        "Lo confirman al momento del cobro."
    )


def _saludo_del_dia(ahora: datetime | None = None) -> str:
    try:
        from zoneinfo import ZoneInfo

        now = ahora or datetime.now(ZoneInfo("America/Bogota"))
    except Exception:
        now = ahora or datetime.now(timezone.utc)
    hora = now.hour
    if 5 <= hora < 12:
        return "Buenos días"
    if 12 <= hora < 18:
        return "Buenas tardes"
    return "Buenas noches"


def _texto_saludo(nombre_cda: str) -> str:
    return f"{_saludo_del_dia()}. Gracias por escribir a {nombre_cda}."


def _texto_cierre(nombre_cda: str, url: str) -> str:
    return (
        f"Gracias por preferir {nombre_cda}. "
        f"Si desea agilizar su atención, puede agendar aquí: {url}"
    )


def _texto_humano(nombre_cda: str) -> str:
    return (
        f"Claro, un asesor de {nombre_cda} le escribe por aquí. "
        "Si es urgente, también puede acercarse a la sede."
    )


def _hechos_y_base(db: Session, tenant: Tenant, texto: str, intencion: str) -> tuple[str, str]:
    nombre = _cda(tenant.nombre_comercial or tenant.nombre)
    url = enlace_agendar_publico(tenant.slug)
    if intencion == INTENT_DOCUMENTOS:
        base = _texto_documentos(nombre)
        hechos = (
            f"- CDA: {nombre}\n"
            "- Documentos RTM: solo licencia de tránsito (tarjeta de propiedad) y el vehículo limpio. "
            "El SOAT no es obligatorio. "
            "Servicio público: no se piden documentos extra; con la tarjeta de propiedad basta."
        )
        return hechos, base
    if intencion == INTENT_AGENDAR:
        base = _texto_agendar(nombre, url)
        hechos = f"- CDA: {nombre}\n- Enlace para agendar (no lo cambies): {url}"
        return hechos, base
    if intencion == INTENT_LUGAR:
        sedes = (
            db.query(Sucursal)
            .filter(Sucursal.tenant_id == tenant.id, Sucursal.activa == True)
            .order_by(Sucursal.es_principal.desc(), Sucursal.nombre.asc())
            .all()
        )
        base = _texto_lugar(nombre, sedes, url)
        lineas = [f"- CDA: {nombre}", f"- Enlace para agendar (no lo cambies): {url}"]
        for s in sedes:
            extra = " · ".join(p for p in [(s.ciudad or "").strip(), (s.direccion or "").strip()] if p)
            lineas.append(f"- Sede: {s.nombre}" + (f" ({extra})" if extra else ""))
        return "\n".join(lineas), base
    if intencion == INTENT_PRECIO:
        base = _texto_precio(db, tenant, texto, url)
        hechos = f"- CDA: {nombre}\n- Respuesta de tarifa (cifras y URL tal cual):\n{base}"
        return hechos, base
    if intencion == INTENT_PAGO:
        base = _texto_pago(nombre)
        hechos = (
            f"- CDA: {nombre}\n"
            "- Medios de pago en caja: efectivo, tarjeta débito, tarjeta crédito, "
            "transferencia o billeteras digitales, y crédito si la sede lo ofrece. "
            "Se confirman al cobro. No prometas Nequi, Daviplata ni un crédito específico."
        )
        return hechos, base
    if intencion == INTENT_SALUDO:
        base = _texto_saludo(nombre)
        hechos = (
            f"- CDA: {nombre}\n"
            f"- Saludo: {_saludo_del_dia()}. Gracias por escribir a {nombre}. "
            "No armes menú, no inventes horarios ni precios. Espera la pregunta."
        )
        return hechos, base
    if intencion == INTENT_CIERRE:
        base = _texto_cierre(nombre, url)
        hechos = (
            f"- CDA: {nombre}\n"
            "- El cliente cierra (gracias / de acuerdo). "
            "Agradece por preferir el CDA, de usted. "
            f"Si invita a agendar, el enlace tal cual: {url}"
        )
        return hechos, base
        return hechos, base
    base = _texto_humano(nombre)
    hechos = f"- CDA: {nombre}\n- No hay dato seguro. Escalar a un asesor humano del CDA."
    return hechos, base


def _armar_respuesta(db: Session, tenant: Tenant, texto: str, intencion: str) -> str:
    from app.integrations.xai_client import redactar_whatsapp

    nombre = _cda(tenant.nombre_comercial or tenant.nombre)
    hechos, base = _hechos_y_base(db, tenant, texto, intencion)
    grok = redactar_whatsapp(
        nombre_cda=nombre,
        mensaje_cliente=texto,
        hechos=hechos,
        texto_base=base,
    )
    return grok or base


def procesar_inbound(
    db: Session,
    payload: dict,
    *,
    tenant_id: uuid.UUID | None = None,
) -> dict:
    mensajes = extraer_mensajes_inbound(payload)
    procesados = 0
    respondidos = 0
    for item in mensajes:
        ya = (
            db.query(TenantWhatsAppMensaje)
            .filter(TenantWhatsAppMensaje.proveedor_message_id == item.wa_id)
            .first()
        )
        if ya:
            continue
        row = resolver_tenant_settings(
            db,
            tenant_id=tenant_id,
            phone_number_id=item.phone_number_id,
            display_phone=item.display_phone,
        )
        if row is None:
            continue
        tenant = db.query(Tenant).filter(Tenant.id == row.tenant_id, Tenant.activo == True).first()
        if tenant is None:
            continue
        conversacion = (
            db.query(TenantWhatsAppConversacion)
            .filter(
                TenantWhatsAppConversacion.tenant_id == row.tenant_id,
                TenantWhatsAppConversacion.cliente_e164 == item.from_e164,
            )
            .first()
        )
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        if conversacion is None:
            conversacion = TenantWhatsAppConversacion(
                tenant_id=row.tenant_id,
                cliente_e164=item.from_e164,
                estado="abierta",
                created_at=now,
                updated_at=now,
            )
            db.add(conversacion)
            db.flush()
        prev_intent = conversacion.last_intent
        if conversacion.last_inbound_at is not None:
            last_at = conversacion.last_inbound_at
            if getattr(last_at, "tzinfo", None) is not None:
                last_at = last_at.replace(tzinfo=None)
            if (now - last_at).total_seconds() > _PRECIO_TTL_SEGUNDOS:
                prev_intent = None
        intencion = clasificar_intencion(item.texto, prev_intent)
        if intencion not in (INTENT_CIERRE, INTENT_ACK):
            conversacion.last_intent = intencion
        conversacion.last_inbound_at = now
        conversacion.updated_at = now
        db.add(
            TenantWhatsAppMensaje(
                conversacion_id=conversacion.id,
                tenant_id=row.tenant_id,
                direccion="in",
                texto=item.texto,
                intencion=intencion,
                proveedor_message_id=item.wa_id,
                created_at=now,
            )
        )
        procesados += 1
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            continue
        if (
            intencion == INTENT_ACK
            or not row.habilitado
            or not bool(getattr(row, "asistente_habilitado", False))
            or not creds_listas(row)
        ):
            continue
        respuesta = _armar_respuesta(db, tenant, item.texto, intencion)
        result = _enviar_con_row(row, build_text_payload(item.from_e164, respuesta))
        db.add(
            TenantWhatsAppMensaje(
                conversacion_id=conversacion.id,
                tenant_id=row.tenant_id,
                direccion="out",
                texto=respuesta,
                intencion=intencion,
                proveedor_message_id=result.message_id,
                created_at=now,
            )
        )
        if result.ok:
            respondidos += 1
            row.last_ok_at = now
            row.last_error = None
        else:
            row.last_error = (result.error or "Error WhatsApp asistente")[:1000]
        db.commit()
    if procesados and not mensajes:
        db.commit()
    return {"ok": True, "recibidos": len(mensajes), "procesados": procesados, "respondidos": respondidos}
