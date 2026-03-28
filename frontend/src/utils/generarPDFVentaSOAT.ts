import { jsPDF } from 'jspdf';
import { cargarLogoCDA, LOGO_CONFIG } from './logoBase64';

interface DatosVentaSOATPDF {
  placa: string;
  tipoVehiculo: 'moto' | 'carro';
  valorSoatComercial: number;
  comisionCobrada: number;
  clienteNombre: string;
  clienteDocumento: string;
  fecha: Date;
  nombreCajero: string;
  metodoPago: string;
}

export async function generarPDFVentaSOAT(datos: DatosVentaSOATPDF): Promise<string> {
  const doc = new jsPDF();
  
  // Cargar logo
  const logoBase64 = await cargarLogoCDA();
  
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
  if (logoBase64) {
    const logoWidth = 25;
    const logoHeight = 25;
    const logoX = (pageWidth - logoWidth) / 2;
    doc.addImage(logoBase64, 'PNG', logoX, y - 5, logoWidth, logoHeight);
    y += logoHeight + 2;
  }
  
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('CDASOFT', pageWidth / 2, y, { align: 'center' });
  y += 8;
  
  doc.setFontSize(14);
  doc.text('RECIBO DE VENTA SOAT', pageWidth / 2, y, { align: 'center' });
  y += 6;
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'italic');
  doc.text('(Comisión por venta de seguro obligatorio)', pageWidth / 2, y, { align: 'center' });
  y += 12;
  
  // Número de recibo
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const numeroRecibo = `SOAT-${datos.fecha.getFullYear()}-${String(Date.now()).slice(-6)}`;
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
  
  const tipoLabel = datos.tipoVehiculo === 'moto' ? 'MOTOCICLETA' : 'AUTOMÓVIL';
  y = addText(`Tipo: ${tipoLabel}`, leftMargin, y);
  y += 3;
  
  // VALOR SOAT COMERCIAL (informativo)
  doc.setFillColor(255, 250, 205);
  doc.rect(leftMargin, y, contentWidth, 12, 'F');
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Valor comercial del SOAT:', leftMargin + 5, y + 8);
  
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  const valorComercialFormateado = `$${datos.valorSoatComercial.toLocaleString('es-CO')}`;
  doc.text(valorComercialFormateado, pageWidth - leftMargin - 5, y + 8, { align: 'right' });
  
  doc.setFontSize(7);
  doc.setFont('helvetica', 'italic');
  doc.text('(Informativo - No cobrado por CDA)', leftMargin + 5, y + 11);
  y += 18;
  
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
  
  // COMISIÓN COBRADA (destacado)
  y = addLine(y);
  
  doc.setFillColor(13, 148, 136); // Teal
  doc.rect(leftMargin, y, contentWidth, 25, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('COMISIÓN CDA:', leftMargin + 5, y + 10);
  
  doc.setFontSize(24);
  const comisionFormateada = `$${datos.comisionCobrada.toLocaleString('es-CO')}`;
  doc.text(comisionFormateada, pageWidth - leftMargin - 5, y + 16, { align: 'right' });
  
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('Monto cobrado por intermediación', leftMargin + 5, y + 21);
  
  // Resetear color de texto
  doc.setTextColor(0, 0, 0);
  y += 31;
  
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
  y = addText(`Atendido por: ${datos.nombreCajero}`, leftMargin, y);
  y += 10;
  
  // NOTA LEGAL
  doc.setFillColor(255, 250, 205);
  doc.rect(leftMargin, y, contentWidth, 18, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.text('NOTA: Este recibo certifica únicamente el pago de la comisión por intermediación', leftMargin + 5, y + 6);
  doc.text('en la venta del SOAT. El seguro debe ser tramitado directamente con la aseguradora.', leftMargin + 5, y + 11);
  doc.text('CDASOFT NO es responsable de la validez o vigencia del seguro.', leftMargin + 5, y + 16);
  y += 24;
  
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
  doc.text('CDASOFT — sistema integral para administracion de cda · Sistema de Gestión POS', pageWidth / 2, footerY + 5, { align: 'center' });
  doc.text(`Generado: ${new Date().toLocaleString('es-CO')}`, pageWidth / 2, footerY + 9, { align: 'center' });
  
  // Generar nombre de archivo
  const timestamp = datos.fecha.toISOString().slice(0, 19).replace(/:/g, '-');
  const nombreArchivo = `Recibo_SOAT_${datos.placa}_${timestamp}.pdf`;
  
  // Guardar PDF
  doc.save(nombreArchivo);
  
  return nombreArchivo;
}
