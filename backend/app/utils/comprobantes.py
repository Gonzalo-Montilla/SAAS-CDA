"""
Utilidad para generar comprobantes de egreso en PDF
"""
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image, KeepTogether
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from io import BytesIO
from datetime import datetime
from decimal import Decimal
from typing import Optional
import os

from app.utils.comprobantes_caja import (
    _download_remote_logo,
    _resolve_tenant_logo_path,
    _safe_text,
)


def generar_comprobante_egreso(
    numero_comprobante: str,
    fecha: datetime,
    beneficiario: str,
    concepto: str,
    categoria: str,
    monto: Decimal,
    metodo_pago: str,
    autorizado_por: str,
    desglose_efectivo: Optional[dict] = None,
    tenant_logo_url: Optional[str] = None,
    nombre_comercial_cda: Optional[str] = None,
    beneficiario_tipo_identificacion: Optional[str] = None,
    beneficiario_numero_identificacion: Optional[str] = None,
    beneficiario_direccion: Optional[str] = None,
    beneficiario_email: Optional[str] = None,
    beneficiario_telefono: Optional[str] = None,
    beneficiario_factus_municipality_id: Optional[int] = None,
    retencion_motor_cop: Optional[Decimal] = None,
    retencion_motor_anio: Optional[int] = None,
) -> BytesIO:
    """
    Genera un comprobante de egreso en PDF
    
    Args:
        numero_comprobante: Número único del comprobante
        fecha: Fecha del egreso
        beneficiario: Persona o entidad que recibe el dinero
        beneficiario_tipo_identificacion: Tipo de documento del beneficiario (ej. C.C, NIT)
        beneficiario_numero_identificacion: Número del documento del beneficiario
        concepto: Descripción del egreso
        categoria: Categoría del egreso
        monto: Monto del egreso (positivo)
        metodo_pago: Método de pago utilizado
        autorizado_por: Nombre del usuario que autoriza
        desglose_efectivo: Desglose de billetes/monedas si aplica
        tenant_logo_url: URL o ruta del logo del tenant (misma lógica que cierre de caja)
        nombre_comercial_cda: Nombre del CDA bajo el título (sustituye el subtítulo genérico)
    
    Returns:
        BytesIO con el PDF generado
    """
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        topMargin=0.42 * inch,
        bottomMargin=0.4 * inch,
        leftMargin=0.55 * inch,
        rightMargin=0.55 * inch,
    )
    
    # Estilos
    styles = getSampleStyleSheet()
    
    titulo_style = ParagraphStyle(
        'TituloComprobante',
        parent=styles['Heading1'],
        fontSize=17,
        textColor=colors.HexColor('#0a1d3d'),  # Azul marino
        alignment=TA_CENTER,
        spaceAfter=8,
        fontName='Helvetica-Bold'
    )
    
    subtitulo_style = ParagraphStyle(
        'SubtituloComprobante',
        parent=styles['Normal'],
        fontSize=11,
        textColor=colors.HexColor('#0a1d3d'),
        alignment=TA_CENTER,
        spaceAfter=10
    )

    detalle_valor_para = ParagraphStyle(
        'DetalleValorPara',
        parent=styles['Normal'],
        fontSize=10,
        leading=12,
        textColor=colors.black,
    )

    detalle_label_para = ParagraphStyle(
        'DetalleLabelPara',
        parent=styles['Normal'],
        fontSize=9,
        leading=11,
        textColor=colors.HexColor('#0a1d3d'),
        fontName='Helvetica-Bold',
    )
    
    label_style = ParagraphStyle(
        'Label',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.gray,
        fontName='Helvetica-Bold'
    )
    
    valor_style = ParagraphStyle(
        'Valor',
        parent=styles['Normal'],
        fontSize=11,
        textColor=colors.black
    )
    
    # Elementos del documento
    elementos = []
    
    # Logo: tenant actual (local/remoto) o fallback heredado
    tenant_logo_local_path = _resolve_tenant_logo_path(tenant_logo_url)
    tenant_logo_remote_buffer = _download_remote_logo(tenant_logo_url)
    fallback_logo_path = os.path.join(os.path.dirname(__file__), 'logo_cda.png')

    logo_source = None
    if tenant_logo_local_path and os.path.exists(tenant_logo_local_path):
        logo_source = tenant_logo_local_path
    elif tenant_logo_remote_buffer:
        logo_source = tenant_logo_remote_buffer
    elif os.path.exists(fallback_logo_path):
        logo_source = fallback_logo_path

    if logo_source:
        logo = Image(logo_source, width=1.35 * inch, height=0.95 * inch, kind='proportional')
        logo.hAlign = 'CENTER'
        elementos.append(logo)
        elementos.append(Spacer(1, 0.06 * inch))

    # Encabezado
    elementos.append(Paragraph("COMPROBANTE DE EGRESO", titulo_style))
    subtitulo_texto = (nombre_comercial_cda or "").strip() or "CDASOFT"
    elementos.append(Paragraph(_safe_text(subtitulo_texto), subtitulo_style))
    elementos.append(Spacer(1, 0.1 * inch))
    
    # Información del comprobante
    info_data = [
        ["Comprobante N°:", numero_comprobante, "Fecha:", fecha.strftime("%d/%m/%Y %H:%M")],
    ]
    
    info_table = Table(info_data, colWidths=[1.5*inch, 2*inch, 1*inch, 2*inch])
    info_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTNAME', (2, 0), (2, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('TEXTCOLOR', (0, 0), (0, -1), colors.HexColor('#0a1d3d')),
        ('TEXTCOLOR', (2, 0), (2, -1), colors.HexColor('#0a1d3d')),
        ('BACKGROUND', (1, 0), (1, -1), colors.HexColor('#f5f5f5')),
        ('BACKGROUND', (3, 0), (3, -1), colors.HexColor('#f5f5f5')),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#cccccc')),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    elementos.append(info_table)
    elementos.append(Spacer(1, 0.14 * inch))
    
    # Detalles del egreso
    categorias_map = {
        'nomina': 'Nómina y Salarios',
        'servicios_publicos': 'Servicios Públicos',
        'arriendo': 'Arriendo',
        'proveedores': 'Proveedores',
        'compra_inventario': 'Compra de Inventario',
        'mantenimiento': 'Mantenimiento',
        'impuestos': 'Impuestos',
        'otros_gastos': 'Otros Gastos'
    }
    
    metodos_map = {
        'efectivo': 'Efectivo',
        'transferencia': 'Transferencia Bancaria',
        'cheque': 'Cheque',
        'consignacion': 'Consignación'
    }
    
    tipo_id_label = (beneficiario_tipo_identificacion or "—").strip() or "—"
    num_id_label = (beneficiario_numero_identificacion or "—").strip() or "—"

    def _pl(txt: str) -> Paragraph:
        return Paragraph(_safe_text(txt), detalle_label_para)

    def _pv(txt: str) -> Paragraph:
        return Paragraph(_safe_text(txt), detalle_valor_para)

    detalles_data = [
        [_pl("Pagado a:"), _pv(beneficiario)],
        [_pl("Tipo identificación:"), _pv(tipo_id_label)],
        [_pl("No. identificación:"), _pv(num_id_label)],
    ]
    if (beneficiario_direccion or "").strip():
        detalles_data.append([_pl("Dirección proveedor:"), _pv((beneficiario_direccion or "").strip())])
    if (beneficiario_email or "").strip():
        detalles_data.append([_pl("Correo proveedor:"), _pv((beneficiario_email or "").strip())])
    if (beneficiario_telefono or "").strip():
        detalles_data.append([_pl("Teléfono / celular:"), _pv((beneficiario_telefono or "").strip())])
    if beneficiario_factus_municipality_id is not None:
        detalles_data.append(
            [_pl("Municipio proveedor (id Factus):"), _pv(str(beneficiario_factus_municipality_id))]
        )
    detalles_data.extend(
        [
            [_pl("Categoría:"), _pv(str(categorias_map.get(categoria, categoria)))],
            [_pl("Concepto:"), _pv(concepto)],
            [_pl("Método de pago:"), _pv(metodos_map.get(metodo_pago, metodo_pago))],
        ]
    )
    
    detalles_table = Table(detalles_data, colWidths=[2.2 * inch, 4.3 * inch])
    detalles_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#f0f4f8')),
        ('ALIGN', (0, 0), (0, -1), 'LEFT'),
        ('ALIGN', (1, 0), (1, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#cccccc')),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    elementos.append(detalles_table)
    elementos.append(Spacer(1, 0.12 * inch))
    
    # Desglose de efectivo (si aplica)
    if metodo_pago == 'efectivo' and desglose_efectivo:
        elementos.append(Paragraph("<b>Desglose de Efectivo:</b>", label_style))
        elementos.append(Spacer(1, 0.06 * inch))
        
        desglose_items = []
        denominaciones = [
            ('billetes_100000', '$100.000', 100000),
            ('billetes_50000', '$50.000', 50000),
            ('billetes_20000', '$20.000', 20000),
            ('billetes_10000', '$10.000', 10000),
            ('billetes_5000', '$5.000', 5000),
            ('billetes_2000', '$2.000', 2000),
            ('billetes_1000', '$1.000', 1000),
            ('monedas_1000', '$1.000 (monedas)', 1000),
            ('monedas_500', '$500', 500),
            ('monedas_200', '$200', 200),
            ('monedas_100', '$100', 100),
            ('monedas_50', '$50', 50),
        ]
        
        for key, label, valor in denominaciones:
            cantidad = int(desglose_efectivo.get(key, 0))
            if cantidad > 0:
                subtotal = cantidad * valor
                desglose_items.append([label, f"× {cantidad}", f"${subtotal:,.0f}"])
        
        if desglose_items:
            desglose_table = Table(desglose_items, colWidths=[2*inch, 1.5*inch, 2*inch])
            desglose_table.setStyle(TableStyle([
                ('FONTSIZE', (0, 0), (-1, -1), 9),
                ('ALIGN', (0, 0), (0, -1), 'LEFT'),
                ('ALIGN', (1, 0), (1, -1), 'CENTER'),
                ('ALIGN', (2, 0), (2, -1), 'RIGHT'),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e0e0e0')),
                ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#fffbeb')),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ]))
            elementos.append(desglose_table)
            elementos.append(Spacer(1, 0.1 * inch))

    rete_ref_rows: list = []
    if retencion_motor_cop is not None and retencion_motor_cop > 0:
        rete_ref_style = ParagraphStyle(
            "ReteRefTesoreria",
            parent=styles["Normal"],
            fontSize=9,
            leading=12,
            textColor=colors.HexColor("#5b21b6"),
        )
        anio_r = str(retencion_motor_anio) if retencion_motor_anio else "—"
        rete_text = (
            f"Retención en la fuente (referencia documento soporte; no descontada del efectivo de este comprobante): "
            f"${float(retencion_motor_cop):,.0f} · parámetros año {anio_r}."
        )
        rete_ref_rows = [
            Paragraph(_safe_text(rete_text), rete_ref_style),
            Spacer(1, 0.07 * inch),
        ]

    # Monto total (destacado)
    monto_data = [
        ["TOTAL EGRESO:", f"${float(monto):,.0f}"]
    ]
    
    monto_table = Table(monto_data, colWidths=[3*inch, 3.5*inch])
    monto_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 14),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.white),
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#dc2626')),  # Rojo para egreso
        ('ALIGN', (0, 0), (0, -1), 'LEFT'),
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 12),
        ('RIGHTPADDING', (0, 0), (-1, -1), 12),
    ]))

    # Firmas
    firmas_data = [
        ["_________________________", "_________________________"],
        ["Autorizado por:", "Recibido por:"],
        [autorizado_por, beneficiario],
    ]

    firmas_table = Table(firmas_data, colWidths=[3.25 * inch, 3.25 * inch])
    firmas_table.setStyle(
        TableStyle(
            [
                ('FONTNAME', (0, 1), (-1, 1), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, -1), 10),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('TOPPADDING', (0, 0), (-1, 0), 0),
                ('BOTTOMPADDING', (0, 0), (-1, 0), 4),
                ('TOPPADDING', (0, 1), (-1, -1), 6),
            ]
        )
    )

    fecha_generacion = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    pie_style = ParagraphStyle(
        'Pie',
        parent=styles['Normal'],
        fontSize=8,
        textColor=colors.gray,
        alignment=TA_CENTER,
    )
    pie_para = Paragraph(f"Documento generado el {fecha_generacion}", pie_style)

    # Total + firmas + pie en un solo flujo para no dejar la franja roja sola al final de página.
    bloque_pie: list = list(rete_ref_rows)
    bloque_pie.extend(
        [
            monto_table,
            Spacer(1, 0.1 * inch),
            firmas_table,
            Spacer(1, 0.08 * inch),
            pie_para,
        ]
    )
    elementos.append(KeepTogether(bloque_pie))

    # Construir PDF
    doc.build(elementos)
    buffer.seek(0)

    return buffer


