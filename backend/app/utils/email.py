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


def generar_email_recuperacion_password(nombre: str, enlace_reset: str) -> str:
    """
    Generar HTML del email de recuperación de contraseña
    
    Args:
        nombre: Nombre del usuario
        enlace_reset: URL con el token para resetear contraseña
    
    Returns:
        HTML del email
    """
    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {{
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #0f172a;
            }}
            .container {{
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f8fafc;
            }}
            .card {{
                background-color: white;
                border-radius: 12px;
                padding: 30px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }}
            .brand {{
                text-align: center;
                margin-bottom: 20px;
            }}
            .brand h1 {{
                color: #2563eb;
                margin: 0;
                font-size: 28px;
            }}
            .content {{
                margin: 20px 0;
            }}
            .button {{
                display: inline-block;
                padding: 12px 30px;
                background-color: #2563eb;
                color: white;
                text-decoration: none;
                border-radius: 5px;
                margin: 20px 0;
            }}
            .footer {{
                text-align: center;
                margin-top: 20px;
                font-size: 12px;
                color: #666;
            }}
            .warning {{
                background-color: #fff7ed;
                border-left: 4px solid #f59e0b;
                padding: 10px;
                margin: 15px 0;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="card">
                <div class="brand">
                    <h1>CDASOFT</h1>
                    <p>Sistema integral para administracion de CDA</p>
                </div>
                
                <div class="content">
                    <h2>Hola {nombre},</h2>
                    <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
                    <p>Haz clic en el siguiente botón para crear una nueva contraseña:</p>
                    
                    <div style="text-align: center;">
                        <a href="{enlace_reset}" class="button">Restablecer Contraseña</a>
                    </div>
                    
                    <div class="warning">
                        <strong>⚠️ Importante:</strong>
                        <ul>
                            <li>Este enlace es válido por <strong>30 minutos</strong></li>
                            <li>Si no solicitaste este cambio, ignora este email</li>
                            <li>Tu contraseña actual seguirá siendo válida</li>
                        </ul>
                    </div>
                    
                    <p>Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
                    <p style="word-break: break-all; color: #666; font-size: 12px;">{enlace_reset}</p>
                </div>
                
                <div class="footer">
                    <p>© 2026 CDASOFT</p>
                    <p>Este es un email automático, por favor no respondas a este mensaje.</p>
                </div>
            </div>
        </div>
    </body>
    </html>
    """


def generar_email_codigo_onboarding(nombre_cda: str, codigo: str) -> str:
    """Generar HTML para código de verificación de onboarding."""
    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {{
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #0f172a;
            }}
            .container {{
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f8fafc;
            }}
            .card {{
                background-color: white;
                border-radius: 12px;
                padding: 30px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }}
            .brand {{
                text-align: center;
                margin-bottom: 20px;
            }}
            .brand h1 {{
                color: #2563eb;
                margin: 0;
                font-size: 28px;
            }}
            .code {{
                font-size: 32px;
                font-weight: bold;
                letter-spacing: 6px;
                text-align: center;
                margin: 20px 0;
                color: #1e293b;
            }}
            .footer {{
                text-align: center;
                margin-top: 20px;
                font-size: 12px;
                color: #666;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="card">
                <div class="brand">
                    <h1>CDASOFT</h1>
                    <p>Sistema integral para administracion de CDA</p>
                </div>
                <p>Recibimos una solicitud para crear el CDA <strong>{nombre_cda}</strong>.</p>
                <p>Usa este código para continuar el registro:</p>
                <div class="code">{codigo}</div>
                <p>El código expira en 15 minutos y solo puede usarse una vez.</p>
                <div class="footer">
                    <p>© 2026 CDASOFT</p>
                    <p>Si no solicitaste este registro, ignora este mensaje.</p>
                </div>
            </div>
        </div>
    </body>
    </html>
    """


def generar_email_bienvenida_tenant(nombre_cda: str, nombre_admin: str, login_url: str) -> str:
    """Email de bienvenida con URL personalizada del tenant."""
    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {{
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #0f172a;
            }}
            .container {{
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f8fafc;
            }}
            .card {{
                background-color: white;
                border-radius: 12px;
                padding: 30px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }}
            .button {{
                display: inline-block;
                padding: 12px 30px;
                background-color: #2563eb;
                color: white;
                text-decoration: none;
                border-radius: 5px;
                margin: 20px 0;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="card">
                <h1>Bienvenido a CDASOFT</h1>
                <p>Hola {nombre_admin},</p>
                <p>Tu CDA <strong>{nombre_cda}</strong> ya está creado.</p>
                <p>Tu URL personalizada para ingresar es:</p>
                <p><strong>{login_url}</strong></p>
                <div style="text-align:center;">
                    <a href="{login_url}" class="button">Ingresar a mi CDA</a>
                </div>
                <p>Guarda este enlace y compártelo con tu equipo autorizado.</p>
            </div>
        </div>
    </body>
    </html>
    """


def generar_email_recibo_pago_saas(
    nombre_cda: str,
    referencia: str,
    monto: float,
    fecha_pago: str,
    proximo_cobro: str,
) -> str:
    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {{ font-family: Arial, sans-serif; color: #0f172a; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc; }}
            .card {{ background: white; border-radius: 12px; padding: 24px; }}
            .badge {{ display: inline-block; background: #dcfce7; color: #166534; padding: 6px 10px; border-radius: 999px; font-size: 12px; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="card">
                <h2>Recibo de pago CDASOFT</h2>
                <p>Hemos registrado tu pago para <strong>{nombre_cda}</strong>.</p>
                <p><span class="badge">Referencia: {referencia}</span></p>
                <ul>
                    <li>Monto: <strong>${monto:,.0f}</strong></li>
                    <li>Fecha de pago: <strong>{fecha_pago}</strong></li>
                    <li>Próximo cobro: <strong>{proximo_cobro}</strong></li>
                </ul>
                <p>Adjunto encontrarás el recibo en PDF.</p>
            </div>
        </div>
    </body>
    </html>
    """
