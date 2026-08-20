<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElCascader, ElInput, ElSelect, ElOption, ElInputNumber } from "element-plus";
import { PvfArchive, firstTypeTag, stackSegment, equipSpecial, classifyItemExpiration } from "@/utils/pvfTool.js";
import { TwPvfArchive } from "@/utils/pvfToolTw.js";

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

// 品质细分标签（86JPGMTool EquipSpecial，见 docs/pvf-item-grant-parsing.md）
const SPECIAL_LABELS = { legacy: "传承", boss: "领主神器", sealed: "魔法封印" };

// 期限过滤选项（86JPGMTool 发放界面 MatchesExpirationFilter 同语义）；不限由 placeholder 承担
const EXPIRATION_OPTIONS = [
    { id: "limited", label: "有限期" },
    { id: "none", label: "无期限" },
    { id: "relative", label: "相对期限(天)" },
    { id: "absolute", label: "绝对期限" },
    { id: "daily", label: "每日删除" },
    { id: "expired", label: "已过期" }
];

const LST_TYPES = [
    { id: "stackable", label: "Stackable", path: /^stackable\/stackable\.lst$/i },
    { id: "equipment", label: "Equipment", path: /^equipment\/equipment\.lst$/i },
    { id: "creature", label: "Creature", path: /^creature\/creature\.lst$/i }
];

// 筛选条件
const filterCategoryPath = ref([]); // 级联选中值 [group, subcategory]，可只选一级
const filterRarity = ref("");
const filterSpecial = ref("");
const filterExpiration = ref("");
const filterMinLevel = ref(null);
const filterMaxLevel = ref(null);

const listScrollEl = ref(null);
const listScrollTop = ref(0);
const listViewH = ref(0);
let listResizeObserver = null;

// 装备侧栏分组（参考 86JPGMTool give.js EQUIP_GROUPS，固定顺序，未列出的装备标签落入"其他"）
const EQUIP_GROUPS = [
    { key: "equip", title: "装备", tags: ["weapon", "coat", "shoulder", "pants", "shoes", "waist", "amulet", "wrist", "ring", "support", "magic stone", "support weapon", "title name", "name tag"] },
    { key: "pet", title: "宠物", tags: ["creature", "artifact red", "artifact blue", "artifact green"] },
    {
        key: "avatar",
        title: "装扮",
        tags: ["hat avatar", "hair avatar", "face avatar", "coat avatar", "breast avatar", "waist avatar", "pants avatar", "shoes avatar", "skin avatar", "aurora avatar", "weapon avatar"]
    }
];
// 堆叠物背包六段（参考 give.js STACK_SEGMENTS，与服务端入格语义一致，固定顺序）
const STACK_SEGMENTS = ["消耗品", "材料", "任务品", "副职业材料", "徽章", "特殊材料"];

// 类型标签中文名（取自 86JPGMTool give.js TAG_LABELS；含义未经实物确认的不硬翻，显示原始标签）
const TAG_LABELS = {
    // 装备部位
    weapon: "武器",
    coat: "上衣",
    shoulder: "头肩",
    pants: "下装",
    shoes: "鞋",
    waist: "腰带",
    amulet: "项链",
    wrist: "手镯",
    ring: "戒指",
    support: "辅助装备",
    "magic stone": "魔法石",
    "support weapon": "副武器",
    "title name": "称号",
    "name tag": "名称装饰卡",
    creature: "宠物",
    "artifact red": "宠物装备·红",
    "artifact blue": "宠物装备·蓝",
    "artifact green": "宠物装备·绿",
    // 装扮部位
    "hat avatar": "帽子装扮",
    "hair avatar": "头发装扮",
    "face avatar": "脸部装扮",
    "coat avatar": "上衣装扮",
    "breast avatar": "胸部装扮",
    "waist avatar": "腰部装扮",
    "pants avatar": "下装装扮",
    "shoes avatar": "鞋装扮",
    "skin avatar": "皮肤装扮",
    "aurora avatar": "光环装扮",
    "weapon avatar": "武器装扮",
    // 堆叠物类型（仅列实物确认过的：附魔宝珠/福包/名称装饰卡等均抽样核对）
    material: "材料",
    quest: "任务品",
    "material expert job": "副职业材料",
    "avatar emblem": "徽章",
    recipe: "设计图",
    dye: "染色剂",
    throw: "投掷物",
    "enchant waste": "附魔宝珠",
    "cera package": "点券礼包",
    "usable cera package": "点券礼包",
    "cera booster": "福包",
    booster: "礼盒",
    "booster selection": "自选礼盒",
    "town and dungeon": "城镇副本道具",
    "teleport potion": "传送药剂",
    etc: "其他"
};

