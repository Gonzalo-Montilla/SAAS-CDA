"""
Generador PDF para el formato adicional de recepción (opcional).
"""
from __future__ import annotations

import base64
import glob
import os
import re
from datetime import datetime, timezone
from io import BytesIO
from typing import Any, Optional

import pytz
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.graphics.shapes import Circle, Drawing
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (
    Flowable,
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.utils.comprobantes_caja import (
    _download_remote_logo,
    _resolve_tenant_logo_path,
    _safe_text,
)


def _parse_hex_color(raw: str | None, fallback: str) -> colors.Color:
    value = (raw or "").strip()
    if re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        try:
            return colors.HexColor(value)
        except Exception:
            pass
    return colors.HexColor(fallback)


def _boolish_to_label(value: Any) -> str:
    v = str(value or "").strip().lower()
    if v == "si":
        return "SI"
    if v == "no":
        return "NO"
    if v == "na":
        return "N/A"
    return "—"


def _to_text(value: Any, *, default: str = "—") -> str:
    txt = _safe_text(value or "").strip()
    return txt if txt else default


def _xml_esc(s: Any) -> str:
    t = _safe_text(s or "")
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _build_row(label: str, value: Any) -> list[str]:
    return [_safe_text(label), _to_text(value)]


def _format_constancia_fecha(fecha_registro: Optional[datetime]) -> tuple[str, str]:
    tz_name = "America/Bogota"
    if not isinstance(fecha_registro, datetime):
        return ("—", tz_name)
    dt = fecha_registro
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    try:
        local_tz = pytz.timezone(tz_name)
        dt = dt.astimezone(local_tz)
    except Exception:
        pass
    return (dt.strftime("%d/%m/%Y %H:%M:%S"), tz_name)


def _safe_para(value: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(_xml_esc(value), style)


def _safe_para_with_cda_alias(value: str, style: ParagraphStyle, tenant_nombre: str) -> Paragraph:
    text = _xml_esc(value)
    tenant = _xml_esc(_to_text(tenant_nombre, default="CDASOFT"))
    text = re.sub(
        r"\bCDA\b",
        f"CENTRO DE DIAGNOSTICO AUTOMOTOR (<b>{tenant}</b>)",
        text,
    )
    return Paragraph(text, style)


def _check_mark(value: Any, target: str) -> str:
    v = str(value or "").strip().lower()
    return "✓" if v == target else ""


def _decode_signature_data_url(data_url: str | None) -> BytesIO | None:
    raw = (data_url or "").strip()
    if not raw or ";base64," not in raw:
        return None
    try:
        b64 = raw.split(";base64,", 1)[1]
        data = base64.b64decode(b64, validate=False)
        if not data:
            return None
        return BytesIO(data)
    except Exception:
        return None


class TirePressureDiagramFlowable(Flowable):
    """Diagrama de vehículo con etiquetas PSI por llanta."""

    def __init__(
        self,
        *,
        image_path: str,
        points_by_pos: dict[str, tuple[float, float]],
        offsets_by_pos: dict[str, tuple[float, float]],
        entries: list[dict[str, Any]],
        width: float,
        max_height: float,
    ) -> None:
        super().__init__()
        self.image_path = image_path
        self.points_by_pos = points_by_pos
        self.offsets_by_pos = offsets_by_pos
        self.entries = entries
        self.width = width
        self.max_height = max_height
        self.height = max_height
        self._reader: ImageReader | None = None
        self._img_w = 0.0
        self._img_h = 0.0
        try:
            self._reader = ImageReader(image_path)
            iw, ih = self._reader.getSize()
            self._img_w = float(iw or 1.0)
            self._img_h = float(ih or 1.0)
            ratio = self._img_h / self._img_w if self._img_w else 1.0
            self.height = min(max_height, width * ratio)
            if self.height <= 0:
                self.height = max_height
        except Exception:
            self._reader = None

    def wrap(self, availWidth, availHeight):  # type: ignore[override]
        return self.width, self.height

    def draw(self):  # type: ignore[override]
        c = self.canv
        if self._reader is None:
            c.setFont("Helvetica", 8)
            c.setFillColor(colors.HexColor("#64748b"))
            c.drawString(0, max(10, self.height / 2), "No se pudo cargar diagrama de vehículo.")
            return

        w = self.width
        h = self.height
        c.drawImage(self._reader, 0, 0, width=w, height=h, preserveAspectRatio=True, mask="auto")

        for item in self.entries:
            pos_id = str(item.get("posicion_id") or "").strip()
            psi = str(item.get("psi") or "").strip()
            if not pos_id or not psi:
                continue
            point = self.points_by_pos.get(pos_id)
            if not point:
                continue
            px = w * point[0]
            py = h * point[1]

            prefix = ""
            if pos_id == "pes_rep_1":
                prefix = "REP-1 "
            elif pos_id == "pes_rep_2":
                prefix = "REP-2 "
            elif str(item.get("is_repuesto") or "").lower() in {"true", "1", "yes"}:
                prefix = "REP "
            label = f"{prefix}{psi} PSI"
            bubble_w = max(40, min(72, 8 + (len(label) * 4.2)))
            bubble_h = 14
            dx, dy = self.offsets_by_pos.get(pos_id, (8.0, 8.0))
            bx = min(max(px + dx, 0), w - bubble_w)
            by = min(max(py + dy, 0), h - bubble_h)
            line_end_x = bx if px <= (bx + bubble_w / 2.0) else (bx + bubble_w)
            line_end_y = by + bubble_h / 2.0

            c.setStrokeColor(colors.HexColor("#94a3b8"))
            c.setLineWidth(0.8)
            c.line(px, py, line_end_x, line_end_y)

            c.setFillColor(colors.white)
            c.setStrokeColor(colors.HexColor("#334155"))
            c.roundRect(bx, by, bubble_w, bubble_h, 3, stroke=1, fill=1)

            c.setFillColor(colors.HexColor("#0f172a"))
            c.setFont("Helvetica-Bold", 7.2)
            c.drawCentredString(bx + bubble_w / 2.0, by + 4.2, label)


def _resolve_vehicle_diagram_path(tipo_vehiculo: str | None) -> str | None:
    base_dir_primary = os.path.join(os.path.dirname(__file__), "assets", "vehiculos")
    base_dir_fallback = os.path.join(os.path.dirname(__file__), "assets")
    tipo = (tipo_vehiculo or "").strip().lower()
    if tipo == "moto":
        base_name = "moto_base"
    elif "pesado" in tipo:
        base_name = "pesado_base"
    else:
        base_name = "liviano_base"

    for base_dir in (base_dir_primary, base_dir_fallback):
        if not os.path.isdir(base_dir):
            continue
        # 1) Prioridad: nombre exacto histórico.
        exact_candidates = (
            f"{base_name}.png",
            f"{base_name}.PNG",
            f"{base_name}.jpg",
            f"{base_name}.JPG",
            f"{base_name}.jpeg",
            f"{base_name}.JPEG",
            f"{base_name}.webp",
            f"{base_name}.WEBP",
        )
        for file_name in exact_candidates:
            target = os.path.join(base_dir, file_name)
            if os.path.exists(target):
                return target
        # 2) Fallback robusto: cualquier archivo que empiece por base_name.
        wildcard_hits = sorted(glob.glob(os.path.join(base_dir, f"{base_name}*")))
        for target in wildcard_hits:
            if os.path.isfile(target):
                return target
    return None


def _resolve_visual_vehicle_type(
    tipo_vehiculo: str | None,
    tipo_vehiculo_formato: str | None = None,
    clase_vehiculo: str | None = None,
) -> str:
    """
    Normaliza el tipo visual para el diagrama de llantas.
    Para servicios especiales (preventiva/auditoria) se deriva desde clase/formato.
    """
    tipo = (tipo_vehiculo or "").strip().lower()
    tipo_formato = (tipo_vehiculo_formato or "").strip().lower()
    clase = (clase_vehiculo or "").strip().lower()

    moto_tokens = ("moto", "motocicleta")
    pesado_tokens = (
        "pesado",
        "camion",
        "camión",
        "tracto",
        "tractocamion",
        "tractocamión",
        "volqueta",
        "bus",
        "buseta",
        "microbus",
        "microbús",
    )
    liviano_tokens = (
        "liviano",
        "carro",
        "automovil",
        "automóvil",
        "camioneta",
        "suv",
        "pickup",
        "pick-up",
    )

    def _has_any(raw: str, tokens: tuple[str, ...]) -> bool:
        return any(token in raw for token in tokens)

    # 1) Tipo explícito del registro (si viene claro, manda).
    if _has_any(tipo, moto_tokens):
        return "moto"
    if _has_any(tipo, pesado_tokens):
        return "pesado"
    if _has_any(tipo, liviano_tokens):
        return "liviano"

    # 2) Para tipos especiales o ambiguos, derivar del formato/clase.
    if _has_any(tipo_formato, moto_tokens) or _has_any(clase, moto_tokens):
        return "moto"
    if _has_any(tipo_formato, pesado_tokens) or _has_any(clase, pesado_tokens):
        return "pesado"
    if _has_any(tipo_formato, liviano_tokens) or _has_any(clase, liviano_tokens):
        return "liviano"

    # 3) Fallback conservador histórico.
    return "liviano"


def _diagram_points_for_tipo(tipo_vehiculo: str | None) -> dict[str, tuple[float, float]]:
    tipo = (tipo_vehiculo or "").strip().lower()
    if tipo == "moto":
        return {
            "moto_delantera": (0.81, 0.29),
            "moto_trasera": (0.24, 0.30),
        }
    if "pesado" in tipo:
        # Coordenadas normalizadas sobre la nueva plantilla pesado_base (cabina a la izquierda).
        # Convención usada en este formato: "izquierda" queda en la parte inferior del plano.
        return {
            # OJO: ReportLab usa origen en esquina inferior izquierda; estas Y ya están convertidas.
            "pes_e1_izq": (0.366, 0.460),
            "pes_e1_der": (0.366, 0.831),
            "pes_e2_izq_ext": (0.649, 0.457),
            "pes_e2_izq_int": (0.649, 0.496),
            "pes_e2_der_int": (0.649, 0.828),
            "pes_e2_der_ext": (0.649, 0.866),
            "pes_e3_izq_ext": (0.784, 0.457),
            "pes_e3_izq_int": (0.784, 0.496),
            "pes_e3_der_int": (0.784, 0.828),
            "pes_e3_der_ext": (0.784, 0.866),
            "pes_e4_izq_ext": (0.493, 0.460),
            "pes_e4_der_ext": (0.493, 0.831),
            # En esta plantilla, los repuestos son las dos llantas sueltas de la parte inferior.
            "pes_rep_1": (0.440, 0.122),
            "pes_rep_2": (0.569, 0.122),
        }
    # Liviano (top view)
    # Plantilla nueva: llantas fuera del vehículo (esquinas + repuesto abajo al centro).
    return {
        # Frente/atrás correcto; se invierte izq/der por orientación real de la plantilla.
        # Ajustado a centros reales de las llantas del nuevo arte (más cerca del vehículo).
        "liv_del_izq": (0.31, 0.30),
        "liv_del_der": (0.31, 0.77),
        "liv_tra_izq": (0.69, 0.30),
        "liv_tra_der": (0.69, 0.77),
        "liv_rep_1": (0.50, 0.12),
    }


def _diagram_label_offsets_for_tipo(tipo_vehiculo: str | None) -> dict[str, tuple[float, float]]:
    tipo = (tipo_vehiculo or "").strip().lower()
    if tipo == "moto":
        return {
            "moto_delantera": (8, -10),
            "moto_trasera": (-54, -10),
        }
    if "pesado" in tipo:
        return {
            "pes_e1_izq": (-72, -14),
            "pes_e1_der": (-72, 10),
            "pes_e2_izq_ext": (-18, -34),
            "pes_e2_izq_int": (-82, -10),
            "pes_e2_der_int": (-82, 10),
            "pes_e2_der_ext": (-18, 30),
            "pes_e3_izq_ext": (24, -34),
            "pes_e3_izq_int": (-40, -10),
            "pes_e3_der_int": (-40, 10),
            "pes_e3_der_ext": (24, 30),
            "pes_e4_izq_ext": (-10, -24),
            "pes_e4_der_ext": (-10, 20),
            "pes_rep_1": (-52, 12),
            "pes_rep_2": (16, 12),
        }
    return {
        # Etiquetas más cerca de cada llanta para evitar líneas largas.
        "liv_del_izq": (-34, -6),
        "liv_del_der": (-34, 6),
        "liv_tra_izq": (10, -6),
        "liv_tra_der": (10, 6),
        "liv_rep_1": (8, 8),
    }


def _trim_transparent_logo(source: Any) -> Any:
    """
    Recorta bordes transparentes (si existen) para mejorar presencia visual del logo.
    Si Pillow no está disponible o falla, retorna la fuente original.
    """
    try:
        from PIL import Image as PILImage  # type: ignore
    except Exception:
        return source

    try:
        raw: bytes | None = None
        if isinstance(source, BytesIO):
            raw = source.getvalue()
        elif isinstance(source, (str, os.PathLike)):
            with open(source, "rb") as f:
                raw = f.read()
        if not raw:
            return source

        img = PILImage.open(BytesIO(raw)).convert("RGBA")
        alpha = img.getchannel("A")
        bbox = alpha.getbbox()
        if not bbox:
            return source
        cropped = img.crop(bbox)
        out = BytesIO()
        cropped.save(out, format="PNG")
        out.seek(0)
        return out
    except Exception:
        return source


def generar_recepcion_formato_extra_pdf(
    *,
    tenant_nombre: str,
    tenant_nit: Optional[str],
    tenant_logo_url: Optional[str],
    tenant_color_primario: Optional[str],
    tenant_color_secundario: Optional[str],
    placa: str,
    tipo_vehiculo: str,
    cliente_nombre: str,
    cliente_documento: str,
    cliente_telefono: Optional[str],
    cliente_email: Optional[str],
    fecha_registro: Optional[datetime],
    formato_extra: dict[str, Any],
) -> bytes:
    primary = _parse_hex_color(tenant_color_primario, "#2563eb")
    secondary = _parse_hex_color(tenant_color_secundario, "#0f172a")
    slate_50 = colors.HexColor("#f8fafc")
    slate_100 = colors.HexColor("#f1f5f9")
    slate_200 = colors.HexColor("#e2e8f0")
    slate_300 = colors.HexColor("#cbd5e1")
    slate_700 = colors.HexColor("#334155")
    emerald_50 = colors.HexColor("#ecfdf5")
    emerald_700 = colors.HexColor("#047857")
    amber_50 = colors.HexColor("#fffbeb")

    datos_tecnicos = (formato_extra or {}).get("datos_tecnicos") or {}
    checklist = (formato_extra or {}).get("preparacion_checklist") or {}
    pre_revision = (formato_extra or {}).get("pre_revision") or {}
    observaciones_recepcion = _to_text((formato_extra or {}).get("observaciones_recepcion"), default="")
    autorizaciones = (formato_extra or {}).get("autorizaciones_datos") or {}
    firma_titular = (formato_extra or {}).get("firma_titular") or {}
    firma_operario = pre_revision.get("firma_operario") if isinstance(pre_revision, dict) else {}
    if not isinstance(firma_operario, dict):
        firma_operario = {}

    styles = getSampleStyleSheet()
    hero_title = ParagraphStyle(
        "RecepcionExtraHeroTitle",
        parent=styles["Heading1"],
        fontSize=16,
        fontName="Helvetica-Bold",
        textColor=secondary,
        alignment=TA_CENTER,
        spaceAfter=3,
    )
    hero_subtitle = ParagraphStyle(
        "RecepcionExtraHeroSubtitle",
        parent=styles["Normal"],
        fontSize=9.2,
        textColor=slate_700,
        alignment=TA_CENTER,
        spaceAfter=4,
    )
    section_title = ParagraphStyle(
        "RecepcionExtraSectionTitle",
        parent=styles["Normal"],
        fontSize=10.5,
        fontName="Helvetica-Bold",
        textColor=colors.white,
        alignment=TA_CENTER,
        spaceBefore=0,
        spaceAfter=0,
    )
    card_label = ParagraphStyle(
        "RecepcionExtraCardLabel",
        parent=styles["Normal"],
        fontSize=8.1,
        fontName="Helvetica-Bold",
        textColor=secondary,
        alignment=TA_LEFT,
        spaceAfter=1.2,
    )
    card_value = ParagraphStyle(
        "RecepcionExtraCardValue",
        parent=styles["Normal"],
        fontSize=9,
        textColor=colors.black,
        alignment=TA_LEFT,
        spaceAfter=1.8,
    )
    body_style = ParagraphStyle(
        "RecepcionExtraBody",
        parent=styles["Normal"],
        fontSize=8.6,
        leading=11,
        alignment=TA_LEFT,
        spaceAfter=5,
        textColor=colors.HexColor("#0f172a"),
    )
    small_style = ParagraphStyle(
        "RecepcionExtraSmall",
        parent=styles["Normal"],
        fontSize=8.1,
        leading=10.5,
        alignment=TA_LEFT,
        spaceAfter=5,
        textColor=slate_700,
    )
    signature_center_style = ParagraphStyle(
        "RecepcionExtraSignatureCenter",
        parent=small_style,
        alignment=TA_CENTER,
    )
    footnote_style = ParagraphStyle(
        "RecepcionExtraFootnote",
        parent=styles["Normal"],
        fontSize=7.6,
        leading=9.6,
        alignment=TA_CENTER,
        textColor=slate_700,
    )
    checklist_header_style = ParagraphStyle(
        "RecepcionExtraChecklistHeader",
        parent=styles["Normal"],
        fontSize=8.4,
        fontName="Helvetica-Bold",
        alignment=TA_CENTER,
        textColor=colors.white,
    )
    checklist_item_style = ParagraphStyle(
        "RecepcionExtraChecklistItem",
        parent=styles["Normal"],
        fontSize=8.2,
        leading=10.2,
        alignment=TA_LEFT,
        textColor=colors.black,
    )
    checklist_mark_style = ParagraphStyle(
        "RecepcionExtraChecklistMark",
        parent=styles["Normal"],
        fontSize=10,
        fontName="Helvetica-Bold",
        alignment=TA_CENTER,
        textColor=emerald_700,
    )

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=0.55 * inch,
        rightMargin=0.55 * inch,
        topMargin=0.45 * inch,
        bottomMargin=0.45 * inch,
    )
    flow: list[Any] = []

    tenant_logo_local_path = _resolve_tenant_logo_path(tenant_logo_url)
    tenant_logo_remote_buffer = _download_remote_logo(tenant_logo_url)
    fallback_logo_path = os.path.join(os.path.dirname(__file__), "logo_cda.png")
    super_logo_path = os.path.join(os.path.dirname(__file__), "assets", "Logo-Vigilados_SuperT_PNG.png")
    logo_source = None
    super_logo_source = super_logo_path if os.path.exists(super_logo_path) else None
    if tenant_logo_local_path and os.path.exists(tenant_logo_local_path):
        logo_source = tenant_logo_local_path
    elif tenant_logo_remote_buffer:
        logo_source = tenant_logo_remote_buffer
    elif os.path.exists(fallback_logo_path):
        logo_source = fallback_logo_path

    if logo_source and super_logo_source:
        try:
            logo_tenant = Image(logo_source, width=2.05 * inch, height=1.05 * inch, kind="proportional")
            logo_tenant.hAlign = "CENTER"
            super_logo_prepared = _trim_transparent_logo(super_logo_source)
            # Tras recorte de transparencia, lo dejamos casi al tamaño visual del logo tenant.
            logo_super = Image(super_logo_prepared, width=2.35 * inch, height=1.10 * inch, kind="proportional")
            logo_super.hAlign = "CENTER"
            logos_table = Table([[logo_tenant, logo_super]], colWidths=[3.55 * inch, 3.55 * inch])
            logos_table.setStyle(
                TableStyle(
                    [
                        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 0),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                        ("TOPPADDING", (0, 0), (-1, -1), 0),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                    ]
                )
            )
            flow.append(logos_table)
            flow.append(Spacer(1, 0.04 * inch))
        except Exception:
            pass
    elif logo_source or super_logo_source:
        try:
            logo_single = Image(
                logo_source or super_logo_source,
                width=2.15 * inch,
                height=1.05 * inch,
                kind="proportional",
            )
            logo_single.hAlign = "CENTER"
            flow.append(logo_single)
            flow.append(Spacer(1, 0.04 * inch))
        except Exception:
            pass

    flow.append(Spacer(1, 0.03 * inch))

    flow.append(Paragraph("PROCESOS OPERATIVOS", hero_title))
    flow.append(Paragraph("PLANILLA DE RECEPCION Y ENTREGA DE VEHICULOS PARA INSPECCION", hero_title))
    flow.append(
        Paragraph(
            f"Formato: <b>{_xml_esc(_to_text((formato_extra or {}).get('version'), default='RTM-01-FR v13'))}</b>",
            hero_subtitle,
        )
    )
    flow.append(Paragraph(f"<b>{_xml_esc(tenant_nombre)}</b>", hero_subtitle))
    flow.append(Paragraph(f"NIT: <b>{_xml_esc((tenant_nit or '').strip() or 'N/A')}</b>", hero_subtitle))
    flow.append(
        Paragraph(
            "Formato operativo para captura de informacion tecnica y checklist de ingreso.",
            hero_subtitle,
        )
    )

    fecha_fmt = _to_text((formato_extra or {}).get("fecha_formato"), default="")
    if not fecha_fmt and isinstance(fecha_registro, datetime):
        fecha_fmt = _safe_text(fecha_registro.strftime("%Y-%m-%d"))
    if not fecha_fmt:
        fecha_fmt = "—"
    no_inspeccion = _to_text((formato_extra or {}).get("no_inspeccion"))
    tipo_formato = _to_text((formato_extra or {}).get("tipo_vehiculo_formato") or tipo_vehiculo)
    constancia_fecha, constancia_tz = _format_constancia_fecha(fecha_registro)
    diagram_tipo = _resolve_visual_vehicle_type(
        tipo_vehiculo,
        tipo_formato,
        _to_text(datos_tecnicos.get("clase_vehiculo"), default=""),
    )

    # Tarjetas de resumen (vehiculo / titular)
    vehicle_rows = [
        [Paragraph("PLACA", card_label), Paragraph(f"<b>{_xml_esc(_to_text(placa))}</b>", card_value)],
        [Paragraph("TIPO DE VEHICULO", card_label), Paragraph(_xml_esc(tipo_formato), card_value)],
        [Paragraph("FECHA FORMATO", card_label), Paragraph(_xml_esc(fecha_fmt), card_value)],
        [Paragraph("NO. INSPECCION", card_label), Paragraph(_xml_esc(no_inspeccion), card_value)],
    ]
    titular_rows = [
        [Paragraph("CLIENTE", card_label), Paragraph(f"<b>{_xml_esc(_to_text(cliente_nombre))}</b>", card_value)],
        [Paragraph("DOCUMENTO", card_label), Paragraph(_xml_esc(_to_text(cliente_documento)), card_value)],
        [Paragraph("TELEFONO", card_label), Paragraph(_xml_esc(_to_text(cliente_telefono)), card_value)],
        [Paragraph("EMAIL", card_label), Paragraph(_xml_esc(_to_text(cliente_email)), card_value)],
    ]
    vehicle_table = Table(vehicle_rows, colWidths=[1.45 * inch, 2.05 * inch])
    titular_table = Table(titular_rows, colWidths=[1.45 * inch, 2.05 * inch])
    for t in (vehicle_table, titular_table):
        t.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
    cards_wrap = Table([[vehicle_table, titular_table]], colWidths=[3.6 * inch, 3.6 * inch])
    cards_wrap.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.8, slate_300),
                ("BACKGROUND", (0, 0), (-1, -1), slate_50),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    flow.append(cards_wrap)
    flow.append(Spacer(1, 0.08 * inch))

    def _section_banner(title: str) -> Table:
        banner = Table([[Paragraph(_xml_esc(title), section_title)]], colWidths=[7.25 * inch])
        banner.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (0, 0), secondary),
                    ("LEFTPADDING", (0, 0), (0, 0), 8),
                    ("RIGHTPADDING", (0, 0), (0, 0), 8),
                    ("TOPPADDING", (0, 0), (0, 0), 5),
                    ("BOTTOMPADDING", (0, 0), (0, 0), 5),
                    ("LINEBELOW", (0, 0), (0, 0), 0.5, slate_200),
                ]
            )
        )
        return banner

    presion_llantas_raw = datos_tecnicos.get("presion_llantas")
    presion_llantas_validas: list[dict[str, Any]] = []
    if isinstance(presion_llantas_raw, list):
        for item in presion_llantas_raw:
            if not isinstance(item, dict):
                continue
            psi_val = _to_text(item.get("psi"), default="").strip()
            if psi_val:
                presion_llantas_validas.append(item)

    presion_inflado_display = datos_tecnicos.get("presion_inflado")
    if presion_llantas_validas:
        presion_inflado_display = f"{len(presion_llantas_validas)} llantas con PSI (ver detalle por llanta)"

    flow.append(_section_banner("1. DATOS TECNICOS DEL VEHICULO"))
    tecnicos_rows = [
        _build_row("Clase vehiculo", datos_tecnicos.get("clase_vehiculo")),
        _build_row("Marca", datos_tecnicos.get("marca")),
        _build_row("Linea", datos_tecnicos.get("linea")),
        _build_row("Modelo", datos_tecnicos.get("modelo")),
        _build_row("Color", datos_tecnicos.get("color")),
        _build_row("Servicio", datos_tecnicos.get("servicio")),
        _build_row("Tipo combustible", datos_tecnicos.get("tipo_combustible")),
        _build_row("Carga/pasajeros", datos_tecnicos.get("carga_pasajeros")),
        _build_row("Ensenanza", _boolish_to_label(datos_tecnicos.get("ensenanza"))),
        _build_row("Kilometraje", datos_tecnicos.get("kilometraje")),
        _build_row("Blindado", _boolish_to_label(datos_tecnicos.get("blindado"))),
        _build_row("Polarizado", _boolish_to_label(datos_tecnicos.get("polarizado"))),
        _build_row("Cilindraje", datos_tecnicos.get("cilindraje")),
        _build_row("Presion de inflado", presion_inflado_display),
        _build_row("Observaciones tecnicas", datos_tecnicos.get("observaciones_tecnicas")),
    ]
    tecnicos_table = Table(tecnicos_rows, colWidths=[2.35 * inch, 4.9 * inch])
    tecnicos_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.55, slate_300),
                ("BACKGROUND", (0, 0), (0, -1), slate_100),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.7),
                ("TOPPADDING", (0, 0), (-1, -1), 4.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
            ]
        )
    )
    flow.append(tecnicos_table)
    if presion_llantas_validas:
        diagram_path = _resolve_vehicle_diagram_path(diagram_tipo)
        if diagram_path:
            flow.append(Spacer(1, 0.05 * inch))
            flow.append(Paragraph("Diagrama de presion por llanta", small_style))
            flow.append(
                TirePressureDiagramFlowable(
                    image_path=diagram_path,
                    points_by_pos=_diagram_points_for_tipo(diagram_tipo),
                    offsets_by_pos=_diagram_label_offsets_for_tipo(diagram_tipo),
                    entries=presion_llantas_validas,
                    width=7.0 * inch,
                    max_height=2.9 * inch,
                )
            )

        def _tire_icon(size: float = 10.0) -> Drawing:
            d = Drawing(size, size)
            outer = Circle(size / 2.0, size / 2.0, (size / 2.0) - 0.6)
            outer.strokeColor = slate_700
            outer.strokeWidth = 1.1
            outer.fillColor = None
            inner = Circle(size / 2.0, size / 2.0, size * 0.17)
            inner.strokeColor = slate_700
            inner.strokeWidth = 0.8
            inner.fillColor = slate_700
            d.add(outer)
            d.add(inner)
            return d

        detalle_rows: list[list[Any]] = [["", "Llanta", "PSI"]]
        for item in presion_llantas_validas:
            label = _to_text(item.get("posicion_label"), default="Llanta")
            psi = _to_text(item.get("psi"), default="—")
            detalle_rows.append([_tire_icon(), label, psi])
        if len(detalle_rows) > 1:
            flow.append(Spacer(1, 0.05 * inch))
            flow.append(Paragraph("Detalle de presion por llanta", small_style))
            detalle_table = Table(detalle_rows, colWidths=[0.38 * inch, 5.37 * inch, 1.5 * inch])
            detalle_table.setStyle(
                TableStyle(
                    [
                        ("GRID", (0, 0), (-1, -1), 0.5, slate_300),
                        ("BACKGROUND", (0, 0), (-1, 0), slate_200),
                        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
                        ("ALIGN", (2, 1), (2, -1), "CENTER"),
                        ("ALIGN", (0, 1), (0, -1), "CENTER"),
                        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
                    ]
                )
            )
            flow.append(detalle_table)
    flow.append(Spacer(1, 0.08 * inch))

    flow.append(_section_banner("2. PREPARACION DEL VEHICULO PARA INSPECCION"))
    checklist_map = [
        ("¿El vehículo se encuentra en un estado de limpieza adecuado y descargado? (peso adicional que no hace parte del vehículo) y, si aplica, con la alarma desactivada?", "limpieza_descargado"),
        ("¿Se presenta la licencia de tránsito (tarjeta de propiedad) del vehículo? ¿La confrontación de los datos: Placa – Marca - Clase – Modelo – Servicio – Color con el vehículo, ¿es correcto?", "licencia_y_confrontacion_datos"),
        ("El vehículo (si aplica), cuenta con certificado de conversión a gas VIGENTE (registrar fecha en el evento que aplique)", "conversion_gas_vigente"),
        ("¿El vehículo se presenta sin copas o tapacubos ( o slider) que cubran el rin y/o los pernos o tuercas?", "tapa_o_capuchones_valvula"),
        (f"¿La presión de inflado de las llantas son adecuadas de acuerdo con las disposiciones de {tenant_nombre.upper()} (ver procedimiento de pre-revisión y post-revisión RTM-04-PR)", "presion_llantas_adecuada_cda"),
        ("¿La motocicleta NO cuenta con accesorios que impida la ubicación adecuada del acople (si aplica) y la introducción de la sonda de muestreo?", "sin_accesorios_que_impidan_acople"),
        ("Los depósitos de los niveles de líquido de frenos son visibles (que no presenten alteraciones que no permitan inspeccionar el nivel en las líneas de inspección).", "niveles_fluidos_visibles"),
        ("Si aplica, se deja libre la carpa con el objetivo de verificar las puertas y compuertas de carga para brindar las condiciones necesarias para realizar la inspección a conformidad.", "liberacion_carga_para_inspeccion"),
        ("Se retiran candados (o dejarlos abiertos) o seguros de la(s) cubierta(s) de la(s) batería(s), puertas, compuertas, cabina basculante (cuando aplique), tapa de combustible y el brazo utilizado como soporte exterior de la llanta de repuesto (si aplica), así como amarres, cintas, forros, fundas, los protectores o tapas de las exploradoras y demás elementos que protejan parte del vehículo para asegurarse que se tenga acceso a los mismos y brindar las condiciones necesarias para realizar la inspección a conformidad.", "retiro_elementos_cabina_carga"),
        ("¿El vehículo se presenta sin fugas de combustible, aceite, líquidos de frenos, líquido refrigerante (si aplica), con la tapa del combustible y no cuenta con otras condiciones que impidan que se realicen las pruebas de manera segura (ver procedimiento de pre-revisión y post-revisión RTM-04-PR)", "viable_ingreso_linea"),
        ("El tablero de instrumentos se encuentra en un estado tal que permita visualizar los indicadores de falla del motor, presión de aceite y temperatura.", "tablero_instrumentos_ok"),
        ("¿Los cinturones de seguridad, las sillas / asientos son de fácil acceso, para permitir su verificación en las líneas de inspección?", "cinturones_sillas_accesos_ok"),
        ("El vehículo cuenta con el combustible suficiente para el desarrollo de la inspección", "combustible_suficiente"),
        ("¿La placa del vehículo está en buen estado y posicionamiento que garantice su plena identificación?", "placa_identificacion_legible"),
        ("En vehículos en los que la llanta de repuesto vaya fijada en el soporte exterior, se retira el protector, seguro o forro de la llanta de repuesto. En vehículos tipo sedán/coupé se deja libre la llanta de repuesto para que sea accesible a los inspectores durante la inspección.", "llanta_repuesto_accesible"),
        ("¿El vehículo cuenta con al menos una luz funcional?", "luces_funcionales"),
        ("¿Si es una motocicleta automática, ¿cuenta con el soporte central funcional?", "extintor_central_funcional_moto"),
        ("¿El vehículo cuenta con adaptaciones para personas con discapacidad?", "adaptaciones_discapacidad"),
    ]
    checklist_rows: list[list[Any]] = [
        [
            Paragraph("ITEM", checklist_header_style),
            Paragraph("SI", checklist_header_style),
            Paragraph("NO", checklist_header_style),
            Paragraph("N/A", checklist_header_style),
            Paragraph("OBS", checklist_header_style),
        ]
    ]
    for label, key in checklist_map:
        raw = checklist.get(key)
        checklist_rows.append(
            [
                Paragraph(_xml_esc(label), checklist_item_style),
                Paragraph(_check_mark(raw, "si"), checklist_mark_style),
                Paragraph(_check_mark(raw, "no"), checklist_mark_style),
                Paragraph(_check_mark(raw, "na"), checklist_mark_style),
                Paragraph(_xml_esc(_boolish_to_label(raw) if not _check_mark(raw, "si") and not _check_mark(raw, "no") and not _check_mark(raw, "na") else ""), checklist_item_style),
            ]
        )
    checklist_table = Table(checklist_rows, colWidths=[4.95 * inch, 0.55 * inch, 0.55 * inch, 0.55 * inch, 0.65 * inch])
    checklist_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.55, slate_300),
                ("BACKGROUND", (0, 0), (-1, 0), secondary),
                ("BACKGROUND", (0, 1), (-1, -1), slate_50),
                ("ALIGN", (1, 1), (3, -1), "CENTER"),
                ("ALIGN", (4, 1), (4, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 4.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
            ]
        )
    )
    flow.append(checklist_table)
    flow.append(Spacer(1, 0.08 * inch))

    if observaciones_recepcion:
        flow.append(Paragraph("Observaciones de recepcion", card_label))
        obs_table = Table(
            [[Paragraph(_xml_esc(observaciones_recepcion).replace("\n", "<br/>"), body_style)]],
            colWidths=[7.25 * inch],
        )
        obs_table.setStyle(
            TableStyle(
                [
                    ("GRID", (0, 0), (-1, -1), 0.55, slate_300),
                    ("BACKGROUND", (0, 0), (-1, -1), amber_50),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ]
            )
        )
        flow.append(obs_table)
        flow.append(Spacer(1, 0.08 * inch))

    flow.append(_section_banner("3. OPERARIOS RESPONSABLES"))
    operario_nombre = _to_text(
        (firma_operario or {}).get("signer_name") if isinstance(firma_operario, dict) else "",
        default=_to_text(pre_revision.get("operario_pre_revision") if isinstance(pre_revision, dict) else ""),
    )
    operario_firma_fecha = _to_text(
        (firma_operario or {}).get("signed_at") if isinstance(firma_operario, dict) else "",
        default="—",
    )
    operario_rows = [
        _build_row("Operario pre-revision", operario_nombre),
        _build_row("Fecha firma operario", operario_firma_fecha),
    ]
    operario_table = Table(operario_rows, colWidths=[2.35 * inch, 4.9 * inch])
    operario_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.55, slate_300),
                ("BACKGROUND", (0, 0), (0, -1), slate_100),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.8),
                ("TOPPADDING", (0, 0), (-1, -1), 4.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
            ]
        )
    )
    flow.append(operario_table)

    firma_operario_buffer = _decode_signature_data_url(
        (firma_operario or {}).get("data_url") if isinstance(firma_operario, dict) else None
    )
    if firma_operario_buffer is not None:
        try:
            firma_operario_img = Image(
                firma_operario_buffer,
                width=2.4 * inch,
                height=0.95 * inch,
                kind="proportional",
            )
            firma_operario_img.hAlign = "CENTER"
            flow.append(Spacer(1, 0.04 * inch))
            flow.append(Paragraph("FIRMA CAPTURADA OPERARIO PRE-REVISION", signature_center_style))
            flow.append(firma_operario_img)
        except Exception:
            pass
    flow.append(Spacer(1, 0.08 * inch))

    flow.append(_section_banner("4. AUTORIZACIONES DE PROTECCION DE DATOS"))
    auth_rows = [
        ["Autorizacion", "Respuesta"],
        [
            "Contacto fuerza comercial / investigacion de mercados",
            _boolish_to_label(autorizaciones.get("contacto_fuerza_comercial")),
        ],
        [
            "Contacto para encuestas y confirmacion de datos",
            _boolish_to_label(autorizaciones.get("contacto_encuestas_confirmacion")),
        ],
        [
            "Recordatorios RTM y SOAT",
            _boolish_to_label(autorizaciones.get("contacto_recordatorio_rtm_soat")),
        ],
    ]
    auth_table = Table(auth_rows, colWidths=[6.0 * inch, 1.25 * inch])
    auth_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.55, slate_300),
                ("BACKGROUND", (0, 0), (-1, 0), primary),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.8),
                ("ALIGN", (1, 1), (1, -1), "CENTER"),
                ("BACKGROUND", (0, 1), (-1, -1), slate_50),
                ("TOPPADDING", (0, 0), (-1, -1), 4.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
            ]
        )
    )
    flow.append(auth_table)
    flow.append(Spacer(1, 0.06 * inch))
    flow.append(
        Paragraph(
            f"Documento generado automaticamente: {_xml_esc(datetime.now().strftime('%Y-%m-%d %H:%M:%S'))}",
            footnote_style,
        )
    )

    flow.append(PageBreak())
    flow.append(_section_banner("CONDICIONES CONTRACTUALES"))
    flow.append(Spacer(1, 0.05 * inch))

    condiciones = [
        (
            "1. Aplicando la normatividad vigente, se le realizara al vehiculo, segun sus caracteristicas, las "
            "pruebas que apliquen: emisiones contaminantes, frenos, medicion de desviacion lateral, suspension, "
            "taximetro, intensidad e inclinacion de luces, inspeccion sensorial y presion sonora. El certificado "
            "se expedira unicamente a vehiculos que cumplan Resolucion 3768 de 2013, Resolucion 0762 de 2022, "
            "NTC 5375 y demas normas aplicables. Tener en cuenta que "
            f"{tenant_nombre} se encuentra acreditado para RTMyEC a vehiculos livianos, pesados rigidos y "
            "motocicletas 4T. El alcance no incluye ciclomotores, motocicletas con llanta gemela, tricimotos, "
            "vehiculos electricos, cuatrimotos, motocarros, cuadriciclos, vehiculos articulados y biarticulados."
        ),
        (
            "2. Si en inspeccion sensorial se detectan defectos como labrado insuficiente o inferior a marcas de "
            "desgaste, protuberancias, deformaciones, despegue o rotura en banda de rodamiento de una o mas "
            "llantas, no se realizara la prueba de frenos para proteger vehiculos y personal del CDA, en "
            "cumplimiento de ISO/IEC 17020:2012."
        ),
        (
            "3. Durante la RTMyEC, el vehiculo sera sometido a pruebas con el grado de exigencia definido en la "
            "normatividad y manuales de fabricante de equipos. El CDA no se hace responsable por danos derivados "
            "de desgaste o mal estado previo de piezas del vehiculo."
        ),
        (
            "4. Por seguridad, propietario o tenedor no debe ingresar a las lineas de inspeccion. El CDA dispone "
            "sala de espera para evidenciar el proceso. No se permite interaccion directa con personal de linea; "
            "si requiere apoyo, comunicarse con ingenieria responsable."
        ),
        (
            "5. El pago de la RTMyEC no esta sujeto a expedicion del certificado. Si el vehiculo es rechazado, "
            "dispone de quince (15) dias calendario desde la reprobacion para correcciones y segunda oportunidad "
            "sin costo adicional (Art. 28 Res. 3768 de 2013 y Art. 6 Res. 3625 de 2020). En segunda inspeccion se "
            "realiza sensorial completa y revision gratuita de aspectos reprobados. Si se evidencia alteracion "
            "posterior, se realiza revision total como primera vez y genera cobro."
        ),
        (
            "6. Si un vehiculo liviano registra peso vacio superior a 3500 kg, se reasignara como pesado y se "
            "cancelara excedente por parte del usuario. Esto puede generar retrocesos del proceso."
        ),
        (
            "7. Las tarifas de inspeccion estan reguladas por marco normativo y publicadas en sala de espera y "
            "recepcion de vehiculos (Res. 3318 de 2015 y normas que la modifiquen o deroguen)."
        ),
        "8. Una vez activada la inspeccion, el CDA no realizara devoluciones de dinero.",
        (
            "9. Abstengase de dar propinas, obsequios o cualquier remuneracion por certificacion del vehiculo. "
            "Esto compromete independencia e imparcialidad del proceso y la estabilidad laboral del colaborador."
        ),
        (
            "10. Si se presenta falla del vehiculo durante inspeccion, el CDA no realiza ajustes o reparaciones. "
            "Su objetivo es evaluar parametros de revision. Si se identifica riesgo para personas, infraestructura "
            "o vehiculo, se cancelara la inspeccion y el usuario debera ajustar para iniciar revision total."
        ),
        (
            "11. Los resultados de inspeccion son confiables, confidenciales y protegidos. El certificado RTMyEC "
            "es valido cuando se reporta al RUNT. Los resultados y datos del FUR/certificado podran suministrarse "
            "a RUNT, SICOV, Ministerio de Transporte, Supertransporte, corporaciones ambientales, operador de "
            "recaudo, proveedor tecnologico (software contable), ONAC y auditorias internas."
        ),
        "12. El vehiculo podria ser objeto de atestiguamiento por evaluaciones ONAC y auditorias internas.",
        (
            "13. Al finalizar inspeccion, revise dentro del CDA su vehiculo, documentos y resultados entregados. "
            "Al retirarse del CDA, este no se hace responsable por danos o perdida de elementos/documentos."
        ),
        (
            "14. Usted tiene derecho a registrar queja por el servicio o apelacion por resultado de inspeccion. "
            "Solicite formato de Queja o Apelacion y revise instrucciones publicadas en sala de espera."
        ),
        (
            "15. En vehiculos gas-gasolina (bicombustible), segun Res. 0762:2022, la prueba debe realizarse a "
            "gasolina. Si no funciona con ese combustible, no se permite ingreso."
        ),
    ]
    for item in condiciones:
        flow.append(_safe_para_with_cda_alias(item, body_style, tenant_nombre))

    flow.append(Spacer(1, 0.06 * inch))
    aceptacion_texto = [
        [
            Paragraph(
                _xml_esc(
                    "Acepto los lineamientos y condiciones contractuales relacionados en el presente documento y "
                    "manifiesto que la presente autorizacion me fue solicitada antes de entregar mis datos y la "
                    "suscribo de forma libre y voluntaria una vez leida en su totalidad, al igual que la Politica "
                    "de Tratamiento de Datos Personales."
                ),
                body_style,
            )
        ],
        [
            Paragraph(
                _xml_esc(
                    "Acuso recibo de mi vehiculo en las condiciones en que lo entregue, de los documentos "
                    "suministrados al inicio del proceso y de los resultados de la inspeccion (FUR). El FUR "
                    "recibido esta firmado y fue socializado por el director tecnico del establecimiento."
                ),
                body_style,
            )
        ],
    ]
    aceptacion_table = Table(aceptacion_texto, colWidths=[7.25 * inch])
    aceptacion_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.55, slate_300),
                ("BACKGROUND", (0, 0), (-1, -1), amber_50),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    flow.append(aceptacion_table)
    flow.append(Spacer(1, 0.06 * inch))

    firma_buffer = _decode_signature_data_url(firma_titular.get("data_url") if isinstance(firma_titular, dict) else None)
    if firma_buffer is not None:
        try:
            firma_block: list[Any] = [Spacer(1, 0.05 * inch), Paragraph("FIRMA CAPTURADA DEL TITULAR", signature_center_style)]
            firma_img = Image(firma_buffer, width=2.4 * inch, height=0.95 * inch, kind="proportional")
            firma_img.hAlign = "CENTER"
            firma_block.append(firma_img)
            signer_name = _to_text((firma_titular or {}).get("signer_name"), default="")
            signed_at = _to_text((firma_titular or {}).get("signed_at"), default="")
            if signer_name != "—" or signed_at != "—":
                firma_block.append(
                    Paragraph(
                        f"<b>Firmante:</b> {_xml_esc(signer_name)}<br/><b>Fecha firma:</b> {_xml_esc(signed_at)}",
                        signature_center_style,
                    )
                )
            flow.append(KeepTogether(firma_block))
        except Exception:
            pass

    flow.append(Spacer(1, 0.1 * inch))
    flow.append(_section_banner("CONSTANCIA DE ACEPTACION ELECTRONICA"))
    constancia_table = Table(
        [[
            Paragraph(
                _xml_esc(
                    "En ausencia de firma autografa en soporte fisico, la aceptacion de la presente autorizacion "
                    "queda acreditada mediante el registro electronico de la firma del cliente, la firma del "
                    "operario de pre-revision y del registro del vehiculo en recepcion y el envio de este documento "
                    "al correo del titular, con la fecha y hora "
                    "indicadas a continuacion (trazabilidad del sistema), conforme al uso de medios electronicos y "
                    "a las reglas aplicables al tratamiento de datos personales."
                ),
                small_style,
            )
        ],
         [
            Paragraph(
                f"<b>Fecha y hora del registro:</b> {_xml_esc(constancia_fecha)} ({_xml_esc(constancia_tz)})<br/>"
                f"<b>Placa:</b> {_xml_esc(_to_text(placa))}<br/>"
                f"<b>Correo de notificacion al titular:</b> {_xml_esc(_to_text(cliente_email))}",
                small_style,
            )
        ],
         [
            Paragraph(
                f"<b>Nombre completo:</b> {_xml_esc(_to_text(cliente_nombre))}<br/>"
                f"<b>Documento de identidad:</b> {_xml_esc(_to_text(cliente_documento))}<br/>"
                f"<b>Fecha:</b> {_xml_esc(constancia_fecha.split(' ')[0] if constancia_fecha != '—' else '—')}",
                body_style,
            )
        ]],
        colWidths=[7.25 * inch],
    )
    constancia_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.55, slate_300),
                ("BACKGROUND", (0, 0), (-1, -1), emerald_50),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    flow.append(constancia_table)

    doc.build(flow)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes
