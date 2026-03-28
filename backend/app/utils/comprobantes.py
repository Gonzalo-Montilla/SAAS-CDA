"""
Utilidad para generar comprobantes de egreso en PDF
"""
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from io import BytesIO
from datetime import datetime
from decimal import Decimal
from typing import Optional
import os


def generar_comprobante_egreso(
    numero_comprobante: str,
    fecha: datetime,
    beneficiario: str,
    concepto: str,
    categoria: str,
    monto: Decimal,
    metodo_pago: str,
    autorizado_por: str,
    desglose_efectivo: Optional[dict] = None
) -> BytesIO:
    """
    Genera un comprobante de egreso en PDF
    
    Args:
        numero_comprobante: Número único del comprobante
        fecha: Fecha del egreso
        beneficiario: Persona o entidad que recibe el dinero
        concepto: Descripción del egreso
        categoria: Categoría del egreso
        monto: Monto del egreso (positivo)
        metodo_pago: Método de pago utilizado
        autorizado_por: Nombre del usuario que autoriza
        desglose_efectivo: Desglose de billetes/monedas si aplica
    
    Returns:
        BytesIO con el PDF generado
    """
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=0.5*inch, bottomMargin=0.5*inch)
    
    # Estilos
    styles = getSampleStyleSheet()
    
    titulo_style = ParagraphStyle(
        'TituloComprobante',
        parent=styles['Heading1'],
        fontSize=18,
        textColor=colors.HexColor('#0a1d3d'),  # Azul marino
        alignment=TA_CENTER,
        spaceAfter=12,
        fontName='Helvetica-Bold'
    )
    
    subtitulo_style = ParagraphStyle(
        'SubtituloComprobante',
        parent=styles['Normal'],
        fontSize=12,
        textColor=colors.HexColor('#0a1d3d'),
        alignment=TA_CENTER,
        spaceAfter=20
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
    
    # Logo (si existe)
    logo_path = os.path.join(os.path.dirname(__file__), 'logo_cda.png')
    if os.path.exists(logo_path):
        logo = Image(logo_path, width=1.5*inch, height=1.5*inch, kind='proportional')
        logo.hAlign = 'CENTER'
        elementos.append(logo)
        elementos.append(Spacer(1, 0.1*inch))
    
    # Encabezado
    elementos.append(Paragraph("COMPROBANTE DE EGRESO", titulo_style))
    elementos.append(Paragraph("CDASOFT", subtitulo_style))
    elementos.append(Spacer(1, 0.2*inch))
    
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
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
    ]))
    elementos.append(info_table)
    elementos.append(Spacer(1, 0.3*inch))
    
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
    
    detalles_data = [
        ["Pagado a:", beneficiario],
        ["Categoría:", categorias_map.get(categoria, categoria)],
        ["Concepto:", concepto],
        ["Método de pago:", metodos_map.get(metodo_pago, metodo_pago)],
    ]
    
    detalles_table = Table(detalles_data, colWidths=[2*inch, 4.5*inch])
    detalles_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('TEXTCOLOR', (0, 0), (0, -1), colors.HexColor('#0a1d3d')),
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#f0f4f8')),
        ('ALIGN', (0, 0), (0, -1), 'LEFT'),
        ('ALIGN', (1, 0), (1, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#cccccc')),
        ('TOPPADDING', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
    ]))
    elementos.append(detalles_table)
    elementos.append(Spacer(1, 0.3*inch))
    
    # Desglose de efectivo (si aplica)
    if metodo_pago == 'efectivo' and desglose_efectivo:
        elementos.append(Paragraph("<b>Desglose de Efectivo:</b>", label_style))
        elementos.append(Spacer(1, 0.1*inch))
        
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
                ('TOPPADDING', (0, 0), (-1, -1), 6),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ]))
            elementos.append(desglose_table)
            elementos.append(Spacer(1, 0.2*inch))
    
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
        ('TOPPADDING', (0, 0), (-1, -1), 12),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
        ('LEFTPADDING', (0, 0), (-1, -1), 15),
        ('RIGHTPADDING', (0, 0), (-1, -1), 15),
    ]))
    elementos.append(monto_table)
    elementos.append(Spacer(1, 0.5*inch))
    
    # Firmas
    firmas_data = [
        ["_________________________", "_________________________"],
        ["Autorizado por:", "Recibido por:"],
        [autorizado_por, beneficiario]
    ]
    
    firmas_table = Table(firmas_data, colWidths=[3.25*inch, 3.25*inch])
    firmas_table.setStyle(TableStyle([
        ('FONTNAME', (0, 1), (-1, 1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, 0), 0),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 5),
        ('TOPPADDING', (0, 1), (-1, -1), 8),
    ]))
    elementos.append(firmas_table)
    elementos.append(Spacer(1, 0.3*inch))
    
    # Pie de página
    fecha_generacion = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    pie_style = ParagraphStyle(
        'Pie',
        parent=styles['Normal'],
        fontSize=8,
        textColor=colors.gray,
        alignment=TA_CENTER
    )
    elementos.append(Paragraph(f"Documento generado el {fecha_generacion}", pie_style))
    
    # Construir PDF
    doc.build(elementos)
    buffer.seek(0)
    
    return buffer
