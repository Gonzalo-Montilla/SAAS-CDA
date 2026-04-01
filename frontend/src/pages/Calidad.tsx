import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, MessageSquareHeart, RefreshCw, Star, X } from 'lucide-react';
import Layout from '../components/Layout';
import { qualityApi } from '../api/quality';
import type { QualityInviteItem } from '../types';

const statusLabel = (status: string): string => {
  const map: Record<string, string> = {
    pending: 'Pendiente envío',
    sent: 'Enviada',
    responded: 'Respondida',
    expired: 'Vencida',
    failed: 'Fallida',
    no_email: 'Sin correo',
  };
  return map[status] || status;
};

const statusClass = (status: string): string => {
  if (status === 'responded') return 'badge badge-success';
  if (status === 'sent' || status === 'pending') return 'badge badge-info';
  if (status === 'failed' || status === 'expired' || status === 'no_email') return 'badge bg-amber-100 text-amber-800';
  return 'badge bg-slate-100 text-slate-700';
};

const stars = (value?: number | null) => {
  if (!value) return '-';
  return `${'★'.repeat(value)}${'☆'.repeat(5 - value)}`;
};

const scoreClass = (value?: number | null): string => {
  if (!value) return 'text-slate-500';
  if (value <= 2) return 'text-red-600';
  if (value === 3) return 'text-amber-600';
  return 'text-emerald-600';
};

const scoreBorderClass = (value?: number | null): string => {
  if (!value) return 'border-l-slate-300';
  if (value <= 2) return 'border-l-red-500';
  if (value === 3) return 'border-l-amber-500';
  return 'border-l-emerald-500';
};