function tagLabel(tag) {
    return TAG_LABELS[tag] || tag || "(无标签)";
}

// 分类路径：返回 [groupKey, subKey]。一级=give.js 业务分组，二级=组内标签/分段。
// 装备按部位标签归组，堆叠物按背包分段（stack 组），creature.lst 物品归宠物组，
// 未列出的装备标签落入"其他"（give.js 同款）。
function resolveCategoryPath(it) {
    if (it.type === "Stackable") return ["stack", it.segment || "消耗品"];
    if (it.type === "Creature") return ["pet", "creature"];
    const tag = it.typeTag || "(无标签)";
    for (const g of EQUIP_GROUPS) {
        if (g.tags.includes(tag)) return [g.key, tag];
    }
    return ["other", tag];
}

// 级联数据：一级 = give.js 业务分组（装备/宠物/装扮/消耗品/材料/其他，固定顺序），
// 二级 = 组内标签/分段（按 give.js 顺序，其他组按数量降序），带计数。
const categoryCascaderProps = { value: "value", label: "label", children: "children" };
const categoryCascaderOptions = computed(() => {
    const counts = new Map(); // groupKey -> Map<subKey, count>
    for (const it of items.value) {
        const [gk, sub] = resolveCategoryPath(it);
        if (!counts.has(gk)) counts.set(gk, new Map());
        const m = counts.get(gk);
        m.set(sub, (m.get(sub) || 0) + 1);
    }
    const groups = [];
    const addGroup = (key, title, ordered) => {
        const m = counts.get(key);
        if (!m) return;
        const present = [...m.entries()].filter(([, c]) => c > 0);
        if (!present.length) return;
        const children = (ordered != null ? present.sort((a, b) => ordered.indexOf(a[0]) - ordered.indexOf(b[0])) : present.sort((a, b) => b[1] - a[1])).map(([sub, count]) => ({
            value: sub,
            label: `${tagLabel(sub)} (${count})`
        }));
        const total = present.reduce((sum, [, c]) => sum + c, 0);
        groups.push({ value: key, label: `${title} (${total})`, children });
    };
    for (const g of EQUIP_GROUPS) addGroup(g.key, g.title, g.tags);
    addGroup("stack", "消耗品 / 材料", STACK_SEGMENTS);
    addGroup("other", "其他", null);
    return groups;
});

// 级联选中 -> 过滤条件（只选一级 = 按业务分组过滤；选到二级 = 分组 + 具体标签/分段）
const filterGroup = computed(() => filterCategoryPath.value?.[0] || "");
const filterType = computed(() => filterCategoryPath.value?.[1] || "");

const filteredItems = computed(() => {
    const q = searchQuery.value.trim().toLowerCase();
    // 纯数字 query 精确匹配物品ID（86JPGMTool SearchItems 同语义），避免输入 1 命中全部
    const numericId = /^\d+$/.test(q) ? q : null;
    const minLevel = filterMinLevel.value != null ? Number(filterMinLevel.value) : null;
    const maxLevel = filterMaxLevel.value != null ? Number(filterMaxLevel.value) : null;
    const rarity = filterRarity.value != null && filterRarity.value !== "" ? Number(filterRarity.value) : null;
    const now = Math.floor(Date.now() / 1000);
    return items.value.filter(it => {
        if (numericId != null) {
            if (it.code !== numericId) return false;
        } else if (q) {
            if (!it.name.toLowerCase().includes(q) && !it.ref.toLowerCase().includes(q) && !it.type.toLowerCase().includes(q)) return false;
        }
        const [gk, sub] = resolveCategoryPath(it);
        if (filterGroup.value && gk !== filterGroup.value) return false;
        if (filterType.value && sub !== filterType.value) return false;
        if (rarity != null && it.rarity !== rarity) return false;
        if (filterSpecial.value && it.special !== filterSpecial.value) return false;
        if (minLevel != null && (it.minLevel == null || it.minLevel < minLevel)) return false;
        if (maxLevel != null && (it.minLevel == null || it.minLevel > maxLevel)) return false;
        if (filterExpiration.value && !matchesExpirationFilter(it.expiration, filterExpiration.value, now)) return false;
        return true;
    });
});