def generar_comprobante_egreso_caja(
    *,
    numero_comprobante: str,
    fecha: datetime,
    tipo_movimiento_label: str,
    turno: str,
    beneficiario: str,
    beneficiario_tipo_identificacion: str,
    concepto: str,
    monto: Decimal,
    metodo_pago: str,
    nombre_cajero: str,
    tenant_logo_url: Optional[str] = None,
    nombre_comercial_cda: Optional[str] = None,
    beneficiario_numero_identificacion: str = "",
    beneficiario_direccion: Optional[str] = None,
    beneficiario_email: Optional[str] = None,
    beneficiario_telefono: Optional[str] = None,
    beneficiario_factus_municipality_id: Optional[int] = None,
) -> BytesIO:
    """
    Comprobante PDF de egreso registrado en caja (gasto, devolución, ajuste).
    Coherente con el comprobante generado en el cliente, persistiendo datos en servidor.
    """
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

    titulo_style = ParagraphStyle(
        "TituloComprobanteCaja",
        parent=styles["Heading1"],
        fontSize=17,
        textColor=colors.HexColor("#0a1d3d"),
        alignment=TA_CENTER,
        spaceAfter=8,
        fontName="Helvetica-Bold",
    )

    subtitulo_style = ParagraphStyle(
        "SubtituloComprobanteCaja",
        parent=styles["Normal"],
        fontSize=11,
        textColor=colors.HexColor("#0a1d3d"),
        alignment=TA_CENTER,
        spaceAfter=10,
    )

    label_style = ParagraphStyle(
        "LabelCaja",
        parent=styles["Normal"],
        fontSize=10,
        textColor=colors.gray,
        fontName="Helvetica-Bold",
    )

    detalle_valor_para_caja = ParagraphStyle(
        "DetalleValorParaCaja",
        parent=styles["Normal"],
        fontSize=10,
        leading=12,
        textColor=colors.black,
    )

    detalle_label_para_caja = ParagraphStyle(
        "DetalleLabelParaCaja",
        parent=styles["Normal"],
        fontSize=9,
        leading=11,
        textColor=colors.HexColor("#0a1d3d"),
        fontName="Helvetica-Bold",
    )

    elementos = []

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
        logo = Image(logo_source, width=1.35 * inch, height=0.95 * inch, kind="proportional")
        logo.hAlign = "CENTER"
        elementos.append(logo)
        elementos.append(Spacer(1, 0.06 * inch))

    elementos.append(Paragraph("COMPROBANTE DE EGRESO DE CAJA", titulo_style))
    subtitulo_texto = (nombre_comercial_cda or "").strip() or "CDASOFT"
    elementos.append(Paragraph(_safe_text(subtitulo_texto), subtitulo_style))
    elementos.append(Spacer(1, 0.1 * inch))

    info_data = [
        ["Comprobante N°:", numero_comprobante, "Fecha:", fecha.strftime("%d/%m/%Y %H:%M")],
    ]

    info_table = Table(info_data, colWidths=[1.5 * inch, 2 * inch, 1 * inch, 2 * inch])
    info_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#0a1d3d")),
                ("TEXTCOLOR", (2, 0), (2, -1), colors.HexColor("#0a1d3d")),
                ("BACKGROUND", (1, 0), (1, -1), colors.HexColor("#f5f5f5")),
                ("BACKGROUND", (3, 0), (3, -1), colors.HexColor("#f5f5f5")),
                ("ALIGN", (0, 0), (-1, -1), "LEFT"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("GRID", (0, 0), (-1, -1), 1, colors.HexColor("#cccccc")),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    elementos.append(info_table)
    elementos.append(Spacer(1, 0.14 * inch))

    ben_l = (beneficiario or "").strip() or "—"
    tid_l = (beneficiario_tipo_identificacion or "").strip() or "—"
    num_l = (beneficiario_numero_identificacion or "").strip() or "—"

    def _pl_caja(txt: str) -> Paragraph:
        return Paragraph(_safe_text(txt), detalle_label_para_caja)

    def _pv_caja(txt: str) -> Paragraph:
        return Paragraph(_safe_text(txt), detalle_valor_para_caja)

    detalles_data = [
        [_pl_caja("Tipo de movimiento:"), _pv_caja(tipo_movimiento_label)],
        [_pl_caja("Turno:"), _pv_caja(turno)],
        [_pl_caja("Pagado a:"), _pv_caja(ben_l)],
        [_pl_caja("Tipo identificación:"), _pv_caja(tid_l)],
        [_pl_caja("No. identificación:"), _pv_caja(num_l)],
    ]
    if (beneficiario_direccion or "").strip():
        detalles_data.append(
            [_pl_caja("Dirección proveedor:"), _pv_caja((beneficiario_direccion or "").strip())]
        )
    if (beneficiario_email or "").strip():
        detalles_data.append(
            [_pl_caja("Correo proveedor:"), _pv_caja((beneficiario_email or "").strip())]
        )
    if (beneficiario_telefono or "").strip():
        detalles_data.append(
            [_pl_caja("Teléfono / celular:"), _pv_caja((beneficiario_telefono or "").strip())]
        )
    if beneficiario_factus_municipality_id is not None:
        detalles_data.append(
            [
                _pl_caja("Municipio proveedor (id Factus):"),
                _pv_caja(str(beneficiario_factus_municipality_id)),
            ]
        )
    detalles_data.extend(
        [
            [_pl_caja("Concepto:"), _pv_caja(concepto)],
            [_pl_caja("Método de pago:"), _pv_caja(metodo_pago or "N/A")],
            [_pl_caja("Cajero(a) que registra:"), _pv_caja(nombre_cajero)],
        ]
    )

    detalles_table = Table(detalles_data, colWidths=[2.2 * inch, 4.3 * inch])
    detalles_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f0f4f8")),
                ("ALIGN", (0, 0), (0, -1), "LEFT"),
                ("ALIGN", (1, 0), (1, -1), "LEFT"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 1, colors.HexColor("#cccccc")),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    elementos.append(detalles_table)
    elementos.append(Spacer(1, 0.12 * inch))

    monto_data = [["TOTAL EGRESO:", f"${float(monto):,.0f}"]]

    monto_table = Table(monto_data, colWidths=[3 * inch, 3.5 * inch])
    monto_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 14),
                ("TEXTCOLOR", (0, 0), (-1, -1), colors.white),
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#dc2626")),
                ("ALIGN", (0, 0), (0, -1), "LEFT"),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ]
        )
    )

    firmas_data = [
        ["_________________________", "_________________________"],
        ["Recibido por (beneficiario):", "Entregó (cajero):"],
        [_safe_text(ben_l), _safe_text(nombre_cajero)],
    ]

    firmas_table = Table(firmas_data, colWidths=[3.25 * inch, 3.25 * inch])
    firmas_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, 0), 0),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 4),
                ("TOPPADDING", (0, 1), (-1, -1), 6),
            ]
        )
    )

    fecha_generacion = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    pie_style = ParagraphStyle(
        "PieCaja",
        parent=styles["Normal"],
        fontSize=8,
        textColor=colors.gray,
        alignment=TA_CENTER,
    )
    pie_para_caja = Paragraph(f"Documento generado el {fecha_generacion}", pie_style)
    nota_importante = Paragraph(
        "<b>IMPORTANTE:</b> Comprobante para firma de quien recibe el dinero.",
        label_style,
    )

    elementos.append(
        KeepTogether(
            [
                monto_table,
                Spacer(1, 0.08 * inch),
                nota_importante,
                Spacer(1, 0.1 * inch),
                firmas_table,
                Spacer(1, 0.08 * inch),
                pie_para_caja,
            ]
        )
    )

    doc.build(elementos)
    buffer.seek(0)
    return buffer


