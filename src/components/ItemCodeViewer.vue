<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { PvfArchive } from "@/utils/pvfTool.js";

const ROW_H = 30;
const ROW_BUFFER = 10;

const router = useRouter();

const archive = ref(null);
const fileName = ref("");
const items = ref([]);
const loading = ref(false);
const loadingMessage = ref("");
const searchQuery = ref("");
const error = ref("");
const labelNameMap = {
    Stackable: "物品",
    Equipment: "装备",
    Creature: "宠物"
};

// 品级体系依客户端串表(dstr 35103-35105): 勇者=红色仅出自异界, 传说=6
const RARITY_LABELS = ["普通", "高级", "稀有", "神器", "史诗", "勇者", "传说"];

const LST_TYPES = [
    { id: "stackable", label: "Stackable", path: /^stackable\/stackable\.lst$/i },
    { id: "equipment", label: "Equipment", path: /^equipment\/equipment\.lst$/i },
    { id: "creature", label: "Creature", path: /^creature\/creature\.lst$/i }
];

const listScrollEl = ref(null);
const listScrollTop = ref(0);
const listViewH = ref(0);
let listResizeObserver = null;

const filteredItems = computed(() => {
    const q = searchQuery.value.trim().toLowerCase();
    if (!q) return items.value;
    return items.value.filter(it => it.code.toLowerCase().includes(q) || it.type.toLowerCase().includes(q) || it.name.toLowerCase().includes(q) || it.ref.toLowerCase().includes(q));
});

// 虚拟滚动：仅渲染可视区 ± 缓冲行，窗口 resize / 滚动时 DOM 行数恒定，避免整表重排卡顿。
const visibleRows = computed(() => {
    const total = filteredItems.value.length;
    if (!total) return [];
    const viewH = listViewH.value > 0 ? listViewH.value : 400;
    const start = Math.max(0, Math.floor(listScrollTop.value / ROW_H) - ROW_BUFFER);
    const end = Math.min(total, Math.ceil((listScrollTop.value + viewH) / ROW_H) + ROW_BUFFER);
    const rows = [];
    for (let i = start; i < end; i++) {
        const it = filteredItems.value[i];
        rows.push({ no: i, top: i * ROW_H, code: it.code, type: it.type, name: it.name, ref: it.ref, rarity: it.rarity, minLevel: it.minLevel });
    }
    return rows;
});

function onListScroll() {
    const el = listScrollEl.value;
    if (el) listScrollTop.value = el.scrollTop;
}

function observeList() {
    if (listResizeObserver) {
        listResizeObserver.disconnect();
        listResizeObserver = null;
    }
    const el = listScrollEl.value;
    if (!el) return;
    listViewH.value = el.clientHeight;
    let raf = 0;
    listResizeObserver = new ResizeObserver(() => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
            raf = 0;
            const h = el.clientHeight;
            if (h > 0 && h !== listViewH.value) listViewH.value = h;
        });
    });
    listResizeObserver.observe(el);
}

watch(searchQuery, async () => {
    const el = listScrollEl.value;
    if (el) el.scrollTop = 0;
    else listScrollTop.value = 0;
    await nextTick();
    observeList();
});

watch(archive, async val => {
    if (!val) return;
    listScrollTop.value = 0;
    await nextTick();
    observeList();
});

onBeforeUnmount(() => {
    if (listResizeObserver) {
        listResizeObserver.disconnect();
        listResizeObserver = null;
    }
});

function goBack() {
    if (window.history.length > 1) router.back();
    else router.push({ name: "Game" });
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = "";
    loadPvf(file);
}

