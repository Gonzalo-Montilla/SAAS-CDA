"""
Modelo de Auditoría - Registro de operaciones críticas
"""
from sqlalchemy import Column, String, DateTime, Text, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID, JSONB
from datetime import datetime, timezone
import uuid
import enum

from app.db.database import Base


class AuditAction(str, enum.Enum):
    """Tipos de acciones auditables"""
    # Autenticación
    LOGIN = "login"
    LOGOUT = "logout"
    FAILED_LOGIN = "failed_login"
    
    # Usuarios
    CREATE_USER = "create_user"
    UPDATE_USER = "update_user"
    DELETE_USER = "delete_user"
    CHANGE_PASSWORD = "change_password"
    
    # Caja
    OPEN_CAJA = "open_caja"
    CLOSE_CAJA = "close_caja"
    REGISTER_GASTO = "register_gasto"
    REGISTER_INGRESO_EXTRA = "register_ingreso_extra"
    
    # Tesorería
    CREATE_MOVEMENT = "create_tesoreria_movement"
    UPDATE_MOVEMENT = "update_tesoreria_movement"
    DELETE_MOVEMENT = "delete_tesoreria_movement"
    
    # Tarifas
    CREATE_TARIFA = "create_tarifa"
    UPDATE_TARIFA = "update_tarifa"
    ACTIVATE_TARIFA = "activate_tarifa"
    DEACTIVATE_TARIFA = "deactivate_tarifa"
    
    # Vehículos
    REGISTER_VEHICLE = "register_vehicle"
    UPDATE_VEHICLE = "update_vehicle"
    DELETE_VEHICLE = "delete_vehicle"
    CORRECT_INSPECTION_RESULT = "correct_inspection_result"


class AuditLog(Base):
    """Registro de auditoría del sistema"""
    __tablename__ = "audit_logs"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # Información de la acción
    action = Column(String(50), nullable=False, index=True)  # Almacena el valor del enum como string
    description = Column(String(500), nullable=False)
    
    # Usuario que realizó la acción
    usuario_id = Column(UUID(as_uuid=True), nullable=True, index=True)  # Null para acciones anónimas (login fallido)
    usuario_email = Column(String(255), nullable=True)
    usuario_nombre = Column(String(200), nullable=True)
    usuario_rol = Column(String(50), nullable=True)
    
    # Información de la solicitud
    ip_address = Column(String(45), nullable=True)  # Soporta IPv6
    user_agent = Column(String(500), nullable=True)
    
    # Datos adicionales (JSON flexible)
    extra_data = Column(JSONB, nullable=True)  # Información específica de la acción
    
    # Resultado
    success = Column(String(20), nullable=False, default="success")  # "success", "failed", "error"
    error_message = Column(Text, nullable=True)
    
    # Timestamp
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
    
    def __repr__(self):
        return f"<AuditLog {self.action} by {self.usuario_email} at {self.created_at}>"
