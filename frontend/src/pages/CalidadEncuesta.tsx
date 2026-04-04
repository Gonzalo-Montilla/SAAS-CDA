import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { qualityApi, type QualitySurveySubmitPayload } from '../api/quality';

type RatingKey =
  | 'atencion_recepcion'
  | 'atencion_caja'
  | 'sala_espera'
  | 'agrado_visita'
  | 'atencion_general';

const QUESTIONS: Array<{ key: RatingKey; label: string }> = [
  { key: 'atencion_recepcion', label: '¿Cómo te pareció la atención en recepción?' },
  { key: 'atencion_caja', label: '¿Cómo te pareció la atención en caja?' },
  { key: 'sala_espera', label: '¿Cómo fue la atención en sala de espera?' },
  { key: 'agrado_visita', label: '¿Fue de tu agrado la visita?' },
  { key: 'atencion_general', label: '¿Cómo calificas la atención en general?' },
];

export default function CalidadEncuesta() {
  const { token = '' } = useParams();
  const [ratings, setRatings] = useState<Record<RatingKey, number>>({
    atencion_recepcion: 0,
    atencion_caja: 0,
    sala_espera: 0,
    agrado_visita: 0,
    atencion_general: 0,
  });
  const [comentario, setComentario] = useState('');

  const infoQuery = useQuery({
    queryKey: ['quality-public', token],
    queryFn: () => qualityApi.getPublicSurveyInfo(token),
    enabled: !!token,
  });

  const submitMutation = useMutation({
    mutationFn: (payload: QualitySurveySubmitPayload) => qualityApi.submitPublicSurvey(token, payload),
  });

  const allRated = useMemo(
    () => QUESTIONS.every((q) => ratings[q.key] >= 1 && ratings[q.key] <= 5),
    [ratings],
  );

  const handleSubmit = () => {
    submitMutation.mutate({
      ...ratings,
      comentario: comentario.trim() || undefined,
    });
  };

  const brandPrimary = infoQuery.data?.color_primario || '#2563eb';

  return (
    <div className="corporate-shell py-10 px-4">
      <div className="max-w-3xl mx-auto section-card p-6 md:p-8">
        {infoQuery.isLoading && <p className="text-slate-600">Cargando encuesta...</p>}
        {infoQuery.isError && <p className="text-red-600">No fue posible cargar esta encuesta.</p>}

        {infoQuery.data && (
          <>
            <div className="text-center mb-6">
              {infoQuery.data.logo_url && (
                <img
                  src={infoQuery.data.logo_url}
                  alt={infoQuery.data.nombre_cda}
                  className="h-20 mx-auto mb-3 object-contain"
                />
              )}
              <h1 className="text-2xl font-bold text-slate-900">Encuesta de satisfacción</h1>
              <p className="text-sm text-slate-600 mt-1">
                {infoQuery.data.nombre_cda} - Cliente: {infoQuery.data.cliente_nombre} - Placa: {infoQuery.data.placa}
              </p>
            </div>

            {infoQuery.data.already_answered ? (
              <p className="text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm">
                Esta encuesta ya fue respondida. Gracias por tu tiempo.
              </p>
            ) : infoQuery.data.expired || !infoQuery.data.token_valid ? (
              <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                Este enlace de encuesta ha expirado.
              </p>
            ) : submitMutation.isSuccess ? (
              <p className="text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm">
                Gracias por tu calificación. Tu opinión es muy valiosa para nosotros.
              </p>
            ) : (
              <div className="space-y-5">
                {QUESTIONS.map((q) => (
                  <div key={q.key}>
                    <p className="text-sm font-medium text-slate-800 mb-2">{q.label}</p>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setRatings((prev) => ({ ...prev, [q.key]: value }))}
                          className="p-1 rounded-md hover:bg-amber-50"
                        >
                          <Star
                            className={`w-7 h-7 ${
                              ratings[q.key] >= value ? 'text-amber-500 fill-current' : 'text-slate-300'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                <div>
                  <p className="text-sm font-medium text-slate-800 mb-2">Comentario (opcional)</p>
                  <textarea
                    value={comentario}
                    onChange={(e) => setComentario(e.target.value)}
                    className="input-corporate min-h-[120px]"
                    placeholder="Cuéntanos cómo podemos mejorar tu experiencia..."
                    maxLength={2000}
                  />
                </div>

                <button
                  type="button"
                  disabled={!allRated || submitMutation.isLoading}
                  onClick={handleSubmit}
                  className="w-full text-white font-semibold py-3 rounded-xl disabled:opacity-60"
                  style={{ backgroundColor: brandPrimary }}
                >
                  {submitMutation.isLoading ? 'Enviando...' : 'Enviar encuesta'}
                </button>
                {submitMutation.isError && (
                  <p className="text-red-600 text-sm">
                    {submitMutation.error instanceof Error
                      ? submitMutation.error.message
                      : 'No fue posible enviar tu encuesta'}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

