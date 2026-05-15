from __future__ import annotations

from datetime import datetime
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse
from xml.sax.saxutils import escape as xml_escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.utils.comprobantes_caja import _download_remote_logo, _resolve_tenant_logo_path, _safe_text


def _safe_paragraph_text(value: object) -> str:
    return xml_escape(_safe_text(value))


def _logo_source(tenant_logo_url: str | None):
    tenant_logo_local_path = _resolve_tenant_logo_path(tenant_logo_url)
    tenant_logo_remote_buffer = _download_remote_logo(tenant_logo_url)
    fallback_logo_path = Path(__file__).resolve().parent / "logo_cda.png"

    if tenant_logo_local_path and Path(tenant_logo_local_path).is_file():
        return tenant_logo_local_path
    if tenant_logo_remote_buffer:
        return tenant_logo_remote_buffer
    if fallback_logo_path.is_file():
        return str(fallback_logo_path)
    return None


def _format_datetime(value: datetime | None) -> str:
    if not value:
        return "N/D"
    return value.strftime("%d/%m/%Y %H:%M:%S")


def _parse_host(url_value: str | None) -> str:
    value = (url_value or "").strip()
    if not value:
        return "N/D"
    try:
        host = (urlparse(value).netloc or "").replace("www.", "").strip()
        return host or value
    except Exception:
        return value


