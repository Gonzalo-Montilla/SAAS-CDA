import { jsPDF } from 'jspdf';
import { cargarLogoCDAConDimensiones } from './logoBase64';

interface DatosReciboPagoPDF {
  placa: string;
  tipoVehiculo: string;
  marca?: string;
  modelo?: string;
  anoModelo: number;
  clienteNombre: string;
  clienteDocumento: string;
  valorRTM: number;
  comisionSOAT: number;
  totalCobrado: number;
  metodoPago: string;
  numeroFacturaDIAN: string;
  fecha: Date;
  nombreCajero: string;
  logoUrl?: string;
}

export async function generarPDFReciboPago(datos: DatosReciboPagoPDF): Promise<string> {
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
    // Logo centrado manteniendo proporción original
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
  doc.text('RECIBO DE PAGO', pageWidth / 2, y, { align: 'center' });
  y += 7;
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'italic');
  doc.text('Revisión Técnico-Mecánica y de Emisiones Contaminantes', pageWidth / 2, y, { align: 'center' });
  y += 11;
  
  // Número de recibo
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const numeroRecibo = `RTM-${datos.fecha.getFullYear()}-${String(Date.now()).slice(-6)}`;
  doc.text(`No. ${numeroRecibo}`, pageWidth - leftMargin, y, { align: 'right' });
  y += 10;
  
  // LÍNEA DIVISORIA
  y = addLine(y);
  
  // DATOS DEL VEHÍCULO
  doc.setFillColor(240, 248, 255);
  doc.rect(leftMargin, y, contentWidth, 10, 'F');
  
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('DATOS DEL VEHÍCULO', leftMargin + 5, y + 7);
  y += 15;
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  y = addText(`Placa: ${datos.placa}`, leftMargin, y, { fontSize: 12, bold: true });
  y = addText(`Tipo: ${datos.tipoVehiculo.toUpperCase()}`, leftMargin, y);
  
  if (datos.marca) {
    y = addText(`Marca: ${datos.marca}`, leftMargin, y);
  }
  if (datos.modelo) {
    y = addText(`Modelo: ${datos.modelo}`, leftMargin, y);
  }
  
  y = addText(`Año: ${datos.anoModelo}`, leftMargin, y);
  y += 3;
  
  // DATOS DEL CLIENTE
  y = addLine(y);
  
  doc.setFillColor(240, 248, 255);
  doc.rect(leftMargin, y, contentWidth, 10, 'F');
  
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('DATOS DEL CLIENTE', leftMargin + 5, y + 7);
  y += 15;
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  y = addText(`Nombre: ${datos.clienteNombre}`, leftMargin, y);
  y = addText(`Documento: ${datos.clienteDocumento}`, leftMargin, y);
  y += 3;
  
  // DESGLOSE DE COBRO
  y = addLine(y);
  
  doc.setFillColor(240, 248, 255);
  doc.rect(leftMargin, y, contentWidth, 10, 'F');
  
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('DESGLOSE DE COBRO', leftMargin + 5, y + 7);
  y += 15;
  
  // RTM
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Revisión Técnico-Mecánica (RTM):', leftMargin + 5, y);
  doc.setFont('helvetica', 'bold');
  doc.text(`$${datos.valorRTM.toLocaleString('es-CO')}`, pageWidth - leftMargin - 5, y, { align: 'right' });
  y += 7;
  
  // Comisión SOAT (si aplica)
  if (datos.comisionSOAT > 0) {
    doc.setFont('helvetica', 'normal');
    doc.text('Comisión SOAT:', leftMargin + 5, y);
    doc.setFont('helvetica', 'bold');
    doc.text(`$${datos.comisionSOAT.toLocaleString('es-CO')}`, pageWidth - leftMargin - 5, y, { align: 'right' });
    y += 10;
  } else {
    y += 3;
  }
  
  // TOTAL (destacado)
  doc.setFillColor(34, 139, 34); // Verde
  doc.rect(leftMargin, y, contentWidth, 20, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('TOTAL PAGADO:', leftMargin + 5, y + 13);
  
  doc.setFontSize(20);
  const totalFormateado = `$${datos.totalCobrado.toLocaleString('es-CO')}`;
  doc.text(totalFormateado, pageWidth - leftMargin - 5, y + 13, { align: 'right' });
  
  // Resetear color de texto
  doc.setTextColor(0, 0, 0);
  y += 26;
  
  // INFORMACIÓN DE PAGO
  y = addLine(y);
  
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
  
  const metodoPagoLabel = datos.metodoPago === 'efectivo' ? 'EFECTIVO' :
                          datos.metodoPago === 'tarjeta_debito' ? 'TARJETA DÉBITO' :
                          datos.metodoPago === 'tarjeta_credito' ? 'TARJETA CRÉDITO' :
                          datos.metodoPago === 'transferencia' ? 'TRANSFERENCIA' :
                          datos.metodoPago === 'credismart' ? 'CREDISMART' : datos.metodoPago.toUpperCase();
  
  y = addText(`Método de pago: ${metodoPagoLabel}`, leftMargin, y);
  
  // Factura DIAN (destacado)
  doc.setFillColor(255, 250, 205);
  doc.rect(leftMargin, y - 3, contentWidth, 10, 'F');
  doc.setFont('helvetica', 'bold');
  doc.text(`Factura DIAN: ${datos.numeroFacturaDIAN}`, leftMargin + 5, y + 4);
  y += 12;
  
  doc.setFont('helvetica', 'normal');
  y = addText(`Atendido por: ${datos.nombreCajero}`, leftMargin, y);
  y += 10;
  
  // NOTA LEGAL
  doc.setFillColor(255, 250, 205);
  doc.rect(leftMargin, y, contentWidth, 12, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.text('NOTA: Conserve este recibo como comprobante de pago de la revisión técnico-mecánica.', leftMargin + 5, y + 6);
  doc.text('Este documento no reemplaza el certificado oficial de la RTM.', leftMargin + 5, y + 10);
  y += 18;
  
  // FIRMA DEL CLIENTE
  y = addLine(y);
  y += 5;
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('FIRMA DEL CLIENTE', pageWidth / 2, y, { align: 'center' });
  y += 15;
  
  const firmaWidth = 80;
  const xPos = (pageWidth - firmaWidth) / 2;
  
  doc.line(xPos, y, xPos + firmaWidth, y);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(datos.clienteNombre, xPos + firmaWidth / 2, y + 5, { align: 'center' });
  doc.setFontSize(8);
  doc.text(`CC. ${datos.clienteDocumento}`, xPos + firmaWidth / 2, y + 10, { align: 'center' });
  
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
  const nombreArchivo = `Recibo_Pago_${datos.placa}_${timestamp}.pdf`;
  
  // Guardar PDF
  doc.save(nombreArchivo);
  
  return nombreArchivo;
}
