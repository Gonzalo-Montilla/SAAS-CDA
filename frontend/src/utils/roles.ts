/** Roles de tenant: gerente = marca; administrador = sede(s). */

export function isGerente(rol?: string | null): boolean {
  return rol === 'gerente';
}

export function isAdminSede(rol?: string | null): boolean {
  return rol === 'administrador';
}

export function isGerenteOrAdmin(rol?: string | null): boolean {
  return rol === 'gerente' || rol === 'administrador';
}

export function rolUsaListaSedes(rol?: string | null): boolean {
  return (
    rol === 'administrador' ||
    rol === 'cajero' ||
    rol === 'recepcionista' ||
    rol === 'comercial'
  );
}
