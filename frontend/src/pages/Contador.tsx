import { Fragment, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Download, FileUp, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import Layout from '../components/Layout';
import { exogenaApi } from '../api/exogena';

function currentYear(): string {
  return String(new Date().getFullYear());
}

export default function Contador() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'exogena'>('exogena');
  const [anio, setAnio] = useState(currentYear());
  const [uvt, setUvt] = useState<number>(0);
  const [versionNormativa, setVersionNormativa] = useState('');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historialFiltro, setHistorialFiltro] = useState<'success' | 'error' | 'all'>('success');
  const [modoExportacion, setModoExportacion] = useState<'consolidado' | 'detalle'>('consolidado');
  const [expandedEjecucionId, setExpandedEjecucionId] = useState<string | null>(null);
  const [validacionesByEjecucion, setValidacionesByEjecucion] = useState<Record<string, any[]>>({});
  const [loadingValidacionesEjecId, setLoadingValidacionesEjecId] = useState<string | null>(null);
  const [mapeosDraft, setMapeosDraft] = useState<
    Array<{
      id: string;
      formato: string;
      cuenta_contable: string;
      concepto: string;
      categoria: string;
      saldo_a_reportar: string;
      activo: string;
      source_rule?: string | null;
    }>
  >([]);

  const configQuery = useQuery({
    queryKey: ['exogena-config', anio],
    queryFn: () => exogenaApi.getConfig(anio),
  });

  const ejecucionesQuery = useQuery({
    queryKey: ['exogena-ejecuciones', anio],
    queryFn: () => exogenaApi.listarEjecuciones(anio),
  });

  const validarMutation = useMutation({
    mutationFn: () => exogenaApi.validar({ anio, formatos: ['1001', '1007'] }),
    onSuccess: (res) => {
      setError(null);
      setMensaje(`Validación: ${res.total_errors} errores, ${res.total_warnings} advertencias.`);
      queryClient.invalidateQueries({ queryKey: ['exogena-ejecuciones', anio] });
    },
    onError: (err: any) => {
      setMensaje(null);
      setError(err?.response?.data?.detail || 'No se pudo validar.');
    },
  });

  const guardarMutation = useMutation({
    mutationFn: () =>
      exogenaApi.saveConfig({
        anio,
        uvt_anual: Number(uvt || 0),
        topes_por_formato_json: {},
        version_normativa: versionNormativa.trim() || null,
        mapeos: mapeosDraft.map((m) => ({
          formato: m.formato,
          cuenta_contable: m.cuenta_contable,
          concepto: m.concepto,
          categoria: m.categoria || '',
          saldo_a_reportar: m.saldo_a_reportar || 'saldo_final',
          source_rule: m.source_rule || null,
          activo: m.activo || 'si',
        })),
      }),
    onSuccess: () => {
      setError(null);
      setMensaje('Configuración guardada correctamente.');
      queryClient.invalidateQueries({ queryKey: ['exogena-config', anio] });
    },
    onError: (err: any) => {
      setMensaje(null);
      setError(err?.response?.data?.detail || 'No se pudo guardar configuración.');
    },
  });

  const exportarMutation = useMutation({
    mutationFn: (formato: '1001' | '1007') =>
      exogenaApi.exportar({ anio, formato, include_warnings: true, modo_exportacion: modoExportacion }),
    onSuccess: (res) => {
      setError(null);
      setMensaje(
        res.ok
          ? `Exportación ${res.formato} (${modoExportacion}) OK (${res.total_rows} filas, omitidos: ${res.omitidos_rows || 0}).`
          : `Exportación ${res.formato} bloqueada: ${res.error_message || 'revisar validaciones'}.`,
      );
      queryClient.invalidateQueries({ queryKey: ['exogena-ejecuciones', anio] });
    },
    onError: (err: any) => {
      setMensaje(null);
      setError(err?.response?.data?.detail || 'No se pudo exportar.');
    },
  });

  const mapeos = mapeosDraft;
  const ejecuciones = (ejecucionesQuery.data || []).filter((e) => {
    if (historialFiltro === 'all') return true;
    return (e.status || '').toLowerCase() === historialFiltro;
  });

  useEffect(() => {
    if (configQuery.data) {
      setUvt(Number(configQuery.data.uvt_anual || 0));
      setVersionNormativa(configQuery.data.version_normativa || '');
      setMapeosDraft(
        (configQuery.data.mapeos || []).map((m) => ({
          id: m.id,
          formato: m.formato,
          cuenta_contable: m.cuenta_contable,
          concepto: m.concepto,
          categoria: m.categoria || '',
          saldo_a_reportar: m.saldo_a_reportar || 'saldo_final',
          activo: m.activo || 'si',
          source_rule: m.source_rule || null,
        })),
      );
    }
  }, [configQuery.data]);

  const addMapeo = () => {
    setMapeosDraft((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        formato: '1001',
        cuenta_contable: '',
        concepto: '',
        categoria: '',
        saldo_a_reportar: 'saldo_final',
        activo: 'si',
        source_rule: null,
      },
    ]);
  };

  const cargarPlantillaBase = () => {
    const template = [
      {
        id: `tpl-1001-ded-${Date.now()}`,
        formato: '1001',
        cuenta_contable: '513505',
        concepto: '5001',
        categoria: 'deducible',
        saldo_a_reportar: 'saldo_final',
        activo: 'si',
        source_rule:
          'fuente:movimientos_caja|movimientos_tesoreria;categoria_egreso:proveedores|servicios_publicos|arriendo|mantenimiento|compra_inventario|nomina',
      },
      {
        id: `tpl-1001-node-${Date.now()}`,
        formato: '1001',
        cuenta_contable: '519595',
        concepto: '5002',
        categoria: 'no_deducible',
        saldo_a_reportar: 'saldo_final',
        activo: 'si',
        source_rule: 'fuente:movimientos_tesoreria;categoria_egreso:impuestos|ajuste_correccion|otros_gastos',
      },
      {
        id: `tpl-1007-ing-${Date.now()}`,
        formato: '1007',
        cuenta_contable: '413505',
        concepto: '4001',
        categoria: 'ingresos',
        saldo_a_reportar: 'saldo_final',
        activo: 'si',
        source_rule: 'fuente:vehiculos_proceso',
      },
      {
        id: `tpl-1007-dev-${Date.now()}`,
        formato: '1007',
        cuenta_contable: '417505',
        concepto: '4002',
        categoria: 'devoluciones',
        saldo_a_reportar: 'saldo_final',
        activo: 'si',
        source_rule: 'fuente:vehiculos_proceso;estado:rechazado',
      },
    ];
    setMapeosDraft(template);
    if (!Number.isFinite(uvt) || Number(uvt) <= 0) {
      setUvt(50000);
    }
    if (!versionNormativa.trim()) {
      setVersionNormativa(`plantilla-base-${anio}`);
    }
    setError(null);
    setMensaje('Plantilla base cargada. Revisa cuentas/conceptos y luego guarda.');
  };

  const removeMapeo = (id: string) => {
    setMapeosDraft((prev) => prev.filter((m) => m.id !== id));
  };

  const updateMapeo = (id: string, patch: Partial<(typeof mapeosDraft)[number]>) => {
    setMapeosDraft((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  const descargarArchivo = async (ejecucionId: string) => {
    try {
      const { blob, filename } = await exogenaApi.descargarArchivoEjecucion(ejecucionId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setError(null);
      setMensaje('Archivo descargado correctamente.');
    } catch (err: any) {
      setMensaje(null);
      setError(err?.message || 'No se pudo descargar el archivo.');
    }
  };

  const descargarOmitidos = async (ejecucionId: string) => {
    try {
      const { blob, filename } = await exogenaApi.descargarOmitidosEjecucion(ejecucionId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setError(null);
      setMensaje('Archivo de omitidos descargado correctamente.');
    } catch (err: any) {
      setMensaje(null);
      setError(err?.message || 'No se pudo descargar el archivo de omitidos.');
    }
  };

  const toggleValidacionesEjecucion = async (ejecucionId: string) => {
    if (expandedEjecucionId === ejecucionId) {
      setExpandedEjecucionId(null);
      return;
    }
    setExpandedEjecucionId(ejecucionId);
    if (validacionesByEjecucion[ejecucionId]) return;
    try {
      setLoadingValidacionesEjecId(ejecucionId);
      const items = await exogenaApi.listarValidacionesEjecucion(ejecucionId);
      setValidacionesByEjecucion((prev) => ({ ...prev, [ejecucionId]: items }));
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || 'No se pudieron cargar validaciones.');
    } finally {
      setLoadingValidacionesEjecId(null);
    }
  };

  return (
    <Layout title="Contador">
      <div className="space-y-6">
        <div className="card-corporate p-4">
          <div className="flex items-center gap-3 mb-3">
            <Database className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-slate-900">Módulo Contador</h2>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={`btn-chip ${activeTab === 'exogena' ? 'bg-indigo-600 text-white' : ''}`}
              onClick={() => setActiveTab('exogena')}
            >
              Exógena
            </button>
          </div>
        </div>

        {activeTab === 'exogena' && (
          <div className="card-corporate p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500 uppercase tracking-wide">Año gravable</span>
                <input
                  className="input-corporate"
                  value={anio}
                  onChange={(e) => setAnio(e.target.value)}
                  maxLength={4}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500 uppercase tracking-wide">UVT anual</span>
                <input
                  type="number"
                  className="input-corporate"
                  value={uvt}
                  onChange={(e) => setUvt(Number(e.target.value || 0))}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500 uppercase tracking-wide">Versión normativa</span>
                <input
                  className="input-corporate"
                  value={versionNormativa}
                  onChange={(e) => setVersionNormativa(e.target.value)}
                  placeholder="ej. resolucion-2026-v1"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <label className="flex items-center gap-2">
                <span className="text-xs text-slate-500 uppercase tracking-wide">Modo exportación</span>
                <select
                  className="input-corporate text-sm"
                  value={modoExportacion}
                  onChange={(e) => setModoExportacion(e.target.value as 'consolidado' | 'detalle')}
                >
                  <option value="consolidado">Consolidado</option>
                  <option value="detalle">Detalle</option>
                </select>
              </label>
              <button
                type="button"
                className="btn-corporate-primary px-4"
                onClick={() => guardarMutation.mutate()}
                disabled={guardarMutation.isLoading}
              >
                Guardar configuración
              </button>
              <button
                type="button"
                className="btn-corporate-muted px-4"
                onClick={() => validarMutation.mutate()}
                disabled={validarMutation.isLoading}
              >
                Validar
              </button>
              <button
                type="button"
                className="btn-corporate-muted px-4 inline-flex items-center gap-2"
                onClick={cargarPlantillaBase}
              >
                <Plus className="w-4 h-4" />
                Plantilla base 1001/1007
              </button>
              <button
                type="button"
                className="btn-corporate-muted px-4 inline-flex items-center gap-2"
                onClick={() => exportarMutation.mutate('1001')}
                disabled={exportarMutation.isLoading}
              >
                <FileUp className="w-4 h-4" />
                Exportar 1001
              </button>
              <button
                type="button"
                className="btn-corporate-muted px-4 inline-flex items-center gap-2"
                onClick={() => exportarMutation.mutate('1007')}
                disabled={exportarMutation.isLoading}
              >
                <FileUp className="w-4 h-4" />
                Exportar 1007
              </button>
            </div>

            {mensaje && <p className="text-sm text-emerald-700">{mensaje}</p>}
            {error && (
              <p className="text-sm text-red-700 inline-flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" />
                {error}
              </p>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-800">Mapeos ({mapeos.length})</h3>
                <button type="button" className="btn-chip inline-flex items-center gap-1" onClick={addMapeo}>
                  <Plus className="w-3.5 h-3.5" />
                  Agregar mapeo
                </button>
              </div>
              <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <p className="font-medium text-slate-700">Ayudante de reglas (`source_rule`)</p>
                <p className="mt-1">
                  Sintaxis: <code>clave:valor1|valor2;otra_clave:valor</code>
                </p>
                <p className="mt-1">
                  Claves soportadas: <code>fuente</code>, <code>categoria_egreso</code>, <code>estado</code>,{' '}
                  <code>metodo_pago</code>, <code>tipo</code>, <code>concepto_contains</code>.
                </p>
                <p className="mt-1">
                  Ejemplo 1001 deducible:{' '}
                  <code>
                    fuente:movimientos_caja|movimientos_tesoreria;categoria_egreso:proveedores|servicios_publicos|arriendo
                  </code>
                </p>
                <p className="mt-1">
                  Ejemplo 1001 no deducible:{' '}
                  <code>fuente:movimientos_tesoreria;categoria_egreso:impuestos|otros_gastos|ajuste_correccion</code>
                </p>
                <p className="mt-1">
                  Ejemplo 1007 devoluciones: <code>fuente:vehiculos_proceso;estado:rechazado</code>
                </p>
              </div>
              <div className="overflow-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-3 py-2">Formato</th>
                      <th className="text-left px-3 py-2">Cuenta</th>
                      <th className="text-left px-3 py-2">Concepto</th>
                      <th className="text-left px-3 py-2">Categoría</th>
                      <th className="text-left px-3 py-2">Saldo</th>
                      <th className="text-left px-3 py-2">Regla</th>
                      <th className="text-left px-3 py-2">Activo</th>
                      <th className="text-left px-3 py-2">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapeos.map((m) => (
                      <tr key={m.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <select
                            className="input-corporate"
                            value={m.formato}
                            onChange={(e) => updateMapeo(m.id, { formato: e.target.value })}
                          >
                            <option value="1001">1001</option>
                            <option value="1007">1007</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="input-corporate"
                            value={m.cuenta_contable}
                            onChange={(e) => updateMapeo(m.id, { cuenta_contable: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="input-corporate"
                            value={m.concepto}
                            onChange={(e) => updateMapeo(m.id, { concepto: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="input-corporate"
                            value={m.categoria || ''}
                            onChange={(e) => updateMapeo(m.id, { categoria: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            className="input-corporate"
                            value={m.saldo_a_reportar || 'saldo_final'}
                            onChange={(e) => updateMapeo(m.id, { saldo_a_reportar: e.target.value })}
                          >
                            <option value="saldo_final">Saldo final</option>
                            <option value="saldo_debito">Saldo débito</option>
                            <option value="saldo_credito">Saldo crédito</option>
                            <option value="debito_menos_credito">Débito - Crédito</option>
                          </select>
                        </td>
                        <td className="px-3 py-2 min-w-[280px]">
                          <input
                            className="input-corporate"
                            value={m.source_rule || ''}
                            onChange={(e) => updateMapeo(m.id, { source_rule: e.target.value })}
                            placeholder="ej: fuente:movimientos_tesoreria;categoria_egreso:impuestos|otros_gastos"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            className="input-corporate"
                            value={m.activo || 'si'}
                            onChange={(e) => updateMapeo(m.id, { activo: e.target.value })}
                          >
                            <option value="si">si</option>
                            <option value="no">no</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="btn-chip text-red-600 inline-flex items-center gap-1"
                            onClick={() => removeMapeo(m.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Quitar
                          </button>
                        </td>
                      </tr>
                    ))}
                    {mapeos.length === 0 && (
                      <tr>
                        <td className="px-3 py-3 text-slate-500" colSpan={8}>
                          Sin mapeos en este año.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2 gap-2">
                <h3 className="text-sm font-semibold text-slate-800">
                  Historial de ejecuciones ({ejecuciones.length})
                </h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Vista</span>
                  <select
                    className="input-corporate text-sm"
                    value={historialFiltro}
                    onChange={(e) => setHistorialFiltro(e.target.value as 'success' | 'error' | 'all')}
                  >
                    <option value="success">Solo success</option>
                    <option value="error">Solo error</option>
                    <option value="all">Todos</option>
                  </select>
                </div>
              </div>
              <div className="overflow-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-3 py-2">Fecha</th>
                      <th className="text-left px-3 py-2">Formato</th>
                      <th className="text-left px-3 py-2">Estado</th>
                      <th className="text-left px-3 py-2">Filas</th>
                      <th className="text-left px-3 py-2">Fuentes</th>
                      <th className="text-left px-3 py-2">Omitidos</th>
                      <th className="text-left px-3 py-2">Errores</th>
                      <th className="text-left px-3 py-2">Validaciones</th>
                      <th className="text-left px-3 py-2">Archivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ejecuciones.map((e) => {
                      const items = validacionesByEjecucion[e.id] || [];
                      const byCode = items.reduce((acc, v) => {
                        const key = String(v.codigo || 'SIN_CODIGO');
                        acc[key] = (acc[key] || 0) + 1;
                        return acc;
                      }, {} as { [key: string]: number });
                      const resumen = (Object.entries(byCode) as Array<[string, number]>)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 6)
                        .map(([code, n]) => `${code}: ${n}`)
                        .join(' | ');
                      return (
                        <Fragment key={e.id}>
                      <tr className="border-t border-slate-100">
                        <td className="px-3 py-2">{new Date(e.created_at).toLocaleString('es-CO')}</td>
                        <td className="px-3 py-2">{e.formato}</td>
                        <td className="px-3 py-2">{e.status}</td>
                        <td className="px-3 py-2">{e.total_rows}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {(e.fuente_resumen_json || [])
                            .map((f) => `${f.fuente}: ${f.rows}`)
                            .join(' | ') || '—'}
                        </td>
                        <td className="px-3 py-2">
                          {(e.omitidos_rows || 0) > 0 ? (
                            <button
                              type="button"
                              className="btn-chip inline-flex items-center gap-1"
                              onClick={() => descargarOmitidos(e.id)}
                            >
                              <Download className="w-3.5 h-3.5" />
                              {e.omitidos_rows}
                            </button>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>
                        <td className="px-3 py-2">{e.total_errors}</td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="btn-chip inline-flex items-center gap-1"
                            onClick={() => toggleValidacionesEjecucion(e.id)}
                          >
                            {expandedEjecucionId === e.id ? 'Ocultar' : 'Ver'}
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          {e.archivo_relpath ? (
                            <button
                              type="button"
                              className="btn-chip inline-flex items-center gap-1"
                              onClick={() => descargarArchivo(e.id)}
                            >
                              <Download className="w-3.5 h-3.5" />
                              Descargar
                            </button>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                      {expandedEjecucionId === e.id && (
                        <tr className="border-t border-slate-100 bg-slate-50">
                          <td className="px-3 py-3 text-xs text-slate-700" colSpan={9}>
                            {loadingValidacionesEjecId === e.id ? (
                              <span>Cargando validaciones...</span>
                            ) : (
                              <div className="space-y-1">
                                <p>
                                  <strong>Total validaciones:</strong> {items.length}
                                </p>
                                <p>
                                  <strong>Resumen por código:</strong> {resumen || 'Sin validaciones.'}
                                </p>
                                {items.slice(0, 5).map((v) => (
                                  <p key={v.id}>
                                    - [{String(v.severidad || '').toUpperCase()}] {v.codigo}: {v.mensaje}
                                  </p>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                        </Fragment>
                      );
                    })}
                    {ejecuciones.length === 0 && (
                      <tr>
                        <td className="px-3 py-3 text-slate-500" colSpan={9}>
                          No hay ejecuciones para el filtro actual.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