// 期限过滤（86JPGMTool MatchesExpirationFilter 同语义）
function matchesExpirationFilter(exp, filter, now) {
    if (!exp) return filter === "none";
    const hasAbsolute = exp.hasAbsolute;
    const hasRelative = exp.hasRelative;
    const hasDaily = exp.dailyDelete;
    switch (filter) {
        case "limited":
            return hasAbsolute || hasRelative || hasDaily;
        case "none":
            return !exp.invalid && !hasAbsolute && !hasRelative && !hasDaily;
        case "relative":
            return hasRelative;
        case "absolute":
            return hasAbsolute;
        case "daily":
            return hasDaily;
        case "expired":
            return hasAbsolute && exp.absoluteExpireTime != null && exp.absoluteExpireTime <= now;
        default:
            return true;
    }
}

// 期限列展示文案
function expirationText(exp) {
    if (!exp) return "-";
    switch (exp.kind) {
        case "invalid":
            return "定义异常";
        case "absolute":
            return formatUnix(exp.absoluteExpireTime);
        case "relative":
            return (exp.usablePeriodDays || 0) + " 天";
        case "daily":
            return "每日删除";
        default:
            return "-";
    }
}

function formatUnix(sec) {
    if (sec == null) return "-";
    const d = new Date(sec * 1000 + 8 * 3600 * 1000);
    const p = n => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

const nowSec = Math.floor(Date.now() / 1000);
function isExpired(exp) {
    return !!(exp && exp.hasAbsolute && exp.absoluteExpireTime != null && exp.absoluteExpireTime <= nowSec);
}

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
        rows.push({
            no: i,
            top: i * ROW_H,
            code: it.code,
            type: it.type,
            name: it.name,
            ref: it.ref,
            rarity: it.rarity,
            minLevel: it.minLevel,
            category: resolveCategoryPath(it)[1],
            categoryLabel: tagLabel(resolveCategoryPath(it)[1]),
            special: it.special,
            expiration: it.expiration,
            expired: isExpired(it.expiration)
        });
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

function resetFilters() {
    searchQuery.value = "";
    filterCategoryPath.value = [];
    filterRarity.value = "";
    filterSpecial.value = "";
    filterExpiration.value = "";
    filterMinLevel.value = null;
    filterMaxLevel.value = null;
}

// 是否有任一筛选条件生效（控制"重置筛选"按钮显隐）
const hasActiveFilter = computed(
    () =>
        !!searchQuery.value ||
        (filterCategoryPath.value?.length ?? 0) > 0 ||
        (filterRarity.value != null && filterRarity.value !== "") ||
        !!filterSpecial.value ||
        !!filterExpiration.value ||
        filterMinLevel.value != null ||
        filterMaxLevel.value != null
);

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
        // 先按 JP/JPAG/CN 解析，失败则按繁体 TW 解析
        let arch = null;
        let loadError = null;
        try {
            arch = new PvfArchive(buffer);
            await arch.parse();
        } catch (err) {
            loadError = err;
            try {
                arch = new TwPvfArchive(buffer);
                await arch.parse();
            } catch (twErr) {
                throw loadError || twErr;
            }
        }
        const allItems = [];
        for (const lstType of LST_TYPES) {
            const lst = arch.files.find(f => !f.isDir && lstType.path.test(f.fullpath || ""));
            if (lst) {
                loadingMessage.value = `正在提取 ${lstType.label} 物品名称...`;
                const list = await arch.listLstItems(lst);
                list.forEach(it => {
                    it.type = lstType.label;
                });
                loadingMessage.value = `正在解析 ${lstType.label} 品质/类型/期限...`;
                const metaList = await arch.listLstItemMeta(lst, list);
                list.forEach((it, i) => {
                    const meta = metaList[i];
                    it.rarity = meta && meta.rarity >= 0 ? meta.rarity : null;
                    it.minLevel = meta && meta.minLevel >= 0 ? meta.minLevel : null;
                    // 类型标签/品质细分/期限（86JPGMTool 发放语义，见 docs/pvf-item-grant-parsing.md）
                    const typeString = meta ? meta.equipType || meta.stackableType : null;
                    it.typeTag = firstTypeTag(typeString);
                    it.segment = meta && meta.stackableType ? stackSegment(meta.stackableType) : null;
                    it.special = meta ? equipSpecial(meta.itemCategory, meta.hasRandomOption) : null;
                    it.expiration = meta ? classifyItemExpiration(meta) : null;
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
        filterCategoryPath.value = [];
        filterRarity.value = "";
        filterSpecial.value = "";
        filterExpiration.value = "";
        filterMinLevel.value = null;
        filterMaxLevel.value = null;
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
                <p>支持 JP / JPAG（0x55 XOR）/ CN、US（protected_nkpi）/ TW（繁体）四种格式的 PVF 解析</p>
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
            <div class="ivc-filterbar">
                <el-input v-model="searchQuery" placeholder="搜索物品ID(精确) / 物品名称 / 引用路径..." clearable size="small" class="ivc-search-input">
                    <template #prefix>
                        <svg class="ivc-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                    </template>
                </el-input>
                <el-cascader
                    v-model="filterCategoryPath"
                    :options="categoryCascaderOptions"
                    :props="categoryCascaderProps"
                    placeholder="类型 / 分类"
                    clearable
                    filterable
                    size="small"
                    popper-class="ivc-cascader-popper"
                    class="ivc-cascader"
                    title="类型 / 分类：装备按部位标签，堆叠物按背包入格分段" />
                <el-select v-model="filterRarity" placeholder="品质不限" clearable size="small" popper-class="ivc-select-popper" class="ivc-select ivc-select-rarity" title="品质">
                    <el-option v-for="(label, idx) in RARITY_LABELS" :key="idx" :label="label" :value="idx" />
                </el-select>
                <el-select v-model="filterSpecial" placeholder="细分不限" clearable size="small" popper-class="ivc-select-popper" class="ivc-select ivc-select-special" title="品质细分">
                    <el-option v-for="(label, key) in SPECIAL_LABELS" :key="key" :label="label" :value="key" />
                </el-select>
                <el-select v-model="filterExpiration" placeholder="期限不限" clearable size="small" popper-class="ivc-select-popper" class="ivc-select ivc-select-expiration" title="期限">
                    <el-option v-for="opt in EXPIRATION_OPTIONS" :key="opt.id" :label="opt.label" :value="opt.id" />
                </el-select>
                <div class="ivc-level-range" title="使用等级区间">
                    <el-input-number v-model="filterMinLevel" :min="0" :max="filterMaxLevel || undefined" placeholder="等级≥" controls-position="right" size="small" class="ivc-level" />
                    <span class="ivc-level-sep">~</span>
                    <el-input-number v-model="filterMaxLevel" :min="filterMinLevel || 0" placeholder="≤" controls-position="right" size="small" class="ivc-level" />
                </div>
                <button v-if="hasActiveFilter" type="button" class="ivc-filter-reset" @click="resetFilters">重置筛选</button>
                <span class="ivc-count">{{ filteredItems.length.toLocaleString() }} / {{ items.length.toLocaleString() }}</span>
            </div>
            <div class="ivc-list">
                <div class="ivc-head">
                    <span>物品ID</span>
                    <span>类型</span>
                    <span>分类</span>
                    <span>物品名称</span>
                    <span>品质</span>
                    <span>使用等级</span>
                    <span>期限</span>
                    <span>引用路径</span>
                </div>
                <div v-if="filteredItems.length" ref="listScrollEl" class="ivc-scroll" @scroll.passive="onListScroll">
                    <div class="ivc-spacer" :style="{ height: filteredItems.length * ROW_H + 'px' }"></div>
                    <div v-for="row in visibleRows" :key="row.no" class="ivc-row" :style="{ top: row.top + 'px' }">
                        <span class="ivc-code">{{ row.code }}</span>
                        <span class="ivc-type" :class="'type-' + row.type">{{ labelNameMap[row.type] }}</span>
                        <span class="ivc-category" :title="row.category">{{ row.categoryLabel === "-" ? "-" : row.categoryLabel }}</span>
                        <span class="ivc-name" :class="{ empty: !row.name }">{{ row.name || "-" }}</span>
                        <span class="ivc-rarity" :class="row.rarity >= 0 ? 'rarity-' + row.rarity : 'rarity-unknown'">
                            <template v-if="row.rarity >= 0">{{ RARITY_LABELS[row.rarity] || row.rarity }}</template>
                            <template v-else>-</template>
                            <span v-if="row.special" class="ivc-special" :title="SPECIAL_LABELS[row.special]">·{{ SPECIAL_LABELS[row.special] }}</span>
                        </span>
                        <span class="ivc-min-level" :class="{ empty: !row.minLevel }">{{ row.minLevel >= 0 ? row.minLevel : "-" }}</span>
                        <span class="ivc-expiration" :class="{ expired: row.expired, invalid: row.expiration && row.expiration.kind === 'invalid' }">{{ expirationText(row.expiration) }}</span>
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
.ivc-format-tw {
    color: #b57ef0;
    border-color: #b57ef055;
    background: #b57ef018;
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
/* ---- Toolbar + filter bar（合并单行：搜索 + 级联筛选） ---- */
.ivc-filterbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--surface-border);
    flex-shrink: 0;
    flex-wrap: wrap;
}
.ivc-count {
    flex-shrink: 0;
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-left: auto;
}
.ivc-filter {
    box-sizing: border-box;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    font-size: 0.75rem;
    outline: none;
    font-family: system-ui, sans-serif;
    max-width: 220px;
}
.ivc-filter:focus {
    border-color: var(--accent);
}
.ivc-level-range {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}
.ivc-level {
    width: 96px;
    max-width: 96px;
}
.ivc-level-sep {
    color: var(--text-muted);
    font-size: 0.75rem;
}
.ivc-filter-reset {
    padding: 4px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--accent);
    font-size: 0.75rem;
    cursor: pointer;
}
.ivc-filter-reset:hover {
    background: rgba(91, 140, 255, 0.1);
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
    grid-template-columns: 1.3fr 1fr 1.6fr 2.6fr 1.7fr 1.1fr 1.6fr 2.6fr;
    gap: 10px;
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
/* 分类列（装备部位标签 / 堆叠物背包分段） */
.ivc-category {
    color: var(--text-muted);
    font-size: 0.74rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
/* 品质细分角标（传承/领主神器/魔法封印） */
.ivc-special {
    font-size: 0.68rem;
    opacity: 0.85;
}
/* 期限列 */
.ivc-expiration {
    color: var(--text);
    font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
    font-size: 0.72rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ivc-expiration.expired {
    color: var(--text-muted);
    text-decoration: line-through;
}
.ivc-expiration.invalid {
    color: #ff7373;
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

<!-- el-cascader 输入框 + 下拉面板主题化：非 scoped 全局样式（.el-cascader.ivc-cascader / .ivc-cascader-popper 前缀限定），
     直接覆盖 .el-input__wrapper 背景，避免 element-plus 默认白底 -->
<style>
/* 搜索框（el-input）：深色主题 + flex 伸展 */
.el-input.ivc-search-input {
    flex: 1 1 140px;
    min-width: 140px;
    --el-input-bg-color: var(--bg);
    --el-input-border-color: var(--border);
    --el-input-hover-border-color: var(--accent);
    --el-input-focus-border-color: var(--accent);
    --el-input-text-color: var(--text);
    --el-input-placeholder-color: var(--text-muted);
    --el-input-icon-color: var(--text-muted);
    --el-input-clear-hover-color: var(--accent);
    --el-input-focus-bg-color: var(--bg);
    --el-input-fill-color: var(--bg);
}
.el-input.ivc-search-input .el-input__wrapper {
    background-color: var(--bg) !important;
    box-shadow: 0 0 0 1px var(--border) inset;
    border-radius: 6px;
    padding: 0 8px;
}
.el-input.ivc-search-input .el-input__inner {
    font-size: 0.75rem;
    color: var(--text) !important;
    height: 24px;
    line-height: 24px;
}
.el-input.ivc-search-input .el-input__inner::placeholder {
    color: var(--text-muted);
}
.el-input.ivc-search-input .el-input__wrapper:hover,
.el-input.ivc-search-input .el-input__wrapper.is-focus {
    box-shadow: 0 0 0 1px var(--accent) inset;
    background-color: var(--bg) !important;
}
.el-input.ivc-search-input .el-input__prefix {
    color: var(--text-muted);
    margin-right: 4px;
}
.el-input.ivc-search-input .ivc-search-icon {
    width: 14px;
    height: 14px;
    display: block;
}
.el-input.ivc-search-input .el-input__wrapper.is-focus .el-input__prefix {
    color: var(--accent);
}

/* 等级区间（el-input-number）：深色主题 + 固定宽度 */
.el-input-number.ivc-level {
    width: 96px;
    flex-shrink: 0;
    --el-input-bg-color: var(--bg);
    --el-input-border-color: var(--border);
    --el-input-hover-border-color: var(--accent);
    --el-input-focus-border-color: var(--accent);
    --el-input-text-color: var(--text);
    --el-input-placeholder-color: var(--text-muted);
    --el-input-icon-color: var(--text-muted);
    --el-input-clear-hover-color: var(--accent);
    --el-input-focus-bg-color: var(--bg);
    --el-input-fill-color: var(--bg);
    --el-input-number-controls-width: 22px;
}
.el-input-number.ivc-level .el-input__wrapper {
    background-color: var(--bg) !important;
    box-shadow: 0 0 0 1px var(--border) inset;
    border-radius: 6px;
    padding: 0 8px;
}
.el-input-number.ivc-level .el-input__inner {
    font-size: 0.75rem;
    color: var(--text) !important;
    height: 24px;
    line-height: 24px;
}
.el-input-number.ivc-level .el-input__inner::placeholder {
    color: var(--text-muted);
}
.el-input-number.ivc-level .el-input__wrapper:hover,
.el-input-number.ivc-level .el-input__wrapper.is-focus {
    box-shadow: 0 0 0 1px var(--accent) inset;
    background-color: var(--bg) !important;
}
.el-input-number.ivc-level .el-input-number__increase,
.el-input-number.ivc-level .el-input-number__decrease {
    background: var(--bg-2);
    color: var(--text-muted);
    border-color: var(--border);
}
.el-input-number.ivc-level .el-input-number__increase:hover,
.el-input-number.ivc-level .el-input-number__decrease:hover {
    color: var(--accent);
}
.el-input-number.ivc-level .el-input-number__increase.is-disabled,
.el-input-number.ivc-level .el-input-number__decrease.is-disabled {
    color: var(--text-muted);
    opacity: 0.4;
}

/* 输入框：变量覆盖 + 直写背景双保险（el-cascader + el-select 共用） */
.el-cascader.ivc-cascader,
.el-select.ivc-select {
    flex-shrink: 0;
    --el-input-bg-color: var(--bg);
    --el-input-border-color: var(--border);
    --el-input-hover-border-color: var(--accent);
    --el-input-focus-border-color: var(--accent);
    --el-input-text-color: var(--text);
    --el-input-placeholder-color: var(--text-muted);
    --el-input-icon-color: var(--text-muted);
    --el-input-clear-hover-color: var(--accent);
    --el-input-focus-bg-color: var(--bg);
    --el-input-fill-color: var(--bg);
}
.el-cascader.ivc-cascader,
.el-select.ivc-select-rarity,
.el-select.ivc-select-special,
.el-select.ivc-select-expiration {
    width: 140px;
}
.el-cascader.ivc-cascader .el-input__wrapper {
    background-color: var(--bg) !important;
    box-shadow: 0 0 0 1px var(--border) inset;
    border-radius: 6px;
    padding: 0 8px;
}
.el-cascader.ivc-cascader .el-input__inner {
    font-size: 0.75rem;
    color: var(--text) !important;
    height: 24px;
    line-height: 24px;
}
.el-cascader.ivc-cascader .el-input__inner::placeholder {
    color: var(--text-muted);
}
.el-cascader.ivc-cascader .el-input__wrapper:hover,
.el-cascader.ivc-cascader .el-input__wrapper.is-focus {
    box-shadow: 0 0 0 1px var(--accent) inset;
    background-color: var(--bg) !important;
}
.el-cascader.ivc-cascader .el-input__wrapper.is-focus .el-input__suffix,
.el-cascader.ivc-cascader .el-input__wrapper.is-focus .el-input__icon {
    color: var(--accent);
}

/* el-select 专属输入容器（element-plus 2.x 为 .el-select__wrapper，非 .el-input__wrapper） */
.el-select.ivc-select .el-select__wrapper {
    background-color: var(--bg) !important;
    box-shadow: 0 0 0 1px var(--border) inset;
    border-radius: 6px;
    padding: 0 8px;
}
.el-select.ivc-select .el-select__wrapper:hover:not(.is-focused),
.el-select.ivc-select .el-select__wrapper.is-focused {
    box-shadow: 0 0 0 1px var(--accent) inset;
    background-color: var(--bg) !important;
}
.el-select.ivc-select .el-select__selected-item {
    color: var(--text);
    font-size: 0.75rem;
}
.el-select.ivc-select .el-select__placeholder {
    color: var(--text-muted);
    font-size: 0.75rem;
}
.el-select.ivc-select .el-select__input {
    color: var(--text);
    font-size: 0.75rem;
    height: 24px;
    line-height: 24px;
}
.el-select.ivc-select .el-select__suffix {
    color: var(--text-muted);
}
.el-select.ivc-select .el-select__wrapper.is-focused .el-select__suffix {
    color: var(--accent);
}

/* el-select 下拉面板：popper-class 实际加在 .el-popper 根上（el-select__popper ivc-select-popper），
   .el-select-dropdown 是其内部子元素。背景/边框/箭头由 .el-popper.is-light 的
   --el-popper-bg-color-light / --el-border-color-light 控制，与级联（cascader popper）一致。 */
.ivc-select-popper.el-popper {
    --el-popper-bg-color-light: var(--bg-2);
    --el-bg-color-overlay: var(--bg-2);
    --el-bg-color: var(--bg-2);
    --el-text-color-primary: var(--text);
    --el-text-color-regular: var(--text);
    --el-text-color-secondary: var(--text-muted);
    --el-border-color-light: var(--surface-border);
    --el-border-color-lighter: var(--divider);
    --el-fill-color-light: rgba(91, 140, 255, 0.1);
    --el-color-primary: var(--accent);
    background: var(--bg-2);
    border: 1px solid var(--surface-border);
    box-shadow: var(--shadow-card);
}
.ivc-select-popper .el-select-dropdown__item {
    color: var(--text);
    font-size: 0.75rem;
}
.ivc-select-popper .el-select-dropdown__item:hover {
    background: var(--el-fill-color-light);
}
.ivc-select-popper .el-select-dropdown__item.is-selected {
    color: var(--accent);
    font-weight: 600;
}

/* 下拉面板（teleport 到 body）：深色贴合当前主题，类名经 popper-class 限定不全局污染 */
.ivc-cascader-popper.el-popper {
    --el-bg-color-overlay: var(--bg-2);
    --el-bg-color: var(--bg-2);
    --el-text-color-primary: var(--text);
    --el-text-color-regular: var(--text);
    --el-text-color-secondary: var(--text-muted);
    --el-text-color-placeholder: var(--text-muted);
    --el-border-color-light: var(--surface-border);
    --el-border-color-lighter: var(--divider);
    --el-fill-color: rgba(91, 140, 255, 0.16);
    --el-fill-color-light: rgba(91, 140, 255, 0.1);
    --el-fill-color-lighter: rgba(91, 140, 255, 0.08);
    --el-fill-color-blank: transparent;
    --el-color-primary: var(--accent);
    background: var(--bg-2);
    border: 1px solid var(--surface-border);
    box-shadow: var(--shadow-card);
}
.ivc-cascader-popper .el-cascader-menu {
    border-color: var(--divider);
}
.ivc-cascader-popper .el-cascader-node {
    color: var(--text);
    font-size: 0.75rem;
}
.ivc-cascader-popper .el-cascader-node:hover,
.ivc-cascader-popper .el-cascader-node.in-active-path {
    background: var(--el-fill-color-light);
}
.ivc-cascader-popper .el-cascader-node.is-active,
.ivc-cascader-popper .el-cascader-node.is-selectable.in-checked-path {
    background: var(--el-fill-color);
    color: var(--accent);
}
.ivc-cascader-popper .el-cascader-node__prefix,
.ivc-cascader-popper .el-cascader-node__postfix {
    color: var(--text-muted);
}
.ivc-cascader-popper .el-cascader__suggestion-panel {
    background: var(--bg-2);
}
.ivc-cascader-popper .el-cascader__suggestion-item {
    color: var(--text);
    font-size: 0.75rem;
}
.ivc-cascader-popper .el-cascader__suggestion-item:hover,
.ivc-cascader-popper .el-cascader__suggestion-item:focus {
    background: var(--el-fill-color-light);
}
.ivc-cascader-popper .el-scrollbar__thumb {
    background-color: rgba(255, 255, 255, 0.15);
}
.ivc-cascader-popper .el-scrollbar__thumb:hover {
    background-color: rgba(255, 255, 255, 0.25);
}
</style>
