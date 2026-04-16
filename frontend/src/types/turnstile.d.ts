interface TurnstileApi {
  render: (
    container: string | HTMLElement,
    options: {
      sitekey: string;
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      /** Cloudflare puede pasar código numérico o string según versión del script */
      "error-callback"?: (errorCode?: string | number) => void;
      theme?: "light" | "dark" | "auto";
      retry?: "auto" | "never";
      "retry-interval"?: number;
    }
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

interface Window {
  turnstile?: TurnstileApi;
  onloadTurnstileCallback?: () => void;
}
