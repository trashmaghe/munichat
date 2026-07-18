/**
 * Where the client finds the API/WebSocket origins.
 *
 * A distributable, prebuilt web image can't have a customer's domain baked in
 * at build time (Vite inlines `import.meta.env.VITE_*` when the bundle is
 * built). So the container writes a tiny `/config.js` at startup from its
 * environment, setting `window.__ELYZIAN__`; this module reads that first and
 * falls back to the build-time value for local dev and source builds.
 */
interface ElyzianRuntimeConfig {
  apiUrl?: string;
  wsUrl?: string;
}

declare global {
  interface Window {
    __ELYZIAN__?: ElyzianRuntimeConfig;
  }
}

const runtime = typeof window !== 'undefined' ? window.__ELYZIAN__ : undefined;

export const API_URL: string = runtime?.apiUrl || import.meta.env.VITE_API_URL;
export const WS_URL: string = runtime?.wsUrl || import.meta.env.VITE_WS_URL;
