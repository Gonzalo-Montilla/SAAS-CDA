from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Optional
from xml.sax.saxutils import escape as xml_escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.utils.comprobantes_caja import (
    _download_remote_logo,
    _resolve_tenant_logo_path,
    _safe_text,
)


@dataclass
class CertificacionDocumentoItem:
    identificacion: str
    titulo: str
    nombre_archivo: str
    version: str
    fecha_ultima_modificacion: str
    hash_sha256: str | None = None


def _logo_source(tenant_logo_url: Optional[str]):
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


def _safe_paragraph_text(value: object) -> str:
    # ReportLab Paragraph interpreta XML-like tags; escapamos contenido dinámico.
    return xml_escape(_safe_text(value))


def _href_xml_attr(url: str) -> str:
    """Valor seguro para atributo href en Paragraph (incluye & → &amp;)."""
    return xml_escape((url or "").strip(), {'"': "&quot;", "'": "&apos;"})


def _cdasoft_logo_source() -> str | None:
    # Permite personalizar el logo corporativo de CDASOFT si está presente.
    candidates = [
        Path(__file__).resolve().parent / "logo_cdasoft.png",
        Path(__file__).resolve().parent / "cdasoft_logo.png",
        Path(__file__).resolve().parent / "LOGO_CDA_SOFT-SIN FONDO.png",
    ]
    for p in candidates:
        if p.is_file():
            return str(p)
    return None


def _logo_in_box(path: str, box_w: float, box_h: float) -> Image:
    """Misma caja para ambos logos: escala proporcional y alineación uniforme."""
    return Image(path, width=box_w, height=box_h, kind="proportional")


def _sello_electronico_hex(*, tenant_slug: str, codigo_verificacion: str, fecha_emision_iso: str) -> str:
    payload = f"CDASOFT|CERT|{tenant_slug}|{codigo_verificacion}|{fecha_emision_iso}"
    h = hashlib.sha256(payload.encode("utf-8")).hexdigest().upper()
    return "-".join(h[i : i + 8] for i in range(0, 32, 8))


