<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { alertModal, confirmModal } from "@/hooks/useModal";
import { ElInput, ElInputNumber, ElSelect, ElOption, ElSwitch, ElTree } from "element-plus";
import { NPK_FORMATS, parseNpk, readImgEntry, readImgFull, decodeFrameToPng, encodeFrameFromRgba, encodeImg, encodeNpk, encodeBmp } from "@/utils/npkTool.js";

const FORMAT_KEY = "launch-helper:npk-format";
const PLAY_KEY = "launch-helper:npk-play-interval";
const PLAY_MODE_KEY = "launch-helper:npk-play-mode";

const router = useRouter();

const archive = ref(null); // { entries: [{ name, offset, size }], count }
const rawBuffer = ref(null); // ArrayBuffer（解码时用）
const fileName = ref("");
const formatId = ref(localStorage.getItem(FORMAT_KEY) || "jp");
const loading = ref(false);
const loadingMessage = ref("");
const error = ref("");
const selected = ref(null); // 当前选中条目
const imgInfo = ref(null); // { frames: [...] } 当前条目 IMG 帧
const frameIndex = ref(0); // 当前预览帧号（0 基）
const framePng = ref(null); // 当前帧 PNG DataURL
const frameError = ref("");
const frameLoading = ref(false);
const frameSize = ref(null); // 当前帧实际像素尺寸 { w, h }（用于辅助虚线定位）
const autoPlay = ref(true); // 自动播放（默认开启）
const playInterval = ref(Number(localStorage.getItem(PLAY_KEY)) || 100); // 帧切换间隔(ms)
const playMode = ref(localStorage.getItem(PLAY_MODE_KEY) || "once"); // 播放模式：loop 无限重复 / once 播放一次
const playedOnce = new Set(); // once 模式下已完整播放过的条目（entry.offset）
let playTimer = null;

// ---- 编辑 / 保存状态（参考 ExtractorSharp 操作逻辑） ----
const dirty = ref(false); // 是否有未保存的修改
const dirtyCount = ref(0); // 已修改条目数
const editedNames = new Set(); // 已修改的条目名（保存时应用）
const replaceMenu = ref(false); // 「替换当前帧」菜单展开
const importMenu = ref(false); // 「导入 IMG」菜单展开
const exportMenu = ref(false); // 「导出」菜单展开
const replaceFormat = ref("keep"); // 替换目标格式：keep / 0x0e / 0x0f / 0x10
const exportFormat = ref("png"); // 导出格式：png / bmp / jpeg / webp
const imgInputEl = ref(null); // 替换当前帧用的文件 input
const importInputEl = ref(null); // 导入 IMG 用的文件 input
const importTargetEl = ref(null); // 导入 IMG 的目标条目（点击导入时设置）

// 帧替换格式下拉选项（保持原有格式）
const REPLACE_FORMATS = [
    { value: "keep", label: "保持原格式" },
    { value: "0x0e", label: "ARGB1555" },
    { value: "0x0f", label: "ARGB4444" },
    { value: "0x10", label: "ARGB8888" }
];

// 导出格式选项（多格式贴图）
const EXPORT_FORMATS = [
    { value: "png", label: "PNG" },
    { value: "bmp", label: "BMP" },
    { value: "jpeg", label: "JPEG" },
    { value: "webp", label: "WebP" }
];

// 当前所选加解密算法的显示名（联动顶栏下拉）
const currentFormatLabel = computed(() => {
    const f = NPK_FORMATS.find(x => x.id === formatId.value) || NPK_FORMATS[0];
    return f ? f.label : formatId.value.toUpperCase();
});

// 像素画布：原点在左上角，X 向右 / Y 向下，1 图像像素 = 1 CSS px
const MAJOR_STEP = 50; // 主刻度（含数字）间隔(px)
const MINOR_STEP = 10; // 次刻度间隔(px)
const RULER_W = 36; // Y 轴标尺宽度（容纳刻度数字）
const RULER_H = 24; // X 轴标尺高度（容纳刻度数字）

// 画布尺寸自适应预览窗口：用 ResizeObserver 测量
const canvasEl = ref(null);
const canvasSize = ref({ w: 0, h: 0 });
let canvasResizeObserver = null;

function measureCanvas() {
    const el = canvasEl.value;
    if (el) canvasSize.value = { w: el.clientWidth, h: el.clientHeight };
}

function setupCanvasObserver() {
    measureCanvas();
    if (typeof ResizeObserver === "undefined" || canvasResizeObserver) return;
    canvasResizeObserver = new ResizeObserver(measureCanvas);
    if (canvasEl.value) canvasResizeObserver.observe(canvasEl.value);
}

// 刻度数组：按固定间距铺满画布尺寸（扣除标尺占位，不随图片变化）
const xTicks = computed(() => {
    const w = Math.max(0, canvasSize.value.w - RULER_W);
    const arr = [];
    for (let i = 0; i <= w; i += MINOR_STEP) arr.push({ pos: i, major: i % MAJOR_STEP === 0 });
    return arr;
});
const yTicks = computed(() => {
    const h = Math.max(0, canvasSize.value.h - RULER_H);
    const arr = [];
    for (let i = 0; i <= h; i += MINOR_STEP) arr.push({ pos: i, major: i % MAJOR_STEP === 0 });
    return arr;
});

// 条目搜索
const searchQuery = ref("");
const treeRef = ref(null);

// 构建树节点：每个 .img 条目附带其帧子节点（kind: img / frame / dir）
let nodeIdSeq = 0;
function buildTree(entries, buffer) {
    const root = [];
    const map = {};
    for (const entry of entries) {
        const parts = entry.name.split("/");
        let cur = root;
        let path = "";
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            path = path ? path + "/" + part : part;
            const isImg = i === parts.length - 1 && part.toLowerCase().endsWith(".img");
            if (isImg) {
                const frameNodes = [];
                try {
                    const info = readImgEntry(new Uint8Array(buffer), entry);
                    info.frames.forEach((f, fi) => {
                        frameNodes.push({
                            id: `f-${entry.offset}-${fi}`,
                            label: `${fi + 1}帧(${f.width}×${f.height})`,
                            path: path + `#${fi}`,
                            kind: "frame",
                            entry,
                            frame: fi,
                            meta: f
                        });
                    });
                } catch (e) {
                    // 非 IMG 或解析失败：不生成帧子节点
                }
                // img 节点默认收起（帧详情不展开）
                cur.push({ id: ++nodeIdSeq, label: part, path, kind: "img", entry, children: frameNodes, defaultExpanded: false });
            } else {
                let node = map[path];
                if (!node) {
                    node = { id: ++nodeIdSeq, label: part, path, kind: "dir", children: [] };
                    map[path] = node;
                    cur.push(node);
                }
                cur = node.children;
            }
        }
    }
    return root;
}

// 搜索过滤：扁平化树，只保留匹配条目及其祖先路径
function filterTree(nodes, q) {
    const out = [];
    for (const n of nodes) {
        if (n.kind === "frame") {
            if (!q || (n.entry && n.entry.name.toLowerCase().includes(q))) out.push(n);
        } else if (n.kind === "img") {
            if (!q || n.entry.name.toLowerCase().includes(q)) {
                out.push({ ...n, children: q ? filterTree(n.children, q) : n.children });
            }
        } else {
            const filtered = filterTree(n.children, q);
            if (filtered.length) {
                out.push({ ...n, children: filtered });
            } else if (q && n.label.toLowerCase().includes(q)) {
                out.push(n);
            }
        }
    }
    return out;
}

const treeData = computed(() => {
    const entries = archive.value ? archive.value.entries : [];
    const buffer = rawBuffer.value;
    const q = searchQuery.value.trim().toLowerCase();
    nodeIdSeq = 0;
    if (!buffer) return [];
    const tree = buildTree(entries, buffer);
    if (!q) return tree;
    return filterTree(tree, q);
});

// 默认展开的文件夹节点 id（img 节点不展开）
const defaultExpandedKeys = computed(() => {
    const keys = [];
    const walk = nodes => {
        for (const node of nodes) {
            if (node.kind === "dir") {
                keys.push(node.id);
                if (node.children) walk(node.children);
            }
        }
    };
    walk(treeData.value);
    return keys;
});

// 当前可见 .img 条目数量
const leafCount = computed(() => {
    let n = 0;
    const walk = nodes => {
        for (const node of nodes) {
            if (node.kind === "img") n++;
            else if (node.children) walk(node.children);
        }
    };
    walk(treeData.value);
    return n;
});

function onTreeNodeClick(data) {
    if (data.kind === "frame" && data.entry) selectEntry(data.entry, data.frame);
    else if (data.kind === "img" && data.entry) selectEntry(data.entry, 0);
}

// 搜索时展开全部文件夹节点，并高亮当前选中项
watch(searchQuery, () => {
    nextTick(() => {
        const tree = treeRef.value;
        if (!tree) return;
        const expandDirs = nodes => {
            for (const n of nodes) {
                if (n.kind === "dir" && n.children && n.children.length) {
                    const node = tree.getNode(n.id);
                    if (node) node.expanded = true;
                    expandDirs(n.children);
                } else if (n.kind === "img" && n.children && n.children.length) {
                    expandDirs(n.children);
                }
            }
        };
        expandDirs(treeData.value);
        expandSelected();
    });
});

// 树数据变化（加载文件 / 切换格式）后，默认展开文件夹
watch(treeData, () => {
    nextTick(() => {
        const tree = treeRef.value;
        if (!tree) return;
        const expandDirs = nodes => {
            for (const n of nodes) {
                if (n.kind === "dir" && n.children && n.children.length) {
                    const node = tree.getNode(n.id);
                    if (node) node.expanded = true;
                    expandDirs(n.children);
                }
            }
        };
        expandDirs(treeData.value);
    });
});

function goBack() {
    router.push({ name: "Game" });
}

async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = "";
    await loadNpk(file);
}

async function loadNpk(file) {
    loading.value = true;
    loadingMessage.value = "读取文件中...";
    error.value = "";
    selected.value = null;
    imgInfo.value = null;
    framePng.value = null;
    frameError.value = "";
    frameSize.value = null;
    resetEditState();
    try {
        const buffer = await file.arrayBuffer();
        loadingMessage.value = `正在解析 NPK（${formatId.value.toUpperCase()} 加解密）...`;
        const parsed = parseNpk(new Uint8Array(buffer), formatId.value);
        rawBuffer.value = buffer;
        archive.value = parsed;
        fileName.value = file.name;
        searchQuery.value = "";
    } catch (err) {
        rawBuffer.value = null;
        archive.value = null;
        fileName.value = "";
        error.value = (err && err.message) || "加载失败，请确认选择的是有效的 NPK 文件。";
    } finally {
        loading.value = false;
    }
}

// 重置编辑状态（加载新文件 / 切换加解密 / 保存后）
function resetEditState() {
    editedNames.clear();
    dirty.value = false;
    dirtyCount.value = 0;
    replaceMenu.value = false;
    importMenu.value = false;
    exportMenu.value = false;
    importTargetEl.value = null;
}

// 切换加解密算法：重新解析当前文件
async function onFormatChange() {
    localStorage.setItem(FORMAT_KEY, formatId.value);
    if (!rawBuffer.value || !fileName.value) return;
    if (dirty.value) {
        const ok = await confirmModal({ title: "丢弃修改", message: "当前存在未保存的修改，切换加解密将丢弃这些修改。确定继续？" });
        if (!ok) return;
    }
    loading.value = true;
    loadingMessage.value = `正在解析 NPK（${formatId.value.toUpperCase()} 加解密）...`;
    error.value = "";
    selected.value = null;
    imgInfo.value = null;
    framePng.value = null;
    frameError.value = "";
    frameSize.value = null;
    resetEditState();
    try {
        const parsed = parseNpk(new Uint8Array(rawBuffer.value), formatId.value);
        archive.value = parsed;
    } catch (err) {
        error.value = (err && err.message) || "当前格式解析失败。";
    } finally {
        loading.value = false;
    }
}

// ---------------------------------------------------------------------------
// 编辑能力（参考 ExtractorSharp：替换帧 → 重新编码 → 保存）
// 加解密算法保持不变：替换帧仅重编码 IMG 内部像素，保存沿用原有 XOR 加密。
// ---------------------------------------------------------------------------

// 读取本地图片文件为 RGBA（缩放到目标尺寸，保持透明 alpha）
// 优先 createImageBitmap；老浏览器回退 object URL + Image
async function readImageFileToRgba(file, targetW, targetH) {
    const canvas = document.createElement("canvas");
    canvas.width = targetW || 0;
    canvas.height = targetH || 0;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let bitmap = null;
    try {
        if (typeof createImageBitmap === "function") {
            bitmap = await createImageBitmap(file);
            canvas.width = targetW || bitmap.width;
            canvas.height = targetH || bitmap.height;
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            if (bitmap.close) bitmap.close();
        } else {
            const url = URL.createObjectURL(file);
            try {
                const img = new Image();
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = () => reject(new Error("图片加载失败"));
                    img.src = url;
                });
                canvas.width = targetW || img.naturalWidth;
                canvas.height = targetH || img.naturalHeight;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            } finally {
                URL.revokeObjectURL(url);
            }
        }
    } finally {
        if (bitmap && bitmap.close) bitmap.close();
    }
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

