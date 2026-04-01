// Logo CDASOFT convertido a Base64
// Este archivo se genera automáticamente al cargar la imagen del logo
// Asset: LOGO_CDA_SOFT-SIN FONDO.png
import logoCdaSoftUrl from '../assets/LOGO_CDA_SOFT-SIN FONDO.png';
import { configApi } from '../api/config';

const DEFAULT_API_URL = 'http://localhost:8000/api/v1';

const extractHttpUrl = (value: string): string | null => {
  const match = value.match(/https?:\/\/[^\s"'|]+/i);
  return match ? match[0] : null;
};

const resolveBackendBaseUrl = (): string => {
  const rawEnv = String(import.meta.env.VITE_API_URL || '').trim();
  const extractedEnvUrl = rawEnv ? extractHttpUrl(rawEnv) : null;
  const apiUrl = extractedEnvUrl || DEFAULT_API_URL;
  // Ejemplo: http://localhost:8000/api/v1 -> http://localhost:8000
  return apiUrl.replace(/\/api\/v1\/?$/i, '').replace(/\/+$/, '');
};

const normalizeSlashes = (value: string): string => value.replace(/\\/g, '/');

const normalizeLogoSource = (logoUrl?: string): string => {
  const raw = (logoUrl || '').trim();
  if (!raw) return logoCdaSoftUrl;
  const normalized = normalizeSlashes(raw);
  if (normalized.startsWith('http://') || normalized.startsWith('https://') || normalized.startsWith('data:')) {
    return normalized;
  }

  const backendBase = resolveBackendBaseUrl();
  if (normalized.startsWith('/uploads/')) {
    return `${backendBase}${normalized}`;
  }
  if (normalized.startsWith('uploads/')) {
    return `${backendBase}/${normalized}`;
  }
  return normalized;
};

const buildLogoCandidates = (logoUrl?: string): string[] => {
  const primary = normalizeLogoSource(logoUrl);
  const backendBase = resolveBackendBaseUrl();
  const raw = normalizeSlashes((logoUrl || '').trim());

  const candidates = new Set<string>();
  candidates.add(primary);

  if (!raw) {
    return Array.from(candidates);
  }

  // Caso: ruta local/absoluta con segmento /uploads/...
  const uploadsIndex = raw.toLowerCase().indexOf('/uploads/');
  if (uploadsIndex >= 0) {
    const uploadsPart = raw.slice(uploadsIndex);
    candidates.add(`${backendBase}${uploadsPart}`);
  }

  // Caso: ruta local relativa que contiene uploads/...
  const relUploadsIndex = raw.toLowerCase().indexOf('uploads/');
  if (relUploadsIndex >= 0) {
    const relUploadsPart = raw.slice(relUploadsIndex);
    candidates.add(`${backendBase}/${relUploadsPart}`);
  }

  // Caso: solo tenant-logos/archivo.ext o C:\...\tenant-logos\archivo.ext
  const tenantLogosIndex = raw.toLowerCase().indexOf('tenant-logos/');
  if (tenantLogosIndex >= 0) {
    const tenantLogoPart = raw.slice(tenantLogosIndex + 'tenant-logos/'.length);
    if (tenantLogoPart) {
      candidates.add(`${backendBase}/uploads/tenant-logos/${tenantLogoPart}`);
    }
  }

  // Caso: archivo suelto
  const filenameMatch = raw.match(/([a-zA-Z0-9_\-.]+\.(png|jpg|jpeg|webp))$/i);
  if (filenameMatch?.[1]) {
    candidates.add(`${backendBase}/uploads/tenant-logos/${filenameMatch[1]}`);
  }

  return Array.from(candidates);
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('No se pudo convertir blob a data URL'));
    };
    reader.onerror = () => reject(new Error('Error leyendo blob'));
    reader.readAsDataURL(blob);
  });

const imageToPngDataUrl = (src: string): Promise<LogoCDAData | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        resolve({
          dataUrl: canvas.toDataURL('image/png'),
          width: img.width,
          height: img.height,
        });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });

async function loadLogoAsDataUrl(logoUrl?: string): Promise<LogoCDAData | null> {
  try {
    // Prioridad 1: endpoint backend confiable del tenant autenticado.
    try {
      const blob = await configApi.obtenerTenantLogoBlob();
      if (blob && blob.type.startsWith('image/')) {
        const rawDataUrl = await blobToDataUrl(blob);
        const pngLogo = await imageToPngDataUrl(rawDataUrl);
        if (pngLogo) {
          return pngLogo;
        }
      }
    } catch {
      // Continuar con fallback por URL.
    }

    const candidates = buildLogoCandidates(logoUrl);

    for (const source of candidates) {
      if (source.startsWith('data:')) {
        const data = await imageToPngDataUrl(source);
        if (data) return data;
        continue;
      }

      try {
        const response = await fetch(source, { method: 'GET' });
        if (!response.ok) {
          continue;
        }
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) {
          continue;
        }
        const rawDataUrl = await blobToDataUrl(blob);
        // Normalizar siempre a PNG para evitar incompatibilidades JPG/WEBP en addImage.
        const pngLogo = await imageToPngDataUrl(rawDataUrl);
        if (pngLogo) {
          return pngLogo;
        }
      } catch {
        // Intentar siguiente candidato
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function cargarLogoCDA(logoUrl?: string): Promise<string> {
  try {
    const logoSource = normalizeLogoSource(logoUrl);
    const fromFetch = await loadLogoAsDataUrl(logoUrl);
    if (fromFetch) {
      return fromFetch.dataUrl;
    }

    // Convertir a Base64
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('No se pudo obtener el contexto del canvas'));
            return;
          }
          
          ctx.drawImage(img, 0, 0);
          const dataURL = canvas.toDataURL('image/png');
          resolve(dataURL);
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Error renderizando logo en canvas'));
        }
      };
      
      img.onerror = () => {
        reject(new Error('Error al cargar el logo'));
      };
      
      img.src = logoSource;
    });
  } catch (error) {
    console.error('Error al cargar el logo:', error);
    // Retornar string vacío si falla
    return '';
  }
}

export interface LogoCDAData {
  dataUrl: string;
  width: number;
  height: number;
}

export async function cargarLogoCDAConDimensiones(logoUrl?: string): Promise<LogoCDAData | null> {
  try {
    const logoSource = normalizeLogoSource(logoUrl);
    const fromFetch = await loadLogoAsDataUrl(logoUrl);
    if (fromFetch) {
      return fromFetch;
    }

    return await new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0);
          resolve({
            dataUrl: canvas.toDataURL('image/png'),
            width: img.width,
            height: img.height,
          });
        } catch {
          resolve(null);
        }
      };

      img.onerror = () => resolve(null);
      img.src = logoSource;
    });
  } catch (error) {
    console.error('Error al cargar el logo con dimensiones:', error);
    return null;
  }
}

// Dimensiones recomendadas para el logo en los PDFs
export const LOGO_CONFIG = {
  width: 30,  // Ancho en mm
  height: 30, // Alto en mm (ajustable según proporción del logo)
  x: 15,      // Posición X desde la izquierda
  y: 10,      // Posición Y desde arriba
};
