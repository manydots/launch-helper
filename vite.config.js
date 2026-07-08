import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import legacy from "@vitejs/plugin-legacy";
// import vueDevTools from "vite-plugin-vue-devtools";

// https://vite.dev/config/
export default defineConfig({
    base: process.env.GITHUB_ACTIONS ? "/launch-helper/" : "/",
    define: {
        __BUILD_TIME__: JSON.stringify(new Date().toISOString())
    },
    server: {
        host: "0.0.0.0",
        port: 5173 // default
    },
    plugins: [
        vue(),
        legacy({
            targets: ["defaults", "not IE 11"]
            // modernPolyfills: true // polyfill
        })
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
});
