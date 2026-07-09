/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_APP_BASEURL: string;
    readonly VITE_GATEWAY_TARGET: string;
    readonly VITE_GATEWAY_ENABLED: string;
    readonly VITE_PLATFORM_CHECK: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
