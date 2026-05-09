from __future__ import annotations

from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse
from xml.sax.saxutils import escape as xml_escape

from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
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


def _safe_paragraph_text(value: object) -> str:
    return xml_escape(_safe_text(value))


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


def _cdasoft_logo_source() -> str | None:
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
    return Image(path, width=box_w, height=box_h, kind="proportional")


def _build_sources_display(*, source_urls: list[str], provider_label: str) -> list[str]:
    labels: list[str] = [provider_label]
    for raw in source_urls:
        url = (raw or "").strip()
        if not url:
            continue
        low = url.lower()
        if "ofac" in low and "OFAC (Sanctions Search)" not in labels:
            labels.append("OFAC (Sanctions Search)")
            continue
        if ("un.org" in low or "unitednations" in low) and "ONU (United Nations)" not in labels:
            labels.append("ONU (United Nations)")
            continue
        host = (urlparse(url).netloc or "").replace("www.", "").strip()
        if host:
            host_label = f"Fuente externa: {host}"
            if host_label not in labels:
                labels.append(host_label)
    return labels


def _result_label_by_risk(risk_level: str) -> str:
    lv = (risk_level or "").strip().lower()
    if lv == "rojo":
        return "RECHAZADO"
    if lv == "amarillo":
        return "REQUIERE INFORMACION ADICIONAL"
    return "FAVORABLE"


def _result_color_by_risk(risk_level: str):
    lv = (risk_level or "").strip().lower()
    if lv == "rojo":
        return colors.HexColor("#b91c1c")
    if lv == "amarillo":
        return colors.HexColor("#b45309")
    return colors.HexColor("#166534")


def _subject_type_label(subject_type: str) -> str:
    st = (subject_type or "").strip().lower()
    if st == "juridica":
        return "Persona jurídica"
    if st == "natural":
        return "Persona natural"
    return subject_type or "N/D"


def _qr_image_flowable(content: str, size: float = 1.05 * inch):
    qr = QrCodeWidget(content)
    bounds = qr.getBounds()
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    drawing = Drawing(size, size, transform=[size / width, 0, 0, size / height, 0, 0])
    drawing.add(qr)
    return drawing


