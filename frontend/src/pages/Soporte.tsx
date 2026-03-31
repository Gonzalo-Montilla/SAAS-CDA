import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy, Send } from 'lucide-react';
import Layout from '../components/Layout';
import apiClient from '../api/client';
import type { TenantSupportTicketItem } from '../types';

const statusLabel = (status: string) => {
  const labels: Record<string, string> = {
    abierto: 'Abierto',
    en_progreso: 'En progreso',
    resuelto: 'Resuelto',
    cerrado: 'Cerrado',
  };
  return labels[status] || status;
};

const statusClass = (status: string) => {
  if (status === 'abierto' || status === 'en_progreso') return 'badge badge-info';
  if (status === 'resuelto' || status === 'cerrado') return 'badge badge-success';
  return 'badge bg-slate-100 text-slate-700';
};

export default function Soporte() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [priority, setPriority] = useState<'baja' | 'media' | 'alta' | 'critica'>('media');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const ticketsQuery = useQuery({
    queryKey: ['tenant-support-tickets'],
    queryFn: async () => {
      const response = await apiClient.get<TenantSupportTicketItem[]>('/support/tickets');
      return response.data;
    },
  });

  const createTicketMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<TenantSupportTicketItem>('/support/tickets', {
        title: title.trim(),
        description: description.trim(),
        category: category.trim().toLowerCase() || 'general',
        priority,
      });
      return response.data;
    },
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Ticket enviado correctamente. Nuestro equipo lo revisará.' });
      setTitle('');
      setDescription('');
      setCategory('general');
      setPriority('media');
      queryClient.invalidateQueries({ queryKey: ['tenant-support-tickets'] });
    },
    onError: (error: any) => {
      setFeedback({
        type: 'error',
        message: error?.response?.data?.detail || 'No fue posible enviar el ticket. Intenta nuevamente.',
      });
    },
  });

  return (
    <Layout title="Soporte">
      <div className="space-y-6">
        <section className="module-hero">
          <p className="module-hero-title flex items-center gap-2">
            <LifeBuoy className="w-5 h-5 text-cyan-600" />
            Mesa de soporte
          </p>
          <p className="module-hero-subtitle">
            Registra incidentes o solicitudes para que el equipo CDASOFT las atienda.
          </p>
        </section>

        <section className="section-card p-6">
          <p className="text-sm font-semibold text-slate-800 mb-3">Crear ticket</p>
          {feedback && (
            <p
              className={`text-sm rounded-lg border p-3 mb-3 ${
                feedback.type === 'success'
                  ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                  : 'text-red-700 bg-red-50 border-red-200'
              }`}
            >
              {feedback.message}
            </p>
          )}
          <form
            className="grid grid-cols-1 md:grid-cols-2 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setFeedback(null);
              createTicketMutation.mutate();
            }}
          >
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input-corporate"
              placeholder="Asunto del ticket"
              required
            />
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="input-corporate"
              placeholder="Categoría (acceso, facturación, operación...)"
              required
            />
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as 'baja' | 'media' | 'alta' | 'critica')}
              className="input-corporate"
            >
              <option value="baja">Prioridad baja</option>
              <option value="media">Prioridad media</option>
              <option value="alta">Prioridad alta</option>
              <option value="critica">Prioridad crítica</option>
            </select>
            <div />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-corporate md:col-span-2 min-h-[120px]"
              placeholder="Describe lo que necesitas, impacto y pasos para reproducir."
              required
            />
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={createTicketMutation.isLoading}
                className="btn-corporate-primary px-4 disabled:opacity-60 inline-flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                {createTicketMutation.isLoading ? 'Enviando...' : 'Enviar ticket'}
              </button>
            </div>
          </form>
        </section>

        <section className="section-card p-6">
          <p className="text-sm font-semibold text-slate-800 mb-3">Mis tickets</p>
          {ticketsQuery.isLoading && <p className="text-sm text-slate-500">Cargando tickets...</p>}
          {ticketsQuery.isError && <p className="text-sm text-red-600">No fue posible cargar tus tickets.</p>}
          {ticketsQuery.data && (
            ticketsQuery.data.length === 0 ? (
              <p className="text-sm text-slate-500">Aún no has registrado tickets.</p>
            ) : (
              <div className="table-shell">
                <table className="table-enterprise">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Asunto</th>
                      <th>Categoría</th>
                      <th>Prioridad</th>
                      <th>Estado</th>
                      <th>Asignado</th>
                      <th>Respuesta CDASOFT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ticketsQuery.data.map((ticket) => (
                      <tr key={ticket.id}>
                        <td>{new Date(ticket.created_at).toLocaleString()}</td>
                        <td>
                          <p className="font-medium text-slate-900">{ticket.title}</p>
                          <p className="text-xs text-slate-500">{ticket.description}</p>
                        </td>
                        <td>{ticket.category}</td>
                        <td className="capitalize">{ticket.priority}</td>
                        <td>
                          <span className={statusClass(ticket.status)}>{statusLabel(ticket.status)}</span>
                        </td>
                        <td>{ticket.assigned_to_user_email || '-'}</td>
                        <td>
                          {ticket.tenant_response_message ? (
                            <>
                              <p className="text-xs text-slate-700">{ticket.tenant_response_message}</p>
                              {ticket.tenant_responded_at && (
                                <p className="text-[11px] text-slate-400 mt-1">
                                  {new Date(ticket.tenant_responded_at).toLocaleString()}
                                </p>
                              )}
                            </>
                          ) : (
                            <span className="text-xs text-slate-400">Aún sin respuesta</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </section>
      </div>
    </Layout>
  );
}

