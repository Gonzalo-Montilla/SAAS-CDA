import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Camera, RotateCcw, X } from 'lucide-react';

/** Licencia de tránsito colombiana (formato ID-1). */
const TARJETA_ASPECT = 85.6 / 54;
const SALIDA_ANCHO = 1600;

type Props = {
  onClose: () => void;
  onCaptura: (file: File) => void;
  onElegirArchivo: () => void;
};

function pareceMovilOTablet(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Android|webOS|iPhone|iPod|Mobile/i.test(ua)) return true;
  // iPadOS 13+ se anuncia como Macintosh con pantalla táctil.
  if (navigator.maxTouchPoints > 1 && /Mac|iPad/i.test(`${navigator.platform} ${ua}`)) return true;
  return false;
}

function mensajeErrorCamara(error: unknown): string {
  const err = error as { name?: string; message?: string };
  if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
    return 'Permita la cámara en el navegador para fotografiar la tarjeta.';
  }
  if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
    return 'No hay cámara en este equipo.';
  }
  if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
    return 'La cámara está en uso por otra aplicación.';
  }
  return err?.message || 'No se pudo abrir la cámara.';
}

async function pedirCamara(preferirTrasera: boolean): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este navegador no permite cámara en vivo.');
  }
  const facingMode: VideoFacingModeEnum = preferirTrasera ? 'environment' : 'user';
  const movil = pareceMovilOTablet();
  const intentos: MediaStreamConstraints[] = [];
  if (movil && preferirTrasera) {
    intentos.push({ audio: false, video: { facingMode: { exact: 'environment' } } });
  }
  intentos.push(
    {
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: movil ? 1280 : 1920 },
        height: { ideal: movil ? 720 : 1080 },
      },
    },
    { audio: false, video: { facingMode } },
    { audio: false, video: true },
  );
  let ultimo: unknown = null;
  for (const constraints of intentos) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      ultimo = err;
    }
  }
  throw ultimo || new Error('No se pudo abrir la cámara.');
}

