/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_GATEWAY_TARGET: string;
    readonly VITE_GATEWAY_PORT: string;
    readonly VITE_GATEWAY_PATH: string;
    readonly VITE_GATEWAY_ENABLED: string;
    readonly VITE_PLATFORM_CHECK: string;
    readonly VITE_HEALTH_INTERVAL: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
