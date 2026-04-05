import { jsPDF } from 'jspdf';
import { cargarLogoCDAConDimensiones } from './logoBase64';
import { formatCOP } from './formatNumber';

interface DatosEgresoPDF {
  numeroComprobante: string;
  tipo: string;
  monto: number;
  concepto: string;
  fecha: Date;
  nombreCajero: string;
  turno: string;
  logoUrl?: string;
}

export async function generarPDFComprobanteEgreso(datos: DatosEgresoPDF): Promise<string> {
  const doc = new jsPDF();
  
  // Cargar logo
  const logoData = await cargarLogoCDAConDimensiones(datos.logoUrl);
  
  let y = 20;
  const leftMargin = 20;
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - 40;
  
  // Helper para añadir texto
  const addText = (text: string, x: number, yPos: number, options?: { fontSize?: number, bold?: boolean, align?: 'left' | 'center' | 'right' }) => {
    if (options?.fontSize) doc.setFontSize(options.fontSize);
    if (options?.bold) doc.setFont('helvetica', 'bold');
    else doc.setFont('helvetica', 'normal');
    
    if (options?.align === 'center') {
      doc.text(text, pageWidth / 2, yPos, { align: 'center' });
    } else if (options?.align === 'right') {
      doc.text(text, pageWidth - leftMargin, yPos, { align: 'right' });
    } else {
      doc.text(text, x, yPos);
    }
    
    return yPos + 7;
  };
  
  // Helper para línea divisoria
  const addLine = (yPos: number) => {
    doc.setDrawColor(0, 0, 0);
    doc.line(leftMargin, yPos, pageWidth - leftMargin, yPos);
    return yPos + 8;
  };
  
  // ENCABEZADO CON LOGO
  if (logoData && logoData.width > 0 && logoData.height > 0) {
    const maxLogoWidth = 40;
    const maxLogoHeight = 24;
    const ratio = logoData.width / logoData.height;
    let logoWidth = maxLogoWidth;
    let logoHeight = logoWidth / ratio;
    if (logoHeight > maxLogoHeight) {
      logoHeight = maxLogoHeight;
      logoWidth = logoHeight * ratio;
    }
    const logoX = (pageWidth - logoWidth) / 2;
    doc.addImage(logoData.dataUrl, 'PNG', logoX, y - 1, logoWidth, logoHeight);
    y += logoHeight + 5;
  }
  
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('COMPROBANTE DE EGRESO', pageWidth / 2, y, { align: 'center' });
  y += 10;
  
  // Número de comprobante
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`No. ${datos.numeroComprobante}`, pageWidth - leftMargin, y, { align: 'right' });
  y += 10;
  
  // LÍNEA DIVISORIA
  y = addLine(y);
  
  // DATOS DEL EGRESO
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('DATOS DEL EGRESO', leftMargin, y);
  y += 10;
  
  // Fecha y hora
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const fechaFormateada = datos.fecha.toLocaleDateString('es-CO', { 
    day: '2-digit', 
    month: 'long', 
    year: 'numeric' 
  });
  const horaFormateada = datos.fecha.toLocaleTimeString('es-CO', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  y = addText(`Fecha: ${fechaFormateada}`, leftMargin, y);
  y = addText(`Hora: ${horaFormateada}`, leftMargin, y);
  y = addText(`Turno: ${datos.turno}`, leftMargin, y);
  y += 3;
  
  // Tipo de movimiento
  const tipoLabel = datos.tipo === 'gasto' ? 'GASTO' : 
                   datos.tipo === 'devolucion' ? 'DEVOLUCION' : 'AJUSTE';
  
  doc.setFillColor(255, 240, 240);
  doc.rect(leftMargin, y, contentWidth, 12, 'F');
  
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(`Tipo: ${tipoLabel}`, leftMargin + 5, y + 8);
  y += 18;
  
  // MONTO (destacado)
  y = addLine(y);
  
  doc.setFillColor(230, 245, 230);
  doc.rect(leftMargin, y, contentWidth, 20, 'F');
  
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('MONTO:', leftMargin + 5, y + 8);
  
  doc.setFontSize(20);
  const montoFormateado = formatCOP(datos.monto);
  doc.text(montoFormateado, pageWidth - leftMargin - 5, y + 13, { align: 'right' });
  y += 26;
  
  // CONCEPTO
  y = addLine(y);
  
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('CONCEPTO / DETALLE:', leftMargin, y);
  y += 8;
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  
  // Dividir concepto en líneas si es muy largo
  const conceptoLineas = doc.splitTextToSize(datos.concepto, contentWidth - 10);
  conceptoLineas.forEach((linea: string) => {
    doc.text(linea, leftMargin + 5, y);
    y += 6;
  });
  
  y += 10;
  
  // INFORMACIÓN ADMINISTRATIVA
  y = addLine(y);
  
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  y = addText(`Cajero(a) que registra: ${datos.nombreCajero}`, leftMargin, y, { fontSize: 9 });
  y += 5;
  
  // NOTA IMPORTANTE
  doc.setFillColor(255, 250, 205);
  doc.rect(leftMargin, y, contentWidth, 12, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.text('IMPORTANTE: Este comprobante debe ser firmado por quien recibe el dinero', leftMargin + 5, y + 8);
  y += 18;
  
  // SECCIÓN DE FIRMAS
  y = addLine(y);
  y += 5;
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('FIRMAS DE AUTORIZACIÓN Y RECIBIDO', pageWidth / 2, y, { align: 'center' });
  y += 15;
  
  // Tres líneas de firma
  const firmaWidth = 50;
  const spacing = (contentWidth - (firmaWidth * 3)) / 2;
  
  // Firma 1: Beneficiario
  let xPos = leftMargin;
  doc.line(xPos, y, xPos + firmaWidth, y);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Recibí Conforme', xPos + firmaWidth / 2, y + 5, { align: 'center' });
  doc.setFontSize(7);
  doc.text('Nombre y Firma', xPos + firmaWidth / 2, y + 10, { align: 'center' });
  doc.text('Beneficiario', xPos + firmaWidth / 2, y + 14, { align: 'center' });
  
  // Firma 2: Cajero
  xPos += firmaWidth + spacing;
  doc.line(xPos, y, xPos + firmaWidth, y);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Entregué', xPos + firmaWidth / 2, y + 5, { align: 'center' });
  doc.setFontSize(7);
  doc.text(`${datos.nombreCajero}`, xPos + firmaWidth / 2, y + 10, { align: 'center' });
  doc.text('Cajero(a)', xPos + firmaWidth / 2, y + 14, { align: 'center' });
  
  // Firma 3: Supervisor
  xPos += firmaWidth + spacing;
  doc.line(xPos, y, xPos + firmaWidth, y);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Autorizó', xPos + firmaWidth / 2, y + 5, { align: 'center' });
  doc.setFontSize(7);
  doc.text('Nombre y Firma', xPos + firmaWidth / 2, y + 10, { align: 'center' });
  doc.text('Supervisor', xPos + firmaWidth / 2, y + 14, { align: 'center' });
  
  y += 25;
  
  // PIE DE PÁGINA
  const footerY = doc.internal.pageSize.getHeight() - 15;
  doc.setDrawColor(200, 200, 200);
  doc.line(leftMargin, footerY, pageWidth - leftMargin, footerY);
  
  doc.setFontSize(7);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(100, 100, 100);
  doc.text(`Generado: ${new Date().toLocaleString('es-CO')}`, pageWidth / 2, footerY + 7, { align: 'center' });
  
  // Generar nombre de archivo
  const timestamp = datos.fecha.toISOString().slice(0, 19).replace(/:/g, '-');
  const nombreArchivo = `Comprobante_Egreso_${datos.numeroComprobante}_${timestamp}.pdf`;
  
  // Guardar PDF
  doc.save(nombreArchivo);
  
  return nombreArchivo;
}
