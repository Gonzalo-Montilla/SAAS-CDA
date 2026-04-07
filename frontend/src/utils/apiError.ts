/**
 * Mensaje de error legible desde respuestas FastAPI / Axios (detail string, array de validación, etc.).
 */
export function extractApiErrorMessage(err: unknown, fallback: string): string {
  const e = err as {
    code?: string;
    message?: string;
    response?: { data?: { detail?: unknown } };
  };

  if (
    e?.code === 'ECONNABORTED' ||
    (typeof e?.message === 'string' && e.message.includes('timeout'))
  ) {
    if (import.meta.env.DEV) {
      return 'Tiempo de espera agotado al hablar con el API. Comprueba: 1) Backend en http://127.0.0.1:8000 (abre /docs o /health). 2) Tras cambiar .env reinicia npm run dev. 3) Si la base de datos está en otro servidor, que DATABASE_URL sea alcanzable.';
    }
    return 'La petición expiró: el servidor no respondió a tiempo. Revisa que el backend esté arriba y que la URL del API (VITE_API_URL en el build) apunte al dominio correcto, sin mezclar HTTPS del sitio con HTTP del API bloqueado por el navegador.';
  }

  const detail = e?.response?.data?.detail;

  if (typeof detail === 'string' && detail.trim()) {
    return detail.trim();
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        if (item && typeof (item as { msg?: string }).msg === 'string') {
          const loc = Array.isArray((item as { loc?: unknown }).loc)
            ? (item as { loc: unknown[] }).loc
                .filter((part: unknown) => typeof part === 'string')
                .join('.')
            : '';
          const msg = (item as { msg: string }).msg;
          return loc ? `${loc}: ${msg}` : msg;
        }
        return '';
      })
      .filter(Boolean);

    if (messages.length > 0) {
      return messages.join(' | ');
    }
  }

  if (typeof e?.message === 'string' && e.message.trim()) {
    return e.message;
  }

  return fallback;
}
