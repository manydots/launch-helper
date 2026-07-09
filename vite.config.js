import { fileURLToPath, URL } from "node:url";

import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import legacy from "@vitejs/plugin-legacy";
// import vueDevTools from "vite-plugin-vue-devtools";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd());
    const gatewayTarget = env.VITE_GATEWAY_TARGET || "http://127.0.0.1:8080";
    const baseURL = env.VITE_APP_BASEURL;
    // console.log("baseURL", baseURL);

    return {
        base: process.env.GITHUB_ACTIONS ? "/launch-helper/" : "/",
        define: {
            __BUILD_TIME__: JSON.stringify(new Date().toISOString())
        },
        server: {
            host: "0.0.0.0",
            port: 5173, // default
            proxy: {
                [`^${baseURL}`]: {
                    target: gatewayTarget,
                    changeOrigin: true,
                    rewrite: path => {
                        const target = path.replace(new RegExp(`^${baseURL}`), "");
                        // console.log("target", target);
                        return target;
                    }
                }
            }
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
    };
});