def build_sarlaft_manual_certificate_pdf(
    *,
    tenant_nombre: str,
    tenant_nit: str | None,
    tenant_logo_url: str | None,
    certificate_code: str,
    verification_url: str,
    manual_check_id: str,
    fecha_consulta: datetime,
    fecha_emision: datetime,
    full_name: str,
    subject_type: str,
    doc_type: str | None,
    doc_number: str | None,
    email: str | None,
    phone: str | None,
    economic_activity: str | None,
    legal_representative: str | None,
    dataset: str,
    algorithm: str,
    risk_level: str,
    risk_score: float,
    hits_count: int,
    source_urls: list[str],
    performed_by_name: str,
    performed_by_role: str,
    pdf_sha256_hex: str | None = None,
    notes: str | None = None,
) -> BytesIO:
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        topMargin=0.5 * inch,
        bottomMargin=0.45 * inch,
        leftMargin=0.55 * inch,
        rightMargin=0.55 * inch,
    )
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "SarlaftTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=12.5,
        textColor=colors.HexColor("#0a1d3d"),
        alignment=TA_CENTER,
        spaceAfter=10,
    )
    heading_style = ParagraphStyle(
        "SarlaftHeading",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=11,
        textColor=colors.HexColor("#0a1d3d"),
        alignment=TA_CENTER,
        spaceBefore=10,
        spaceAfter=10,
    )
    paragraph_style = ParagraphStyle(
        "SarlaftParagraph",
        parent=styles["Normal"],
        fontSize=9,
        leading=13,
        textColor=colors.black,
        alignment=TA_JUSTIFY,
        spaceAfter=9,
    )
    subtitle_style = ParagraphStyle(
        "SarlaftSubtitle",
        parent=styles["Normal"],
        fontSize=9.5,
        textColor=colors.HexColor("#334155"),
        alignment=TA_CENTER,
        spaceAfter=12,
    )
    label_style = ParagraphStyle(
        "SarlaftLabelCell",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.5,
        textColor=colors.HexColor("#0a1d3d"),
        alignment=TA_LEFT,
    )
    value_style = ParagraphStyle(
        "SarlaftValueCell",
        parent=styles["Normal"],
        fontSize=9,
        textColor=colors.black,
        alignment=TA_LEFT,
        leading=12,
    )
    footer_style = ParagraphStyle(
        "SarlaftFooter",
        parent=styles["Normal"],
        fontSize=8,
        textColor=colors.HexColor("#64748b"),
        alignment=TA_CENTER,
    )
    mono_style = ParagraphStyle(
        "SarlaftMono",
        parent=styles["Normal"],
        fontName="Courier",
        fontSize=7.5,
        leading=9.5,
        textColor=colors.HexColor("#334155"),
        alignment=TA_LEFT,
    )
    small_style = ParagraphStyle(
        "SarlaftSmall",
        parent=styles["Normal"],
        fontSize=8,
        textColor=colors.HexColor("#64748b"),
        alignment=TA_LEFT,
        leading=11,
    )

    elements: list = []

    # Encabezado de dos logos (homologado con certificación en cuenta)
    logo_box_w = 2.35 * inch
    logo_box_h = 1.05 * inch
    col_logo = 3.65 * inch
    tenant_logo = _logo_source(tenant_logo_url)
    cdasoft_logo = _cdasoft_logo_source()
    logo_left = (
        _logo_in_box(tenant_logo, logo_box_w, logo_box_h)
        if tenant_logo
        else Paragraph("<b>[Logo CDA]</b>", small_style)
    )
    logo_right = (
        _logo_in_box(cdasoft_logo, logo_box_w, logo_box_h)
        if cdasoft_logo
        else Paragraph("<b>CDASOFT</b><br/><font size='7'>PROMETHEUS TECH SAS</font>", small_style)
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
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    elements.append(logos_table)
    elements.append(Spacer(1, 0.08 * inch))

    tenant_name = _safe_paragraph_text((tenant_nombre or "").strip() or "CDASOFT")
    tenant_nit_display = _safe_paragraph_text((tenant_nit or "").strip() or "N/D")
    result_label = _safe_paragraph_text(_result_label_by_risk(risk_level))
    result_color = _result_color_by_risk(risk_level)
    issued_at_text = _safe_paragraph_text(fecha_emision.strftime("%d/%m/%Y %H:%M:%S"))
    consulted_at_text = _safe_paragraph_text(fecha_consulta.strftime("%d/%m/%Y %H:%M:%S"))
    subject_label = _safe_paragraph_text(_subject_type_label(subject_type))

    elements.append(Paragraph("SISTEMA INTEGRAL DE ADMINISTRACIÓN DE RIESGO - SARLAFT", title_style))
    elements.append(Paragraph("CERTIFICADO DE VALIDACIÓN DE CONTRAPARTE (PROVEEDORES)", heading_style))
    elements.append(Paragraph(f"{tenant_name} · NIT {tenant_nit_display}", subtitle_style))

    header_meta = Table(
        [
            [
                Paragraph("<b>NÚMERO DE CERTIFICADO:</b>", label_style),
                Paragraph(_safe_paragraph_text(certificate_code), value_style),
            ],
            [
                Paragraph("<b>FECHA DE EMISIÓN:</b>", label_style),
                Paragraph(
                    _safe_paragraph_text(
                        f"{fecha_emision.strftime('%d/%m/%Y')} | HORA: {fecha_emision.strftime('%H:%M')}"
                    ),
                    value_style,
                ),
            ],
        ],
        colWidths=[2.15 * inch, 4.8 * inch],
    )
    header_meta.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#94a3b8")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f8fafc")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    elements.append(header_meta)
    elements.append(Spacer(1, 0.12 * inch))

    elements.append(Paragraph("1. DATOS DEL PROVEEDOR EVALUADO", heading_style))
    elements.append(
        Paragraph(
            f"Por medio del presente documento se certifica la ejecución de una consulta SARLAFT "
            f"realizada en {tenant_name} para debida diligencia de contraparte.",
            paragraph_style,
        )
    )

    info_rows = [
        [Paragraph("ID consulta sistema", label_style), Paragraph(_safe_paragraph_text(manual_check_id), value_style)],
        [Paragraph("Fecha y hora consulta", label_style), Paragraph(consulted_at_text, value_style)],
        [Paragraph("Tipo de contraparte", label_style), Paragraph(subject_label, value_style)],
        [Paragraph("Razón Social/Nombre", label_style), Paragraph(_safe_paragraph_text(full_name), value_style)],
        [Paragraph("NIT / Documento", label_style), Paragraph(_safe_paragraph_text(f"{doc_type or 'N/D'} {doc_number or ''}".strip()), value_style)],
        [Paragraph("Actividad Económica", label_style), Paragraph(_safe_paragraph_text(economic_activity or "N/D"), value_style)],
        [Paragraph("Representante Legal", label_style), Paragraph(_safe_paragraph_text(legal_representative or "N/D"), value_style)],
        [Paragraph("Correo", label_style), Paragraph(_safe_paragraph_text(email or "N/D"), value_style)],
        [Paragraph("Celular", label_style), Paragraph(_safe_paragraph_text(phone or "N/D"), value_style)],
    ]
    if notes and notes.strip():
        info_rows.append([Paragraph("Observaciones", label_style), Paragraph(_safe_paragraph_text(notes.strip()), value_style)])
    info_rows.append([Paragraph("Dataset / algoritmo", label_style), Paragraph(_safe_paragraph_text(f"{dataset} / {algorithm}"), value_style)])
    info_rows.append([Paragraph("Nivel / score / hits", label_style), Paragraph(_safe_paragraph_text(f"{risk_level.upper()} / {risk_score:.2f} / {hits_count}"), value_style)])
    if pdf_sha256_hex:
        info_rows.append([Paragraph("Hash PDF SHA-256", label_style), Paragraph(_safe_paragraph_text(pdf_sha256_hex), value_style)])

    info_table = Table(info_rows, colWidths=[2.15 * inch, 4.8 * inch])
    info_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#94a3b8")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f8fafc")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    elements.append(info_table)
    elements.append(Spacer(1, 0.12 * inch))

    elements.append(Paragraph("2. RESULTADOS DE LA CONSULTA EN LISTAS RESTRICTIVAS", heading_style))
    elements.append(
        Paragraph(
            "Se informa que se ha realizado la consulta en las bases de datos disponibles para la prevención "
            "del Lavado de Activos y Financiación del Terrorismo, obteniendo el siguiente resultado:",
            paragraph_style,
        )
    )

    urls_low = [u.lower() for u in source_urls if isinstance(u, str)]
    has_ofac = any("ofac" in u for u in urls_low)
    has_un = any(("un.org" in u) or ("unitednations" in u) for u in urls_low)
    has_hits = hits_count > 0
    list_result_yes_no = "COINCIDENCIA" if has_hits else "SIN COINCIDENCIAS"
    ofac_result = "COINCIDENCIA" if has_ofac else ("SIN COINCIDENCIAS" if not has_hits else "SIN COINCIDENCIA DIRECTA")
    un_result = "COINCIDENCIA" if has_un else ("SIN COINCIDENCIAS" if not has_hits else "SIN COINCIDENCIA DIRECTA")

    sources = _build_sources_display(
        source_urls=source_urls,
        provider_label="OpenSanctions (API /match)",
    )
    other_sources = [s for s in sources if "OFAC" not in s and "ONU" not in s and "OpenSanctions" not in s]
    other_sources_text = ", ".join(other_sources) if other_sources else "N/D"

    lists_rows = [
        [Paragraph("Lista OFAC (Clinton)", label_style), Paragraph(_safe_paragraph_text(ofac_result), value_style)],
        [Paragraph("Lista ONU (Sanciones)", label_style), Paragraph(_safe_paragraph_text(un_result), value_style)],
        [
            Paragraph("Antecedentes de Policía/Procuraduría", label_style),
            Paragraph(" ", value_style),
        ],
        [Paragraph("Otras Listas Vinculantes", label_style), Paragraph(_safe_paragraph_text(other_sources_text), value_style)],
    ]
    lists_table = Table(lists_rows, colWidths=[2.55 * inch, 4.4 * inch])
    lists_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#94a3b8")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f8fafc")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    elements.append(lists_table)
    elements.append(Spacer(1, 0.12 * inch))

    elements.append(Paragraph("3. CONCEPTO TÉCNICO DE CUMPLIMIENTO", heading_style))
    favorable_mark = "X" if (risk_level or "").lower() == "verde" else " "
    rejected_mark = "X" if (risk_level or "").lower() == "rojo" else " "
    additional_mark = "X" if (risk_level or "").lower() == "amarillo" else " "
    concept_rows = [
        [
            Paragraph(
                _safe_paragraph_text(
                    f"[{favorable_mark}] FAVORABLE: No se encontraron vínculos con actividades delictivas. "
                    "La contraparte es apta para vinculación comercial."
                ),
                value_style,
            )
        ],
        [
            Paragraph(
                _safe_paragraph_text(
                    f"[{rejected_mark}] RECHAZADO: Se detectaron hallazgos críticos. "
                    "Se recomienda no vinculación según el Manual SARLAFT del CDA."
                ),
                value_style,
            )
        ],
        [
            Paragraph(
                _safe_paragraph_text(
                    f"[{additional_mark}] REQUERIMIENTO ADICIONAL: Se requiere ampliar información por coincidencia parcial."
                ),
                value_style,
            )
        ],
    ]
    concept_table = Table(concept_rows, colWidths=[6.95 * inch])
    concept_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#94a3b8")),
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    elements.append(concept_table)
    elements.append(Spacer(1, 0.1 * inch))

    # Resultado final destacado
    result_table = Table([[f"RESULTADO FINAL: {result_label}"]], colWidths=[6.95 * inch])
    result_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, 0), result_color),
                ("TEXTCOLOR", (0, 0), (0, 0), colors.white),
                ("FONTNAME", (0, 0), (0, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (0, 0), 10.5),
                ("ALIGN", (0, 0), (0, 0), "CENTER"),
                ("TOPPADDING", (0, 0), (0, 0), 7),
                ("BOTTOMPADDING", (0, 0), (0, 0), 7),
            ]
        )
    )
    elements.append(result_table)
    elements.append(Spacer(1, 0.12 * inch))

    elements.append(Paragraph("Fuentes consultadas", heading_style))
    sources = _build_sources_display(
        source_urls=source_urls,
        provider_label="OpenSanctions (API /match)",
    )
    source_text = _safe_paragraph_text(" ; ".join(sources))
    sources_table = Table(
        [
            [Paragraph("Fuentes consultadas", label_style)],
            [Paragraph(source_text, value_style)],
        ],
        colWidths=[6.95 * inch],
    )
    sources_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#94a3b8")),
                ("BACKGROUND", (0, 0), (0, 0), colors.HexColor("#e2e8f0")),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    elements.append(sources_table)
    elements.append(Spacer(1, 0.14 * inch))

    elements.append(Paragraph("Verificación pública", heading_style))
    qr = _qr_image_flowable(verification_url)
    verification_table = Table(
        [
            [qr, Paragraph(_safe_paragraph_text(verification_url), mono_style)],
            ["", Paragraph(_safe_paragraph_text(f"Código de verificación: {certificate_code}"), value_style)],
        ],
        colWidths=[1.2 * inch, 5.75 * inch],
    )
    verification_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#94a3b8")),
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    elements.append(verification_table)
    elements.append(Spacer(1, 0.14 * inch))

    elements.append(Paragraph("4. FIRMA Y RESPONSABILIDAD", heading_style))
    elements.append(
        Paragraph(
            f"Este documento ha sido generado automáticamente por el sistema {tenant_name} en cumplimiento de lo "
            "dispuesto en la Circular Única de la Superintendencia de Transporte (Título VI) y lo establecido "
            "en la Resolución 20213040044585 de 2021 del Ministerio de Transporte, bajo las funciones "
            "delegadas al Oficial de Cumplimiento.",
            paragraph_style,
        )
    )

    # Firma / responsable
    firma_table = Table(
        [
            ["_______________________________"],
            ["Responsable de Cumplimiento"],
            [_safe_paragraph_text(performed_by_name)],
        ],
        colWidths=[6.95 * inch],
    )
    firma_table.setStyle(
        TableStyle(
            [
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    elements.append(firma_table)
    elements.append(Spacer(1, 0.08 * inch))

    elements.append(
        Paragraph(
            "Documento generado automáticamente por CDASOFT para soporte de cumplimiento SARLAFT. "
            "Valide autenticidad usando el código de verificación y el enlace/QR incluidos.",
            footer_style,
        )
    )

    doc.build(elements)
    buffer.seek(0)
    return buffer
