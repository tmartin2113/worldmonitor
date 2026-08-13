/// <reference types="vite/client" />

interface Window {
  umami?: {
    track: (event: string, data?: Record<string, unknown>) => void;
    identify: (data: Record<string, unknown>) => void;
  };
}

declare const __APP_VERSION__: string;
declare const __BUILD_HASH__: string;
declare const __CLERK_JS_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_WS_API_URL?: string;
  // Self-host build flags (LOCAL fork patches — re-apply after any upstream sync).
  // VITE_SELF_HOST_PRO unlocks the UI (widget-store.ts isProUser);
  // VITE_SELF_HOST_API_KEY is sent as X-WorldMonitor-Key (runtime.ts) and must
  // match an entry in the server's WORLDMONITOR_VALID_KEYS.
  readonly VITE_SELF_HOST_PRO?: string;
  readonly VITE_SELF_HOST_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
