<script setup>
import { computed } from "vue";
import GameLauncher from "@/components/GameLauncher.vue";

const isWindows = computed(() => /Windows/i.test(navigator.userAgent));
</script>

<template>
    <GameLauncher v-if="isWindows" />
    <div v-else class="unsupported">
        <div class="unsupported-icon">Windows</div>
        <h1>LaunchHelper</h1>
        <p class="unsupported-title">不支持当前系统</p>
        <p class="unsupported-desc">本工具仅支持 Windows 系统，无法在 macOS、Linux 或移动端使用。</p>
    </div>
</template>

<style>
:root {
    --bg: #f5f5f5;
    --surface: #fff;
    --shadow-card: rgba(0, 0, 0, 0.08);
    --shadow-modal: rgba(0, 0, 0, 0.2);
    --overlay: rgba(0, 0, 0, 0.4);
    --text: #1a1a1a;
    --text-muted: #999;
    --text-label: #888;
    --divider: #eee;
    --border: #ccc;
    --input-text: #333;
    --input-border: #9e9e9e;
    --autofill-bg: #fff;
    --accent: #2c3e50;
    --accent-hover: #1a2733;
    --accent-shadow: rgba(44, 62, 80, 0.25);
    --outline-1: #495057;
    --outline-2: #9aa0a6;
    --outline-3-text: #666;
    --outline-3-border: #ccc;
    --outline-3-hover-bg: #f5f5f5;
    --outline-3-hover-border: #999;
    --code-bg: #f0f0f0;
    --error: #d32f2f;
    --section-accent: #ccc;
}

@media (prefers-color-scheme: dark) {
    :root {
        --bg: #0d1117;
        --surface: #161b22;
        --shadow-card: rgba(0, 0, 0, 0.4);
        --shadow-modal: rgba(0, 0, 0, 0.5);
        --overlay: rgba(1, 4, 9, 0.6);
        --text: #c9d1d9;
        --text-muted: #8b949e;
        --text-label: #8b949e;
        --divider: #21262d;
        --border: #30363d;
        --input-text: #c9d1d9;
        --input-border: #484f58;
        --autofill-bg: #161b22;
        --accent: #58a6ff;
        --accent-hover: #388bfd;
        --accent-shadow: rgba(88, 166, 255, 0.3);
        --outline-1: #8b949e;
        --outline-2: #6e7681;
        --outline-3-text: #8b949e;
        --outline-3-border: #30363d;
        --outline-3-hover-bg: #21262d;
        --outline-3-hover-border: #8b949e;
        --code-bg: #1c2128;
        --error: #f85149;
        --section-accent: #30363d;
    }
}

body {
    margin: 0;
    background: var(--bg);
}
.unsupported {
    max-width: 420px;
    margin: 120px auto;
    text-align: center;
    font-family: system-ui, sans-serif;
    color: var(--text);
}
.unsupported-icon {
    display: inline-block;
    padding: 8px 20px;
    border: 2px solid var(--text);
    border-radius: 8px;
    color: var(--text);
    font-weight: 700;
    font-size: 1.1rem;
    margin-bottom: 20px;
}
.unsupported h1 {
    font-size: 2rem;
    margin: 0 0 16px;
}
.unsupported-title {
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--error);
    margin: 0 0 8px;
}
.unsupported-desc {
    font-size: 0.95rem;
    color: var(--text-muted);
    line-height: 1.6;
    margin: 0;
}
</style>
