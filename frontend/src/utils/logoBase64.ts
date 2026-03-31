// Logo CDASOFT convertido a Base64
// Este archivo se genera automáticamente al cargar la imagen del logo
// Asset: LOGO_CDA_SOFT-SIN FONDO.png
import logoCdaSoftUrl from '../assets/LOGO_CDA_SOFT-SIN FONDO.png';

export async function cargarLogoCDA(): Promise<string> {
  try {
    // Convertir a Base64
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
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
      };
      
      img.onerror = () => {
        reject(new Error('Error al cargar el logo'));
      };
      
      img.src = logoCdaSoftUrl;
    });
  } catch (error) {
    console.error('Error al cargar el logo:', error);
    // Retornar string vacío si falla
    return '';
  }
}

// Dimensiones recomendadas para el logo en los PDFs
export const LOGO_CONFIG = {
  width: 30,  // Ancho en mm
  height: 30, // Alto en mm (ajustable según proporción del logo)
  x: 15,      // Posición X desde la izquierda
  y: 10,      // Posición Y desde arriba
};