def build_sarlaft_expediente_template_pdf(
    *,
    tenant_nombre: str,
    tenant_nit: str | None,
    tenant_logo_url: str | None,
    case_id: str,
    operacion_ref: str,
    case_status: str,
    risk_level: str,
    risk_score: float,
    created_at: datetime | None,
    transaction_amount_cop: float,
    cash_amount_cop: float,
    payment_method: str,
    cliente_nombre: str | None,
    cliente_documento: str | None,
    operation_classification: str | None,
    rule_code: str | None,
    alert_reason: str | None,
    funds_source_declaration: str | None,
    economic_activity_support: str | None,
    cashier_interview: str | None,
    support_refs: list[str],
    official_notes: str | None,
    pre_ros_text: str,
    generated_by: str,
    generated_at: datetime | None = None,
) -> BytesIO:
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        topMargin=0.5 * inch,
        bottomMargin=0.5 * inch,
        leftMargin=0.55 * inch,
        rightMargin=0.55 * inch,
    )
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "ExpedienteTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=13,
        textColor=colors.HexColor("#0a1d3d"),
        alignment=TA_CENTER,
        spaceAfter=8,
    )
    subtitle_style = ParagraphStyle(
        "ExpedienteSubtitle",
        parent=styles["Normal"],
        fontSize=9,
        textColor=colors.HexColor("#334155"),
        alignment=TA_CENTER,
        spaceAfter=10,
    )
    section_style = ParagraphStyle(
        "ExpedienteSection",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=9.5,
        textColor=colors.HexColor("#0f172a"),
        alignment=TA_LEFT,
        spaceBefore=10,
        spaceAfter=6,
    )
    label_style = ParagraphStyle(
        "ExpedienteLabel",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.5,
        textColor=colors.HexColor("#0a1d3d"),
        alignment=TA_LEFT,
    )
    value_style = ParagraphStyle(
        "ExpedienteValue",
        parent=styles["Normal"],
        fontSize=8.8,
        textColor=colors.black,
        leading=11.5,
        alignment=TA_LEFT,
    )
    mono_style = ParagraphStyle(
        "ExpedienteMono",
        parent=styles["Normal"],
        fontName="Courier",
        fontSize=7.6,
        leading=9.2,
        textColor=colors.HexColor("#334155"),
        alignment=TA_LEFT,
    )
    footer_style = ParagraphStyle(
        "ExpedienteFooter",
        parent=styles["Normal"],
        fontSize=8,
        textColor=colors.HexColor("#64748b"),
        alignment=TA_CENTER,
    )

    elements: list = []

    tenant_logo = _logo_source(tenant_logo_url)
    if tenant_logo:
        logo = Image(tenant_logo, width=2.2 * inch, height=0.95 * inch, kind="proportional")
        logo_table = Table([[logo]], colWidths=[6.95 * inch])
        logo_table.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "LEFT"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
        elements.append(logo_table)
        elements.append(Spacer(1, 0.04 * inch))

    tenant_name = _safe_paragraph_text((tenant_nombre or "").strip() or "CDASOFT")
    tenant_nit_safe = _safe_paragraph_text((tenant_nit or "").strip() or "N/D")
    generated_at_safe = _safe_paragraph_text(_format_datetime(generated_at or datetime.utcnow()))

    elements.append(Paragraph("PLANTILLA DE EXPEDIENTE ROS - SARLAFT", title_style))
    elements.append(Paragraph(f"{tenant_name} · NIT {tenant_nit_safe}", subtitle_style))
    elements.append(Paragraph(f"Generado por: {_safe_paragraph_text(generated_by)} · Fecha: {generated_at_safe}", subtitle_style))

    info_rows = [
        [Paragraph("ID caso", label_style), Paragraph(_safe_paragraph_text(case_id), value_style)],
        [Paragraph("Operacion", label_style), Paragraph(_safe_paragraph_text(operacion_ref), value_style)],
        [Paragraph("Estado", label_style), Paragraph(_safe_paragraph_text(case_status), value_style)],
        [Paragraph("Riesgo / score", label_style), Paragraph(_safe_paragraph_text(f"{risk_level} / {risk_score:.2f}"), value_style)],
        [Paragraph("Fecha caso", label_style), Paragraph(_safe_paragraph_text(_format_datetime(created_at)), value_style)],
        [Paragraph("Monto operacion", label_style), Paragraph(_safe_paragraph_text(f"COP {transaction_amount_cop:,.2f}"), value_style)],
        [Paragraph("Monto efectivo", label_style), Paragraph(_safe_paragraph_text(f"COP {cash_amount_cop:,.2f}"), value_style)],
        [Paragraph("Metodo pago", label_style), Paragraph(_safe_paragraph_text(payment_method), value_style)],
        [Paragraph("Cliente", label_style), Paragraph(_safe_paragraph_text(cliente_nombre or "N/D"), value_style)],
        [Paragraph("Documento", label_style), Paragraph(_safe_paragraph_text(cliente_documento or "N/D"), value_style)],
    ]
    info_table = Table(info_rows, colWidths=[2.1 * inch, 4.85 * inch])
    info_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.45, colors.HexColor("#94a3b8")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f8fafc")),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    elements.append(info_table)

    elements.append(Paragraph("MOTIVO DE SOSPECHA", section_style))
    motive_rows = [
        [Paragraph("Clasificacion operacion", label_style), Paragraph(_safe_paragraph_text(operation_classification or "N/D"), value_style)],
        [Paragraph("Regla interna", label_style), Paragraph(_safe_paragraph_text(rule_code or "N/D"), value_style)],
        [Paragraph("Motivo alerta", label_style), Paragraph(_safe_paragraph_text(alert_reason or "N/D"), value_style)],
    ]
    motive_table = Table(motive_rows, colWidths=[2.1 * inch, 4.85 * inch])
    motive_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.45, colors.HexColor("#94a3b8")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f8fafc")),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    elements.append(motive_table)

    elements.append(Paragraph("DDI Y SOPORTES", section_style))
    refs_display = ", ".join([r for r in support_refs if (r or "").strip()]) or "N/D"
    ddi_rows = [
        [Paragraph("Origen fondos", label_style), Paragraph(_safe_paragraph_text(funds_source_declaration or "N/D"), value_style)],
        [Paragraph("Soporte actividad", label_style), Paragraph(_safe_paragraph_text(economic_activity_support or "N/D"), value_style)],
        [Paragraph("Entrevista cajero", label_style), Paragraph(_safe_paragraph_text(cashier_interview or "N/D"), value_style)],
        [Paragraph("Referencias", label_style), Paragraph(_safe_paragraph_text(refs_display), value_style)],
        [Paragraph("Notas oficial", label_style), Paragraph(_safe_paragraph_text(official_notes or "N/D"), value_style)],
    ]
    ddi_table = Table(ddi_rows, colWidths=[2.1 * inch, 4.85 * inch])
    ddi_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.45, colors.HexColor("#94a3b8")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f8fafc")),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    elements.append(ddi_table)

    elements.append(Paragraph("PRE-ROS (BORRADOR OPERATIVO)", section_style))
    elements.append(Paragraph(_safe_paragraph_text(pre_ros_text or "N/D").replace("\n", "<br/>"), mono_style))
    elements.append(Spacer(1, 0.08 * inch))
    elements.append(
        Paragraph(
            "Sugerencia de archivo documental: 01_identificacion_caso.pdf, 02_ddi_formulario.pdf, "
            "03_soportes_cliente/, 04_pre_ros.txt, 05_ros_sirel_constancia.pdf, 06_acta_cierre_interno.pdf",
            value_style,
        )
    )
    elements.append(Spacer(1, 0.12 * inch))
    elements.append(
        Paragraph(
            "Documento de apoyo interno para cumplimiento SARLAFT. El reporte oficial debe radicarse en SIREL/UIAF.",
            footer_style,
        )
    )
    elements.append(Paragraph(f"Dominio evidencia recomendado: {_safe_paragraph_text(_parse_host(tenant_logo_url))}", footer_style))

    doc.build(elements)
    buffer.seek(0)
    return buffer
