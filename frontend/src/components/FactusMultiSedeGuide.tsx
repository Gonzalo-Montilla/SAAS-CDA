import { ClipboardList } from 'lucide-react';

type GuideVariant = 'saas_backoffice' | 'cda_app';

/**
 * Guía colapsable: checklist resumido para no saturar la pantalla (detalle en backend/docs/CHECKLIST_FACTUS_MULTISEDES.md).
 */
export default function FactusMultiSedeGuide({ variant }: { variant: GuideVariant }) {
  const isSaaS = variant === 'saas_backoffice';

  return (
    <details className="group rounded-xl border border-sky-200/90 bg-gradient-to-b from-sky-50 to-white text-slate-800 shadow-sm open:ring-1 open:ring-sky-100">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-sky-950 [&::-webkit-details-marker]:hidden">
        <ClipboardList className="h-5 w-5 shrink-0 text-sky-700" aria-hidden />
        <span>{isSaaS ? 'Checklist CDASOFT (varias sedes)' : 'Checklist tu CDA (varias ciudades)'}</span>
        <span className="ml-auto text-xs font-normal text-sky-700 group-open:hidden">Ver pasos</span>
        <span className="ml-auto hidden text-xs font-normal text-sky-700 group-open:inline">Ocultar</span>
      </summary>
      <div className="space-y-3 border-t border-sky-100 px-4 pb-4 pt-3 text-sm text-slate-700">
        {isSaaS ? (
          <>
            <p className="text-xs text-slate-600">
              Aquí solo configuras <strong>cuenta Factus</strong> del tenant. Municipio y rango por <strong>cada
              ciudad</strong> lo completa el administrador del CDA en <strong>Organización → Sedes</strong>.
            </p>
            <ol className="list-decimal space-y-1.5 pl-5 marker:text-sky-800">
              <li>Modo <strong>Factus</strong> si deben emitir en caja.</li>
              <li>Credenciales <strong>pruebas</strong> y <strong>producción</strong> (son distintas).</li>
              <li>
                <strong>Ambiente activo</strong>: sandbox primero → probar conexión → luego producción el día del corte.
              </li>
              <li>
                <strong>Rango predeterminado</strong>: respaldo si alguna sede no tiene rango propio.
              </li>
              <li>
                <strong>Consultar rangos</strong> ayuda a copiar el id correcto (factura de venta).
              </li>
              <li>Avisa al CDA que terminen sedes (municipio + rango por ciudad).</li>
            </ol>
          </>
        ) : (
          <>
            <p className="text-xs text-slate-600">
              Las <strong>claves Factus</strong> las configura CDASOFT. Tú completas <strong>dónde</strong> factura cada
              sede.
            </p>
            <ol className="list-decimal space-y-1.5 pl-5 marker:text-sky-800">
              <li>
                <strong>Matriz</strong>: dirección + buscar municipio y guardar.
              </li>
              <li>
                <strong>Sede principal</strong>: suele dejar municipio/dirección vacíos para heredar matriz.
              </li>
              <li>
                <strong>Otra ciudad</strong>: editar sede → municipio (buscar) + <strong>rango Factus</strong> de esa
                ciudad.
              </li>
              <li>
                <strong>Caja</strong>: cada quien revisa la <strong>sede activa</strong> antes de cobrar.
              </li>
              <li>
                Si Factus falla: enviar el <strong>mensaje completo</strong> a CDASOFT.
              </li>
            </ol>
          </>
        )}
        <p className="rounded-lg bg-white/80 px-2 py-1.5 text-xs text-slate-500 ring-1 ring-slate-100">
          Checklist imprimible y orden detallado: archivo{' '}
          <code className="rounded bg-slate-100 px-1">backend/docs/CHECKLIST_FACTUS_MULTISEDES.md</code> en el
          repositorio.
        </p>
      </div>
    </details>
  );
}