async function loadPvf(file) {
    loading.value = true;
    loadingMessage.value = "读取文件中...";
    error.value = "";
    try {
        const buffer = await file.arrayBuffer();
        loadingMessage.value = "正在解析 PVF 归档...";
        const arch = new PvfArchive(buffer);
        await arch.parse();
        const allItems = [];
        for (const lstType of LST_TYPES) {
            const lst = arch.files.find(f => !f.isDir && lstType.path.test(f.fullpath || ""));
            if (lst) {
                loadingMessage.value = `正在提取 ${lstType.label} 物品名称...`;
                const list = await arch.listLstItems(lst);
                list.forEach(it => {
                    it.type = lstType.label;
                });
                loadingMessage.value = `正在解析 ${lstType.label} 品质与使用等级...`;
                const metaList = await arch.listLstItemMeta(lst, list);
                list.forEach((it, i) => {
                    const meta = metaList[i];
                    it.rarity = meta && meta.rarity >= 0 ? meta.rarity : null;
                    it.minLevel = meta && meta.minLevel >= 0 ? meta.minLevel : null;
                });
                // 大档案如 CN的 .lst 可达十余万行，push(...list) 参数展开会爆栈，
                // 必须逐条追加
                for (let i = 0; i < list.length; i++) allItems.push(list[i]);
            }
        }
        if (!allItems.length) throw new Error("归档中未找到任何物品列表文件");
        archive.value = arch;
        fileName.value = file.name;
        items.value = allItems;
        searchQuery.value = "";
    } catch (err) {
        error.value = err && err.message ? err.message : "加载失败，请确认选择的是有效的 Script.pvf 文件。";
    } finally {
        loading.value = false;
    }
}
</script>

