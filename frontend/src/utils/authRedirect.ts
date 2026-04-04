export const LAST_TENANT_SLUG_KEY = 'last_tenant_slug';

export function normalizeTenantSlug(slug?: string | null): string {
  return (slug || '').trim().toLowerCase();
}

export function getTenantLoginPath(slug?: string | null): string {
  const normalizedSlug = normalizeTenantSlug(slug);
  return normalizedSlug ? `/${normalizedSlug}` : '/login';
}

export function getStoredTenantLoginPath(): string {
  const storedSlug = localStorage.getItem(LAST_TENANT_SLUG_KEY);
  return getTenantLoginPath(storedSlug);
}

export function persistTenantSlug(slug?: string | null): void {
  const normalizedSlug = normalizeTenantSlug(slug);
  if (normalizedSlug) {
    localStorage.setItem(LAST_TENANT_SLUG_KEY, normalizedSlug);
  }
}