// 整体重建 NPK 内存缓冲：替换指定条目数据 → encodeNpk → 更新 rawBuffer 并重解析。
// 每次编辑后调用，保证预览与最终保存的字节一致（参考 ExtractorSharp WriteNpk 模型）。
async function rebuildNpk(replaceMap) {
    const u8 = new Uint8Array(rawBuffer.value);
    const entries = archive.value.entries.map(e => {
        const repl = replaceMap.get(e.name);
        if (repl) return { name: e.name, data: repl };
        return { name: e.name, data: u8.subarray(e.offset, e.offset + e.size) };
    });
    const npkBytes = await encodeNpk(entries);
    rawBuffer.value = npkBytes.buffer.slice(npkBytes.byteOffset, npkBytes.byteOffset + npkBytes.byteLength);
    const parsed = parseNpk(new Uint8Array(rawBuffer.value), formatId.value);
    archive.value = parsed;
    return parsed;
}

// 标记条目已修改（dirty 指示 + 保存）
function markEdited(entryName) {
    editedNames.add(entryName);
    dirty.value = true;
    dirtyCount.value = editedNames.size;
}

// 替换当前帧为 RGBA 像素（参考 ExtractorSharp：替换 → 重编码 → 保存）
async function commitFrameReplace(rgba, width, height, type, meta) {
    const entry = selected.value;
    const entryName = entry.name;
    const targetFrameIndex = frameIndex.value;
    const newFrame = await encodeFrameFromRgba(rgba, width, height, type, meta.keyX, meta.keyY, meta.maxWidth, meta.maxHeight);
    const u8 = new Uint8Array(rawBuffer.value);
    const full = readImgFull(u8, entry);
    // readImgFull 的像素帧仅含 pixelOffset（无 pixelData），encodeImg 需要逐帧 pixelData，
    // 未替换帧需从原始 buffer 提取（对齐 importImgFile 的规范化重建）
    const frames = full.frames.map((f, i) => {
        if (i === targetFrameIndex) return newFrame;
        if (f.type === 0x11) return f;
        return {
            type: f.type,
            compression: f.compression,
            width: f.width,
            height: f.height,
            size: f.size,
            keyX: f.keyX,
            keyY: f.keyY,
            maxWidth: f.maxWidth,
            maxHeight: f.maxHeight,
            pixelData: u8.subarray(f.pixelOffset, f.pixelOffset + f.size)
        };
    });
    const imgBytes = await encodeImg(frames);
    loading.value = true;
    loadingMessage.value = "正在重建 NPK...";
    try {
        const parsed = await rebuildNpk(new Map([[entryName, imgBytes]]));
        markEdited(entryName);
        // 重新选中同一条目并刷新预览（旧 entry 引用已失效）
        const newEntry = parsed.entries.find(e => e.name === entryName);
        await selectEntry(newEntry, targetFrameIndex);
        alertModal({ title: "替换完成", message: `已替换第 ${targetFrameIndex + 1} 帧（${formatLabel(type)}）。` });
    } catch (err) {
        alertModal({ title: "替换失败", message: (err && err.message) || "替换帧失败。" });
    } finally {
        loading.value = false;
    }
}

// 替换当前帧入口（本地图片 → RGBA → 重编码）
async function replaceCurrentFrame(file) {
    if (!file) return;
    if (!selected.value || !imgInfo.value || !currentFrameMeta.value) {
        alertModal({ title: "无法替换", message: "请先选择一个可编辑的像素帧。" });
        return;
    }
    const meta = currentFrameMeta.value;
    if (meta.type === 0x11) {
        alertModal({ title: "无法替换", message: "链接帧不可替换，请选择像素帧。" });
        return;
    }
    try {
        let type = meta.type;
        if (replaceFormat.value !== "keep") type = parseInt(replaceFormat.value, 16);
        const rgba = await readImageFileToRgba(file, meta.width, meta.height);
        await commitFrameReplace(rgba, meta.width, meta.height, type, meta);
    } catch (err) {
        alertModal({ title: "替换失败", message: (err && err.message) || "替换帧失败。" });
    } finally {
        replaceMenu.value = false;
        if (imgInputEl.value) imgInputEl.value.value = "";
    }
}

// 保存：rawBuffer 已是每次编辑后重建的完整合法 NPK，直接导出下载。
// 加解密算法保持不变（沿用原有 XOR 名称加密与头部/SHA256 布局）。
function saveNpk() {
    if (!dirty.value) {
        alertModal({ title: "无修改", message: "当前没有未保存的修改。" });
        return;
    }
    try {
        const npkBytes = new Uint8Array(rawBuffer.value);
        const blob = new Blob([npkBytes], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName.value.replace(/\.npk$/i, "") + ".npk";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        editedNames.clear();
        dirty.value = false;
        dirtyCount.value = 0;
        alertModal({ title: "保存完成", message: "已生成保存文件（下载中）。" });
    } catch (err) {
        alertModal({ title: "保存失败", message: (err && err.message) || "保存失败。" });
    }
}

// 导出当前帧为多格式贴图（PNG / JPEG / WebP / BMP）
async function exportFrameAs(format) {
    if (!framePng.value) {
        alertModal({ title: "无法导出", message: "当前没有可导出的帧。" });
        return;
    }
    try {
        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error("图片加载失败"));
            img.src = framePng.value;
        });
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const base = (selected.value ? selected.value.name.replace(/\.img$/i, "") : "frame") + `_${frameIndex.value + 1}`;
        let blob;
        if (format === "bmp") {
            // BMP：手写编码（浏览器 image/bmp 已移除）
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const bmpBytes = encodeBmp(canvas.width, canvas.height, imgData.data);
            blob = new Blob([bmpBytes], { type: "image/bmp" });
        } else {
            const mime = format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
            const dataUrl = canvas.toDataURL(mime, 0.92);
            const res = await fetch(dataUrl);
            blob = await res.blob();
        }
        const ext = format === "jpeg" ? "jpg" : format;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${base}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        alertModal({ title: "导出完成", message: `已导出 ${ext.toUpperCase()}。` });
    } catch (err) {
        alertModal({ title: "导出失败", message: (err && err.message) || "导出失败。" });
    } finally {
        exportMenu.value = false;
    }
}

