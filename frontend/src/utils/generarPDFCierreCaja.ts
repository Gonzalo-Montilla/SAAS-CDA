import { jsPDF } from 'jspdf';
import type { CajaResumen, Caja, MovimientoCaja } from '../types';
import { cargarLogoCDA, LOGO_CONFIG } from './logoBase64';

interface DatosCierrePDF {
  caja: Caja;
  resumen: CajaResumen;
  egresos: MovimientoCaja[];
  montoFisico: number;
  diferencia: number;
  nombreCajero: string;
  observaciones?: string;
}

export async function generarPDFCierreCaja(datos: DatosCierrePDF) {
  const doc = new jsPDF();
  
  // Cargar logo
  const logoBase64 = await cargarLogoCDA();
  
  let y = 15;
  const leftMargin = 15;
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - 30;
  
  // Helper para añadir texto (compacto)
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
    
    return yPos + 5; // Reducido de 7 a 5
  };
  
  // Helper para línea divisoria (más compacta)
  const addLine = (yPos: number) => {
    doc.setDrawColor(200, 200, 200);
    doc.line(leftMargin, yPos, pageWidth - leftMargin, yPos);
    return yPos + 4; // Reducido de 10 a 4
  };
  
  // ENCABEZADO CON LOGO (compacto)
  if (logoBase64) {
    const logoWidth = 20;
    const logoHeight = 20;
    const logoX = (pageWidth - logoWidth) / 2;
    doc.addImage(logoBase64, 'PNG', logoX, y - 3, logoWidth, logoHeight);
    y += logoHeight;
  }
  
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('CDASOFT', pageWidth / 2, y, { align: 'center' });
  y += 6;
  
  doc.setFontSize(11);
  doc.text('COMPROBANTE DE CIERRE DE CAJA', pageWidth / 2, y, { align: 'center' });
  y += 8;
  
  // INFORMACIÓN GENERAL (compacta)
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  
  const fechaCierre = new Date(datos.caja.fecha_cierre || new Date());
  const fechaApertura = new Date(datos.caja.fecha_apertura);
  
  y = addText(`Fecha: ${fechaCierre.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })} | Turno: ${datos.caja.turno} | Cajero: ${datos.nombreCajero}`, leftMargin, y, { fontSize: 8 });
  y = addText(`Apertura: ${fechaApertura.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} | Cierre: ${fechaCierre.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`, leftMargin, y, { fontSize: 8 });
  y += 2;
  
  // RESUMEN DEL TURNO
  y = addLine(y);
  y = addText('RESUMEN DEL TURNO', leftMargin, y, { fontSize: 10, bold: true });
  y = addLine(y);
  
  doc.setFontSize(8);
  
  const formatMoney = (val: number) => `$${val.toLocaleString('es-CO')}`;
  
  y = addText(`Monto Inicial:`, leftMargin, y, { fontSize: 8 });
  doc.text(formatMoney(datos.resumen.monto_inicial), pageWidth - leftMargin, y - 5, { align: 'right' });
  
  y = addText(`Total Ingresos:`, leftMargin, y, { fontSize: 8 });
  doc.text(formatMoney(datos.resumen.total_ingresos), pageWidth - leftMargin, y - 5, { align: 'right' });
  
  y = addText(`Total Egresos:`, leftMargin, y, { fontSize: 8 });
  doc.text(formatMoney(datos.resumen.total_egresos), pageWidth - leftMargin, y - 5, { align: 'right' });
  
  doc.setFontSize(9);
  y = addText(`Saldo Esperado:`, leftMargin, y, { fontSize: 9, bold: true });
  doc.setFont('helvetica', 'bold');
  doc.text(formatMoney(datos.resumen.saldo_esperado), pageWidth - leftMargin, y - 5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  y += 1;
  
  // INGRESOS POR CONCEPTO
  y = addLine(y);
  y = addText('INGRESOS POR CONCEPTO', leftMargin, y, { fontSize: 9, bold: true });
  y = addLine(y);
  
  doc.setFontSize(8);
  y = addText(`RTM:`, leftMargin, y, { fontSize: 8 });
  doc.text(formatMoney(datos.resumen.total_rtm), pageWidth - leftMargin, y - 5, { align: 'right' });
  
  y = addText(`Comision SOAT:`, leftMargin, y, { fontSize: 8 });
  doc.text(formatMoney(datos.resumen.total_comision_soat), pageWidth - leftMargin, y - 5, { align: 'right' });
  y += 1;
  
  // INGRESOS POR MÉTODO DE PAGO (en dos columnas)
  y = addLine(y);
  y = addText('METODOS DE PAGO', leftMargin, y, { fontSize: 9, bold: true });
  y = addLine(y);
  
  doc.setFontSize(7);
  const midPoint = leftMargin + (contentWidth / 2);
  
  // Columna izquierda
  let yLeft = y;
  yLeft = addText(`Efectivo:`, leftMargin, yLeft, { fontSize: 7 });
  doc.text(formatMoney(datos.resumen.efectivo), midPoint - 5, yLeft - 5, { align: 'right' });
  
  yLeft = addText(`T. Debito:`, leftMargin, yLeft, { fontSize: 7 });
  doc.text(formatMoney(datos.resumen.tarjeta_debito), midPoint - 5, yLeft - 5, { align: 'right' });
  
  yLeft = addText(`T. Credito:`, leftMargin, yLeft, { fontSize: 7 });
  doc.text(formatMoney(datos.resumen.tarjeta_credito), midPoint - 5, yLeft - 5, { align: 'right' });
  
  // Columna derecha
  let yRight = y;
  yRight = addText(`Transfer:`, midPoint + 5, yRight, { fontSize: 7 });
  doc.text(formatMoney(datos.resumen.transferencia), pageWidth - leftMargin, yRight - 5, { align: 'right' });
  
  yRight = addText(`CrediSmart:`, midPoint + 5, yRight, { fontSize: 7 });
  doc.text(formatMoney(datos.resumen.credismart), pageWidth - leftMargin, yRight - 5, { align: 'right' });
  
  y = Math.max(yLeft, yRight) + 1;
  
  // EGRESOS DETALLADOS (compacto)
  if (datos.egresos.length > 0) {
    y = addLine(y);
    y = addText(`EGRESOS (${datos.egresos.length})`, leftMargin, y, { fontSize: 9, bold: true });
    y = addLine(y);
    
    doc.setFontSize(7);
    datos.egresos.slice(0, 5).forEach((egreso) => { // Máximo 5 gastos en PDF
      const hora = new Date(egreso.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
      const concepto = egreso.concepto.length > 30 ? egreso.concepto.substring(0, 30) + '...' : egreso.concepto;
      
      y = addText(`${hora} ${concepto}`, leftMargin, y, { fontSize: 7 });
      doc.text(`-${formatMoney(Math.abs(egreso.monto))}`, pageWidth - leftMargin, y - 5, { align: 'right' });
    });
    if (datos.egresos.length > 5) {
      doc.setFontSize(6);
      doc.text(`... y ${datos.egresos.length - 5} egresos mas`, leftMargin, y, {});
      y += 4;
    }
    y += 1;
  }
  
  // ARQUEO DE CAJA
  y = addLine(y);
  y = addText('ARQUEO DE CAJA', leftMargin, y, { fontSize: 10, bold: true });
  y = addLine(y);
  
  doc.setFontSize(8);
  y = addText(`Saldo Esperado:`, leftMargin, y, { fontSize: 8 });
  doc.text(formatMoney(datos.resumen.saldo_esperado), pageWidth - leftMargin, y - 5, { align: 'right' });
  
  y = addText(`Efectivo Contado:`, leftMargin, y, { fontSize: 8 });
  doc.text(formatMoney(datos.montoFisico), pageWidth - leftMargin, y - 5, { align: 'right' });
  
  doc.setFontSize(9);
  y = addText(`Diferencia:`, leftMargin, y, { fontSize: 9, bold: true });
  doc.setFont('helvetica', 'bold');
  const diferenciaText = datos.diferencia === 0 
    ? `${formatMoney(datos.diferencia)} - CUADRADA` 
    : `${datos.diferencia > 0 ? '+' : ''}${formatMoney(datos.diferencia)}`;
  doc.text(diferenciaText, pageWidth - leftMargin, y - 5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  y += 2;
  
  // OBSERVACIONES (compactas)
  if (datos.observaciones) {
    y = addLine(y);
    doc.setFontSize(7);
    const obsCortas = datos.observaciones.length > 80 ? datos.observaciones.substring(0, 80) + '...' : datos.observaciones;
    y = addText(`Obs: ${obsCortas}`, leftMargin, y, { fontSize: 7 });
  }
  
  // FIRMAS (compactas)
  y += 8;
  y = addLine(y);
  y += 6;
  
  doc.line(leftMargin, y, leftMargin + 50, y);
  doc.line(pageWidth - leftMargin - 50, y, pageWidth - leftMargin, y);
  y += 3;
  
  doc.setFontSize(7);
  doc.text('Cajero', leftMargin + 25, y, { align: 'center' });
  doc.text('Supervisor', pageWidth - leftMargin - 25, y, { align: 'center' });
  
  // PIE DE PÁGINA
  y = doc.internal.pageSize.getHeight() - 10;
  doc.setFontSize(6);
  doc.setTextColor(150, 150, 150);
  doc.text(`${new Date().toLocaleString('es-CO')} | ID: ${datos.caja.id.substring(0, 8)}`, pageWidth / 2, y, { align: 'center' });
  
  // Generar nombre del archivo
  const fechaStr = fechaCierre.toLocaleDateString('es-CO').replace(/\//g, '-');
  const nombreArchivo = `Cierre_Caja_${datos.caja.turno}_${fechaStr}.pdf`;
  
  // Descargar PDF
  doc.save(nombreArchivo);
  
  return nombreArchivo;
}
