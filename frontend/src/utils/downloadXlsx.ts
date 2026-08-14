/**
 * Descarga Excel (.xlsx) con encabezados y filas (compatible Excel es-CO).
 */
import * as XLSX from 'xlsx';

export function downloadXlsx(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
  sheetName = 'Datos',
): void {
  const data = [
    headers,
    ...rows.map((row) =>
      row.map((v) => (v === null || v === undefined ? '' : v)),
    ),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const outName = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  XLSX.writeFile(wb, outName);
}