export default function Calidad() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('todos');
  const [search, setSearch] = useState('');
  const [selectedInviteId, setSelectedInviteId] = useState<string | null>(null);

  const summaryQuery = useQuery({
    queryKey: ['quality-summary'],
    queryFn: qualityApi.getSummary,
    refetchInterval: 30000,
  });

  const invitesQuery = useQuery({
    queryKey: ['quality-invites', statusFilter],
    queryFn: () => qualityApi.listInvites(statusFilter === 'todos' ? undefined : statusFilter),
    refetchInterval: 30000,
  });

  const processMutation = useMutation({
    mutationFn: qualityApi.processPending,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality-summary'] });
      queryClient.invalidateQueries({ queryKey: ['quality-invites'] });
    },
  });

  const detailQuery = useQuery({
    queryKey: ['quality-invite-detail', selectedInviteId],
    queryFn: () => qualityApi.getInviteDetail(selectedInviteId || ''),
    enabled: !!selectedInviteId,
  });

  const rows = useMemo(() => {
    const data = invitesQuery.data || [];
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter((row: QualityInviteItem) => {
      return (
        row.cliente_nombre.toLowerCase().includes(q) ||
        row.placa.toLowerCase().includes(q) ||
        (row.cliente_celular || '').toLowerCase().includes(q)
      );
    });
  }, [invitesQuery.data, search]);

  return (
    <Layout title="Calidad">
      <div className="space-y-6">
        <section className="module-hero">
          <p className="module-hero-title flex items-center gap-2">
            <MessageSquareHeart className="w-5 h-5 text-violet-600" />
            Gestión de calidad
          </p>
          <p className="module-hero-subtitle">
            Monitorea la satisfacción de clientes con encuestas de experiencia post-servicio.
          </p>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="section-card p-4">
            <p className="text-xs text-slate-500">Invitaciones</p>
            <p className="text-2xl font-bold text-slate-900">{summaryQuery.data?.total_invitaciones || 0}</p>
          </div>
          <div className="section-card p-4">
            <p className="text-xs text-slate-500">Respondidas</p>
            <p className="text-2xl font-bold text-emerald-700">{summaryQuery.data?.total_respondidas || 0}</p>
          </div>
          <div className="section-card p-4">
            <p className="text-xs text-slate-500">Pendientes</p>
            <p className="text-2xl font-bold text-cyan-700">{summaryQuery.data?.total_pendientes || 0}</p>
          </div>
          <div className="section-card p-4">
            <p className="text-xs text-slate-500">Promedio general</p>
            <p className="text-2xl font-bold text-violet-700">{summaryQuery.data?.promedio_general?.toFixed(2) || '0.00'}</p>
          </div>
        </section>

        <section className="section-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <p className="text-sm font-semibold text-slate-800">Bandeja de encuestas</p>
            <button
              type="button"
              onClick={() => processMutation.mutate()}
              disabled={processMutation.isLoading}
              className="btn-corporate-primary px-4 inline-flex items-center gap-2 disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${processMutation.isLoading ? 'animate-spin' : ''}`} />
              {processMutation.isLoading ? 'Procesando...' : 'Procesar envíos pendientes'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-corporate"
              placeholder="Buscar por cliente, placa o celular"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input-corporate"
            >
              <option value="todos">Todos los estados</option>
              <option value="pending">Pendiente envío</option>
              <option value="sent">Enviada</option>
              <option value="responded">Respondida</option>
              <option value="failed">Fallida</option>
              <option value="expired">Vencida</option>
              <option value="no_email">Sin correo</option>
            </select>
            <div className="text-xs text-slate-500 flex items-center">
              Tasa de respuesta: <span className="font-semibold ml-1">{summaryQuery.data?.tasa_respuesta || 0}%</span>
            </div>
          </div>

          <div className="table-shell">
            <table className="table-enterprise">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th>Celular</th>
                  <th>Placa</th>
                  <th>Tipo</th>
                  <th>General</th>
                  <th>Comentario</th>
                  <th>Estado</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {invitesQuery.isLoading && (
                  <tr>
                    <td colSpan={9} className="text-sm text-slate-500">Cargando encuestas...</td>
                  </tr>
                )}
                {!invitesQuery.isLoading && rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-sm text-slate-500">No hay resultados para los filtros actuales.</td>
                  </tr>
                )}
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.created_at).toLocaleString()}</td>
                    <td>{row.cliente_nombre}</td>
                    <td>{row.cliente_celular || '-'}</td>
                    <td className="font-semibold text-slate-900">{row.placa}</td>
                    <td className="capitalize">{row.tipo_vehiculo.replaceAll('_', ' ')}</td>
                    <td>
                      {row.atencion_general ? (
                        <span className="inline-flex items-center gap-1 text-amber-600 font-semibold">
                          <Star className="w-4 h-4 fill-current" />
                          {row.atencion_general} ({stars(row.atencion_general)})
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="max-w-[260px] truncate" title={row.comentario || ''}>{row.comentario || '-'}</td>
                    <td><span className={statusClass(row.status)}>{statusLabel(row.status)}</span></td>
                    <td>
                      <button
                        type="button"
                        onClick={() => setSelectedInviteId(row.id)}
                        className="px-3 py-1 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 inline-flex items-center gap-1"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Ver detalle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {selectedInviteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className={`w-full max-w-3xl rounded-2xl border border-slate-200 border-l-8 ${scoreBorderClass(detailQuery.data?.atencion_general)} bg-gradient-to-b from-white to-slate-50 shadow-2xl max-h-[90vh] overflow-y-auto`}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white/95 backdrop-blur-sm">
              <div>
                <p className="text-base font-semibold text-slate-900">Detalle de encuesta</p>
                <p className="text-xs text-slate-500 mt-0.5">Vista completa de experiencia del cliente</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInviteId(null)}
                className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5 text-slate-600" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {detailQuery.isLoading && <p className="text-sm text-slate-500">Cargando detalle...</p>}
              {detailQuery.isError && (
                <p className="text-sm text-red-600">No fue posible cargar el detalle de esta encuesta.</p>
              )}

              {detailQuery.data && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Cliente</p>
                      <p className="font-semibold text-slate-900">{detailQuery.data.cliente_nombre}</p>
                      <p className="text-xs text-slate-600 mt-1">
                        Celular: <span className="font-medium">{detailQuery.data.cliente_celular || '-'}</span>
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Servicio</p>
                      <p className="font-semibold text-slate-900">{detailQuery.data.placa} - {detailQuery.data.tipo_vehiculo}</p>
                      <p className="text-xs text-slate-600 mt-1">
                        Estado:{' '}
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusClass(detailQuery.data.status)}`}>
                          {statusLabel(detailQuery.data.status)}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
                    <p className="text-sm font-semibold text-slate-800 mb-2">Calificaciones</p>
                    <p className="text-sm text-slate-700">Recepción: <span className={`font-semibold ${scoreClass(detailQuery.data.atencion_recepcion)}`}>{stars(detailQuery.data.atencion_recepcion)}</span></p>
                    <p className="text-sm text-slate-700">Caja: <span className={`font-semibold ${scoreClass(detailQuery.data.atencion_caja)}`}>{stars(detailQuery.data.atencion_caja)}</span></p>
                    <p className="text-sm text-slate-700">Sala de espera: <span className={`font-semibold ${scoreClass(detailQuery.data.sala_espera)}`}>{stars(detailQuery.data.sala_espera)}</span></p>
                    <p className="text-sm text-slate-700">Agrado de la visita: <span className={`font-semibold ${scoreClass(detailQuery.data.agrado_visita)}`}>{stars(detailQuery.data.agrado_visita)}</span></p>
                    <p className="text-sm text-slate-700">Atención general: <span className={`font-semibold ${scoreClass(detailQuery.data.atencion_general)}`}>{stars(detailQuery.data.atencion_general)}</span></p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-sm font-semibold text-slate-800 mb-2">Comentario del cliente</p>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">
                      {detailQuery.data.comentario || 'Sin comentario.'}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Recepcionista</p>
                      <p className="text-sm font-medium text-slate-800">{detailQuery.data.recepcionista_nombre || '-'}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Cajero</p>
                      <p className="text-sm font-medium text-slate-800">{detailQuery.data.cajero_nombre || '-'}</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