def generar_certificacion_en_cuenta_pdf(
    *,
    tenant_nombre: str,
    tenant_nit: str | None,
    tenant_slug: str,
    fecha_emision: datetime,
    codigo_verificacion: str,
    documentos: list[CertificacionDocumentoItem],
    usuario_emisor: str | None,
    tenant_logo_url: str | None = None,
    incluir_hash: bool = True,
    ciudad_emision: str | None = None,
    verification_url: str | None = None,
    format_version: str = "v1.0",
) -> BytesIO:
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        topMargin=0.55 * inch,
        bottomMargin=0.5 * inch,
        leftMargin=0.6 * inch,
        rightMargin=0.6 * inch,
    )
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "CertTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=12.5,
        textColor=colors.HexColor("#0a1d3d"),
        alignment=TA_CENTER,
        spaceBefore=4,
        spaceAfter=14,
    )
    heading_style = ParagraphStyle(
        "CertHeading",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=11,
        textColor=colors.HexColor("#0a1d3d"),
        alignment=TA_CENTER,
        spaceBefore=16,
        spaceAfter=14,
    )
    paragraph_style = ParagraphStyle(
        "CertParagraph",
        parent=styles["Normal"],
        fontSize=9,
        leading=14,
        textColor=colors.black,
        alignment=TA_JUSTIFY,
        spaceAfter=10,
    )
    saludo_style = ParagraphStyle(
        "CertSaludo",
        parent=styles["Normal"],
        fontSize=9.5,
        alignment=TA_LEFT,
        spaceBefore=4,
        spaceAfter=12,
    )
    intro_paragraph_style = ParagraphStyle(
        "CertIntroParagraph",
        parent=styles["Normal"],
        fontSize=9,
        leading=14,
        textColor=colors.black,
        alignment=TA_JUSTIFY,
        spaceAfter=14,
    )
    small_label_style = ParagraphStyle(
        "CertSmallLabel",
        parent=styles["Normal"],
        fontSize=8,
        textColor=colors.HexColor("#64748b"),
        alignment=TA_LEFT,
        leading=11,
        spaceAfter=6,
    )
    small_label_last_style = ParagraphStyle(
        "CertSmallLabelLast",
        parent=small_label_style,
        spaceAfter=0,
    )
    sello_style = ParagraphStyle(
        "CertSello",
        parent=styles["Normal"],
        fontName="Courier",
        fontSize=7.5,
        textColor=colors.HexColor("#334155"),
        alignment=TA_LEFT,
        leading=10,
        spaceAfter=4,
    )
    table_cell_style = ParagraphStyle(
        "CertTableCell",
        parent=styles["Normal"],
        fontSize=8,
        leading=10.5,
        textColor=colors.black,
        alignment=TA_LEFT,
    )
    table_cell_center_style = ParagraphStyle(
        "CertTableCellCenter",
        parent=table_cell_style,
        alignment=TA_CENTER,
    )

    elements: list = []

    # Logos: misma caja (ancho/alto máx.) y centrados verticalmente en la fila.
    logo_box_w = 2.35 * inch
    logo_box_h = 1.05 * inch
    # Ancho útil carta con márgenes 0.6: 8.5 - 1.2 = 7.3 → dos columnas iguales
    col_logo = 3.65 * inch
    tenant_logo = _logo_source(tenant_logo_url)
    cdasoft_logo = _cdasoft_logo_source()
    logo_left = (
        _logo_in_box(tenant_logo, logo_box_w, logo_box_h)
        if tenant_logo
        else Paragraph("<b>[Logo CDA]</b>", small_label_style)
    )
    logo_right = (
        _logo_in_box(cdasoft_logo, logo_box_w, logo_box_h)
        if cdasoft_logo
        else Paragraph("<b>CDASOFT</b><br/><font size='7'>PROMETHEUS TECH SAS</font>", small_label_style)
    )
    logos_table = Table([[logo_left, logo_right]], colWidths=[col_logo, col_logo], rowHeights=[logo_box_h + 0.08 * inch])
    logos_table.setStyle(
        TableStyle(
            [
                ("ALIGN", (0, 0), (0, 0), "LEFT"),
                ("ALIGN", (1, 0), (1, 0), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    elements.append(logos_table)
    elements.append(Spacer(1, 0.14 * inch))

    tenant_display = _safe_text((tenant_nombre or "").strip() or "CDASOFT")
    nit_display = _safe_text((tenant_nit or "").strip() or "N/D")
    tenant_display_xml = _safe_paragraph_text(tenant_display)
    nit_display_xml = _safe_paragraph_text(nit_display)
    fecha_display = fecha_emision.strftime("%d/%m/%Y %H:%M:%S")
    usuario_display = _safe_text((usuario_emisor or "").strip() or "Sistema")
    usuario_display_xml = _safe_paragraph_text(usuario_display)
    tenant_slug_xml = _safe_paragraph_text(tenant_slug)
    codigo_verificacion_xml = _safe_paragraph_text(codigo_verificacion)
    verification_url_raw = (verification_url or "").strip() or "N/D"
    verification_url_xml = _safe_paragraph_text(verification_url_raw)
    verification_href = _href_xml_attr(verification_url_raw) if verification_url_raw != "N/D" else ""
    format_version_xml = _safe_paragraph_text((format_version or "").strip() or "v1.0")
    fecha_simple = fecha_emision.strftime("%d/%m/%Y")
    dia = fecha_emision.strftime("%d")
    anio = fecha_emision.strftime("%Y")
    mes = {
        1: "enero",
        2: "febrero",
        3: "marzo",
        4: "abril",
        5: "mayo",
        6: "junio",
        7: "julio",
        8: "agosto",
        9: "septiembre",
        10: "octubre",
        11: "noviembre",
        12: "diciembre",
    }[fecha_emision.month]
    ciudad_raw = (ciudad_emision or "").strip()
    ciudad = ciudad_raw if ciudad_raw else "N/D"

    elements.append(
        Paragraph(
            "Certificación de Documentos Almacenados en el Sistema de Control de Versiones CDASOFT",
            title_style,
        )
    )
    elements.append(Spacer(1, 0.06 * inch))
    elements.append(Paragraph("A quien corresponda,", saludo_style))
    elements.append(
        Paragraph(
            "Por medio de la presente, el Sistema de Gestión Documental y Control de Versiones "
            "(en adelante, \"el Sistema\"), identificado como CDASOFT, perteneciente a PROMETHEUS TECH SAS, "
            "y en cumplimiento de las políticas de integridad, trazabilidad y custodia de la información,",
            intro_paragraph_style,
        )
    )
    elements.append(Paragraph("CERTIFICA", heading_style))

    body = (
        f"Que, con base en la solicitud formulada por el titular de la cuenta <b>{tenant_display_xml}</b>, "
        f"identificado con NIT <b>{nit_display_xml}</b>, a fecha <b>{fecha_simple}</b>, y previa verificación de los "
        "registros internos de almacenamiento, se confirma la existencia de los documentos que a continuación "
        "se detallan, los cuales se encuentran bajo el esquema de control por nombre, identificación única y "
        "número de versión, según se indica:"
    )
    elements.append(Paragraph(body, paragraph_style))
    elements.append(Spacer(1, 0.12 * inch))

    headers = [
        "Nombre documento",
        "Identificador único",
        "Versión",
        "Última modificación",
        "Hash / Integridad (opcional)" if incluir_hash else "Integridad",
    ]

    rows = [headers]
    for d in documentos:
        row = [
            Paragraph(_safe_paragraph_text(d.titulo), table_cell_style),
            Paragraph(_safe_paragraph_text(d.identificacion), table_cell_style),
            Paragraph(_safe_paragraph_text(d.version), table_cell_center_style),
            Paragraph(_safe_paragraph_text(d.fecha_ultima_modificacion), table_cell_center_style),
            Paragraph(_safe_paragraph_text(d.hash_sha256 or "N/D"), table_cell_style),
        ]
        rows.append(row)

    col_widths = [1.65 * inch, 1.35 * inch, 0.75 * inch, 1.35 * inch, 1.5 * inch]

    table = Table(rows, repeatRows=1, colWidths=col_widths)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e2e8f0")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, 0), 8),
                ("ALIGN", (0, 0), (-1, 0), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#94a3b8")),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    elements.append(table)
    elements.append(Spacer(1, 0.2 * inch))

    elements.append(
        Paragraph(
            f"La presente certificación acredita que los documentos referidos se hallan almacenados en el "
            f"repositorio oficial <b>{tenant_display_xml}</b> a la fecha de emisión, conservando su integridad, "
            "autoría y secuencia de versiones, de acuerdo con las políticas de retención y seguridad vigentes.",
            paragraph_style,
        )
    )
    elements.append(
        Paragraph(
            "Esta certificación es expedida a solicitud de parte interesada y tendrá validez únicamente para "
            "los fines informativos y de consulta expresamente requeridos por el titular de la cuenta. "
            "Ni CDASOFT ni PROMETHEUS TECH SAS se hacen responsables del uso que se dé a la información aquí "
            "contenida, ni de la interpretación que terceros pudieran realizar.",
            paragraph_style,
        )
    )
    elements.append(
        Paragraph(
            f"Se extiende la presente en { _safe_paragraph_text(ciudad) }, a los {dia} días del mes de {mes} de {anio}.",
            paragraph_style,
        )
    )
    elements.append(Spacer(1, 0.16 * inch))
    elements.append(Paragraph("Atentamente,", paragraph_style))
    elements.append(Spacer(1, 0.14 * inch))
    sello_hex = _sello_electronico_hex(
        tenant_slug=tenant_slug,
        codigo_verificacion=codigo_verificacion,
        fecha_emision_iso=fecha_emision.isoformat(),
    )
    sello_xml = _safe_paragraph_text(sello_hex)
    elements.append(
        Paragraph(
            f"<b>Sello electrónico (identificador derivado):</b> {sello_xml}",
            sello_style,
        )
    )
    elements.append(Paragraph("Sistema de Control de Versiones CDASOFT", small_label_style))
    elements.append(Spacer(1, 0.2 * inch))
    elements.append(
        Paragraph(
            "Nota: Este documento es una certificación automatizada generada por el módulo de certificación en cuenta.",
            small_label_style,
        )
    )
    elements.append(Spacer(1, 0.04 * inch))
    if verification_href:
        verif_phrase = (
            "Verificación en línea: use el botón o enlace "
            f'<a href="{verification_href}" color="#1d4ed8"><b>Abrir página de comprobación</b></a>. '
            "Al hacer clic, el lector PDF abre la URL completa (evita cortes al copiar el texto). "
            f"Para copiar manualmente: <font name=\"Courier\" size=\"7.5\">{verification_url_xml}</font>. "
            f"Código de verificación: <b>{codigo_verificacion_xml}</b>. "
            "Compare el sello de este documento con el mostrado en la página."
        )
    else:
        verif_phrase = (
            f"Verificación en línea: (URL no configurada). Código: <b>{codigo_verificacion_xml}</b>."
        )
    elements.append(Paragraph(verif_phrase, small_label_style))

    table_footer_line = Table([[""]], colWidths=[6.6 * inch])
    table_footer_line.setStyle(
        TableStyle(
            [
                ("LINEABOVE", (0, 0), (0, 0), 0.6, colors.HexColor("#cbd5e1")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("TOPPADDING", (0, 0), (0, 0), 12),
                ("BOTTOMPADDING", (0, 0), (0, 0), 4),
            ]
        )
    )
    elements.append(table_footer_line)
    elements.append(Spacer(1, 0.06 * inch))
    elements.append(
        Paragraph(
            f"Emitido por: {tenant_slug_xml} | Usuario emisor: {usuario_display_xml} | Fecha y hora: {fecha_display} | Formato: {format_version_xml}",
            small_label_last_style,
        )
    )

    doc.build(elements)
    buffer.seek(0)
    return buffer
