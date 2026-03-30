import { createContext, useContext, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import type { Usuario } from '../types';
import defaultLogo from '../assets/LOGO_CDA_SOFT-SIN FONDO.png';

interface BrandState {
  nombreComercial: string;
  logoSrc: string;
  colorPrimario: string;
  colorSecundario: string;
  isTenantBrand: boolean;
}

const DEFAULT_BRAND: BrandState = {
  nombreComercial: 'CDASOFT',
  logoSrc: defaultLogo,
  colorPrimario: '#2563eb',
  colorSecundario: '#0f172a',
  isTenantBrand: false,
};

const BrandContext = createContext<BrandState>(DEFAULT_BRAND);

function getTenantBrand(user: Usuario | null): BrandState {
  if (!user?.tenant_branding) {
    return DEFAULT_BRAND;
  }

  return {
    nombreComercial: user.tenant_branding.nombre_comercial || DEFAULT_BRAND.nombreComercial,
    logoSrc: user.tenant_branding.logo_url || DEFAULT_BRAND.logoSrc,
    colorPrimario: user.tenant_branding.color_primario || DEFAULT_BRAND.colorPrimario,
    colorSecundario: user.tenant_branding.color_secundario || DEFAULT_BRAND.colorSecundario,
    isTenantBrand: true,
  };
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const { user, authScope } = useAuth();

  const brandState =
    authScope === 'tenant' && user && 'tenant_id' in user ? getTenantBrand(user as Usuario) : DEFAULT_BRAND;

  return <BrandContext.Provider value={brandState}>{children}</BrandContext.Provider>;
}

export function useBrand() {
  return useContext(BrandContext);
}
