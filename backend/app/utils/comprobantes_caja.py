"""
Utilidad para generar comprobantes de cierre de caja en PDF
"""
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from io import BytesIO
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional
import os
from pathlib import Path
from urllib.parse import urlparse

from app.core.config import settings


def _safe_text(value: object) -> str:
    """
    Normaliza texto para fuentes PDF estándar (WinAnsi/cp1252).
    Evita que caracteres fuera de soporte (ej. emoji) rompan la generación.
    """
    if value is None:
        return ""
    return str(value).encode("cp1252", errors="replace").decode("cp1252")


def _resolve_tenant_logo_path(tenant_logo_url: Optional[str]) -> Optional[str]:
    """
    Resuelve la ruta local del logo del tenant cuando viene en formato URL pública.
    Soporta URLs tipo /uploads/... mapeadas al filesystem local.
    """
    if not tenant_logo_url:
        return None

    raw = str(tenant_logo_url).strip()
    if not raw:
        return None

    # Caso 1: ruta absoluta local
    direct_path = Path(raw)
    if direct_path.is_file():
        return str(direct_path)

    uploads_root = Path(settings.TENANT_LOGO_UPLOAD_DIR).resolve().parent

    # Caso 2: URL pública servida por /uploads
    if raw.startswith("/uploads/"):
        rel = raw[len("/uploads/"):]
        candidate = uploads_root / rel
        if candidate.is_file():
            return str(candidate)

    # Caso 2b: URL absoluta (http/https) apuntando a /uploads/...
    if raw.startswith("http://") or raw.startswith("https://"):
        parsed = urlparse(raw)
        path = parsed.path or ""
        if path.startswith("/uploads/"):
            rel = path[len("/uploads/"):]
            candidate = uploads_root / rel
            if candidate.is_file():
                return str(candidate)

    # Caso 3: ruta relativa tipo uploads/tenant-logos/...
    if raw.startswith("uploads/"):
        candidate = Path(raw).resolve()
        if candidate.is_file():
            return str(candidate)

    return None