def generar_recibo_pago_vehiculo_pdf(
    nombre_cda: str,
    placa: str,
    tipo_vehiculo: str,
    cliente_nombre: str,
    cliente_documento: str,
    valor_rtm: Decimal,
    comision_soat: Decimal,
    total_cobrado: Decimal,
    metodo_pago: str,
    fecha_pago: datetime,
    nombre_cajero: str,
    *,
    numero_factura_dian: Optional[str] = None,
    cliente_email: Optional[str] = None,
    cliente_telefono: Optional[str] = None,
) -> bytes:
    """Genera PDF de recibo de pago (formato estándar CDASOFT)."""
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=0.5 * inch, bottomMargin=0.5 * inch)
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "TitleReciboPago",
        parent=styles["Heading1"],
        fontSize=18,
        textColor=colors.HexColor("#0a1d3d"),
        alignment=TA_CENTER,
        spaceAfter=8,
        fontName="Helvetica-Bold",
    )
    subtitle_style = ParagraphStyle(
        "SubtitleReciboPago",
        parent=styles["Normal"],
        fontSize=10,
        textColor=colors.HexColor("#334155"),
        alignment=TA_CENTER,
        spaceAfter=16,
    )

    elementos = []
    logo_path = os.path.join(os.path.dirname(__file__), "logo_cda.png")
    if os.path.exists(logo_path):
        logo = Image(logo_path, width=1.5 * inch, height=0.9 * inch, kind="proportional")
        logo.hAlign = "CENTER"
        elementos.append(logo)
        elementos.append(Spacer(1, 0.08 * inch))

    elementos.append(Paragraph("RECIBO DE PAGO", title_style))
    elementos.append(Paragraph(nombre_cda, subtitle_style))

    metodo_label = {
        "efectivo": "Efectivo",
        "tarjeta_debito": "Tarjeta débito",
        "tarjeta_credito": "Tarjeta crédito",
        "transferencia": "Transferencia",
        "credismart": "Credismart",
        "sistecredito": "Sistecredito",
        "mixto": "Mixto",
    }.get((metodo_pago or "").lower(), str(metodo_pago or "").replace("_", " ").title())

    data = [
        ["Fecha de pago", fecha_pago.strftime("%d/%m/%Y %H:%M:%S"), "Placa", placa],
        ["Cliente", cliente_nombre, "Documento", cliente_documento],
        ["Tipo vehículo", tipo_vehiculo.replace("_", " ").title(), "Atendido por", nombre_cajero],
        ["Método de pago", metodo_label, "Factura DIAN", (numero_factura_dian or "—")],
        ["Correo", (cliente_email or "—"), "Celular", (cliente_telefono or "—")],
    ]
    info_table = Table(data, colWidths=[1.3 * inch, 2.2 * inch, 1.2 * inch, 2.1 * inch])
    info_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.6, colors.HexColor("#d1d5db")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f8fafc")),
                ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#f8fafc")),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    elementos.append(info_table)
    elementos.append(Spacer(1, 0.18 * inch))

    cobro_data = [
        ["Concepto", "Valor"],
        ["Revisión técnico-mecánica (RTM)", f"${float(valor_rtm):,.0f}"],
        ["Comisión SOAT", f"${float(comision_soat):,.0f}"],
        ["TOTAL PAGADO", f"${float(total_cobrado):,.0f}"],
    ]
    cobro_table = Table(cobro_data, colWidths=[4.2 * inch, 2.6 * inch])
    cobro_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.7, colors.HexColor("#cbd5e1")),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e2e8f0")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTNAME", (0, 3), (-1, 3), "Helvetica-Bold"),
                ("BACKGROUND", (0, 3), (-1, 3), colors.HexColor("#dcfce7")),
                ("ALIGN", (0, 0), (0, -1), "LEFT"),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    elementos.append(cobro_table)
    elementos.append(Spacer(1, 0.22 * inch))

    footer_style = ParagraphStyle(
        "FooterReciboPago",
        parent=styles["Normal"],
        fontSize=8,
        textColor=colors.HexColor("#64748b"),
        alignment=TA_CENTER,
    )
    elementos.append(Paragraph("Documento generado automáticamente por CDASOFT.", footer_style))

    doc.build(elementos)
    return buffer.getvalue()
