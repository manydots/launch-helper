<script setup>
import { computed, version } from "vue";
import { useRoute } from "vue-router";
import ModalHost from "@/components/ModalHost.vue";

const route = useRoute();

const buildTime = computed(() => {
    try {
        const d = new Date(__BUILD_TIME__);
        const p = n => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    } catch {
        return "";
    }
});

const isGameRoute = computed(() => route.name === "Game");

console.log(`Vue.js version is%c ${version}`, "color:red");
</script>

<template>
    <router-view />

    <!-- 全局弹窗 -->
    <ModalHost />

    <!-- PVF 编辑器入口按钮 -->
    <button v-if="isGameRoute" class="pvf-entry-btn" @click="$router.push({ name: 'Pvf' })">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="9" y1="13" x2="15" y2="13" />
            <line x1="9" y1="17" x2="13" y2="17" />
        </svg>
        <span>PVF 编辑</span>
    </button>

    <!-- 以下信息仅在 Game 路由显示 -->
    <template v-if="isGameRoute">
        <div class="build-time">更新时间 {{ buildTime }}</div>
        <div class="agent-badge">Agent Plan GLM5.2 生成</div>
    </template>
</template>

<style>
:root {
    --bg: #0a0e1a;
    --bg-2: #161b2e;
    --surface: rgba(255, 255, 255, 0.04);
    --surface-border: rgba(255, 255, 255, 0.08);
    --shadow-card: 0 8px 32px rgba(0, 0, 0, 0.4);
    --shadow-modal: 0 12px 48px rgba(0, 0, 0, 0.5);
    --overlay: rgba(0, 0, 0, 0.6);
    --text: #e8eaf0;
    --text-muted: #6b7390;
    --text-label: #8b92a8;
    --divider: rgba(255, 255, 255, 0.08);
    --border: rgba(255, 255, 255, 0.12);
    --input-text: #e8eaf0;
    --input-border: rgba(255, 255, 255, 0.15);
    --autofill-bg: #0a0e1a;
    --accent: #5b8cff;
    --accent-hover: #4a7eff;
    --accent-gradient: linear-gradient(135deg, #4f8cff 0%, #7b5cff 100%);
    --accent-shadow: rgba(91, 140, 255, 0.35);
    --outline-1: rgba(255, 255, 255, 0.75);
    --outline-2: rgba(255, 255, 255, 0.5);
    --outline-3-text: rgba(255, 255, 255, 0.6);
    --outline-3-border: rgba(255, 255, 255, 0.15);
    --outline-3-hover-bg: rgba(255, 255, 255, 0.06);
    --outline-3-hover-border: rgba(255, 255, 255, 0.3);
    --code-bg: rgba(255, 255, 255, 0.08);
    --error: #ff5b6e;
    --section-accent: #5b8cff;
    --glow-1: rgba(91, 140, 255, 0.18);
    --glow-2: rgba(139, 92, 255, 0.14);
    --pvf-tag-color: #ff6b9d;
}

@media (prefers-color-scheme: dark) {
    :root {
        --bg: #060912;
        --bg-2: #0f1424;
        --surface: rgba(255, 255, 255, 0.03);
        --surface-border: rgba(255, 255, 255, 0.06);
        --shadow-card: 0 8px 32px rgba(0, 0, 0, 0.5);
        --shadow-modal: 0 12px 48px rgba(0, 0, 0, 0.6);
        --overlay: rgba(0, 0, 0, 0.7);
        --glow-1: rgba(91, 140, 255, 0.14);
        --glow-2: rgba(139, 92, 255, 0.1);
    }
}

body {
    margin: 0;
    min-height: 100vh;
    background: var(--bg);
    background-image: radial-gradient(ellipse at 20% 0%, var(--glow-1), transparent 50%), radial-gradient(ellipse at 80% 100%, var(--glow-2), transparent 50%);
    background-attachment: fixed;
    color: var(--text);
}
#app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
}
.build-time {
    position: fixed;
    left: 8px;
    bottom: 4px;
    font-size: 11px;
    line-height: 1.4;
    color: var(--text-muted);
    font-family:
        system-ui,
        -apple-system,
        sans-serif;
    pointer-events: none;
    user-select: none;
    z-index: 9999;
    opacity: 0.5;
}
.agent-badge {
    position: fixed;
    right: 8px;
    bottom: 4px;
    font-size: 11px;
    line-height: 1.4;
    color: var(--text-muted);
    font-family:
        system-ui,
        -apple-system,
        sans-serif;
    pointer-events: none;
    user-select: none;
    z-index: 9999;
    opacity: 0.5;
}
.route-title {
    position: fixed;
    right: 8px;
    bottom: 4px;
    font-size: 11px;
    line-height: 1.4;
    color: var(--text-muted);
    font-family:
        system-ui,
        -apple-system,
        sans-serif;
    pointer-events: none;
    user-select: none;
    z-index: 9999;
    opacity: 0.5;
}

