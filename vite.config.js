import { fileURLToPath, URL } from "node:url";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import legacy from "@vitejs/plugin-legacy";
// import vueDevTools from "vite-plugin-vue-devtools";

// GitHub Pages 不支持 SPA 回退：未知路径返回 404。
// history 模式下直接访问 /PvfTool 等深层路由会 404，
// 因此构建后复制 index.html 为 404.html，让 Pages 用其作为兜底页面，
// 应用在该 URL 下加载并由 vue-router 接管路由。
function ghPagesHistoryFallback() {
    return {
        name: "gh-pages-history-fallback",
        apply: "build",
        closeBundle() {
            const indexPath = resolve("dist", "index.html");
            const errPath = resolve("dist", "404.html");
            if (existsSync(indexPath)) {
                writeFileSync(errPath, readFileSync(indexPath));
            }
        }
    };
}

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
        }),
        ghPagesHistoryFallback()
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
