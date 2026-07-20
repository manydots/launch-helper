import { fileURLToPath, URL } from "node:url";

import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import legacy from "@vitejs/plugin-legacy";
// import vueDevTools from "vite-plugin-vue-devtools";
import gatewayBridge from "./vite-plugin-gateway-bridge.js";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd());
    const gatewayHost = env.VITE_GATEWAY_TARGET || "127.0.0.1";
    const gatewayPort = env.VITE_GATEWAY_PORT || "80";
    const gatewayPath = env.VITE_GATEWAY_PATH || "/gateway";
    const gatewayTarget = `${gatewayHost}:${gatewayPort}`;

    return {
        base: process.env.GITHUB_ACTIONS ? "/launch-helper/" : "/",
        define: {
            __BUILD_TIME__: JSON.stringify(new Date().toISOString())
        },
        server: {
            host: "0.0.0.0",
            port: 5173
        },
        plugins: [
            vue(),
            legacy({
                targets: ["defaults", "not IE 11"]
            }),
            gatewayBridge({ target: gatewayTarget, path: gatewayPath })
        ],
        resolve: {
            alias: {
                "@": fileURLToPath(new URL("./src", import.meta.url))
            }
        },
        build: {
            // sourcemap: true,
            // target: "esnext",
            modulePreload: false,
            rollupOptions: {
                output: {
                    hashCharacters: "base36",
                    manualChunks: {
                        vendor: ["vue", "vue-router", "pinia", "pinia-plugin-persistedstate"],
                        plugin: ["highlight.js"]
                    }
                }
            }
        }
    };
});