def generar_comprobante_cierre_caja(
    caja_id: str,
    cajero_nombre: str,
    turno: str,
    fecha_apertura: datetime,
    fecha_cierre: datetime,
    monto_inicial: Decimal,
    total_ingresos_efectivo: Decimal,
    total_egresos: Decimal,
    saldo_esperado: Decimal,
    monto_final_fisico: Decimal,
    diferencia: Decimal,
    desglose_efectivo: dict,
    observaciones: Optional[str] = None,
    vehiculos_cobrados: int = 0,
    total_rtm: Decimal = Decimal(0),
    total_soat: Decimal = Decimal(0),
    total_efectivo: Decimal = Decimal(0),
    total_tarjeta_debito: Decimal = Decimal(0),
    total_tarjeta_credito: Decimal = Decimal(0),
    total_transferencia: Decimal = Decimal(0),
    total_credismart: Decimal = Decimal(0),
    total_sistecredito: Decimal = Decimal(0),
    tenant_logo_url: Optional[str] = None,
) -> BytesIO:
    """
    Genera un comprobante de cierre de caja en PDF
    
    Args:
        caja_id: ID de la caja
        cajero_nombre: Nombre del cajero
        turno: Turno de trabajo
        fecha_apertura: Fecha/hora de apertura
        fecha_cierre: Fecha/hora de cierre
        monto_inicial: Monto con que se abrió la caja
        total_ingresos_efectivo: Total de ingresos en efectivo
        total_egresos: Total de egresos
        saldo_esperado: Saldo calculado por el sistema
        monto_final_fisico: Monto contado físicamente
        diferencia: Diferencia entre físico y esperado
        desglose_efectivo: Desglose de billetes/monedas
        observaciones: Observaciones opcionales
        vehiculos_cobrados: Cantidad de vehículos cobrados
        total_rtm: Total de RTM cobrados
        total_soat: Total de comisiones SOAT
        total_efectivo: Total cobrado en efectivo
        total_tarjeta_debito: Total cobrado con tarjeta débito
        total_tarjeta_credito: Total cobrado con tarjeta crédito
        total_transferencia: Total cobrado por transferencia
        total_credismart: Total de créditos CrediSmart
        total_sistecredito: Total de créditos SisteCredito
    
    Returns:
        BytesIO con el PDF generado
    """
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=0.3*inch, bottomMargin=0.3*inch, leftMargin=0.5*inch, rightMargin=0.5*inch)
    
    # Convertir fechas UTC a hora de Colombia (UTC-5)
    colombia_offset = timedelta(hours=-5)
    fecha_apertura_local = fecha_apertura + colombia_offset
    fecha_cierre_local = fecha_cierre + colombia_offset
    fecha_generacion_local = datetime.utcnow() + colombia_offset
    
    # Estilos compactos
    styles = getSampleStyleSheet()
    
    titulo_style = ParagraphStyle(
        'TituloComprobante',
        parent=styles['Heading1'],
        fontSize=14,
        textColor=colors.HexColor('#0a1d3d'),
        alignment=TA_CENTER,
        spaceAfter=6,
        fontName='Helvetica-Bold'
    )
    
    subtitulo_style = ParagraphStyle(
        'SubtituloComprobante',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.HexColor('#0a1d3d'),
        alignment=TA_CENTER,
        spaceAfter=8
    )
    
    label_style = ParagraphStyle(
        'Label',
        parent=styles['Normal'],
        fontSize=9,
        textColor=colors.gray,
        fontName='Helvetica-Bold'
    )
    
    seccion_style = ParagraphStyle(
        'Seccion',
        parent=styles['Heading2'],
        fontSize=10,
        textColor=colors.HexColor('#0a1d3d'),
        fontName='Helvetica-Bold',
        spaceAfter=4
    )
    
    # Elementos del documento
    elementos = []
    
    # Logo: priorizar tenant actual; fallback al heredado local.
    logo_path = _resolve_tenant_logo_path(tenant_logo_url)
    if not logo_path:
        logo_path = os.path.join(os.path.dirname(__file__), 'logo_cda.png')
    if os.path.exists(logo_path):
        # Aumentar el área máxima del logo manteniendo proporción.
        logo = Image(logo_path, width=1.9*inch, height=1.1*inch, kind='proportional')
        logo.hAlign = 'CENTER'
        elementos.append(logo)
        elementos.append(Spacer(1, 0.05*inch))
    
    cajero_nombre_safe = _safe_text(cajero_nombre)
    observaciones_safe = _safe_text(observaciones) if observaciones else None

    # Encabezado compacto
    elementos.append(Paragraph("COMPROBANTE DE CIERRE DE CAJA", titulo_style))
    elementos.append(Spacer(1, 0.1*inch))
    
    # Información de la caja
    turnos_map = {
        'mañana': 'Mañana',
        'tarde': 'Tarde',
        'noche': 'Noche'
    }
    
    info_data = [
        ["Cajero:", cajero_nombre_safe, "Turno:", turnos_map.get(turno, turno)],
        ["Apertura:", fecha_apertura_local.strftime("%d/%m/%Y %H:%M"), "Cierre:", fecha_cierre_local.strftime("%d/%m/%Y %H:%M")],
    ]
    
    info_table = Table(info_data, colWidths=[1*inch, 2*inch, 0.8*inch, 1.7*inch])
    info_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTNAME', (2, 0), (2, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('TEXTCOLOR', (0, 0), (0, -1), colors.HexColor('#0a1d3d')),
        ('TEXTCOLOR', (2, 0), (2, -1), colors.HexColor('#0a1d3d')),
        ('BACKGROUND', (1, 0), (1, -1), colors.HexColor('#f5f5f5')),
        ('BACKGROUND', (3, 0), (3, -1), colors.HexColor('#f5f5f5')),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#cccccc')),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    elementos.append(info_table)
    elementos.append(Spacer(1, 0.1*inch))
    
    # Resumen financiero
    elementos.append(Paragraph("RESUMEN FINANCIERO", seccion_style))
    
    resumen_data = [
        ["Monto inicial:", f"${float(monto_inicial):,.0f}"],
        ["Total ingresos en efectivo:", f"${float(total_ingresos_efectivo):,.0f}"],
        ["Total egresos:", f"${float(total_egresos):,.0f}"],
        ["Saldo esperado (sistema):", f"${float(saldo_esperado):,.0f}"],
    ]
    
    resumen_table = Table(resumen_data, colWidths=[2.5*inch, 3*inch])
    resumen_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('TEXTCOLOR', (0, 0), (0, -1), colors.HexColor('#0a1d3d')),
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#f0f4f8')),
        ('ALIGN', (0, 0), (0, -1), 'LEFT'),
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#cccccc')),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    elementos.append(resumen_table)
    elementos.append(Spacer(1, 0.1*inch))
    
    # Estadísticas del turno
    if vehiculos_cobrados > 0 or total_rtm > 0 or total_soat > 0:
        elementos.append(Paragraph("ESTADÍSTICAS DEL TURNO", seccion_style))
        
        stats_data = [
            ["Vehículos cobrados:", str(vehiculos_cobrados)],
            ["Total RTM:", f"${float(total_rtm):,.0f}"],
            ["Total comisiones SOAT:", f"${float(total_soat):,.0f}"],
        ]
        
        stats_table = Table(stats_data, colWidths=[2.5*inch, 3*inch])
        stats_table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 7),
            ('TEXTCOLOR', (0, 0), (0, -1), colors.HexColor('#0a1d3d')),
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#fffbeb')),
            ('ALIGN', (0, 0), (0, -1), 'LEFT'),
            ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e0e0e0')),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ]))
        elementos.append(stats_table)
        elementos.append(Spacer(1, 0.08*inch))
    
    # Métodos de pago
    if any([total_efectivo, total_tarjeta_debito, total_tarjeta_credito, total_transferencia, total_credismart, total_sistecredito]):
        elementos.append(Paragraph("MÉTODOS DE PAGO", seccion_style))
        
        metodos_data = []
        if total_efectivo > 0:
            metodos_data.append(["Efectivo:", f"${float(total_efectivo):,.0f}"])
        if total_tarjeta_debito > 0:
            metodos_data.append(["Tarjeta débito:", f"${float(total_tarjeta_debito):,.0f}"])
        if total_tarjeta_credito > 0:
            metodos_data.append(["Tarjeta crédito:", f"${float(total_tarjeta_credito):,.0f}"])
        if total_transferencia > 0:
            metodos_data.append(["Transferencia:", f"${float(total_transferencia):,.0f}"])
        if total_credismart > 0:
            metodos_data.append(["CrediSmart:", f"${float(total_credismart):,.0f}"])
        if total_sistecredito > 0:
            metodos_data.append(["SisteCredito:", f"${float(total_sistecredito):,.0f}"])
        
        if metodos_data:
            metodos_table = Table(metodos_data, colWidths=[2.5*inch, 3*inch])
            metodos_table.setStyle(TableStyle([
                ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, -1), 7),
                ('TEXTCOLOR', (0, 0), (0, -1), colors.HexColor('#0a1d3d')),
                ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#e8f5e9')),
                ('ALIGN', (0, 0), (0, -1), 'LEFT'),
                ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e0e0e0')),
                ('TOPPADDING', (0, 0), (-1, -1), 3),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ]))
            elementos.append(metodos_table)
            elementos.append(Spacer(1, 0.08*inch))
    
    # Desglose de efectivo
    elementos.append(Paragraph("ARQUEO FÍSICO - DESGLOSE DE EFECTIVO", seccion_style))
    
    desglose_items = []
    denominaciones = [
        ('billetes_100000', 'Billetes de $100.000', 100000),
        ('billetes_50000', 'Billetes de $50.000', 50000),
        ('billetes_20000', 'Billetes de $20.000', 20000),
        ('billetes_10000', 'Billetes de $10.000', 10000),
        ('billetes_5000', 'Billetes de $5.000', 5000),
        ('billetes_2000', 'Billetes de $2.000', 2000),
        ('billetes_1000', 'Billetes de $1.000', 1000),
        ('monedas_1000', 'Monedas de $1.000', 1000),
        ('monedas_500', 'Monedas de $500', 500),
        ('monedas_200', 'Monedas de $200', 200),
        ('monedas_100', 'Monedas de $100', 100),
        ('monedas_50', 'Monedas de $50', 50),
    ]
    
    for key, label, valor in denominaciones:
        cantidad = int(desglose_efectivo.get(key, 0))
        if cantidad > 0:
            subtotal = cantidad * valor
            desglose_items.append([label, f"× {cantidad}", f"${subtotal:,.0f}"])
    
    if not desglose_items:
        desglose_items.append(["(Sin efectivo)", "", "$0"])
    
    desglose_table = Table(desglose_items, colWidths=[2.2*inch, 1.3*inch, 2*inch])
    desglose_table.setStyle(TableStyle([
        ('FONTSIZE', (0, 0), (-1, -1), 7),
        ('ALIGN', (0, 0), (0, -1), 'LEFT'),
        ('ALIGN', (1, 0), (1, -1), 'CENTER'),
        ('ALIGN', (2, 0), (2, -1), 'RIGHT'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e0e0e0')),
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#fffbeb')),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ]))
    elementos.append(desglose_table)
    elementos.append(Spacer(1, 0.05*inch))
    
    # Total contado
    total_data = [
        ["TOTAL CONTADO (físico):", f"${float(monto_final_fisico):,.0f}"]
    ]
    
    total_table = Table(total_data, colWidths=[2.5*inch, 3*inch])
    total_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.white),
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#0a1d3d')),
        ('ALIGN', (0, 0), (0, -1), 'LEFT'),
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
    ]))
    elementos.append(total_table)
    elementos.append(Spacer(1, 0.08*inch))
    
    # Diferencia (destacada)
    color_diferencia = colors.HexColor('#16a34a') if diferencia >= 0 else colors.HexColor('#dc2626')
    signo_diferencia = "SOBRANTE" if diferencia >= 0 else "FALTANTE"
    
    diferencia_data = [
        [f"DIFERENCIA ({signo_diferencia}):", f"${abs(float(diferencia)):,.0f}"]
    ]
    
    diferencia_table = Table(diferencia_data, colWidths=[2.5*inch, 3*inch])
    diferencia_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 11),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.white),
        ('BACKGROUND', (0, 0), (-1, -1), color_diferencia),
        ('ALIGN', (0, 0), (0, -1), 'LEFT'),
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
    ]))
    elementos.append(diferencia_table)
    elementos.append(Spacer(1, 0.1*inch))
    
    # Observaciones
    if observaciones_safe:
        elementos.append(Paragraph("OBSERVACIONES", seccion_style))
        obs_style = ParagraphStyle(
            'Observaciones',
            parent=styles['Normal'],
            fontSize=7,
            textColor=colors.black
        )
        elementos.append(Paragraph(observaciones_safe, obs_style))
        elementos.append(Spacer(1, 0.08*inch))
    
    # Firmas
    firmas_data = [
        ["_________________________", "_________________________"],
        ["Cajero", "Supervisor/Administrador"],
        [cajero_nombre_safe, ""]
    ]
    
    firmas_table = Table(firmas_data, colWidths=[2.75*inch, 2.75*inch])
    firmas_table.setStyle(TableStyle([
        ('FONTNAME', (0, 1), (-1, 1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, 0), 0),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 3),
        ('TOPPADDING', (0, 1), (-1, -1), 4),
    ]))
    elementos.append(firmas_table)
    elementos.append(Spacer(1, 0.05*inch))
    
    # Pie de página
    fecha_generacion = fecha_generacion_local.strftime("%d/%m/%Y %H:%M:%S")
    pie_style = ParagraphStyle(
        'Pie',
        parent=styles['Normal'],
        fontSize=6,
        textColor=colors.gray,
        alignment=TA_CENTER
    )
    elementos.append(Paragraph(f"Documento generado por CDASOFT | {fecha_generacion} | Caja ID: {caja_id}", pie_style))
    
    # Construir PDF principal.
    # Si por algún carácter inesperado falla, devolver PDF de respaldo válido.
    try:
        doc.build(elementos)
        buffer.seek(0)
        return buffer
    except Exception:
        fallback = BytesIO()
        fallback_doc = SimpleDocTemplate(
            fallback,
            pagesize=letter,
            topMargin=0.5 * inch,
            bottomMargin=0.5 * inch,
            leftMargin=0.6 * inch,
            rightMargin=0.6 * inch,
        )
        fallback_styles = getSampleStyleSheet()
        fallback_title = ParagraphStyle(
            "FallbackTitle",
            parent=fallback_styles["Heading1"],
            fontSize=13,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#0a1d3d"),
        )
        fallback_body = ParagraphStyle(
            "FallbackBody",
            parent=fallback_styles["Normal"],
            fontSize=9,
            leading=13,
            textColor=colors.black,
        )
        fallback_elements = [
            Paragraph("COMPROBANTE DE CIERRE DE CAJA", fallback_title),
            Spacer(1, 0.15 * inch),
            Paragraph(f"Caja ID: {_safe_text(caja_id)}", fallback_body),
            Paragraph(f"Cajero: {cajero_nombre_safe}", fallback_body),
            Paragraph(f"Turno: {_safe_text(turnos_map.get(turno, turno))}", fallback_body),
            Paragraph(f"Apertura: {fecha_apertura_local.strftime('%d/%m/%Y %H:%M')}", fallback_body),
            Paragraph(f"Cierre: {fecha_cierre_local.strftime('%d/%m/%Y %H:%M')}", fallback_body),
            Spacer(1, 0.10 * inch),
            Paragraph(f"Saldo esperado: ${float(saldo_esperado):,.0f}", fallback_body),
            Paragraph(f"Monto final físico: ${float(monto_final_fisico):,.0f}", fallback_body),
            Paragraph(f"Diferencia: ${float(diferencia):,.0f}", fallback_body),
            Spacer(1, 0.15 * inch),
            Paragraph(
                "Nota: Se generó versión de respaldo para garantizar la continuidad operativa del cierre.",
                fallback_body,
            ),
        ]
        fallback_doc.build(fallback_elements)
        fallback.seek(0)
        return fallback
