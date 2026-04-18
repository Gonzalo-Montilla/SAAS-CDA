import { useState, useEffect, useRef } from 'react';
import { isAxiosError } from 'axios';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { extractApiErrorMessage } from '../utils/apiError';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import FactusMunicipalitySearchField from '../components/FactusMunicipalitySearchField';
import {
  proveedoresCatalogoApi,
  type ProveedorCatalogo,
  type ProveedorCatalogoCreate,
} from '../api/proveedoresCatalogo';
import { factusApi } from '../api/factus';
import { BookUser, Plus, Pencil, X, FileText, Eye, Trash2 } from 'lucide-react';

function proveedorToForm(p: ProveedorCatalogo): ProveedorCatalogoCreate {
  return {
    alias: p.alias || '',
    razon_social_rut: p.razon_social_rut,
    tipo_identificacion: p.tipo_identificacion,
    numero_identificacion: p.numero_identificacion,
    direccion: p.direccion,
    email: p.email,
    telefono: p.telefono,
    factus_municipality_id: p.factus_municipality_id,
    activo: p.activo,
  };
}

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
  /** Refleja adjunto RUT en el proveedor en edición (lista + respuestas API). */
  const [tieneAdjuntoRut, setTieneAdjuntoRut] = useState(false);
  const [rutFile, setRutFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitulo, setPreviewTitulo] = useState('');
  const previewBlobRef = useRef<string | null>(null);

  const revocarPreviewBlob = () => {
    if (previewBlobRef.current) {
      URL.revokeObjectURL(previewBlobRef.current);
      previewBlobRef.current = null;
    }
    setPreviewUrl(null);
    setPreviewTitulo('');
  };

  useEffect(() => () => revocarPreviewBlob(), []);

  /** Solo la fila (o el modal del mismo id) muestra “cargando…” al pedir el PDF. */
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);

  const abrirPreviewPdf = async (id: string, titulo: string) => {
    try {
      revocarPreviewBlob();
      setPreviewLoadingId(id);
      const blob = await proveedoresCatalogoApi.descargarDocumentoRutBlob(id);
      const url = URL.createObjectURL(blob);
      previewBlobRef.current = url;
      setPreviewUrl(url);
      setPreviewTitulo(titulo);
    } catch (err: unknown) {
      const st = isAxiosError(err) ? err.response?.status : undefined;
      let detail = '';
      if (isAxiosError(err) && err.response?.data instanceof Blob) {
        try {
          const t = await err.response.data.text();
          const j = JSON.parse(t) as { detail?: unknown };
          if (typeof j.detail === 'string') detail = j.detail;
        } catch {
          /* usar mensajes genéricos */
        }
      }
      if (st === 404) {
        window.alert(
          detail ||
            'No hay PDF del RUT guardado para este proveedor, o el archivo ya no está en el servidor.\n\n' +
              'Si acaba de subirlo, cierre este aviso y pulse de nuevo tras unos segundos. ' +
              'Si persiste, use «Editar» y vuelva a subir la certificación RUT (PDF) de la DIAN.',
        );
      } else if (st === 403) {
        window.alert(
          detail ||
            'No tiene permiso para descargar este documento. Se requiere rol cajero o administrador.',
        );
      } else {
        window.alert(
          extractApiErrorMessage(err, 'No se pudo cargar el PDF. Compruebe su sesión y el servidor.'),
        );
      }
    } finally {
      setPreviewLoadingId(null);
    }
  };

  const cerrarModal = () => {
    revocarPreviewBlob();
    setModal(null);
    setEditId(null);
    setForm(emptyForm);
    setTieneAdjuntoRut(false);
    setRutFile(null);
  };

  const crear = useMutation({
    mutationFn: proveedoresCatalogoApi.crear,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['proveedores-catalogo-admin'] });
      qc.invalidateQueries({ queryKey: ['proveedores-catalogo'] });
      setEditId(data.id);
      setForm(proveedorToForm(data));
      setTieneAdjuntoRut(data.tiene_documento_rut);
      setRutFile(null);
      setModal('editar');
    },
  });

  const actualizar = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof proveedoresCatalogoApi.actualizar>[1] }) =>
      proveedoresCatalogoApi.actualizar(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proveedores-catalogo-admin'] });
      qc.invalidateQueries({ queryKey: ['proveedores-catalogo'] });
      cerrarModal();
    },
  });

  const subirRut = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) =>
      proveedoresCatalogoApi.subirDocumentoRut(id, file),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['proveedores-catalogo-admin'] });
      qc.invalidateQueries({ queryKey: ['proveedores-catalogo'] });
      setTieneAdjuntoRut(data.tiene_documento_rut);
      setRutFile(null);
      if (!data.tiene_documento_rut) {
        window.alert(
          'La subida terminó pero el servidor no registró el PDF. Revise que el backend esté actualizado y que exista la columna rut_pdf_relpath en proveedores_catalogo. Si el problema continúa, copie el mensaje de la consola del servidor.',
        );
      }
    },
    onError: (error) => {
      window.alert(
        extractApiErrorMessage(
          error,
          'No se pudo guardar el PDF. Si es la primera vez, compruebe que su usuario sea administrador.',
        ),
      );
    },
  });

  const eliminarRut = useMutation({
    mutationFn: (id: string) => proveedoresCatalogoApi.eliminarDocumentoRut(id),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['proveedores-catalogo-admin'] });
      qc.invalidateQueries({ queryKey: ['proveedores-catalogo'] });
      setTieneAdjuntoRut(data.tiene_documento_rut);
    },
  });

  const abrirCrear = () => {
    setForm({ ...emptyForm, tipo_identificacion: 'NIT', factus_municipality_id: 1 });
    setEditId(null);
    setTieneAdjuntoRut(false);
    setRutFile(null);
    setModal('crear');
  };

  const abrirEditar = (p: ProveedorCatalogo) => {
    setEditId(p.id);
    setForm(proveedorToForm(p));
    setTieneAdjuntoRut(p.tiene_documento_rut);
    setRutFile(null);
    setModal('editar');
  };

  const guardar = async (e: React.FormEvent) => {
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
      return;
    }
    if (modal === 'editar' && editId) {
      if (rutFile) {
        try {
          const up = await proveedoresCatalogoApi.subirDocumentoRut(editId.trim(), rutFile);
          qc.invalidateQueries({ queryKey: ['proveedores-catalogo-admin'] });
          qc.invalidateQueries({ queryKey: ['proveedores-catalogo'] });
          setTieneAdjuntoRut(up.tiene_documento_rut);
          setRutFile(null);
          if (!up.tiene_documento_rut) {
            window.alert(
              'El PDF no quedó registrado en el servidor. Revise la consola del backend y que exista la columna rut_pdf_relpath.',
            );
            return;
          }
        } catch (err) {
          window.alert(
            extractApiErrorMessage(
              err,
              'No se pudo guardar el PDF del RUT. Compruebe que sea administrador y que el archivo sea un PDF válido.',
            ),
          );
          return;
        }
      }
      actualizar.mutate({ id: editId, body: payload });
    }
  };

  const errMsg =
    (crear.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
    (actualizar.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  const errRut =
    (subirRut.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
    (eliminarRut.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;

  return (
    <Layout title="Catálogo de proveedores">
      <section className="module-hero">
        <p className="module-hero-title flex items-center gap-2">
          <BookUser className="w-5 h-5 text-primary-600" />
          Catálogo de proveedores (documento soporte DIAN)
        </p>
        <p className="module-hero-subtitle max-w-3xl">
          Registre una vez el nombre y número de identificación (como en el RUT/DIAN), más dirección, correo, teléfono y
          municipio Factus. Adjunte solo el PDF de certificación RUT emitido por la DIAN (no cédula escaneada). En caja y
          tesorería podrá elegir el proveedor sin volver a teclear esos datos.
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
                <th className="px-3 py-2 font-semibold">RUT (PDF)</th>
                <th className="px-3 py-2 font-semibold w-28" />
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
                      disabled={previewLoadingId === p.id}
                      title="Abrir o comprobar el PDF del RUT (certificación DIAN)"
                      onClick={() => void abrirPreviewPdf(p.id, p.razon_social_rut)}
                      className="text-primary-600 hover:underline inline-flex items-center gap-1 text-left cursor-pointer"
                    >
                      <Eye className="w-4 h-4 shrink-0" />
                      {previewLoadingId === p.id ? 'Abriendo…' : 'Vista previa'}
                    </button>
                  </td>
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
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 relative">
            <button
              type="button"
              className="absolute top-3 right-3 text-slate-500 hover:text-slate-800"
              onClick={cerrarModal}
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
            {errRut && (
              <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
                {typeof errRut === 'string' ? errRut : JSON.stringify(errRut)}
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
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Tipo de identificación</label>
                <select
                  className="input-pos w-full max-w-xs"
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
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Número de identificación (como en el RUT / registro DIAN)
                </label>
                <input
                  className="input-pos w-full"
                  value={form.numero_identificacion}
                  onChange={(e) => setForm((f) => ({ ...f, numero_identificacion: e.target.value }))}
                  required
                  minLength={4}
                  placeholder="Ej. 900.123.456-8 o 900123456-8"
                  autoComplete="off"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Un solo campo: incluya guion y dígito de verificación si aplica. El servidor quita separadores de miles y
                  unifica el formato para validar y para el documento soporte.
                </p>
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

              {editId && (
                <div className="border border-slate-200 rounded-lg p-3 space-y-3 bg-slate-50/80">
                  <div className="flex items-start gap-2">
                    <FileText className="w-5 h-5 text-slate-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-slate-800">Certificación RUT (PDF)</p>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Solo el PDF oficial del RUT (DIAN). No use cédula escaneada ni otros documentos.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      className="text-sm text-slate-700 max-w-full"
                      onChange={(e) => setRutFile(e.target.files?.[0] ?? null)}
                    />
                    <button
                      type="button"
                      disabled={!rutFile || subirRut.isLoading}
                      className="btn-pos btn-primary text-sm py-1.5 px-3"
                      onClick={() => {
                        if (editId && rutFile) subirRut.mutate({ id: editId, file: rutFile });
                      }}
                    >
                      {subirRut.isLoading ? 'Subiendo…' : 'Subir PDF'}
                    </button>
                    {tieneAdjuntoRut && (
                      <>
                        <button
                          type="button"
                          className="btn-pos btn-secondary text-sm py-1.5 px-3 inline-flex items-center gap-1"
                          onClick={() => editId && abrirPreviewPdf(editId, form.razon_social_rut)}
                          disabled={!!editId && previewLoadingId === editId}
                        >
                          <Eye className="w-4 h-4" />
                          {editId && previewLoadingId === editId ? 'Abriendo…' : 'Vista previa'}
                        </button>
                        <button
                          type="button"
                          className="text-sm text-red-700 hover:underline inline-flex items-center gap-1 py-1.5"
                          disabled={eliminarRut.isLoading}
                          onClick={() => {
                            if (editId && window.confirm('¿Quitar el PDF del RUT adjunto a este proveedor?')) {
                              eliminarRut.mutate(editId);
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                          Quitar PDF
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={crear.isLoading || actualizar.isLoading}
                  className="flex-1 btn-pos btn-primary"
                >
                  {crear.isLoading || actualizar.isLoading ? 'Guardando…' : 'Guardar'}
                </button>
                <button type="button" className="flex-1 btn-pos btn-secondary" onClick={cerrarModal}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {previewUrl && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60"
          role="dialog"
          aria-modal="true"
          aria-label="Vista previa PDF"
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl h-[min(90vh,900px)] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 shrink-0">
              <p className="text-sm font-semibold text-slate-900 truncate" title={previewTitulo}>
                {previewTitulo || 'Certificación RUT'}
              </p>
              <button
                type="button"
                className="text-slate-500 hover:text-slate-800 p-1"
                aria-label="Cerrar vista previa"
                onClick={revocarPreviewBlob}
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <iframe title="Vista previa" src={previewUrl} className="flex-1 w-full min-h-0 border-0 bg-slate-100" />
          </div>
        </div>
      )}
    </Layout>
  );
}
