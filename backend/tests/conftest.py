"""
Registra modelos SQLAlchemy al cargar pytest (antes de importar los tests).
"""
import app.models.appointment  # noqa: F401
import app.models.audit_log  # noqa: F401
import app.models.caja  # noqa: F401
import app.models.notificacion_cierre  # noqa: F401
import app.models.password_reset_token  # noqa: F401
import app.models.quality  # noqa: F401
import app.models.rtm_reminder  # noqa: F401
import app.models.saas_user  # noqa: F401
import app.models.support_ticket  # noqa: F401
import app.models.tarifa  # noqa: F401
import app.models.tenant  # noqa: F401
import app.models.tesoreria  # noqa: F401
import app.models.usuario  # noqa: F401
import app.models.vehiculo  # noqa: F401
import app.models.sucursal  # noqa: F401
