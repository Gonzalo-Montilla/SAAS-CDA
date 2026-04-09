/** Claves alineadas con el API (snake_case) y `QualitySurveyResponse` en backend. */

export const QUALITY_SURVEY_RATING_KEYS = [
  'facilidad_agendar_cita',
  'tiempo_espera_revision',
  'amabilidad_recepcion_caja',
  'limpieza_instalaciones',
  'amenidades_cda',
  'claridad_resultados_revision',
  'confianza_diagnostico_tecnico',
  'recomendar_cda',
  'experiencia_global',
] as const;

export type QualitySurveyRatingKey = (typeof QUALITY_SURVEY_RATING_KEYS)[number];

export const QUALITY_SURVEY_QUESTIONS: Array<{ key: QualitySurveyRatingKey; label: string }> = [
  { key: 'facilidad_agendar_cita', label: '¿Qué tan fácil fue agendar tu cita?' },
  { key: 'tiempo_espera_revision', label: 'El tiempo de espera para iniciar la revisión fue:' },
  {
    key: 'amabilidad_recepcion_caja',
    label: 'La amabilidad y atención del personal de recepción y caja:',
  },
  {
    key: 'limpieza_instalaciones',
    label: 'La limpieza y orden de las instalaciones (incluyendo sala de espera y baños):',
  },
  {
    key: 'amenidades_cda',
    label: '¿Disfrutaste de las amenidades del CDA (café, agua, wifi, TV, etc.)?',
  },
  {
    key: 'claridad_resultados_revision',
    label: 'Claridad con la que te explicaron los resultados de la revisión:',
  },
  {
    key: 'confianza_diagnostico_tecnico',
    label: 'Confianza general en el diagnóstico y el servicio técnico:',
  },
  { key: 'recomendar_cda', label: '¿Recomendarías nuestro CDA a un familiar o amigo?' },
  { key: 'experiencia_global', label: '¿Cómo calificas tu experiencia global en nuestro CDA?' },
];

export const QUALITY_SURVEY_COMMENT_LABEL =
  '(Opcional) ¿Qué podríamos mejorar o qué fue lo que más te gustó?';

export const QUALITY_SURVEY_COMMENT_PLACEHOLDER =
  'Cuéntanos qué podríamos mejorar o qué fue lo que más te gustó...';

export function emptyQualitySurveyRatings(): Record<QualitySurveyRatingKey, number> {
  return {
    facilidad_agendar_cita: 0,
    tiempo_espera_revision: 0,
    amabilidad_recepcion_caja: 0,
    limpieza_instalaciones: 0,
    amenidades_cda: 0,
    claridad_resultados_revision: 0,
    confianza_diagnostico_tecnico: 0,
    recomendar_cda: 0,
    experiencia_global: 0,
  };
}