// 导出整个 IMG（当前条目 .img 字节）
function exportCurrentImg() {
    if (!selected.value) {
        alertModal({ title: "无法导出", message: "请先选择一个 IMG。" });
        return;
    }
    const u8 = new Uint8Array(rawBuffer.value);
    const data = u8.subarray(selected.value.offset, selected.value.offset + selected.value.size);
    const blob = new Blob([data], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = selected.value.name.split("/").pop() || "image.img";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    alertModal({ title: "导出完成", message: "已导出 IMG。" });
    exportMenu.value = false;
}

// 导入 .img 文件替换指定条目
async function importImgFile(file) {
    if (!file) return;
    const entry = importTargetEl.value;
    if (!entry) {
        alertModal({ title: "无法导入", message: "请先选择一个要替换的 IMG 条目。" });
        return;
    }
    try {
        const buffer = await file.arrayBuffer();
        const u8 = new Uint8Array(buffer);
        const magic = String.fromCharCode.apply(null, Array.from(u8.subarray(0, 15)));
        if (magic !== "Neople Img File") {
            alertModal({ title: "导入失败", message: "所选文件不是有效的 IMG 文件。" });
            return;
        }
        // 读取导入 IMG 帧结构并规范化重建（保持帧定义）
        const tmp = { name: entry.name, offset: 0, size: buffer.byteLength };
        const full = readImgFull(u8, tmp);
        const frames = full.frames.map(f => {
            if (f.type === 0x11) return f;
            return {
                type: f.type,
                compression: f.compression,
                width: f.width,
                height: f.height,
                size: f.size,
                keyX: f.keyX,
                keyY: f.keyY,
                maxWidth: f.maxWidth,
                maxHeight: f.maxHeight,
                pixelData: u8.subarray(f.pixelOffset, f.pixelOffset + f.size)
            };
        });
        const imgBytes = await encodeImg(frames);
        loading.value = true;
        loadingMessage.value = "正在重建 NPK...";
        try {
            const parsed = await rebuildNpk(new Map([[entry.name, imgBytes]]));
            markEdited(entry.name);
            alertModal({ title: "导入完成", message: `已导入 IMG 替换「${entry.name}」。` });
            // 若替换的是当前选中条目，刷新预览
            if (selected.value && selected.value.name === entry.name) {
                const newEntry = parsed.entries.find(e => e.name === entry.name);
                await selectEntry(newEntry, 0);
            }
        } finally {
            loading.value = false;
        }
    } catch (err) {
        alertModal({ title: "导入失败", message: (err && err.message) || "导入 IMG 失败。" });
    } finally {
        importMenu.value = false;
        if (importInputEl.value) importInputEl.value.value = "";
    }
}

// 选择导入目标：点击「导入 IMG」时记录目标条目并打开文件选择器
function pickImportTarget(entry) {
    importTargetEl.value = entry;
    importMenu.value = false;
    if (importInputEl.value) importInputEl.value.click();
}

async function selectEntry(entry, frameIdx = 0) {
    stopPlay();
    selected.value = entry;
    frameIndex.value = 0;
    framePng.value = null;
    frameError.value = "";
    imgInfo.value = null;
    try {
        imgInfo.value = readImgEntry(new Uint8Array(rawBuffer.value), entry);
        if (!imgInfo.value.frames.length) {
            frameError.value = "该 IMG 无可用像素帧（可能全为链接帧）。";
            return;
        }
        await renderFrame(Math.min(frameIdx, imgInfo.value.frames.length - 1));
        if (autoPlay.value) startPlay();
    } catch (err) {
        frameError.value = (err && err.message) || "该文件不是可预览的 IMG。";
    }
}

async function renderFrame(idx) {
    if (!imgInfo.value || !imgInfo.value.frames.length) return;
    const frame = imgInfo.value.frames[idx];
    if (!frame) return;
    frameLoading.value = true;
    frameError.value = "";
    try {
        const png = await decodeFrameToPng(new Uint8Array(rawBuffer.value), selected.value, idx);
        const blob = new Blob([png], { type: "image/png" });
        const url = URL.createObjectURL(blob);
        framePng.value = url;
        frameIndex.value = idx;
        // 记录解码后画布尺寸（decodeFrameToPng 输出 maxWidth×maxHeight，快速路径为帧尺寸）
        const canvasW = frame.maxWidth > 0 ? frame.maxWidth : frame.width;
        const canvasH = frame.maxHeight > 0 ? frame.maxHeight : frame.height;
        frameSize.value = { w: canvasW, h: canvasH };
        nextTick(() => {
            setupCanvasObserver();
            syncTreeSelection(idx);
        });
    } catch (err) {
        frameError.value = (err && err.message) || "帧解码失败。";
    } finally {
        frameLoading.value = false;
    }
}

// 图片加载完成后用实际自然尺寸校准 frameSize（精确辅助虚线定位）
function onImgLoad(e) {
    const img = e.target;
    if (img && img.naturalWidth && img.naturalHeight) {
        frameSize.value = { w: img.naturalWidth, h: img.naturalHeight };
    }
}

// 同步左侧树高亮到当前帧节点（播放时跟随）
function syncTreeSelection(idx) {
    const tree = treeRef.value;
    if (!tree || !selected.value) return;
    const key = `f-${selected.value.offset}-${idx}`;
    if (tree.getNode(key)) {
        tree.setCurrentKey(key);
    } else {
        // 帧节点可能被过滤，至少高亮所属 img 节点
        const imgNode = treeData.value && findImgNode(treeData.value, selected.value);
        if (imgNode) tree.setCurrentKey(imgNode.id);
    }
}
function findImgNode(nodes, entry) {
    for (const n of nodes) {
        if (n.kind === "img" && n.entry === entry) return n;
        if (n.children) {
            const r = findImgNode(n.children, entry);
            if (r) return r;
        }
    }
    return null;
}

// 自动播放
function startPlay() {
    stopPlay();
    if (!imgInfo.value || imgInfo.value.frames.length <= 1) return;
    // once 模式下已完整播放过的条目不再自动播放（仅停留在所选帧）
    if (playMode.value === "once" && selected.value && playedOnce.has(selected.value.offset)) return;
    if (playMode.value === "once" && frameIndex.value >= imgInfo.value.frames.length - 1) return;
    playTimer = setInterval(() => {
        const total = imgInfo.value.frames.length;
        let next = frameIndex.value + 1;
        if (playMode.value === "once") {
            if (next >= total) {
                // 完整播放结束：标记该条目，后续再次点击不再自动播放
                if (selected.value) playedOnce.add(selected.value.offset);
                stopPlay();
                return;
            }
        } else {
            next %= total;
        }
        renderFrame(next);
    }, playInterval.value);
}
function stopPlay() {
    if (playTimer !== null) {
        clearInterval(playTimer);
        playTimer = null;
    }
}
function onAutoPlayChange(val) {
    if (val) startPlay();
    else {
        // 关闭自动播放时重置标记，允许下次重新播放
        playedOnce.clear();
        stopPlay();
    }
}

// 调整播放间隔：持久化；若正在播放则立即按新间隔重启
function onPlayIntervalChange(val) {
    if (!val || val < 20) return;
    localStorage.setItem(PLAY_KEY, String(val));
    if (autoPlay.value && playTimer !== null) {
        stopPlay();
        startPlay();
    }
}

// 调整播放模式：持久化；若正在播放则立即按新模式重启
function onPlayModeChange(val) {
    localStorage.setItem(PLAY_MODE_KEY, val);
    playedOnce.clear(); // 切换模式后允许重新播放
    if (autoPlay.value) {
        stopPlay();
        startPlay();
    }
}

const currentFrameMeta = computed(() => {
    if (!imgInfo.value || !imgInfo.value.frames.length) return null;
    return imgInfo.value.frames[frameIndex.value] || null;
});

function formatLabel(type) {
    switch (type) {
        case 0x0e:
            return "ARGB1555";
        case 0x0f:
            return "ARGB4444";
        case 0x10:
            return "ARGB8888";
        default:
            return `0x${(type >>> 0).toString(16).toUpperCase()}`;
    }
}

// 搜索后尝试展开/选中当前条目所在节点
function expandSelected() {
    if (!selected.value || !treeRef.value) return;
    const find = nodes => {
        for (const n of nodes) {
            if (n.entry === selected.value) return [n];
            if (n.children) {
                const r = find(n.children);
                if (r) return [n, ...r];
            }
        }
        return null;
    };
    const chain = find(treeData.value);
    if (!chain) return;
    const { getNode, setCurrentKey } = treeRef.value;
    chain.slice(0, -1).forEach(n => {
        const node = getNode(n.id);
        if (node) node.expanded = true;
    });
    setCurrentKey(chain[chain.length - 1].id);
}

onBeforeUnmount(() => {
    stopPlay();
    if (canvasResizeObserver) {
        canvasResizeObserver.disconnect();
        canvasResizeObserver = null;
    }
});
</script>

<template>
    <div class="npk-root">
        <!-- Top toolbar -->
        <div class="npk-topbar">
            <button class="npk-icon-btn" @click="goBack" title="返回">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <span class="npk-title">
                <svg class="npk-title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                </svg>
                <span class="npk-title-text">NPK 预览</span>
            </span>
            <el-select v-model="formatId" size="small" class="npk-format-select" popper-class="ep-popper-dark" title="加解密算法" @update:model-value="onFormatChange">
                <el-option v-for="f in NPK_FORMATS" :key="f.id" :label="f.label" :value="f.id" />
            </el-select>
            <label v-if="archive" class="npk-autoplay" :class="{ on: autoPlay }" title="自动播放帧预览">
                <el-switch v-model="autoPlay" size="small" @change="onAutoPlayChange" />
                <span>自动播放</span>
            </label>
            <span v-if="archive && autoPlay" class="npk-play-mode" title="播放模式">
                <span class="npk-play-mode-label">模式</span>
                <el-select v-model="playMode" size="small" popper-class="ep-popper-dark" class="npk-play-mode-select" @update:model-value="onPlayModeChange">
                    <el-option value="loop" label="无限重复" />
                    <el-option value="once" label="播放一次" />
                </el-select>
            </span>
            <span v-if="archive && autoPlay" class="npk-play-interval" title="帧切换间隔">
                <span class="npk-play-interval-label">间隔</span>
                <el-input-number v-model="playInterval" :min="20" :max="2000" :step="10" size="small" controls-position="right" class="npk-play-interval-input" @change="onPlayIntervalChange" />
                <span class="npk-play-interval-unit">ms</span>
            </span>

            <!-- 编辑工具栏 -->
            <template v-if="archive">
                <span class="npk-edit-actions">
                    <!-- 替换当前帧 -->
                    <span class="npk-menu-wrap">
                        <button
                            class="npk-edit-btn"
                            :disabled="!selected || !currentFrameMeta || currentFrameMeta.type === 0x11"
                            title="替换当前帧"
                            @click="
                                replaceMenu = !replaceMenu;
                                exportMenu = false;
                                importMenu = false;
                            ">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                                <polyline points="21 3 21 8 16 8" />
                                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                                <polyline points="3 21 3 16 8 16" />
                            </svg>
                            替换
                        </button>
                        <div v-if="replaceMenu" class="npk-menu">
                            <div class="npk-menu-title">替换当前帧</div>
                            <div class="npk-menu-row">
                                <span class="npk-menu-label">格式</span>
                                <el-select v-model="replaceFormat" size="small" popper-class="ep-popper-dark" class="npk-menu-select">
                                    <el-option v-for="f in REPLACE_FORMATS" :key="f.value" :label="f.label" :value="f.value" />
                                </el-select>
                            </div>
                            <button class="btn btn-primary npk-menu-btn" @click="imgInputEl && imgInputEl.click()">选择图片…</button>
                            <input ref="imgInputEl" type="file" accept="image/*" style="display: none" @change="e => replaceCurrentFrame(e.target.files[0])" />
                        </div>
                    </span>

                    <!-- 导入 IMG -->
                    <span class="npk-menu-wrap">
                        <button
                            class="npk-edit-btn"
                            title="导入 .img 替换当前 IMG"
                            @click="
                                importMenu = !importMenu;
                                replaceMenu = false;
                                exportMenu = false;
                            ">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="17 8 12 3 7 8" />
                                <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                            导入
                        </button>
                        <div v-if="importMenu" class="npk-menu">
                            <div class="npk-menu-title">导入 IMG 替换当前条目</div>
                            <div class="npk-menu-hint">{{ selected ? selected.name : "请先在左侧选择一个 IMG 条目" }}</div>
                            <button class="btn btn-primary npk-menu-btn" :disabled="!selected" @click="pickImportTarget(selected)">选择 .img 文件…</button>
                            <input ref="importInputEl" type="file" accept=".img,image/*" style="display: none" @change="e => importImgFile(e.target.files[0])" />
                        </div>
                    </span>

                    <!-- 导出 -->
                    <span class="npk-menu-wrap">
                        <button
                            class="npk-edit-btn"
                            :disabled="!selected"
                            title="导出当前帧 / IMG"
                            @click="
                                exportMenu = !exportMenu;
                                replaceMenu = false;
                                importMenu = false;
                            ">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            导出
                        </button>
                        <div v-if="exportMenu" class="npk-menu">
                            <div class="npk-menu-title">导出</div>
                            <div class="npk-menu-row">
                                <span class="npk-menu-label">帧格式</span>
                                <el-select v-model="exportFormat" size="small" popper-class="ep-popper-dark" class="npk-menu-select">
                                    <el-option v-for="f in EXPORT_FORMATS" :key="f.value" :label="f.label" :value="f.value" />
                                </el-select>
                            </div>
                            <button class="btn btn-primary npk-menu-btn" :disabled="!framePng" @click="exportFrameAs(exportFormat)">导出当前帧</button>
                            <button class="btn btn-outline-primary npk-menu-btn" @click="exportCurrentImg">导出整个 IMG</button>
                        </div>
                    </span>

                    <!-- 保存 -->
                    <button class="npk-edit-btn npk-edit-save" :class="{ disabled: !dirty }" :disabled="!dirty" title="保存修改（下载 NPK）" @click="saveNpk">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                            <polyline points="17 21 17 13 7 13 7 21" />
                            <polyline points="7 3 7 8 15 8" />
                        </svg>
                        保存
                    </button>
                    <span v-if="dirty" class="npk-dirty-badge" title="已修改条目数">{{ dirtyCount }} 处修改</span>
                </span>
            </template>

            <span v-if="archive" class="npk-file-name">{{ fileName }}</span>
            <span v-if="archive" class="npk-stats">{{ archive.count.toLocaleString() }} 个 IMG</span>
        </div>

        <!-- File picker -->
        <div v-if="!archive && !loading" class="npk-picker">
            <div class="npk-picker-card">
                <div class="npk-picker-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                    </svg>
                </div>
                <h2>NPK 素材预览</h2>
                <p>解析 ImagePacks2 的 NPK，解密 IMG帧 并预览</p>
                <p>加解密算法按格式下拉选择（{{ currentFormatLabel }}）</p>
                <button class="btn btn-primary" @click="$refs.fileInputEl && $refs.fileInputEl.click()">
                    <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    选择 NPK 文件
                </button>
                <input ref="fileInputEl" type="file" accept=".npk" style="display: none" @change="handleFileSelect" />
                <p v-if="error" class="npk-error">{{ error }}</p>
                <p class="npk-picker-hint">所有解析与帧解码在浏览器完成</p>
            </div>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="npk-loading">
            <div class="npk-loading-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
            </div>
            <p class="npk-loading-text">{{ loadingMessage }}</p>
        </div>

        <!-- Main body -->
        <div v-if="archive && !loading" class="npk-body">
            <div class="npk-side">
                <div class="npk-searchbar">
                    <el-input v-model="searchQuery" placeholder="搜索 IMG 路径..." clearable size="small" class="npk-search-input">
                        <template #prefix>
                            <svg class="npk-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="11" cy="11" r="8" />
                                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                        </template>
                    </el-input>
                    <span class="npk-count">{{ leafCount.toLocaleString() }} / {{ archive.count.toLocaleString() }}</span>
                </div>
                <div class="npk-tree-wrap">
                    <el-tree
                        ref="treeRef"
                        class="npk-tree"
                        :data="treeData"
                        node-key="id"
                        :props="{ label: 'label', children: 'children' }"
                        highlight-current
                        :expand-on-click-node="false"
                        :default-expanded-keys="defaultExpandedKeys"
                        @node-click="onTreeNodeClick">
                        <template #default="{ data }">
                            <span class="npk-tree-node" :title="data.path">
                                <svg
                                    v-if="data.kind === 'dir'"
                                    class="npk-node-icon folder"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.8"
                                    stroke-linecap="round"
                                    stroke-linejoin="round">
                                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                                </svg>
                                <svg
                                    v-else-if="data.kind === 'img'"
                                    class="npk-node-icon leaf"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.8"
                                    stroke-linecap="round"
                                    stroke-linejoin="round">
                                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                    <circle cx="8.5" cy="8.5" r="1.5" />
                                    <polyline points="21 15 16 10 5 21" />
                                </svg>
                                <svg v-else class="npk-node-icon frame" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                                    <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
                                    <rect x="7" y="7" width="14" height="14" rx="1.5" ry="1.5" opacity="0.55" />
                                </svg>
                                <span class="npk-node-label" :class="{ 'frame-label': data.kind === 'frame' }">{{ data.label }}</span>
                            </span>
                        </template>
                    </el-tree>
                    <div v-if="!leafCount" class="npk-empty">无匹配 IMG</div>
                </div>
            </div>
            <div class="npk-preview">
                <template v-if="selected">
                    <div class="npk-preview-head">
                        <span class="npk-preview-name" :title="selected.name">{{ selected.name }}</span>
                        <span class="npk-preview-meta" v-if="imgInfo">
                            {{ imgInfo.frames.length }} 帧
                            <template v-if="currentFrameMeta"> · {{ formatLabel(currentFrameMeta.type) }} · {{ currentFrameMeta.width }}×{{ currentFrameMeta.height }}</template>
                        </span>
                    </div>
                    <div v-if="frameError" class="npk-preview-error">{{ frameError }}</div>
                    <div v-else-if="framePng" ref="canvasEl" class="npk-preview-canvas">
                        <!-- 原点角标（左上角） -->
                        <div class="npk-ruler-corner"></div>
                        <!-- X 轴标尺（顶部） -->
                        <div class="npk-ruler-x">
                            <template v-for="t in xTicks" :key="'x' + t.pos">
                                <span class="npk-tick-x" :class="{ major: t.major }" :style="{ left: t.pos + 'px' }">
                                    <i class="npk-tick-line"></i>
                                    <i v-if="t.major && t.pos > 0" class="npk-tick-label">{{ t.pos }}</i>
                                </span>
                            </template>
                        </div>
                        <!-- Y 轴标尺（左侧） -->
                        <div class="npk-ruler-y">
                            <template v-for="t in yTicks" :key="'y' + t.pos">
                                <span class="npk-tick-y" :class="{ major: t.major }" :style="{ top: t.pos + 'px' }">
                                    <i v-if="t.major && t.pos > 0" class="npk-tick-label">{{ t.pos }}</i>
                                    <i class="npk-tick-line"></i>
                                </span>
                            </template>
                        </div>
                        <!-- 像素画布区：图像左上角对齐原点 -->
                        <div class="npk-pixel-stage">
                            <img class="npk-pixel-img" :src="framePng" alt="帧预览" @load="onImgLoad" />
                            <!-- 右边缘辅助线（通栏） -->
                            <div v-if="frameSize" class="npk-guide guide-right" :style="{ left: frameSize.w + 'px' }"></div>
                            <!-- 底边缘辅助线（通栏） -->
                            <div v-if="frameSize" class="npk-guide guide-bottom" :style="{ top: frameSize.h + 'px' }"></div>
                            <!-- 交叉点坐标标注 -->
                            <div v-if="frameSize" class="npk-guide-corner" :style="{ left: frameSize.w + 'px', top: frameSize.h + 'px' }">
                                <span class="npk-guide-coord">({{ frameSize.w }}, {{ frameSize.h }})</span>
                            </div>
                        </div>
                    </div>
                    <div v-else class="npk-preview-empty">
                        <div class="npk-loading-icon npk-small">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                            </svg>
                        </div>
                    </div>
                </template>
                <div v-else class="npk-preview-empty">
                    <p>从左侧选择一个 IMG 预览帧</p>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.npk-root {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

/* ---- Top toolbar ---- */
.npk-topbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    height: 48px;
    background: var(--bg-2);
    border-bottom: 1px solid var(--surface-border);
    flex-shrink: 0;
}
.npk-icon-btn {
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
.npk-icon-btn:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.06);
}
.npk-icon-btn svg {
    width: 18px;
    height: 18px;
}
.npk-title {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-weight: 600;
    color: var(--text);
    font-size: 0.9rem;
    white-space: nowrap;
}
.npk-title-icon {
    width: 17px;
    height: 17px;
    color: var(--accent);
}
.npk-format-select {
    width: 90px;
    flex-shrink: 0;
}
.npk-autoplay {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    font-size: 0.78rem;
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
}
.npk-autoplay.on {
    color: var(--accent);
}
.npk-play-mode {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    font-size: 0.78rem;
    color: var(--text-muted);
    white-space: nowrap;
}
.npk-play-mode-select {
    width: 92px;
}
.npk-play-interval {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    font-size: 0.78rem;
    color: var(--text-muted);
    white-space: nowrap;
}
.npk-play-interval-input {
    width: 84px;
}
.npk-play-interval-unit {
    font-size: 0.72rem;
    color: var(--text-muted);
}
.npk-file-name {
    flex: 1;
    min-width: 0;
    color: var(--text-muted);
    font-size: 0.8rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: right;
}
.npk-stats {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: 0.8rem;
}

