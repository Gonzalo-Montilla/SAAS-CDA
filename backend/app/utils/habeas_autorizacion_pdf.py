"""
PDF de autorización de tratamiento de datos personales (Ley 1581 de 2012), por tenant y cliente.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from io import BytesIO
from typing import Optional

import pytz

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer

from app.core.config import settings
from app.utils.comprobantes_caja import (
    _download_remote_logo,
    _resolve_tenant_logo_path,
    _safe_text,
)


def _xml_esc(s: str) -> str:
    t = _safe_text(s or "")
    return (
        t.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def generar_habeas_autorizacion_pdf(
    *,
    nombre_cda: str,
    nit_cda: Optional[str],
    correo_cda: Optional[str],
    celular_cda: Optional[str],
    direccion_cda: Optional[str],
    tenant_logo_url: Optional[str],
    cliente_nombre: str,
    cliente_documento: str,
    placa: str,
    cliente_email: Optional[str],
    momento_aceptacion_utc: datetime,
) -> bytes:
    """
    Genera el PDF de autorización personalizado (logo del tenant, datos CDA y titular).
    La constancia electrónica sustituye la firma autógrafa según criterio del asesor legal.
    """
    nc = _xml_esc(nombre_cda or "CDA")
    nit = _xml_esc((nit_cda or "").strip() or "N/A")
    mail = _xml_esc((correo_cda or "").strip() or "N/A")
    cel = _xml_esc((celular_cda or "").strip() or "N/A")
    dir_f = _xml_esc((direccion_cda or "").strip() or "N/A")
    cn = _xml_esc(cliente_nombre or "")
    cd = _xml_esc(cliente_documento or "")
    pl = _xml_esc((placa or "").strip().upper())
    ce = _xml_esc((cliente_email or "").strip() or "N/A")

    if momento_aceptacion_utc.tzinfo is None:
        momento_aceptacion_utc = momento_aceptacion_utc.replace(tzinfo=timezone.utc)
    tz_name = (settings.TIMEZONE or "America/Bogota").strip()
    try:
        loc_tz = pytz.timezone(tz_name)
    except Exception:
        loc_tz = pytz.UTC
        tz_name = "UTC"
    fecha_local = momento_aceptacion_utc.astimezone(loc_tz)
    ts_str = fecha_local.strftime("%d/%m/%Y %H:%M:%S")

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=0.65 * inch,
        rightMargin=0.65 * inch,
        topMargin=0.55 * inch,
        bottomMargin=0.55 * inch,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "HabeasTitle",
        parent=styles["Heading1"],
        fontSize=13,
        alignment=TA_CENTER,
        spaceAfter=10,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#0f172a"),
    )
    sub_center = ParagraphStyle(
        "HabeasSub",
        parent=styles["Normal"],
        fontSize=10,
        alignment=TA_CENTER,
        spaceAfter=4,
        fontName="Helvetica",
    )
    body = ParagraphStyle(
        "HabeasBody",
        parent=styles["Normal"],
        fontSize=9,
        alignment=TA_JUSTIFY,
        spaceAfter=8,
        leading=11,
        fontName="Helvetica",
    )
    body_bold = ParagraphStyle(
        "HabeasBodyBold",
        parent=body,
        fontName="Helvetica-Bold",
    )
    sec = ParagraphStyle(
        "HabeasSec",
        parent=styles["Normal"],
        fontSize=10,
        alignment=TA_LEFT,
        spaceBefore=10,
        spaceAfter=6,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#1e3a8a"),
    )
    small = ParagraphStyle(
        "HabeasSmall",
        parent=styles["Normal"],
        fontSize=8,
        alignment=TA_JUSTIFY,
        spaceAfter=6,
        leading=10,
        textColor=colors.HexColor("#475569"),
    )

    flowables: list = []

    tenant_logo_local_path = _resolve_tenant_logo_path(tenant_logo_url)
    tenant_logo_remote_buffer = _download_remote_logo(tenant_logo_url)
    fallback_logo_path = os.path.join(os.path.dirname(__file__), "logo_cda.png")

    logo_source = None
    if tenant_logo_local_path and os.path.exists(tenant_logo_local_path):
        logo_source = tenant_logo_local_path
    elif tenant_logo_remote_buffer:
        logo_source = tenant_logo_remote_buffer
    elif os.path.exists(fallback_logo_path):
        logo_source = fallback_logo_path

    if logo_source:
        try:
            logo = Image(logo_source, width=1.85 * inch, height=1.0 * inch, kind="proportional")
            logo.hAlign = "CENTER"
            flowables.append(logo)
            flowables.append(Spacer(1, 0.08 * inch))
        except Exception:
            # Logo dañado, formato no soportado por ReportLab (p. ej. algunos WEBP), etc.
            pass

    flowables.append(Paragraph("AUTORIZACIÓN PARA EL TRATAMIENTO DE DATOS PERSONALES", title_style))
    flowables.append(Paragraph(f"<b>{nc}</b>", sub_center))
    flowables.append(
        Paragraph(
            f"Responsable del Tratamiento: <b>{nc}</b>.<br/>"
            f"NIT: <b>{nit}</b><br/>"
            f"Correo para notificaciones: <b>{mail}</b>",
            sub_center,
        )
    )
    flowables.append(Spacer(1, 0.12 * inch))

    intro = (
        f"Yo, <b>{cn}</b>, identificado(a) con número de identificación <b>{cd}</b>, en mi condición de "
        f"titular de los datos personales y de los datos del vehículo de placa <b>{pl}</b>, actuando de manera "
        f"libre, previa, expresa e informada, <b>AUTORIZO</b> a {nc} para que, de conformidad con lo establecido "
        f"en la <b>Ley 1581 de 2012</b>, sus decretos reglamentarios (<b>Decreto 1074 de 2015</b>) y las demás "
        f"normas que la modifiquen o complementen, lleve a cabo el tratamiento de mis datos personales y los del "
        f"vehículo, incluyendo su recolección, almacenamiento, uso, circulación, actualización y supresión."
    )
    flowables.append(Paragraph(intro, body))

    flowables.append(Paragraph("1. FINALIDADES DEL TRATAMIENTO:", sec))
    flowables.append(
        Paragraph(
            f"La autorización se otorga para que {nc} pueda realizar las siguientes actividades, necesarias "
            f"para la prestación del servicio de Revisión Técnico-Mecánica:",
            body,
        )
    )
    fines = [
        "<b>Gestión del servicio:</b> Realizar la revisión técnico-mecánica y de emisiones contaminantes del "
        "vehículo, y generar el certificado correspondiente.",
        "<b>Registro ante autoridades:</b> Reportar la información de la revisión al Registro Único Nacional de "
        "Tránsito (RUNT) y a las demás autoridades de tránsito y transporte que lo requieran, como "
        "Supertransporte, de acuerdo con la normativa del sector.",
        "<b>Comunicaciones y recordatorios:</b> Enviar notificaciones sobre el resultado de la revisión, "
        "recordatorios de vencimiento de la misma y convocatorias para agendar nuevas citas.",
        "<b>Facturación y cobro:</b> Gestionar el pago y emitir la factura electrónica correspondiente.",
        "<b>Calidad y mejora continua:</b> Realizar encuestas de satisfacción para evaluar y mejorar nuestros "
        "servicios.",
        "<b>Cumplimiento legal:</b> Atender requerimientos de entidades de control y vigilancia, y gestionar "
        "procesos judiciales o administrativos.",
        "<b>Historial del vehículo:</b> Mantener un registro del historial de revisiones del vehículo para "
        "consultas futuras del titular.",
    ]
    for line in fines:
        flowables.append(Paragraph(f"• {line}", body))

    flowables.append(Paragraph("2. DATOS SUJETOS A TRATAMIENTO:", sec))
    flowables.append(
        Paragraph(
            "Los datos que serán tratados incluyen, pero no se limitan a:",
            body,
        )
    )
    datos = [
        "<b>Datos de identificación y contacto:</b> Nombres y apellidos completos, tipo y número de documento "
        "de identidad, dirección de residencia, correo electrónico, número(s) de teléfono fijo y/o celular.",
        "<b>Datos del vehículo:</b> Número de placa, número de tarjeta de propiedad, número de identificación "
        "vehicular (VIN/NIV), marca, línea, clase, modelo, color, y SOAT.",
        "<b>Historial del servicio:</b> Resultados de revisiones técnico-mecánicas anteriores y actuales.",
        "<b>Datos de transacción:</b> Información relacionada con los pagos y la facturación de los servicios "
        "prestados.",
    ]
    for line in datos:
        flowables.append(Paragraph(f"• {line}", body))

    flowables.append(Paragraph("3. DERECHOS DEL TITULAR:", sec))
    flowables.append(
        Paragraph(
            "Como titular de los datos, usted tiene los siguientes derechos, los cuales podrá ejercer en "
            "cualquier momento:",
            body,
        )
    )
    der = [
        "Conocer, actualizar y rectificar sus datos personales y los del vehículo.",
        "Solicitar prueba de la autorización otorgada.",
        f"Ser informado, previa solicitud, sobre el uso que {nc} le ha dado a sus datos.",
        f"Presentar consultas y reclamos ante {nc} o, en última instancia, ante la Superintendencia de "
        "Industria y Comercio (SIC).",
        "Revocar la autorización y/o solicitar la supresión de sus datos, siempre que no exista un deber "
        "legal o contractual que impida hacerlo.",
    ]
    for line in der:
        flowables.append(Paragraph(f"• {line}", body))

    flowables.append(Paragraph("4. CANALES PARA EJERCER SUS DERECHOS:", sec))
    flowables.append(
        Paragraph(
            "Para cualquier consulta, solicitud, reclamo o para conocer nuestra Política de Tratamiento de "
            "Datos Personales en su totalidad, puede contactarnos a través de los siguientes canales:",
            body,
        )
    )
    flowables.append(Paragraph(f"<b>Correo electrónico:</b> {mail}", body))
    flowables.append(Paragraph(f"<b>Teléfono/WhatsApp:</b> {cel}", body))
    flowables.append(Paragraph(f"<b>Dirección física:</b> {dir_f}", body))

    flowables.append(Paragraph("5. VIGENCIA:", sec))
    flowables.append(
        Paragraph(
            "La presente autorización tendrá una vigencia de diez (10) años, contados a partir de la fecha de "
            "su firma, o durante el tiempo que sea necesario para cumplir con las finalidades descritas y las "
            "obligaciones legales aplicables. Cumplido este plazo, sus datos serán eliminados de nuestras bases "
            "de datos de manera segura.",
            body,
        )
    )
    flowables.append(
        Paragraph(
            "Declaro que he leído y comprendido el presente documento, y otorgo mi consentimiento de manera "
            "libre y voluntaria.",
            body_bold,
        )
    )
    flowables.append(Spacer(1, 0.15 * inch))

    flowables.append(Paragraph("<b>CONSTANCIA DE ACEPTACIÓN ELECTRÓNICA</b>", sec))
    flowables.append(
        Paragraph(
            "En ausencia de firma autógrafa en soporte físico, la aceptación de la presente autorización queda "
            "acreditada mediante el registro electrónico del vehículo en recepción y el envío de este documento "
            "al correo del titular, con la fecha y hora indicadas a continuación (trazabilidad del sistema), "
            "conforme al uso de medios electrónicos y a las reglas aplicables al tratamiento de datos "
            "personales. Verifique con su asesor legal si requiere firma electrónica certificada u otro "
            "requisito adicional.",
            small,
        )
    )
    flowables.append(
        Paragraph(
            f"<b>Fecha y hora del registro:</b> {ts_str} ({tz_name})<br/>"
            f"<b>Placa:</b> {pl}<br/>"
            f"<b>Correo de notificación al titular:</b> {ce}",
            small,
        )
    )
    flowables.append(Spacer(1, 0.12 * inch))
    flowables.append(
        Paragraph(
            "______________________________<br/>"
            "<i>Firma (si aplica en versión impresa)</i><br/><br/>"
            f"<b>Nombre completo:</b> {cn}<br/>"
            f"<b>Documento de identidad:</b> {cd}<br/>"
            f"<b>Fecha:</b> {ts_str.split()[0] if ts_str else ''}",
            body,
        )
    )

    doc.build(flowables)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes
