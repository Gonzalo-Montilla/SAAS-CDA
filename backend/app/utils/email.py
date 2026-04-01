"""
Utilidad para envío de emails
"""
import smtplib
from email import encoders
from email.mime.base import MIMEBase
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.core.config import settings


def enviar_email(destinatario: str, asunto: str, cuerpo_html: str) -> bool:
    """
    Enviar email usando Gmail SMTP
    
    Args:
        destinatario: Email del destinatario
        asunto: Asunto del email
        cuerpo_html: Contenido HTML del email
    
    Returns:
        True si se envió correctamente, False en caso contrario
    """
    try:
        # Crear mensaje
        mensaje = MIMEMultipart("alternative")
        mensaje["From"] = settings.SMTP_USER
        mensaje["To"] = destinatario
        mensaje["Subject"] = asunto
        
        # Agregar contenido HTML
        parte_html = MIMEText(cuerpo_html, "html", "utf-8")
        mensaje.attach(parte_html)
        
        # Conectar al servidor SMTP de Gmail
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            server.starttls()  # Seguridad TLS
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.send_message(mensaje)
        
        return True
    
    except Exception as e:
        print(f"Error al enviar email: {e}")
        return False


def enviar_email_con_adjuntos(
    destinatario: str,
    asunto: str,
    cuerpo_html: str,
    adjuntos: list[tuple[str, bytes, str]],
) -> bool:
    """
    Enviar email HTML con archivos adjuntos.
    Cada adjunto: (nombre_archivo, contenido_bytes, mime_type).
    """
    try:
        mensaje = MIMEMultipart("mixed")
        mensaje["From"] = settings.SMTP_USER
        mensaje["To"] = destinatario
        mensaje["Subject"] = asunto

        cuerpo = MIMEMultipart("alternative")
        cuerpo.attach(MIMEText(cuerpo_html, "html", "utf-8"))
        mensaje.attach(cuerpo)

        for nombre, contenido, mime_type in adjuntos:
            main_type, sub_type = (mime_type.split("/", 1) + ["octet-stream"])[:2]
            part = MIMEBase(main_type, sub_type)
            part.set_payload(contenido)
            encoders.encode_base64(part)
            part.add_header("Content-Disposition", f'attachment; filename="{nombre}"')
            mensaje.attach(part)

        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.send_message(mensaje)

        return True
    except Exception as e:
        print(f"Error al enviar email con adjuntos: {e}")
        return False


def _render_email_corporativo(title: str, body_html: str, label: str = "CDASOFT") -> str:
    """Plantilla corporativa base para estandarizar estilo de correos."""
    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {{
                font-family: "Segoe UI", Arial, sans-serif;
                line-height: 1.6;
                color: #0f172a;
                margin: 0;
                padding: 0;
                background: #eef2f7;
            }}
            .container {{
                max-width: 640px;
                margin: 0 auto;
                padding: 24px 16px;
            }}
            .brand-head {{
                background: linear-gradient(135deg, #0f172a, #1e3a8a);
                color: #e2e8f0;
                border-radius: 12px 12px 0 0;
                padding: 14px 20px;
                font-size: 12px;
                letter-spacing: 0.4px;
                text-transform: uppercase;
                font-weight: 600;
            }}
            .card {{
                background: #ffffff;
                border-radius: 0 0 12px 12px;
                padding: 28px 24px;
                border: 1px solid #dbe5f1;
                border-top: 0;
                box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
            }}
            .title {{
                font-size: 28px;
                font-weight: 700;
                color: #0f172a;
                margin: 0 0 14px 0;
            }}
            .muted {{
                color: #475569;
                font-size: 14px;
            }}
            .highlight {{
                background: #f8fafc;
                border: 1px solid #e2e8f0;
                border-left: 4px solid #2563eb;
                border-radius: 8px;
                padding: 12px 14px;
                margin: 18px 0;
                color: #1e293b;
            }}
            .button {{
                display: inline-block;
                padding: 12px 20px;
                background-color: #2563eb;
                color: white !important;
                text-decoration: none;
                border-radius: 8px;
                margin: 14px 0;
                font-weight: 600;
            }}
            .legal {{
                margin-top: 20px;
                font-size: 11px;
                color: #94a3b8;
                border-top: 1px solid #e2e8f0;
                padding-top: 12px;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="brand-head">{label}</div>
            <div class="card">
                <h1 class="title">{title}</h1>
                {body_html}
                <p class="legal">
                    Este mensaje fue generado automáticamente por el sistema.
                </p>
            </div>
        </div>
    </body>
    </html>
    """


def generar_email_recuperacion_password(
    nombre: str,
    enlace_reset: str,
    tenant_nombre: str | None = None,
) -> str:
    """
    Generar HTML del email de recuperación de contraseña
    
    Args:
        nombre: Nombre del usuario
        enlace_reset: URL con el token para resetear contraseña
    
    Returns:
        HTML del email
    """
    tenant_display = (tenant_nombre or "").strip()
    body_html = f"""
    <p>Hola {nombre},</p>
    <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
    {f'<p class="muted"><strong>Tenant:</strong> {tenant_display}</p>' if tenant_display else ''}
    <p>Haz clic en el siguiente botón para crear una nueva contraseña:</p>
    <p style="text-align:center;">
        <a href="{enlace_reset}" class="button">Restablecer contraseña</a>
    </p>
    <div class="highlight">
        <strong>Importante:</strong>
        <ul style="margin:8px 0 0 18px; padding:0;">
            <li>Este enlace es válido por <strong>30 minutos</strong>.</li>
            <li>Si no solicitaste este cambio, ignora este mensaje.</li>
            <li>Tu contraseña actual seguirá vigente.</li>
        </ul>
    </div>
    <p class="muted">Si el botón no funciona, copia y pega este enlace:</p>
    <p class="muted" style="word-break: break-all;">{enlace_reset}</p>
    """
    return _render_email_corporativo(
        title=f"Recuperación de contraseña{' - ' + tenant_display if tenant_display else ''}",
        body_html=body_html,
        label=f"Seguridad {tenant_display}" if tenant_display else "Seguridad CDASOFT",
    )


def generar_email_codigo_onboarding(nombre_cda: str, codigo: str) -> str:
    """Generar HTML para código de verificación de onboarding."""
    body_html = f"""
    <p>Recibimos una solicitud para crear el CDA <strong>{nombre_cda}</strong>.</p>
    <p>Usa este código para continuar el registro:</p>
    <div class="highlight" style="text-align:center;">
        <span style="font-size:32px; letter-spacing:6px; font-weight:700;">{codigo}</span>
    </div>
    <p class="muted">El código expira en 15 minutos y solo puede usarse una vez.</p>
    """
    return _render_email_corporativo(
        title=f"Código de verificación - {nombre_cda}",
        body_html=body_html,
        label=f"Onboarding - {nombre_cda}",
    )


def generar_email_bienvenida_tenant(nombre_cda: str, nombre_admin: str, login_url: str) -> str:
    """Email de bienvenida con URL personalizada del tenant."""
    body_html = f"""
    <p>Hola {nombre_admin},</p>
    <p>Tu CDA <strong>{nombre_cda}</strong> ya está creado.</p>
    <p>Tu URL personalizada para ingresar es:</p>
    <div class="highlight">
        <strong>{login_url}</strong>
    </div>
    <p style="text-align:center;">
        <a href="{login_url}" class="button">Ingresar a mi CDA</a>
    </p>
    <p class="muted">Guarda este enlace y compártelo solo con tu equipo autorizado.</p>
    """
    return _render_email_corporativo(
        title=f"Bienvenido a {nombre_cda}",
        body_html=body_html,
        label=f"Alta de tenant - {nombre_cda}",
    )


def generar_email_bienvenida_recepcion_cliente(
    nombre_cda: str,
    placa_vehiculo: str,
) -> str:
    """Email de bienvenida para cliente al registrar su vehículo en recepción."""
    body_html = f"""
    <p class="muted">
        Queremos que sepas que estamos muy felices de que cuentes con nosotros y nos sentimos
        más que satisfechos de que deposites tu confianza en nuestro trabajo.
        Para nosotros es un placer atenderte.
    </p>
    <div class="highlight">
        Tu vehículo de placa <strong>{placa_vehiculo}</strong> ya se encuentra en revisión.
        Mientras tanto, te invitamos a pasar a nuestra sala de espera, donde puedes relajarte
        y disfrutar de las amenidades que {nombre_cda} tiene preparadas para ti.
    </div>
    <p>Estamos para servirte.</p>
    <p class="muted">
        Saludos,<br />
        El equipo de {nombre_cda}
    </p>
    """
    return _render_email_corporativo(
        title=f"¡Bienvenido a {nombre_cda}!",
        body_html=body_html,
        label=f"Notificación de recepción - {nombre_cda}",
    )


def generar_email_recibo_pago_saas(
    nombre_cda: str,
    referencia: str,
    monto: float,
    fecha_pago: str,
    proximo_cobro: str,
) -> str:
    body_html = f"""
    <p>Hemos registrado tu pago para <strong>{nombre_cda}</strong>.</p>
    <div class="highlight">
        <p style="margin:0 0 6px 0;"><strong>Referencia:</strong> {referencia}</p>
        <p style="margin:0 0 6px 0;"><strong>Monto:</strong> ${monto:,.0f}</p>
        <p style="margin:0 0 6px 0;"><strong>Fecha de pago:</strong> {fecha_pago}</p>
        <p style="margin:0;"><strong>Próximo cobro:</strong> {proximo_cobro}</p>
    </div>
    <p class="muted">Adjunto encontrarás el recibo en PDF.</p>
    """
    return _render_email_corporativo(
        title=f"Recibo de pago - {nombre_cda}",
        body_html=body_html,
        label=f"Facturación - {nombre_cda}",
    )