/* ---- File picker ---- */
.npk-picker {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
}
.npk-picker-card {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 48px;
}
.npk-picker-icon {
    color: var(--accent);
    line-height: 0;
}
.npk-picker-icon svg {
    width: 56px;
    height: 56px;
}
.npk-picker-card h2 {
    margin: 0;
    font-size: 1.4rem;
    color: var(--text);
}
.npk-picker-card > p {
    color: var(--text-muted);
    font-size: 0.9rem;
    margin: 0 0 16px;
}
.npk-picker-card .btn {
    min-width: 180px;
}
.npk-picker-hint {
    margin-top: 20px;
    font-size: 0.75rem;
    color: var(--text-muted);
    opacity: 0.6;
}
.npk-error {
    color: var(--error);
    font-size: 0.85rem;
    max-width: 360px;
    line-height: 1.5;
}

/* ---- Loading ---- */
.npk-loading {
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
.npk-loading-icon {
    width: 56px;
    height: 56px;
    color: var(--accent);
    animation: npk-spin 1.1s linear infinite;
}
.npk-loading-icon svg {
    width: 100%;
    height: 100%;
}
.npk-loading-icon.npk-small {
    width: 40px;
    height: 40px;
}
@keyframes npk-spin {
    to {
        transform: rotate(360deg);
    }
}
.npk-loading-text {
    color: var(--text);
    font-size: 0.9rem;
}

/* ---- Body: side list + preview ---- */
.npk-body {
    flex: 1;
    display: flex;
    min-height: 0;
}
.npk-side {
    width: 360px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid var(--surface-border);
}
.npk-searchbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--surface-border);
    flex-shrink: 0;
}
.npk-search-input {
    flex: 1;
}
.npk-search-icon {
    width: 14px;
    height: 14px;
}
.npk-count {
    flex-shrink: 0;
    font-size: 0.72rem;
    color: var(--text-muted);
}
.npk-tree-wrap {
    flex: 1;
    min-height: 0;
    overflow: auto;
    position: relative;
}
.npk-tree-wrap::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}
.npk-tree-wrap::-webkit-scrollbar-track {
    background: transparent;
}
.npk-tree-wrap::-webkit-scrollbar-thumb {
    background-color: rgba(255, 255, 255, 0.15);
    border-radius: 4px;
}
.npk-tree-wrap::-webkit-scrollbar-thumb:hover {
    background-color: rgba(255, 255, 255, 0.25);
}
.npk-tree-wrap {
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
}
.npk-tree {
    --el-tree-node-hover-bg-color: rgba(255, 255, 255, 0.05);
    --el-tree-node-expanded-bg-color: transparent;
    --el-tree-text-color: var(--text);
    --el-tree-node-hover-bg-color: rgba(255, 255, 255, 0.05);
    background: transparent;
    color: var(--text);
    font-size: 0.78rem;
}
.npk-tree :deep(.el-tree-node__content) {
    height: 30px;
}
.npk-tree :deep(.el-tree-node__content:hover) {
    background: rgba(255, 255, 255, 0.05);
}
.npk-tree :deep(.el-tree-node.is-current > .el-tree-node__content) {
    background: rgba(91, 140, 255, 0.16);
    color: var(--accent);
}
.npk-tree :deep(.el-tree-node__expand-icon) {
    color: var(--text-muted);
}
.npk-tree :deep(.el-tree-node__expand-icon.is-leaf) {
    color: transparent;
}
.npk-tree-node {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
}
.npk-node-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
}
.npk-node-icon.folder {
    color: #d9a545;
}
.npk-node-icon.leaf {
    color: var(--text-muted);
}
.npk-node-icon.frame {
    color: #8fa6ff;
}
.npk-node-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.npk-node-label.frame-label {
    color: var(--text-muted);
}
.npk-empty {
    padding: 24px;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.85rem;
}

