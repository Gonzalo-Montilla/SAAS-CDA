import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import FactusMunicipalitySearchField from '../components/FactusMunicipalitySearchField';
import {
  proveedoresCatalogoApi,
  type ProveedorCatalogo,
  type ProveedorCatalogoCreate,
} from '../api/proveedoresCatalogo';
import { factusApi } from '../api/factus';
import { BookUser, Plus, Pencil, X } from 'lucide-react';

const TIPOS_ID = ['NIT', 'C.C', 'TARJETA DE IDENTIDAD', 'C.E', 'PASAPORTE', 'P.E.P'] as const;

const emptyForm: ProveedorCatalogoCreate = {
  alias: '',
  razon_social_rut: '',
  tipo_identificacion: 'NIT',
  numero_identificacion: '',
  direccion: '',
  email: '',
  telefono: '',
  factus_municipality_id: 1,
  activo: true,
};

export default function ProveedoresCatalogoPage() {
  const qc = useQueryClient();
  const { data: factusCfg } = useQuery({
    queryKey: ['factus-settings'],
    queryFn: () => factusApi.getSettings(),
    staleTime: 60_000,
  });
  const { data: items, isLoading } = useQuery({
    queryKey: ['proveedores-catalogo-admin'],
    queryFn: () => proveedoresCatalogoApi.listar(false),
    staleTime: 15_000,
  });

  const [modal, setModal] = useState<'crear' | 'editar' | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<ProveedorCatalogoCreate>(emptyForm);

  const crear = useMutation({
    mutationFn: proveedoresCatalogoApi.crear,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proveedores-catalogo-admin'] });
      qc.invalidateQueries({ queryKey: ['proveedores-catalogo'] });
      setModal(null);
      setForm(emptyForm);
    },
  });

  const actualizar = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof proveedoresCatalogoApi.actualizar>[1] }) =>
      proveedoresCatalogoApi.actualizar(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proveedores-catalogo-admin'] });
      qc.invalidateQueries({ queryKey: ['proveedores-catalogo'] });
      setModal(null);
      setEditId(null);
      setForm(emptyForm);
    },
  });

  const abrirCrear = () => {
    setForm({ ...emptyForm, tipo_identificacion: 'NIT', factus_municipality_id: 1 });
    setEditId(null);
    setModal('crear');
  };

  const abrirEditar = (p: ProveedorCatalogo) => {
    setEditId(p.id);
    setForm({
      alias: p.alias || '',
      razon_social_rut: p.razon_social_rut,
      tipo_identificacion: p.tipo_identificacion,
      numero_identificacion: p.numero_identificacion,
      direccion: p.direccion,
      email: p.email,
      telefono: p.telefono,
      factus_municipality_id: p.factus_municipality_id,
      activo: p.activo,
    });
    setModal('editar');
  };

  const guardar = (e: React.FormEvent) => {
    e.preventDefault();
    const mid = Number(form.factus_municipality_id);
    if (!Number.isFinite(mid) || mid < 1) {
      window.alert('Indique un id de municipio Factus válido.');
      return;
    }
    const payload: ProveedorCatalogoCreate = {
      ...form,
      alias: form.alias?.trim() || null,
      razon_social_rut: form.razon_social_rut.trim(),
      tipo_identificacion: form.tipo_identificacion.trim(),
      numero_identificacion: form.numero_identificacion.trim(),
      direccion: form.direccion.trim(),
      email: form.email.trim().toLowerCase(),
      telefono: form.telefono.trim(),
      factus_municipality_id: mid,
      activo: form.activo !== false,
    };
    if (modal === 'crear') {
      crear.mutate(payload);
    } else if (modal === 'editar' && editId) {
      actualizar.mutate({ id: editId, body: payload });
    }
  };

  const errMsg =
    (crear.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
    (actualizar.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;

  return (
    <Layout title="Catálogo de proveedores">
      <section className="module-hero">
        <p className="module-hero-title flex items-center gap-2">
          <BookUser className="w-5 h-5 text-primary-600" />
          Catálogo de proveedores (documento soporte DIAN)
        </p>
        <p className="module-hero-subtitle max-w-3xl">
          Registre una vez el nombre y documento tal como figuran en el RUT, más dirección, correo, teléfono y municipio
          Factus. En caja y tesorería podrá elegir el proveedor sin volver a teclear esos datos.
        </p>
      </section>

      <div className="flex justify-end mb-4">
        <button type="button" onClick={abrirCrear} className="btn-pos btn-primary inline-flex items-center gap-2">
          <Plus className="w-5 h-5" />
          Nuevo proveedor
        </button>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2 font-semibold">Alias</th>
                <th className="px-3 py-2 font-semibold">Razón social / nombre RUT</th>
                <th className="px-3 py-2 font-semibold">Doc.</th>
                <th className="px-3 py-2 font-semibold">Correo</th>
                <th className="px-3 py-2 font-semibold">Mcp. Factus</th>
                <th className="px-3 py-2 font-semibold">Activo</th>
                <th className="px-3 py-2 font-semibold w-24" />
              </tr>
            </thead>
            <tbody>
              {(items ?? []).map((p) => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                  <td className="px-3 py-2 text-slate-700">{p.alias || '—'}</td>
                  <td className="px-3 py-2 font-medium text-slate-900">{p.razon_social_rut}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                    {p.tipo_identificacion} {p.numero_identificacion}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{p.email}</td>
                  <td className="px-3 py-2 text-slate-600">{p.factus_municipality_id}</td>
                  <td className="px-3 py-2">{p.activo ? 'Sí' : 'No'}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => abrirEditar(p)}
                      className="text-primary-600 hover:underline inline-flex items-center gap-1"
                    >
                      <Pencil className="w-4 h-4" />
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {items?.length === 0 && (
            <p className="p-6 text-center text-slate-600">No hay proveedores. Cree el primero con «Nuevo proveedor».</p>
          )}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 relative">
            <button
              type="button"
              className="absolute top-3 right-3 text-slate-500 hover:text-slate-800"
              onClick={() => {
                setModal(null);
                setEditId(null);
              }}
              aria-label="Cerrar"
            >
              <X className="w-6 h-6" />
            </button>
            <h3 className="text-lg font-bold text-slate-900 mb-4">
              {modal === 'crear' ? 'Nuevo proveedor' : 'Editar proveedor'}
            </h3>
            {errMsg && (
              <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
                {typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg)}
              </div>
            )}
            <form onSubmit={guardar} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Alias (opcional)</label>
                <input
                  className="input-pos w-full"
                  value={form.alias ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, alias: e.target.value }))}
                  placeholder="Ej: Papelera Central"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Nombre o razón social (RUT)</label>
                <input
                  className="input-pos w-full"
                  value={form.razon_social_rut}
                  onChange={(e) => setForm((f) => ({ ...f, razon_social_rut: e.target.value }))}
                  required
                  minLength={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Tipo ID</label>
                  <select
                    className="input-pos w-full"
                    value={form.tipo_identificacion}
                    onChange={(e) => setForm((f) => ({ ...f, tipo_identificacion: e.target.value }))}
                  >
                    {TIPOS_ID.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Número (con guion y DV si aplica)</label>
                  <input
                    className="input-pos w-full"
                    value={form.numero_identificacion}
                    onChange={(e) => setForm((f) => ({ ...f, numero_identificacion: e.target.value }))}
                    required
                    minLength={4}
                    placeholder="Ej. 900123456-8"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Para NIT o cédula como NIT, use el mismo formato que en el RUT/DIAN (con guion y dígito de verificación).
                    Si solo escribe dígitos y hay dos DV posibles (regla DSAJ24b), el sistema pedirá el número completo.
                  </p>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Dirección</label>
                <textarea
                  className="input-pos w-full min-h-[72px]"
                  value={form.direccion}
                  onChange={(e) => setForm((f) => ({ ...f, direccion: e.target.value }))}
                  required
                  minLength={8}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Correo</label>
                  <input
                    type="email"
                    className="input-pos w-full"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Teléfono</label>
                  <input
                    className="input-pos w-full"
                    value={form.telefono}
                    onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))}
                    required
                  />
                </div>
              </div>
              <FactusMunicipalitySearchField
                value={String(form.factus_municipality_id || '')}
                onChange={(idDigits) =>
                  setForm((f) => ({
                    ...f,
                    factus_municipality_id: parseInt(idDigits, 10) || 0,
                  }))
                }
                disabled={factusCfg?.modo !== 'factus'}
                searchLabel="Municipio (Factus)"
                idInputLabel="Id municipio Factus"
                helperText="Mismo catálogo que en Organización."
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.activo !== false}
                  onChange={(e) => setForm((f) => ({ ...f, activo: e.target.checked }))}
                />
                Activo (visible en caja / tesorería)
              </label>
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={crear.isLoading || actualizar.isLoading}
                  className="flex-1 btn-pos btn-primary"
                >
                  {crear.isLoading || actualizar.isLoading ? 'Guardando…' : 'Guardar'}
                </button>
                <button
                  type="button"
                  className="flex-1 btn-pos btn-secondary"
                  onClick={() => {
                    setModal(null);
                    setEditId(null);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
