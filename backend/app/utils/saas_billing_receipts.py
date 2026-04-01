"""
Utilidades para generar recibos PDF de pagos SaaS.
"""
from io import BytesIO
from datetime import datetime
from pathlib import Path
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


def _fmt_money(value: float) -> str:
    return f"${value:,.0f}".replace(",", ".")


def _draw_section_title(pdf: canvas.Canvas, x: float, y: float, w: float, title: str) -> float:
    pdf.setFillColor(colors.HexColor("#e9eef5"))
    pdf.rect(x, y - 5 * mm, w, 6 * mm, fill=1, stroke=0)
    pdf.setFillColor(colors.black)
    pdf.setFont("Helvetica-Bold", 10)
    pdf.drawCentredString(x + (w / 2), y - 3.1 * mm, title.upper())
    return y - 8 * mm


def _draw_kv_row(
    pdf: canvas.Canvas,
    *,
    x_label: float,
    x_value: float,
    y: float,
    label: str,
    value: str,
    label_bold: bool = True,
    value_bold: bool = False,
) -> float:
    pdf.setFont("Helvetica-Bold" if label_bold else "Helvetica", 9.5)
    pdf.drawString(x_label, y, label)
    pdf.setFont("Helvetica-Bold" if value_bold else "Helvetica", 9.5)
    pdf.drawString(x_value, y, value)
    return y - 5.3 * mm