<template>
    <div class="ivc-root">
        <!-- Top toolbar -->
        <div class="ivc-topbar">
            <button class="ivc-icon-btn" @click="goBack" title="返回">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <span class="ivc-title">
                <svg class="ivc-title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
                <span class="ivc-title-text">物品编码</span>
            </span>
            <span v-if="archive" class="ivc-format-badge" :class="'ivc-format-' + archive.headerFormat" :title="'包头加密规则：' + archive.headerFormatLabel">{{ archive.headerFormatLabel }}</span>
            <span v-if="archive" class="ivc-file-name">{{ fileName }}</span>
            <span v-if="archive" class="ivc-stats">{{ items.length.toLocaleString() }} 个编码</span>
        </div>

        <!-- File picker -->
        <div v-if="!archive && !loading" class="ivc-picker">
            <div class="ivc-picker-card">
                <div class="ivc-picker-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                        <line x1="12" y1="22.08" x2="12" y2="12" />
                    </svg>
                </div>
                <h2>查看物品编码</h2>
                <p>解析 Script.pvf 中的 stackable/equipment/creature 物品列表，映射展示物品编码与名称</p>
                <p>支持 JP / JPAG（0x55 XOR）/ CN、US（protected_nkpi）三种格式的 PVF 解析</p>
                <button class="btn btn-primary" @click="$refs.fileInputEl && $refs.fileInputEl.click()">
                    <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    选择 Script.pvf 文件
                </button>
                <input ref="fileInputEl" type="file" accept=".pvf" style="display: none" @change="handleFileSelect" />
                <p v-if="error" class="ivc-error">{{ error }}</p>
                <p class="ivc-picker-hint">所有解析与名称映射在浏览器本地完成</p>
            </div>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="ivc-loading">
            <div class="ivc-loading-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
            </div>
            <p class="ivc-loading-text">{{ loadingMessage }}</p>
        </div>

        <!-- Item list -->
        <div v-if="archive && !loading" class="ivc-body">
            <div class="ivc-toolbar">
                <div class="ivc-search-wrap">
                    <svg class="ivc-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input v-model="searchQuery" type="text" class="ivc-search" placeholder="搜索物品ID / 物品名称 / 引用路径..." />
                    <button v-if="searchQuery" type="button" class="ivc-search-clear" title="清除" @click="searchQuery = ''">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                            <line x1="6" y1="6" x2="18" y2="18" />
                            <line x1="18" y1="6" x2="6" y2="18" />
                        </svg>
                    </button>
                </div>
                <span class="ivc-count">{{ filteredItems.length.toLocaleString() }} / {{ items.length.toLocaleString() }}</span>
            </div>
            <div class="ivc-list">
                <div class="ivc-head">
                    <span>物品ID</span>
                    <span>类型</span>
                    <span>物品名称</span>
                    <span>品质</span>
                    <span>使用等级</span>
                    <span>引用路径</span>
                </div>
                <div v-if="filteredItems.length" ref="listScrollEl" class="ivc-scroll" @scroll.passive="onListScroll">
                    <div class="ivc-spacer" :style="{ height: filteredItems.length * ROW_H + 'px' }"></div>
                    <div v-for="row in visibleRows" :key="row.no" class="ivc-row" :style="{ top: row.top + 'px' }">
                        <span class="ivc-code">{{ row.code }}</span>
                        <span class="ivc-type" :class="'type-' + row.type">{{ labelNameMap[row.type] }}</span>
                        <span class="ivc-name" :class="{ empty: !row.name }">{{ row.name || "—" }}</span>
                        <span class="ivc-rarity" :class="row.rarity >= 0 ? 'rarity-' + row.rarity : 'rarity-unknown'">{{ row.rarity >= 0 ? RARITY_LABELS[row.rarity] || row.rarity : "—" }}</span>
                        <span class="ivc-min-level" :class="{ empty: !row.minLevel }">{{ row.minLevel >= 0 ? row.minLevel : "—" }}</span>
                        <span class="ivc-ref">{{ row.ref }}</span>
                    </div>
                </div>
                <div v-else class="ivc-empty">无匹配条目</div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.ivc-root {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

/* ---- Top toolbar ---- */
.ivc-topbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    height: 48px;
    background: var(--bg-2);
    border-bottom: 1px solid var(--surface-border);
    flex-shrink: 0;
}
.ivc-icon-btn {
    width: 30px;
    height: 30px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.2s;
}
.ivc-icon-btn:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.06);
}
.ivc-icon-btn svg {
    width: 18px;
    height: 18px;
}
.ivc-title {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-weight: 600;
    color: var(--text);
    font-size: 0.9rem;
    white-space: nowrap;
}
.ivc-title-icon {
    width: 17px;
    height: 17px;
    color: var(--accent);
}
.ivc-format-badge {
    flex-shrink: 0;
    padding: 1px 7px;
    border-radius: 9px;
    font-size: 0.68rem;
    font-weight: 600;
    border: 1px solid;
}
.ivc-format-guard {
    color: #e8a33d;
    border-color: #e8a33d55;
    background: #e8a33d18;
}
.ivc-format-original {
    color: #3d9de8;
    border-color: #3d9de855;
    background: #3d9de818;
}
.ivc-format-protected {
    color: #ff6b60;
    border-color: #ff6b6055;
    background: linear-gradient(135deg, #e0524a28, #ff6b6018);
    box-shadow: 0 0 0 1px #ff6b6014 inset;
}
.ivc-file-name {
    flex: 1;
    min-width: 0;
    color: var(--text-muted);
    font-size: 0.8rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: right;
}
.ivc-stats {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: 0.8rem;
}

/* ---- File picker ---- */
.ivc-picker {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
}
.ivc-picker-card {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 48px;
}
.ivc-picker-icon {
    color: var(--accent);
    line-height: 0;
}
.ivc-picker-icon svg {
    width: 56px;
    height: 56px;
}
.ivc-picker-card h2 {
    margin: 0;
    font-size: 1.4rem;
    color: var(--text);
}
.ivc-picker-card > p {
    color: var(--text-muted);
    font-size: 0.9rem;
    margin: 0 0 16px;
}
.ivc-picker-card .btn {
    min-width: 180px;
}
.ivc-picker-hint {
    margin-top: 20px;
    font-size: 0.75rem;
    color: var(--text-muted);
    opacity: 0.6;
}
.ivc-error {
    color: var(--error);
    font-size: 0.85rem;
    max-width: 360px;
    line-height: 1.5;
}

/* ---- Loading ---- */
.ivc-loading {
    position: fixed;
    inset: 0;
    z-index: 2100;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(8px);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
}
.ivc-loading-icon {
    width: 56px;
    height: 56px;
    color: var(--accent);
    animation: ivc-spin 1.1s linear infinite;
}
.ivc-loading-icon svg {
    width: 100%;
    height: 100%;
}
@keyframes ivc-spin {
    to {
        transform: rotate(360deg);
    }
}
.ivc-loading-text {
    color: var(--text);
    font-size: 0.9rem;
}

/* ---- List ---- */
.ivc-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
}
.ivc-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--surface-border);
    flex-shrink: 0;
}
.ivc-search-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
}
.ivc-search-icon {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    width: 14px;
    height: 14px;
    color: var(--text-muted);
    pointer-events: none;
}
.ivc-search {
    width: 100%;
    box-sizing: border-box;
    padding: 6px 30px 6px 30px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--bg);
    color: var(--text);
    font-size: 0.8rem;
    outline: none;
    font-family: system-ui, sans-serif;
}
.ivc-search:focus {
    border-color: var(--accent);
}
.ivc-search-clear {
    position: absolute;
    inset-block: 0;
    right: 6px;
    width: 16px;
    height: 16px;
    margin: auto;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    line-height: 1;
    box-sizing: border-box;
}
.ivc-search-clear:hover {
    color: var(--text);
    background: var(--border);
}
.ivc-search-clear svg {
    display: block;
    width: 12px;
    height: 12px;
}
.ivc-count {
    flex-shrink: 0;
    font-size: 0.75rem;
    color: var(--text-muted);
}
.ivc-list {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
}
.ivc-scroll {
    position: relative;
    flex: 1;
    overflow: auto;
    min-height: 0;
}
.ivc-spacer {
    position: absolute;
    top: 0;
    left: 0;
    width: 1px;
    pointer-events: none;
}
.ivc-head,
.ivc-row {
    display: grid;
    grid-template-columns: 1.5fr 1.5fr 2.5fr 1.5fr 1.5fr 3fr;
    gap: 12px;
    padding: 0 16px;
    align-items: center;
}
.ivc-head {
    flex-shrink: 0;
    background: var(--bg-2);
    border-bottom: 1px solid var(--surface-border);
    color: var(--text-muted);
    font-size: 0.72rem;
    font-weight: 600;
    height: 30px;
}
.ivc-row {
    position: absolute;
    left: 0;
    right: 0;
    height: 30px;
    box-sizing: border-box;
    border-bottom: 1px solid var(--divider);
    font-size: 0.8rem;
}
.ivc-row:hover {
    background: rgba(91, 140, 255, 0.06);
}
.ivc-code {
    font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
    color: var(--accent);
    font-weight: 600;
}
.ivc-type {
    font-size: 0.72rem;
    padding: 2px 6px;
    border-radius: 4px;
    text-align: left;
    font-weight: 500;
}
.ivc-type.type-Stackable {
    color: #3d9de8;
}
.ivc-type.type-Equipment {
    color: #e8a33d;
}
.ivc-type.type-Creature {
    color: #4db86b;
}
/* 品质色（依客户端串表：普通白灰/高级蓝/稀有紫/神器粉/史诗金/勇者红/传说橙） */
.ivc-rarity {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ivc-rarity.rarity-0 {
    color: #e5edf5;
}
.ivc-rarity.rarity-1 {
    color: #68d5ed;
}
.ivc-rarity.rarity-2 {
    color: #b982ff;
}
.ivc-rarity.rarity-3 {
    color: #f873ed;
}
.ivc-rarity.rarity-4 {
    color: #ffc247;
}
.ivc-rarity.rarity-5 {
    color: #ff7373;
}
.ivc-rarity.rarity-6 {
    color: #ff8338;
}
.ivc-rarity.rarity-unknown {
    color: var(--text-muted);
    opacity: 0.6;
}
.ivc-min-level {
    color: var(--text);
    font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
    font-size: 0.76rem;
}
.ivc-min-level.empty {
    color: var(--text-muted);
    opacity: 0.6;
}
.ivc-name {
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ivc-name.empty {
    color: var(--text-muted);
    opacity: 0.6;
}
.ivc-ref {
    color: var(--text-muted);
    font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
    font-size: 0.74rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ivc-empty {
    padding: 40px;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.85rem;
}
</style>