/* ---- PVF 编辑器入口按钮 (右上角) ---- */
.pvf-entry-btn {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 100;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border: 1px solid var(--surface-border);
    border-radius: 10px;
    background: var(--surface);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    color: var(--text);
    font-size: 0.82rem;
    font-weight: 500;
    cursor: pointer;
    font-family: system-ui, sans-serif;
    transition:
        background 0.2s,
        border-color 0.2s,
        transform 0.1s,
        box-shadow 0.2s;
}
.pvf-entry-btn:hover {
    background: rgba(91, 140, 255, 0.08);
    border-color: var(--accent);
    box-shadow: 0 4px 16px var(--accent-shadow);
}
.pvf-entry-btn:active {
    transform: scale(0.97);
}
.pvf-entry-btn svg {
    width: 16px;
    height: 16px;
    color: var(--accent);
}

/* ---- 按钮（全局） ---- */
.btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px 20px;
    border: none;
    border-radius: 10px;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 500;
    transition:
        background 0.2s,
        color 0.2s,
        border-color 0.2s,
        box-shadow 0.2s,
        transform 0.1s;
}
.btn:active:not(:disabled) {
    transform: scale(0.98);
}
.btn-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
}
.btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}
.btn-primary:disabled {
    filter: grayscale(0.4);
}
.btn-primary {
    background: var(--accent-gradient);
    color: #fff;
    box-shadow: 0 4px 16px var(--accent-shadow);
}
.btn-primary:hover:not(:disabled) {
    box-shadow: 0 6px 20px var(--accent-shadow);
}
.btn-outline-primary {
    background: transparent;
    color: var(--outline-1);
    border: 1.5px solid var(--outline-3-border);
}
.btn-outline-primary:hover:not(:disabled) {
    background: var(--outline-3-hover-bg);
    border-color: var(--outline-3-hover-border);
}
.btn-outline-danger {
    background: transparent;
    color: var(--outline-2);
    border: 1.5px solid var(--outline-3-border);
}
.btn-outline-danger:hover:not(:disabled) {
    background: var(--outline-3-hover-bg);
    border-color: var(--outline-3-hover-border);
}
.btn-outline-secondary {
    background: transparent;
    color: var(--outline-3-text);
    border: 1.5px solid var(--outline-3-border);
}
.btn-outline-secondary:hover {
    background: var(--outline-3-hover-bg);
    border-color: var(--outline-3-hover-border);
}

/* ---- 弹窗（全局） ---- */
.modal-overlay {
    position: fixed;
    inset: 0;
    background: var(--overlay);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 3000;
}
.modal {
    background: var(--bg-2);
    border: 1px solid var(--surface-border);
    border-radius: 16px;
    padding: 32px;
    max-width: 380px;
    width: 90%;
    box-shadow: var(--shadow-modal);
}
.modal-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 1.1rem;
    font-weight: 600;
    margin: 0 0 14px;
    color: var(--text);
}
.modal-title::before {
    content: "";
    width: 4px;
    height: 16px;
    background: var(--accent-gradient);
    border-radius: 2px;
    flex-shrink: 0;
}
.modal-body {
    font-size: 0.9rem;
    color: var(--text-muted);
    line-height: 1.6;
    margin: 0 0 24px;
}
.modal-body code {
    background: var(--code-bg);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.85rem;
}
.modal-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
}
.modal-enter-active,
.modal-leave-active {
    transition: opacity 0.2s ease;
}
.modal-enter-active .modal,
.modal-leave-active .modal {
    transition: transform 0.28s cubic-bezier(0.34, 1.4, 0.64, 1);
}
.modal-enter-from,
.modal-leave-to {
    opacity: 0;
}
.modal-enter-from .modal,
.modal-leave-to .modal {
    transform: scale(0.94) translateY(-8px);
}
</style>