/* ---- Preview panel ---- */
.npk-preview {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
}
.npk-preview-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--surface-border);
    flex-shrink: 0;
}
.npk-preview-name {
    flex: 1;
    min-width: 0;
    font-size: 0.85rem;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.npk-preview-meta {
    flex-shrink: 0;
    font-size: 0.75rem;
    color: var(--text-muted);
}
.npk-preview-canvas {
    flex: 1;
    position: relative;
    display: block;
    min-height: 0;
    overflow: auto;
    box-sizing: border-box;
    /* 标准像素画布：透明棋盘格背景 */
    background-color: #0d1220;
    background-image:
        linear-gradient(45deg, rgba(255, 255, 255, 0.05) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.05) 75%),
        linear-gradient(45deg, rgba(255, 255, 255, 0.05) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.05) 75%);
    background-size: 8px 8px;
    background-position:
        0 0,
        4px 4px;
}
/* 原点角块：固定左上角，与标尺围合出原点 */
.npk-ruler-corner {
    position: absolute;
    top: 0;
    left: 0;
    width: 36px;
    height: 24px;
    background: #121a2c;
    border-bottom: 1px solid var(--surface-border);
    border-right: 1px solid var(--surface-border);
    z-index: 3;
}
/* X 轴标尺：顶部，从原点往右铺满画布宽 */
.npk-ruler-x {
    position: absolute;
    top: 0;
    left: 36px;
    right: 0;
    height: 24px;
    background: #121a2c;
    border-bottom: 1px solid var(--surface-border);
    z-index: 2;
}
/* Y 轴标尺：左侧，从原点往下铺满画布高 */
.npk-ruler-y {
    position: absolute;
    top: 24px;
    left: 0;
    bottom: 0;
    width: 36px;
    background: #121a2c;
    border-right: 1px solid var(--surface-border);
    z-index: 2;
}
.npk-tick-x {
    position: absolute;
    top: 0;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
}
.npk-tick-y {
    position: absolute;
    left: 0;
    width: 36px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    pointer-events: none;
}
.npk-tick-x .npk-tick-line {
    position: absolute;
    bottom: 1px;
    left: 50%;
    transform: translateX(-50%);
    width: 1px;
    height: 5px;
    background: var(--text-muted);
}
.npk-tick-y .npk-tick-line {
    position: absolute;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    width: 5px;
    height: 1px;
    background: var(--text-muted);
}
.npk-tick-x.major .npk-tick-line {
    height: 8px;
    background: var(--text-muted);
}
.npk-tick-y.major .npk-tick-line {
    width: 8px;
    background: var(--text-muted);
}
.npk-tick-x .npk-tick-label {
    position: absolute;
    left: 50%;
    top: 2px;
    transform: translateX(-50%);
    font-size: 9px;
    line-height: 1;
    color: var(--text-muted);
    white-space: nowrap;
    user-select: none;
    pointer-events: none;
}
.npk-tick-y .npk-tick-label {
    position: absolute;
    left: 6px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 9px;
    line-height: 1;
    color: var(--text-muted);
    white-space: nowrap;
    user-select: none;
    pointer-events: none;
}
/* 像素画布区：从原点 (RULER_W, RULER_H) 开始铺满剩余，图像左上角贴合原点 */
.npk-pixel-stage {
    position: absolute;
    top: 24px;
    left: 36px;
    right: 0;
    bottom: 0;
    z-index: 1;
}
/* 辅助虚线：贯穿整个画布，对齐图片右/下边缘与刻度 */
.npk-guide {
    position: absolute;
    pointer-events: none;
    z-index: 2;
}
.npk-guide.guide-right {
    top: 0;
    bottom: 0;
    border-right: 1px dashed rgba(160, 170, 190, 0.4);
}
.npk-guide.guide-bottom {
    left: 0;
    right: 0;
    border-bottom: 1px dashed rgba(160, 170, 190, 0.4);
}
/* 辅助线交叉点坐标标注 */
.npk-guide-corner {
    position: absolute;
    z-index: 3;
    pointer-events: none;
    transform: translate(4px, 2px);
}
.npk-guide-coord {
    display: inline-block;
    padding: 1px 5px;
    background: rgba(13, 18, 32, 0.85);
    border: 1px solid var(--surface-border);
    border-radius: 4px;
    font-size: 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: var(--text);
    white-space: nowrap;
    line-height: 1.4;
}
.npk-pixel-img {
    position: absolute;
    top: 0;
    left: 0;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
    max-width: none;
    max-height: none;
    width: auto;
    height: auto;
    border: none;
    box-shadow: none;
}
.npk-preview-error {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    color: var(--error);
    font-size: 0.85rem;
    text-align: center;
}
.npk-preview-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    color: var(--text-muted);
    font-size: 0.85rem;
}

