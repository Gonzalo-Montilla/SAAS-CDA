import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import Layout from '../components/Layout';
import { sarlaftApi } from '../api/sarlaft';
import type { SarlaftCase, SarlaftCasePartyInput, SarlaftManualCheck } from '../types';

function money(v: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(v || 0);
}

export default function Sarlaft() {
  const [operacionRef, setOperacionRef] = useState('');
  const [transactionAmount, setTransactionAmount] = useState('');
  const [cashAmount, setCashAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'efectivo' | 'mixto' | 'transferencia' | 'otro'>('efectivo');
  const [partyRole, setPartyRole] = useState<'cliente' | 'propietario' | 'pagador' | 'apoderado'>('cliente');
  const [partyDocType, setPartyDocType] = useState('CC');
  const [partyDocNumber, setPartyDocNumber] = useState('');
  const [partyName, setPartyName] = useState('');
  const [manualSubjectType, setManualSubjectType] = useState<'natural' | 'juridica'>('natural');
  const [manualFullName, setManualFullName] = useState('');
  const [manualDocType, setManualDocType] = useState('CC');
  const [manualDocNumber, setManualDocNumber] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [manualEconomicActivity, setManualEconomicActivity] = useState('');
  const [manualLegalRepresentative, setManualLegalRepresentative] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [manualDataset, setManualDataset] = useState<'default' | 'sanctions'>('sanctions');
  const [screeningDataset, setScreeningDataset] = useState<'default' | 'sanctions'>('sanctions');
  const [caseIdLookup, setCaseIdLookup] = useState('');
  const [screeningCaseId, setScreeningCaseId] = useState('');
  const [screeningResult, setScreeningResult] = useState<{
    risk_level: 'verde' | 'amarillo' | 'rojo';
    recommended_action: string;
    raw_count: number;
    alert: boolean;
    hits: Array<{ caption?: string; score?: number; source_url?: string }>;
  } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [createdCase, setCreatedCase] = useState<SarlaftCase | null>(null);
  const [foundCase, setFoundCase] = useState<SarlaftCase | null>(null);
  const [createdManualCheck, setCreatedManualCheck] = useState<SarlaftManualCheck | null>(null);
  const [downloadingCertificateId, setDownloadingCertificateId] = useState<string | null>(null);
  const [copiedManualCheckId, setCopiedManualCheckId] = useState<string | null>(null);

  useEffect(() => {
    setManualDocType((prev) => {
      if (manualSubjectType === 'juridica') return 'NIT';
      if (!prev || prev.toUpperCase() === 'NIT') return 'CC';
      return prev;
    });
  }, [manualSubjectType]);

  const saveBlobAsFile = (blob: Blob, filename: string): void => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const copyTextToClipboard = async (text: string): Promise<boolean> => {
    const value = (text || '').trim();
    if (!value) return false;
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
      } catch {
        return false;
      }
    }
  };

  const casesQuery = useQuery({
    queryKey: ['sarlaft-cases-list', 20],
    queryFn: async () => sarlaftApi.listCases({ limit: 20 }),
  });
  const manualChecksQuery = useQuery({
    queryKey: ['sarlaft-manual-checks-list', 20],
    queryFn: async () => sarlaftApi.listManualChecks({ limit: 20 }),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const parties: SarlaftCasePartyInput[] = [
        {
          role: partyRole,
          doc_type: partyDocType.trim(),
          doc_number: partyDocNumber.trim(),
          full_name: partyName.trim(),
        },
      ];
      return sarlaftApi.createCase({
        operacion_ref: operacionRef.trim(),
        transaction_amount_cop: Number(transactionAmount || 0),
        cash_amount_cop: Number(cashAmount || 0),
        payment_method: paymentMethod,
        parties,
      });
    },
    onSuccess: (data) => {
      setFeedback('Caso SARLAFT creado correctamente.');
      setCreatedCase(data);
      setFoundCase(null);
      setScreeningCaseId(data.id);
    },
    onError: (err: any) => {
      setFeedback(err?.response?.data?.detail || 'No se pudo crear el caso SARLAFT.');
    },
  });

  const findMutation = useMutation({
    mutationFn: async () => sarlaftApi.getCase(caseIdLookup.trim()),
    onSuccess: (data) => {
      setFeedback(null);
      setFoundCase(data);
    },
    onError: (err: any) => {
      setFoundCase(null);
      setFeedback(err?.response?.data?.detail || 'No se encontró el caso.');
    },
  });

  const screeningMutation = useMutation({
    mutationFn: async () =>
      sarlaftApi.screeningOpenSanctions({
        schema: 'Person',
        full_name: partyName.trim(),
        document_number: partyDocNumber.trim() || null,
        dataset: screeningDataset,
        algorithm: 'best',
        limit: 5,
        case_id: screeningCaseId.trim() || null,
        persist_in_case: Boolean(screeningCaseId.trim()),
      }),
    onSuccess: (data) => {
      setScreeningResult({
        risk_level: data.risk_level,
        recommended_action: data.recommended_action,
        raw_count: data.raw_count,
        alert: data.alert,
        hits: data.hits,
      });
      setFeedback(`Screening ejecutado (${data.dataset}). Nivel: ${data.risk_level.toUpperCase()}.`);
      casesQuery.refetch();
      if (data.case_id) {
        setCaseIdLookup(data.case_id);
      }
    },
    onError: (err: any) => {
      setScreeningResult(null);
      setFeedback(err?.response?.data?.detail || 'No se pudo ejecutar screening OpenSanctions.');
    },
  });

  const manualCheckMutation = useMutation({
    mutationFn: async () =>
      sarlaftApi.createManualCheck({
        subject_type: manualSubjectType,
        full_name: manualFullName.trim(),
        doc_type: manualDocType.trim() || null,
        doc_number: manualDocNumber.trim() || null,
        email: manualEmail.trim() || null,
        phone: manualPhone.trim() || null,
        economic_activity: manualEconomicActivity.trim() || null,
        legal_representative: manualLegalRepresentative.trim() || null,
        dataset: manualDataset,
        algorithm: 'best',
        limit: 5,
        notes: manualNotes.trim() || null,
      }),
    onSuccess: (data) => {
      setCreatedManualCheck(data);
      setFeedback(`Consulta manual registrada. Nivel: ${data.risk_level.toUpperCase()}.`);
      // Limpiar formulario para nueva consulta.
      setManualSubjectType('natural');
      setManualDataset('sanctions');
      setManualFullName('');
      setManualDocType('CC');
      setManualDocNumber('');
      setManualEmail('');
      setManualPhone('');
      setManualNotes('');
      setManualEconomicActivity('');
      setManualLegalRepresentative('');
      manualChecksQuery.refetch();
    },
    onError: (err: any) => {
      setCreatedManualCheck(null);
      setFeedback(err?.response?.data?.detail || 'No se pudo registrar la consulta manual.');
    },
  });

  const downloadCertificateMutation = useMutation({
    mutationFn: async (manualCheckId: string) => sarlaftApi.downloadManualCheckCertificate(manualCheckId),
    onMutate: (manualCheckId) => {
      setDownloadingCertificateId(manualCheckId);
    },
    onSuccess: ({ blob, filename, certificateCode }) => {
      saveBlobAsFile(blob, filename);
      setFeedback(
        certificateCode
          ? `Certificado SARLAFT descargado. Codigo: ${certificateCode}.`
          : 'Certificado SARLAFT descargado correctamente.'
      );
    },
    onError: (err: any) => {
      setFeedback(err?.response?.data?.detail || 'No se pudo generar/descargar el certificado SARLAFT.');
    },
    onSettled: () => {
      setDownloadingCertificateId(null);
      manualChecksQuery.refetch();
    },
  });

  const riskBadgeClass = useMemo(
    () => (riskLevel: string) => {
      if (riskLevel === 'rojo') return 'border border-rose-200 bg-rose-50 text-rose-800';
      if (riskLevel === 'amarillo') return 'border border-amber-200 bg-amber-50 text-amber-800';
      return 'border border-emerald-200 bg-emerald-50 text-emerald-800';
    },
    [],
  );
  const manualFormValid = useMemo(() => {
    if (!manualFullName.trim()) return false;
    if (!manualDocType.trim()) return false;
    if (!manualDocNumber.trim()) return false;
    if (!manualEmail.trim()) return false;
    if (!manualPhone.trim()) return false;
    if (manualSubjectType === 'juridica' && manualDocType.trim().toUpperCase() !== 'NIT') return false;
    return true;
  }, [manualFullName, manualDocType, manualDocNumber, manualEmail, manualPhone, manualSubjectType]);
  const certificadoBadgeClass = useMemo(
    () => (hasCertificate: boolean) =>
      hasCertificate
        ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
        : 'border border-amber-200 bg-amber-50 text-amber-800',
    [],
  );

  return (
    <Layout title="SARLAFT">
      <div className="space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Crear caso SARLAFT</h2>
              <p className="text-xs text-slate-500">Captura mínima de cumplimiento (Sprint 1).</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="input-corporate" placeholder="Referencia operación" value={operacionRef} onChange={(e) => setOperacionRef(e.target.value)} />
            <select className="input-corporate" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as any)}>
              <option value="efectivo">Efectivo</option>
              <option value="mixto">Mixto</option>
              <option value="transferencia">Transferencia</option>
              <option value="otro">Otro</option>
            </select>
            <input className="input-corporate" type="number" placeholder="Valor total COP" value={transactionAmount} onChange={(e) => setTransactionAmount(e.target.value)} />
            <input className="input-corporate" type="number" placeholder="Valor efectivo COP" value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} />
            <select className="input-corporate" value={partyRole} onChange={(e) => setPartyRole(e.target.value as any)}>
              <option value="cliente">Cliente</option>
              <option value="propietario">Propietario</option>
              <option value="pagador">Pagador</option>
              <option value="apoderado">Apoderado</option>
            </select>
            <input className="input-corporate" placeholder="Tipo documento" value={partyDocType} onChange={(e) => setPartyDocType(e.target.value)} />
            <input className="input-corporate" placeholder="Número documento" value={partyDocNumber} onChange={(e) => setPartyDocNumber(e.target.value)} />
            <input className="input-corporate" placeholder="Nombre completo" value={partyName} onChange={(e) => setPartyName(e.target.value)} />
          </div>
          <div className="mt-4 flex justify-end">
            <button className="btn-corporate-primary px-4" disabled={createMutation.isLoading} onClick={() => createMutation.mutate()}>
              {createMutation.isLoading ? 'Guardando...' : 'Crear caso'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
              <Search className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">Consulta manual (fuera de recepción)</h3>
              <p className="text-xs text-slate-500">
                Para terceros fuera del flujo de recepción, con campos según tipo de sujeto.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <select
              className="input-corporate"
              value={manualSubjectType}
              onChange={(e) => setManualSubjectType(e.target.value as 'natural' | 'juridica')}
            >
              <option value="natural">Persona natural</option>
              <option value="juridica">Persona jurídica</option>
            </select>
            <select
              className="input-corporate"
              value={manualDataset}
              onChange={(e) => setManualDataset(e.target.value as 'default' | 'sanctions')}
            >
              <option value="sanctions">sanctions</option>
              <option value="default">default</option>
            </select>
            <input
              className="input-corporate md:col-span-1"
              placeholder={manualSubjectType === 'juridica' ? 'Razón social *' : 'Nombre completo *'}
              value={manualFullName}
              onChange={(e) => setManualFullName(e.target.value.toUpperCase())}
            />
            {manualSubjectType === 'juridica' ? (
              <input className="input-corporate" value="NIT" disabled />
            ) : (
              <select className="input-corporate" value={manualDocType} onChange={(e) => setManualDocType(e.target.value)}>
                <option value="CC">CC</option>
                <option value="CE">CE</option>
                <option value="PA">PA</option>
                <option value="TI">TI</option>
              </select>
            )}
            <input
              className="input-corporate"
              placeholder={manualSubjectType === 'juridica' ? 'NIT *' : 'Número de documento *'}
              value={manualDocNumber}
              onChange={(e) => setManualDocNumber(e.target.value)}
            />
            <input
              className="input-corporate"
              placeholder="Correo *"
              value={manualEmail}
              onChange={(e) => setManualEmail(e.target.value.toLowerCase())}
            />
            <input className="input-corporate" placeholder="Celular / Teléfono *" value={manualPhone} onChange={(e) => setManualPhone(e.target.value)} />
            <input
              className="input-corporate md:col-span-1"
              placeholder="Notas internas (opcional)"
              value={manualNotes}
              onChange={(e) => setManualNotes(e.target.value)}
            />
            {manualSubjectType === 'juridica' && (
              <>
                <input
                  className="input-corporate md:col-span-2"
                  placeholder="Actividad económica (opcional)"
                  value={manualEconomicActivity}
                  onChange={(e) => setManualEconomicActivity(e.target.value)}
                />
                <input
                  className="input-corporate md:col-span-1"
                  placeholder="Representante legal (opcional)"
                  value={manualLegalRepresentative}
                  onChange={(e) => setManualLegalRepresentative(e.target.value)}
                />
              </>
            )}
          </div>
          {!manualFormValid && (
            <p className="mt-2 text-xs text-amber-700">
              Completa tipo, nombre/razón social, documento, correo y celular para registrar la consulta.
            </p>
          )}
          <div className="mt-4 flex justify-end">
            <button
              className="btn-corporate-primary px-4"
              disabled={manualCheckMutation.isLoading || !manualFormValid}
              onClick={() => manualCheckMutation.mutate()}
            >
              {manualCheckMutation.isLoading ? 'Registrando...' : 'Registrar consulta manual'}
            </button>
          </div>
          {createdManualCheck && (
            <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-indigo-700">
                    Consulta registrada
                  </p>
                  <p className="text-xs text-slate-600">Código de consulta (trazabilidad SARLAFT)</p>
                  <p className="mt-1 break-all font-mono text-sm font-semibold text-indigo-950 md:text-base">
                    {createdManualCheck.id}
                  </p>
                  <button
                    className="mt-2 inline-flex items-center rounded-md border border-indigo-200 bg-white px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                    onClick={async () => {
                      const ok = await copyTextToClipboard(createdManualCheck.id);
                      if (ok) {
                        setCopiedManualCheckId(createdManualCheck.id);
                        setFeedback('ID de consulta copiado al portapapeles.');
                        window.setTimeout(() => {
                          setCopiedManualCheckId((prev) => (prev === createdManualCheck.id ? null : prev));
                        }, 1500);
                      } else {
                        setFeedback('No fue posible copiar el ID. Cópialo manualmente.');
                      }
                    }}
                  >
                    {copiedManualCheckId === createdManualCheck.id ? 'Copiado' : 'Copiar ID'}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${riskBadgeClass(createdManualCheck.risk_level)}`}>
                    {createdManualCheck.risk_level.toUpperCase()}
                  </span>
                  <span className="text-xs font-medium text-slate-700">Hits: {createdManualCheck.hits_count}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">Screening OpenSanctions</h3>
              <p className="text-xs text-slate-500">Clasifica automáticamente en verde/amarillo/rojo.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <select className="input-corporate" value={screeningDataset} onChange={(e) => setScreeningDataset(e.target.value as 'default' | 'sanctions')}>
              <option value="sanctions">Dataset sanctions (alerta fuerte)</option>
              <option value="default">Dataset default (amplio)</option>
            </select>
            <input
              className="input-corporate md:col-span-2"
              placeholder="Case ID opcional para persistir nivel de riesgo"
              value={screeningCaseId}
              onChange={(e) => setScreeningCaseId(e.target.value)}
            />
          </div>
          <div className="mt-4 flex justify-end">
            <button
              className="btn-corporate-primary px-4"
              disabled={screeningMutation.isLoading || !partyName.trim()}
              onClick={() => screeningMutation.mutate()}
            >
              {screeningMutation.isLoading ? 'Consultando...' : 'Ejecutar screening'}
            </button>
          </div>

          {screeningResult && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${riskBadgeClass(screeningResult.risk_level)}`}>
                  Nivel {screeningResult.risk_level.toUpperCase()}
                </span>
                <span className="text-xs text-slate-600">Hits: {screeningResult.raw_count} · Alert: {screeningResult.alert ? 'Sí' : 'No'}</span>
              </div>
              <p className="text-sm text-slate-700">{screeningResult.recommended_action}</p>
              {screeningResult.hits.length > 0 && (
                <div className="text-xs text-slate-700 space-y-1">
                  {screeningResult.hits.slice(0, 3).map((h, idx) => (
                    <p key={`${h.caption || 'hit'}-${idx}`}>
                      {h.caption || 'Coincidencia'} · score: {typeof h.score === 'number' ? h.score.toFixed(3) : 'N/A'}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900 mb-3">Consultar caso por ID</h3>
          <div className="flex gap-2">
            <input className="input-corporate flex-1" placeholder="UUID del caso" value={caseIdLookup} onChange={(e) => setCaseIdLookup(e.target.value)} />
            <button className="btn-corporate-muted px-4 flex items-center gap-2" disabled={findMutation.isLoading} onClick={() => findMutation.mutate()}>
              <Search className="h-4 w-4" />
              Buscar
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900 mb-3">Bandeja básica SARLAFT (últimos 20)</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Operación</th>
                  <th className="py-2 pr-3">Estado</th>
                  <th className="py-2 pr-3">Riesgo</th>
                  <th className="py-2 pr-3">Score</th>
                  <th className="py-2 pr-3">Monto</th>
                  <th className="py-2 pr-3">Creado</th>
                </tr>
              </thead>
              <tbody>
                {(casesQuery.data || []).map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="py-2 pr-3 font-medium text-slate-900">{row.operacion_ref}</td>
                    <td className="py-2 pr-3 text-slate-700">{row.status}</td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${riskBadgeClass(row.risk_level)}`}>
                        {row.risk_level.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-slate-700">{Number(row.risk_score || 0).toFixed(2)}</td>
                    <td className="py-2 pr-3 text-slate-700">{money(row.transaction_amount_cop)}</td>
                    <td className="py-2 pr-3 text-slate-500">{new Date(row.created_at).toLocaleString('es-CO')}</td>
                  </tr>
                ))}
                {!casesQuery.isLoading && (casesQuery.data || []).length === 0 && (
                  <tr>
                    <td className="py-3 text-slate-500" colSpan={6}>
                      Sin casos registrados aún.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900 mb-3">
            Consultas manuales SARLAFT (últimas 20)
          </h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Tipo</th>
                  <th className="py-2 pr-3">Nombre</th>
                  <th className="py-2 pr-3">Documento</th>
                  <th className="py-2 pr-3">Dataset</th>
                  <th className="py-2 pr-3">Riesgo</th>
                  <th className="py-2 pr-3">Hits</th>
                  <th className="py-2 pr-3">Estado cert.</th>
                  <th className="py-2 pr-3">Certificado</th>
                  <th className="py-2 pr-3">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {(manualChecksQuery.data || []).map((row) => (
                  (() => {
                    const hasCertificate = Boolean((row.certificate_code || '').trim() || row.certificate_issued_at);
                    return (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="py-2 pr-3 text-slate-700 capitalize">{row.subject_type}</td>
                    <td className="py-2 pr-3 font-medium text-slate-900">{row.full_name}</td>
                    <td className="py-2 pr-3 text-slate-700">
                      {(row.doc_type || '—') + (row.doc_number ? ` ${row.doc_number}` : '')}
                    </td>
                    <td className="py-2 pr-3 text-slate-700">{row.dataset}</td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${riskBadgeClass(row.risk_level)}`}>
                        {row.risk_level.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-slate-700">{row.hits_count}</td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${certificadoBadgeClass(hasCertificate)}`}>
                        {hasCertificate ? 'Generado' : 'Pendiente'}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <button
                        className="btn-corporate-muted px-3 py-1 text-xs"
                        disabled={downloadingCertificateId === row.id || downloadCertificateMutation.isLoading}
                        onClick={() => downloadCertificateMutation.mutate(row.id)}
                      >
                        {downloadingCertificateId === row.id ? 'Generando...' : 'Descargar PDF'}
                      </button>
                    </td>
                    <td className="py-2 pr-3 text-slate-500">{new Date(row.created_at).toLocaleString('es-CO')}</td>
                  </tr>
                    );
                  })()
                ))}
                {!manualChecksQuery.isLoading && (manualChecksQuery.data || []).length === 0 && (
                  <tr>
                    <td className="py-3 text-slate-500" colSpan={9}>
                      Sin consultas manuales registradas aún.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {feedback && <p className="text-sm text-slate-700">{feedback}</p>}

        {(createdCase || foundCase) && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
            {(() => {
              const c = foundCase || createdCase;
              if (!c) return null;
              return (
                <div className="text-sm text-emerald-900 space-y-1">
                  <p><strong>ID:</strong> {c.id}</p>
                  <p><strong>Operación:</strong> {c.operacion_ref}</p>
                  <p><strong>Estado:</strong> {c.status} · <strong>Nivel:</strong> {c.risk_level}</p>
                  <p><strong>Monto:</strong> {money(c.transaction_amount_cop)} · <strong>Efectivo:</strong> {money(c.cash_amount_cop)}</p>
                  <p><strong>Partes:</strong> {c.parties?.length || 0}</p>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </Layout>
  );
}