def build_saas_payment_receipt_pdf(
    *,
    reference: str,
    tenant_nombre: str,
    tenant_slug: str,
    tenant_nit: str | None,
    plan_label: str,
    amount: float,
    paid_at: datetime,
    period_days: int,
    sedes_totales: int,
    sucursales_facturables: int,
    next_billing_at: datetime | None,
    actor_email: str | None,
    tenant_email: str | None = None,
    notes: str | None = None,
) -> bytes:
    """
    Genera un PDF simple de recibo de pago SaaS y retorna bytes.
    """
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=LETTER)
    _, height = LETTER
    subtotal = round(amount / 1.19, 2)
    iva = round(amount - subtotal, 2)

    x_start = 20 * mm
    x_label = 28 * mm
    x_value = 95 * mm
    section_w = 170 * mm
    y = height - 24 * mm

    # Header with CDASOFT logo image (without duplicated title text).
    logo_path = (
        Path(__file__).resolve().parents[3]
        / "frontend"
        / "src"
        / "assets"
        / "LOGO_CDA_SOFT-SIN FONDO.png"
    )
    if logo_path.exists():
        logo_reader = ImageReader(str(logo_path))
        img_w, img_h = logo_reader.getSize()
        draw_w = 82 * mm
        draw_h = (draw_w * img_h) / max(img_w, 1)
        x_logo = 105 * mm - (draw_w / 2)
        y_logo = y - draw_h + 2 * mm
        pdf.drawImage(logo_reader, x_logo, y_logo, width=draw_w, height=draw_h, mask="auto")
        y = y_logo - 6 * mm
    else:
        # Fallback if logo is not available in filesystem.
        pdf.setFont("Helvetica-Bold", 18)
        pdf.setFillColor(colors.HexColor("#1f3f77"))
        pdf.drawCentredString(105 * mm, y, "CDASOFT")
        pdf.setFillColor(colors.black)
        y -= 9 * mm

    pdf.setFont("Helvetica", 10)
    pdf.drawCentredString(105 * mm, y, "Prometheus Tech | NIT 123.123.123-1")
    y -= 6 * mm
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawCentredString(105 * mm, y, "Recibo de pago")
    y -= 6 * mm
    pdf.setStrokeColor(colors.HexColor("#333333"))
    pdf.setLineWidth(0.8)
    pdf.line(x_start, y, x_start + section_w, y)
    y -= 6 * mm

    # DATOS DEL RECIBO
    y = _draw_section_title(pdf, x_start, y, section_w, "Datos del recibo")
    y = _draw_kv_row(pdf, x_label=x_label, x_value=x_value, y=y, label="Numero:", value=reference)
    y = _draw_kv_row(
        pdf,
        x_label=x_label,
        x_value=x_value,
        y=y,
        label="Fecha emision:",
        value=f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} UTC",
    )
    y = _draw_kv_row(pdf, x_label=x_label, x_value=x_value, y=y, label="Moneda:", value="COP")
    y -= 2 * mm

    # DATOS DEL CDA
    y = _draw_section_title(pdf, x_start, y, section_w, "Datos de la escuela")
    y = _draw_kv_row(pdf, x_label=x_label, x_value=x_value, y=y, label="Escuela:", value=tenant_nombre)
    y = _draw_kv_row(pdf, x_label=x_label, x_value=x_value, y=y, label="Codigo:", value=tenant_slug)
    y = _draw_kv_row(pdf, x_label=x_label, x_value=x_value, y=y, label="NIT:", value=tenant_nit or "-")
    y = _draw_kv_row(pdf, x_label=x_label, x_value=x_value, y=y, label="Email contacto:", value=tenant_email or "-")
    y = _draw_kv_row(pdf, x_label=x_label, x_value=x_value, y=y, label="Plan comercial:", value=f"{plan_label} ({period_days} dias)")
    y -= 2 * mm

    # DETALLE DE COBRO
    y = _draw_section_title(pdf, x_start, y, section_w, "Detalle de cobro del periodo")
    y = _draw_kv_row(
        pdf,
        x_label=x_label,
        x_value=x_value,
        y=y,
        label="Fecha pago registrado:",
        value=paid_at.strftime("%Y-%m-%d %H:%M:%S"),
    )
    y = _draw_kv_row(pdf, x_label=x_label, x_value=x_value, y=y, label="Referencia:", value=reference)
    period_start = paid_at.strftime("%Y-%m-%d")
    period_end = next_billing_at.strftime("%Y-%m-%d") if next_billing_at else "-"
    y = _draw_kv_row(
        pdf,
        x_label=x_label,
        x_value=x_value,
        y=y,
        label="Corte/periodo:",
        value=f"{period_start} a {period_end}",
    )
    y = _draw_kv_row(
        pdf,
        x_label=x_label,
        x_value=x_value,
        y=y,
        label="Tarifa base plan (sin IVA):",
        value=f"{_fmt_money(subtotal)} COP",
    )
    y = _draw_kv_row(
        pdf,
        x_label=x_label,
        x_value=x_value,
        y=y,
        label="Sucursales adicionales activas:",
        value=str(max(sedes_totales - 1, 0)),
    )
    y = _draw_kv_row(pdf, x_label=x_label, x_value=x_value, y=y, label="Sucursales incluidas sin costo:", value="1")
    sucursales_cobradas_text = (
        "0 (sin cobro adicional)"
        if sucursales_facturables <= 0
        else str(sucursales_facturables)
    )
    y = _draw_kv_row(
        pdf,
        x_label=x_label,
        x_value=x_value,
        y=y,
        label="Sucursales cobradas:",
        value=sucursales_cobradas_text,
    )
    y -= 2 * mm

    # RESUMEN DE COBRO
    y = _draw_section_title(pdf, x_start, y, section_w, "Resumen de cobro")
    y = _draw_kv_row(
        pdf,
        x_label=x_label,
        x_value=x_value,
        y=y,
        label="Subtotal (sin IVA):",
        value=f"{_fmt_money(subtotal)} COP",
        value_bold=True,
    )
    y = _draw_kv_row(pdf, x_label=x_label, x_value=x_value, y=y, label="IVA (19%):", value=f"{_fmt_money(iva)} COP", value_bold=True)
    y = _draw_kv_row(
        pdf,
        x_label=x_label,
        x_value=x_value,
        y=y,
        label="Total periodo (con IVA):",
        value=f"{_fmt_money(amount)} COP",
        value_bold=True,
    )
    y = _draw_kv_row(
        pdf,
        x_label=x_label,
        x_value=x_value,
        y=y,
        label="Monto registrado en esta transaccion:",
        value=f"{_fmt_money(amount)} COP",
        value_bold=True,
    )
    y -= 2 * mm

    # Observaciones
    y = _draw_section_title(pdf, x_start, y, section_w, "Observaciones")
    y = _draw_kv_row(pdf, x_label=x_label, x_value=x_value, y=y, label="Notas:", value=(notes or "-")[:120], label_bold=True)
    y -= 5 * mm
    pdf.setFont("Helvetica", 8)
    pdf.drawCentredString(105 * mm, y, f"Generado por Prometheus Tech | Registrado por {actor_email or 'sistema'}")

    pdf.showPage()
    pdf.save()
    buffer.seek(0)
    return buffer.getvalue()
