"""
Generador de desprendible de nómina (PDF) con estilo CDASOFT.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from io import BytesIO
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.utils.comprobantes_caja import _download_remote_logo, _resolve_tenant_logo_path, _safe_text


def _fmt_cop(value: Decimal) -> str:
    return f"${float(value):,.0f}"


def build_nomina_desprendible_pdf(
    *,
    empleado_nombre: str,
    empleado_documento: str,
    periodo_label: str,
    salario_base: Decimal,
    total_devengos: Decimal,
    total_deducciones: Decimal,
    neto_pagar: Decimal,
    devengos: list[dict],
    deducciones: list[dict],
    tenant_logo_url: Optional[str] = None,
    nombre_comercial_cda: Optional[str] = None,
) -> BytesIO:
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        topMargin=0.42 * inch,
        bottomMargin=0.4 * inch,
        leftMargin=0.55 * inch,
        rightMargin=0.55 * inch,
    )
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "NominaTitle",
        parent=styles["Heading1"],
        fontSize=16,
        textColor=colors.HexColor("#0a1d3d"),
        alignment=TA_CENTER,
        spaceAfter=6,
        fontName="Helvetica-Bold",
    )
    subtitle_style = ParagraphStyle(
        "NominaSubTitle",
        parent=styles["Normal"],
        fontSize=10,
        textColor=colors.HexColor("#0a1d3d"),
        alignment=TA_CENTER,
        spaceAfter=10,
    )
    label_style = ParagraphStyle(
        "NominaLabel",
        parent=styles["Normal"],
        fontSize=9,
        textColor=colors.HexColor("#0a1d3d"),
        fontName="Helvetica-Bold",
        alignment=TA_LEFT,
    )
    text_style = ParagraphStyle(
        "NominaText",
        parent=styles["Normal"],
        fontSize=9,
        textColor=colors.black,
        alignment=TA_LEFT,
    )

    elements = []

    tenant_logo_local_path = _resolve_tenant_logo_path(tenant_logo_url)
    tenant_logo_remote_buffer = _download_remote_logo(tenant_logo_url)
    logo_source = tenant_logo_local_path or tenant_logo_remote_buffer

    if logo_source:
        logo = Image(logo_source, width=1.35 * inch, height=0.95 * inch, kind="proportional")
        logo.hAlign = "CENTER"
        elements.append(logo)
        elements.append(Spacer(1, 0.06 * inch))

    elements.append(Paragraph("DESPRENDIBLE DE NÓMINA", title_style))
    elements.append(Paragraph(_safe_text((nombre_comercial_cda or "").strip() or "CDASOFT"), subtitle_style))
    elements.append(Spacer(1, 0.07 * inch))

    info_data = [
        [Paragraph("Empleado", label_style), Paragraph(_safe_text(empleado_nombre), text_style)],
        [Paragraph("Documento", label_style), Paragraph(_safe_text(empleado_documento), text_style)],
        [Paragraph("Período", label_style), Paragraph(_safe_text(periodo_label), text_style)],
    ]
    info_table = Table(info_data, colWidths=[1.7 * inch, 4.8 * inch])
    info_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f0f4f8")),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    elements.append(info_table)
    elements.append(Spacer(1, 0.1 * inch))

    elements.append(Paragraph("DEVENGOS", label_style))
    dev_rows = [["Concepto", "Unidades", "Vr Unitario", "Total"]]
    if devengos:
        for d in devengos:
            dev_rows.append(
                [
                    _safe_text(d.get("concepto", "")),
                    str(d.get("unidades", "")),
                    _fmt_cop(Decimal(str(d.get("valor_unitario", 0)))),
                    _fmt_cop(Decimal(str(d.get("valor_total", 0)))),
                ]
            )
    else:
        dev_rows.append(["(Sin devengos en este período)", "-", "-", _fmt_cop(Decimal("0"))])
    dev_table = Table(dev_rows, colWidths=[3.1 * inch, 1.0 * inch, 1.2 * inch, 1.2 * inch])
    dev_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dcfce7")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
                ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    elements.append(dev_table)
    elements.append(Spacer(1, 0.08 * inch))

    elements.append(Paragraph("DEDUCCIONES", label_style))
    ded_rows = [["Concepto", "Unidades", "Vr Unitario", "Total"]]
    if deducciones:
        for d in deducciones:
            ded_rows.append(
                [
                    _safe_text(d.get("concepto", "")),
                    str(d.get("unidades", "")),
                    _fmt_cop(Decimal(str(d.get("valor_unitario", 0)))),
                    _fmt_cop(Decimal(str(d.get("valor_total", 0)))),
                ]
            )
    else:
        ded_rows.append(["(Sin deducciones en este período)", "-", "-", _fmt_cop(Decimal("0"))])
    ded_table = Table(ded_rows, colWidths=[3.1 * inch, 1.0 * inch, 1.2 * inch, 1.2 * inch])
    ded_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#fee2e2")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
                ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    elements.append(ded_table)
    elements.append(Spacer(1, 0.1 * inch))

    resumen_data = [
        ["Salario base", _fmt_cop(salario_base)],
        ["Total devengos", _fmt_cop(total_devengos)],
        ["Total deducciones", _fmt_cop(total_deducciones)],
        ["NETO A PAGAR", _fmt_cop(neto_pagar)],
    ]
    resumen = Table(resumen_data, colWidths=[3.8 * inch, 2.8 * inch])
    resumen.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.7, colors.HexColor("#cbd5e1")),
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
                ("BACKGROUND", (0, 0), (-1, -2), colors.HexColor("#f8fafc")),
                ("BACKGROUND", (0, 3), (-1, 3), colors.HexColor("#0a1d3d")),
                ("TEXTCOLOR", (0, 3), (-1, 3), colors.white),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    elements.append(resumen)
    elements.append(Spacer(1, 0.08 * inch))
    elements.append(
        Paragraph(
            f"Generado el {datetime.now().strftime('%d/%m/%Y %H:%M:%S')} por CDASOFT.",
            ParagraphStyle(
                "NominaFooter",
                parent=styles["Normal"],
                fontSize=8,
                textColor=colors.gray,
                alignment=TA_CENTER,
            ),
        )
    )

    doc.build(elements)
    buffer.seek(0)
    return buffer
