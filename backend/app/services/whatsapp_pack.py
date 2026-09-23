"""Paquete de plantillas WhatsApp al cliente (1 CDA = 1 WABA).

No incluye correo interno: recuperación de clave, onboarding, recibo SaaS, copia DS al CDA.
RTM anual y preventiva son plantillas distintas: no se mezclan.
"""
from __future__ import annotations

from typing import TypedDict


class PlantillaPack(TypedDict):
    evento: str
    nombre: str
    grupo: str
    variables: int
    ejemplos: list[str]
    cuerpo: str


PACK: list[PlantillaPack] = [
    {
        "evento": "bienvenida",
        "nombre": "cdasoft_bienvenida",
        "grupo": "visita",
        "variables": 3,
        "ejemplos": ["Juan", "CDA Quitamelsueño", "ABC123"],
        "cuerpo": (
            "Hola {{1}}, en {{2}} ya recibimos su vehículo de placa {{3}}. "
            "Puede esperar en la sala. Gracias."
        ),
    },
    {
        "evento": "caja",
        "nombre": "cdasoft_pase_caja",
        "grupo": "visita",
        "variables": 2,
        "ejemplos": ["Juan", "CDA Quitamelsueño"],
        "cuerpo": (
            "Hola {{1}}, en {{2}} lo invitamos a pasar a caja para realizar el pago. Gracias."
        ),
    },
    {
        "evento": "recibo",
        "nombre": "cdasoft_recibo",
        "grupo": "visita",
        "variables": 3,
        "ejemplos": ["Juan", "CDA Quitamelsueño", "ABC123"],
        "cuerpo": (
            "Hola {{1}}, en {{2}} ya registramos el pago del vehículo {{3}}. "
            "El recibo también se envió a su correo. Gracias."
        ),
    },
    {
        "evento": "recibo_fe",
        "nombre": "cdasoft_recibo_fe",
        "grupo": "visita",
        "variables": 4,
        "ejemplos": [
            "Juan",
            "CDA Quitamelsueño",
            "ABC123",
            "https://www.cdasoft.com.co/factura/ejemplo",
        ],
        "cuerpo": (
            "Hola {{1}}, en {{2}} ya registramos el pago del vehículo {{3}}. "
            "Vea su factura electrónica aquí: {{4}}. Gracias."
        ),
    },
    {
        "evento": "aprobado",
        "nombre": "cdasoft_aprobado",
        "grupo": "visita",
        "variables": 3,
        "ejemplos": ["Juan", "CDA Quitamelsueño", "ABC123"],
        "cuerpo": (
            "Hola {{1}}, en {{2}} tenemos una muy buena noticia: el vehículo de placa {{3}} "
            "aprobó la inspección. ¡Felicitaciones! Gracias por confiar en nosotros."
        ),
    },
    {
        "evento": "reinspeccion",
        "nombre": "cdasoft_reinspeccion",
        "grupo": "visita",
        "variables": 3,
        "ejemplos": ["Juan", "CDA Quitamelsueño", "ABC123"],
        "cuerpo": (
            "Hola {{1}}, en {{2}} la inspección de la placa {{3}} no fue aprobada. "
            "Tiene derecho a reinspección sin costo dentro de 15 días calendario. "
            "Comuníquese con el CDA. Gracias."
        ),
    },
    {
        "evento": "cita",
        "nombre": "cdasoft_cita_ok",
        "grupo": "citas",
        "variables": 5,
        "ejemplos": ["Juan", "CDA Quitamelsueño", "23 de septiembre de 2026", "08:00", "ABC123"],
        "cuerpo": (
            "Hola {{1}}, su cita en {{2}} quedó para el {{3}} a las {{4}}, placa {{5}}. "
            "Llegue unos minutos antes. Gracias."
        ),
    },
    {
        "evento": "cita_recordatorio",
        "nombre": "cdasoft_cita_recordatorio",
        "grupo": "citas",
        "variables": 5,
        "ejemplos": ["Juan", "CDA Quitamelsueño", "23 de septiembre de 2026", "08:00", "ABC123"],
        "cuerpo": (
            "Hola {{1}}, le recordamos su cita en {{2}} el {{3}} a las {{4}}, placa {{5}}. "
            "Llegue unos minutos antes. Gracias."
        ),
    },
    {
        "evento": "rtm",
        "nombre": "cdasoft_rtm",
        "grupo": "vencimientos",
        "variables": 5,
        "ejemplos": [
            "Juan",
            "CDA Quitamelsueño",
            "ABC123",
            "15 de noviembre de 2026",
            "https://www.cdasoft.com.co/agendar/ejemplo",
        ],
        "cuerpo": (
            "Hola {{1}}, en {{2}} su revisión técnico-mecánica de la placa {{3}} está por vencer. "
            "Fecha sugerida: {{4}}. Agende aquí: {{5}}. Gracias."
        ),
    },
    {
        "evento": "preventiva",
        "nombre": "cdasoft_preventiva",
        "grupo": "vencimientos",
        "variables": 5,
        "ejemplos": [
            "Juan",
            "CDA Quitamelsueño",
            "ABC123",
            "15 de noviembre de 2026",
            "https://www.cdasoft.com.co/agendar/ejemplo",
        ],
        "cuerpo": (
            "Hola {{1}}, en {{2}} lo esperamos para la revisión preventiva de la placa {{3}}. "
            "Fecha sugerida: {{4}}. Agende aquí: {{5}}. Gracias."
        ),
    },
    {
        "evento": "rtm_vencida",
        "nombre": "cdasoft_rtm_vencida",
        "grupo": "vencimientos",
        "variables": 5,
        "ejemplos": [
            "Juan",
            "CDA Quitamelsueño",
            "ABC123",
            "15 de noviembre de 2026",
            "https://www.cdasoft.com.co/agendar/ejemplo",
        ],
        "cuerpo": (
            "Hola {{1}}, en {{2}} la revisión técnico-mecánica de la placa {{3}} ya venció "
            "({{4}}). Agende aquí: {{5}}. Gracias."
        ),
    },
    {
        "evento": "preventiva_vencida",
        "nombre": "cdasoft_preventiva_vencida",
        "grupo": "vencimientos",
        "variables": 5,
        "ejemplos": [
            "Juan",
            "CDA Quitamelsueño",
            "ABC123",
            "15 de noviembre de 2026",
            "https://www.cdasoft.com.co/agendar/ejemplo",
        ],
        "cuerpo": (
            "Hola {{1}}, en {{2}} la revisión preventiva de la placa {{3}} ya debió realizarse "
            "({{4}}). Agende aquí: {{5}}. Gracias."
        ),
    },
    {
        "evento": "calidad",
        "nombre": "encuesta_calidad",
        "grupo": "calidad",
        "variables": 3,
        "ejemplos": [
            "Juan",
            "CDA Quitamelsueño",
            "https://www.cdasoft.com.co/calidad/encuesta/ejemplo",
        ],
        "cuerpo": (
            "Hola {{1}}, en {{2}} queremos conocer su experiencia. Responda aquí: {{3}}. Gracias."
        ),
    },
]


def plantilla_por_evento(evento: str) -> PlantillaPack | None:
    for item in PACK:
        if item["evento"] == evento:
            return item
    return None