function recortarVideoAlMarco(
  video: HTMLVideoElement,
  marco: HTMLElement,
): HTMLCanvasElement | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  const videoRect = video.getBoundingClientRect();
  const marcoRect = marco.getBoundingClientRect();
  const dw = videoRect.width;
  const dh = videoRect.height;
  if (dw < 8 || dh < 8) return null;

  const scale = Math.max(dw / vw, dh / vh);
  const offsetX = (vw * scale - dw) / 2;
  const offsetY = (vh * scale - dh) / 2;
  let sx = (marcoRect.left - videoRect.left + offsetX) / scale;
  let sy = (marcoRect.top - videoRect.top + offsetY) / scale;
  let sw = marcoRect.width / scale;
  let sh = marcoRect.height / scale;

  sx = Math.max(0, Math.min(sx, vw - 1));
  sy = Math.max(0, Math.min(sy, vh - 1));
  sw = Math.max(8, Math.min(sw, vw - sx));
  sh = Math.max(8, Math.min(sh, vh - sy));

  const canvas = document.createElement('canvas');
  canvas.width = SALIDA_ANCHO;
  canvas.height = Math.round(SALIDA_ANCHO / TARJETA_ASPECT);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export default function CapturaTarjetaModal({ onClose, onCaptura, onElegirArchivo }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const marcoRef = useRef<HTMLDivElement>(null);
  const escenarioRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [videoListo, setVideoListo] = useState(false);
  const [preferirTrasera, setPreferirTrasera] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);

  const detenerStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const limpiarPreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    setPreviewBlob(null);
  }, []);

  const iniciar = useCallback(async (trasera: boolean) => {
    setError('');
    setCargando(true);
    setVideoListo(false);
    detenerStream();
    try {
      const stream = await pedirCamara(trasera);
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.srcObject = stream;
      const marcarListo = () => {
        if (video.videoWidth > 0) setVideoListo(true);
      };
      video.onloadedmetadata = marcarListo;
      await video.play();
      marcarListo();
    } catch (err) {
      setError(mensajeErrorCamara(err));
    } finally {
      setCargando(false);
    }
  }, [detenerStream]);

  useEffect(() => {
    if (previewUrl) return undefined;
    void iniciar(preferirTrasera);
    return () => {
      detenerStream();
    };
  }, [iniciar, preferirTrasera, detenerStream, previewUrl]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const capturar = () => {
    const video = videoRef.current;
    const marco = marcoRef.current;
    if (!video || !marco || !videoListo) return;
    const canvas = recortarVideoAlMarco(video, marco);
    if (!canvas) {
      setError('Espere a que la cámara enfoque y reintente.');
      return;
    }
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError('No se pudo capturar la foto.');
          return;
        }
        limpiarPreview();
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        setPreviewUrl(url);
        setPreviewBlob(blob);
        detenerStream();
      },
      'image/jpeg',
      0.88,
    );
  };

  useLayoutEffect(() => {
    if (previewUrl) return undefined;
    const escenario = escenarioRef.current;
    const marco = marcoRef.current;
    if (!escenario || !marco) return undefined;
    const ajustar = () => {
      const pad = escenario.clientWidth < 480 ? 20 : 32;
      const maxW = Math.max(48, escenario.clientWidth - pad);
      const maxH = Math.max(48, escenario.clientHeight - pad);
      let w = Math.min(maxW, 560);
      let h = w / TARJETA_ASPECT;
      if (h > maxH) {
        h = maxH;
        w = h * TARJETA_ASPECT;
      }
      marco.style.width = `${Math.round(w)}px`;
      marco.style.height = `${Math.round(h)}px`;
    };
    ajustar();
    const ro = new ResizeObserver(ajustar);
    ro.observe(escenario);
    return () => ro.disconnect();
  }, [previewUrl, videoListo]);

  const usarFoto = () => {
    if (!previewBlob) return;
    const file = new File([previewBlob], 'tarjeta.jpg', { type: 'image/jpeg' });
    onCaptura(file);
  };

  const retomar = () => {
    limpiarPreview();
  };

  const btnBase =
    'inline-flex items-center justify-center gap-2 min-h-11 px-4 py-2.5 rounded-xl text-sm font-medium touch-manipulation';

  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-slate-900/70 p-0 sm:p-4 backdrop-blur-sm overflow-y-auto overscroll-contain">
      <div className="flex h-[100dvh] sm:h-auto w-full max-w-3xl sm:max-h-[min(92dvh,760px)] flex-col overflow-hidden rounded-none sm:rounded-2xl bg-white shadow-2xl border-0 sm:border border-slate-200">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 shrink-0">
          <div className="min-w-0">
            <h4 className="text-base font-bold text-slate-900 truncate">Foto de la tarjeta original</h4>
            <p className="text-xs text-slate-500 hidden min-[400px]:block">
              Encaje una cara en el recuadro. La foto no se guarda.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2.5 text-slate-500 hover:bg-slate-100 touch-manipulation"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-black flex-1 min-h-0 flex flex-col">
          {previewUrl && (
            <div className="flex flex-1 items-center justify-center p-3 min-h-0">
              <img
                src={previewUrl}
                alt="Vista previa de la tarjeta"
                className="max-h-full max-w-full w-auto rounded-md border border-white/30"
              />
            </div>
          )}
          <div
            ref={escenarioRef}
            className={`relative w-full overflow-hidden bg-black ${
              previewUrl
                ? 'hidden'
                : 'flex-1 min-h-0 sm:min-h-[240px] sm:aspect-video sm:max-h-[min(58dvh,480px)] sm:flex-none'
            }`}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                ref={marcoRef}
                className="relative rounded-md border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
              >
                <span className="absolute left-2 top-2 sm:-top-6 sm:left-0 text-[11px] font-semibold text-white drop-shadow">
                  Encaje la tarjeta aquí
                </span>
              </div>
            </div>
            {cargando && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white px-4 text-center">
                Abriendo cámara...
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="px-4 py-2 text-sm text-red-800 bg-red-50 border-t border-red-100 shrink-0">
            {error}
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-3 border-t border-slate-200 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {previewUrl ? (
            <>
              <button
                type="button"
                onClick={retomar}
                className={`${btnBase} border border-slate-300 text-slate-700 hover:bg-slate-50`}
              >
                <RotateCcw className="w-4 h-4" />
                Tomar de nuevo
              </button>
              <button
                type="button"
                onClick={usarFoto}
                className={`${btnBase} flex-1 bg-primary-600 text-white font-semibold hover:bg-primary-700`}
              >
                <Camera className="w-4 h-4" />
                Usar esta foto
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setPreferirTrasera((v) => !v)}
                disabled={cargando}
                className={`${btnBase} border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60`}
              >
                Cambiar cámara
              </button>
              <button
                type="button"
                onClick={capturar}
                disabled={cargando || !videoListo}
                className={`${btnBase} flex-1 bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-60`}
              >
                <Camera className="w-4 h-4" />
                Capturar
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onElegirArchivo}
            className="min-h-11 px-2 text-xs text-slate-500 underline sm:ml-auto touch-manipulation"
          >
            Sin cámara: elegir archivo
          </button>
        </div>
      </div>
    </div>
  );
}
