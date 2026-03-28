"""
Endpoints de Notificaciones de Cierre de Caja
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import and_
from datetime import datetime, timezone
from typing import List
from pydantic import BaseModel
from uuid import UUID

from app.core.deps import get_db, get_admin
from app.models.usuario import Usuario
from app.models.notificacion_cierre import NotificacionCierreCaja, EstadoNotificacion

router = APIRouter()


class NotificacionResponse(BaseModel):
    id: str
    caja_id: str
    turno: str
    cajera_nombre: str
    fecha_cierre: datetime
    efectivo_entregar: float
    monto_sistema: float
    monto_fisico: float
    diferencia: float
    observaciones: str | None
    estado: str
    created_at: datetime
    
    class Config:
        from_attributes = True


@router.get("/pendientes", response_model=List[NotificacionResponse])
def obtener_notificaciones_pendientes(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    """
    Obtener notificaciones de cierre de caja pendientes (solo para administradores)
    """
    notificaciones = db.query(NotificacionCierreCaja).filter(
        NotificacionCierreCaja.estado == EstadoNotificacion.PENDIENTE,
        NotificacionCierreCaja.tenant_id == current_user.tenant_id
    ).order_by(NotificacionCierreCaja.created_at.desc()).all()
    
    return [
        NotificacionResponse(
            id=str(n.id),
            caja_id=str(n.caja_id),
            turno=n.turno,
            cajera_nombre=n.cajera_nombre,
            fecha_cierre=n.fecha_cierre,
            efectivo_entregar=float(n.efectivo_entregar),
            monto_sistema=float(n.monto_sistema),
            monto_fisico=float(n.monto_fisico),
            diferencia=float(n.diferencia),
            observaciones=n.observaciones,
            estado=n.estado.value,
            created_at=n.created_at
        )
        for n in notificaciones
    ]


@router.post("/{notificacion_id}/marcar-leida")
def marcar_notificacion_como_leida(
    notificacion_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    """
    Marcar una notificación como leída
    """
    notificacion = db.query(NotificacionCierreCaja).filter(
        NotificacionCierreCaja.id == notificacion_id,
        NotificacionCierreCaja.tenant_id == current_user.tenant_id
    ).first()
    
    if not notificacion:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notificación no encontrada"
        )
    
    notificacion.estado = EstadoNotificacion.LEIDA
    notificacion.leida_por_id = current_user.id
    notificacion.fecha_lectura = datetime.now(timezone.utc)
    
    db.commit()
    
    return {"message": "Notificación marcada como leída"}


@router.delete("/{notificacion_id}")
def archivar_notificacion(
    notificacion_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin)
):
    """
    Archivar/eliminar una notificación
    """
    notificacion = db.query(NotificacionCierreCaja).filter(
        NotificacionCierreCaja.id == notificacion_id,
        NotificacionCierreCaja.tenant_id == current_user.tenant_id
    ).first()
    
    if not notificacion:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notificación no encontrada"
        )
    
    notificacion.estado = EstadoNotificacion.ARCHIVADA
    db.commit()
    
    return {"message": "Notificación archivada"}