/* ---- 编辑工具栏 ---- */
.npk-edit-actions {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
}
.npk-edit-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--surface-border);
    border-radius: 7px;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.78rem;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
}
.npk-edit-btn:hover:not(:disabled) {
    color: var(--text);
    background: rgba(255, 255, 255, 0.06);
    border-color: var(--outline-3-border);
}
.npk-edit-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
}
.npk-edit-btn svg {
    width: 14px;
    height: 14px;
}
.npk-edit-btn.npk-edit-save {
    color: var(--accent);
    border-color: rgba(91, 140, 255, 0.4);
    background: rgba(91, 140, 255, 0.1);
}
.npk-edit-btn.npk-edit-save:hover:not(:disabled) {
    background: rgba(91, 140, 255, 0.2);
}
.npk-edit-btn.npk-edit-save.disabled {
    color: var(--text-muted);
    border-color: var(--surface-border);
    background: transparent;
}
.npk-dirty-badge {
    font-size: 0.72rem;
    color: var(--text-muted);
    white-space: nowrap;
}
.npk-menu-wrap {
    position: relative;
}
.npk-menu {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    z-index: 3000;
    min-width: 200px;
    padding: 10px;
    background: #161d30;
    border: 1px solid var(--surface-border);
    border-radius: 10px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.npk-menu-title {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text);
}
.npk-menu-hint {
    font-size: 0.72rem;
    color: var(--text-muted);
    word-break: break-all;
}
.npk-menu-row {
    display: flex;
    align-items: center;
    gap: 8px;
}
.npk-menu-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    flex-shrink: 0;
}
.npk-menu-select {
    flex: 1;
}
.npk-menu-btn {
    width: 100%;
    padding: 8px 12px;
    font-size: 0.82rem;
}
</style>
