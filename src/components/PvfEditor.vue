<script>
import hljs from "highlight.js/lib/core";
import xmlLang from "highlight.js/lib/languages/xml";
import { PvfArchive, PvfFormat, formatBytes, buildFileTree, sanitizeFilename } from "@/utils/pvfTool";
import { TwPvfArchive } from "@/utils/pvfToolTw";
import { RepackPvfArchive } from "@/utils/pvfToolRepack";
import { registerPvfLanguage, registerNutLanguage } from "@/utils/pvfHighlight";
import {
    formatNutText,
    findNutFoldRanges,
    buildNutFoldLines,
    buildNutGutterMarks,
    toggleNutFoldRange,
    detectNutIndentUnit,
    computeNutBlockGuideLevels,
    findNutActiveIndentGuide,
    findNutWordOccurrences,
    buildNutFoldEditableText,
    mergeNutFoldEdit,
    buildNutFoldMarkerAnchors,
    captureNutScrollAnchor,
    resolveNutScrollTop
} from "@/utils/pvfNutFormat";
import { getTagInfo, parseTagName, renderTagTooltip, PVF_BLOCK_TAGS } from "@/utils/pvfTags";
import { ensureCodeRefLoaded, renderCodeRefTipHtml } from "@/utils/pvfCodeRef";
import { validatePvfText } from "@/utils/pvfValidator";
import { alertModal, confirmModal } from "@/hooks/useModal";

registerPvfLanguage(hljs);
registerNutLanguage(hljs);
hljs.registerLanguage("xml", xmlLang);

// 超过此大小的文件不再进入可编辑编辑器（textarea/高亮/校验都是 O(行数) 且非虚拟化，
// 10w 行级文件会卡死界面），改为只读预览前 N 行。
const LARGE_FILE_CHAR_LIMIT = 500000;
const LARGE_FILE_PREVIEW_LINES = 2000;
// 大文件全量虚拟滚动：固定行高（与 .pvf-largefile-cline/.gline 的 CSS line-height 一致）与渲染缓冲行数
const LARGE_VIRTUAL_LINE_H = 20;
const LARGE_VIRTUAL_BUFFER = 20;
const LARGE_ROW_CACHE_LIMIT = 40000;
// .nut 编辑器装饰（§3.6）字符数上限：超过则仅保留折叠整行底色（矩形数与行数同阶），
// 关闭缩进辅助线与同类词矩形，避免超大文本构造数万装饰元素（与逐键高亮的大文件阈值同源思路）
const NUT_DECOR_MAX_CHARS = 200000;

const ENCODINGS = [
    { value: "utf-8", label: "UTF-8" },
    { value: "gbk", label: "GBK (简体中文)" },
    { value: "big5", label: "Big5 (繁體中文)" },
    { value: "euc-kr", label: "EUC-KR (韩文)" }
];

// .nut 折叠箭头图标（§3.5 Gutter 版式 / 渲染观感对照）：自绘 SVG chevron，几何取自 VS Code 折叠控件
// 观感——已折叠为右向、未折叠为下向；16×16 viewBox + currentColor 描边，不内嵌第三方图标字体 / 资产。
// 图标盒 16px 见方（样式见 .pvf-fold-mark，对齐 VS Code 折叠开启时 +16px 的装饰槽位宽），显隐不改变列宽。
const NUT_FOLD_ICONS = {
    collapsed:
        '<svg class="pvf-fold-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>',
    expanded:
        '<svg class="pvf-fold-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 6 8 10.5 12.5 6" /></svg>'
};

function nutFoldIcon(mark) {
    return NUT_FOLD_ICONS[mark] || "";
}

// 判断行内第 col 列是否落在反引号引用字符串中；命中返回引用路径（含反引号间原始内容）
function refInLine(line, col) {
    const re = /`(?:[^`]|``)*`/g;
    let m;
    while ((m = re.exec(line))) {
        if (col >= m.index && col < re.lastIndex) return m[0].slice(1, -1).replace(/``/g, "`");
        if (col < m.index) break;
    }
    return null;
}

export default {
    name: "PvfEditor",
    beforeRouteLeave(to, from, next) {
        if (this.archive && this.hasChanges) {
            const total = this.modifiedCount + this.deletedCount + this.renamedCount;
            confirmModal({ title: "确认离开", message: `有 ${total} 项未保存的修改，确认离开编辑器？` }).then(ok => {
                if (ok) next();
                else next(false);
            });
        } else {
            next();
        }
    },
    data() {
        return {
            archive: null,
            fileName: "",
            loading: false,
            loadingMessage: "",
            searchQuery: "",
            effectiveQuery: "",
            currentFile: null,
            editText: "",
            originalText: "",
            isStaging: false,
            saving: false,
            saveProgress: 0,
            saveProgressText: "",
            readonlyPreviewHtml: "",
            scrollTop: 0,
            containerHeight: 0,
            selectedPath: "",
            expandedPaths: new Set(),
            contextMenu: { show: false, x: 0, y: 0, node: null },
            importTarget: null,
            strEncoding: "utf-8",
            textDirty: false,
            highlightedHtml: "",
            highlightTimer: null,
            isLargeFile: false,
            largeFilePreviewHtml: "",
            largeFileLineCount: 0,
            largeFilePreviewLines: LARGE_FILE_PREVIEW_LINES,
            largeFullLines: [],
            largeFullView: false,
            largeFullLoading: false,
            largeScrollTop: 0,
            largeViewHeight: 0,
            largeSearchQuery: "",
            largeSearchMatches: [],
            largeSearchIndex: -1,
            largeSearchNameLoading: false,
            rowHeight: 24,
            ENCODINGS,
            tooltip: { show: false, x: 0, y: 0, html: "" },
            validationErrors: [],
            validationVisible: false,
            logs: [],
            sidebarWidth: 280,
            logHeight: 160,
            drag: null,
            folds: [],
            isFolding: false,
            // nut 花括号折叠（纯展示折叠，§3.5）：区间集合 [{ open, close }]（0 基真实行号），
            // 与 editText 解耦，不共用 PVF 块标签折叠的 folds 状态
            nutFolds: [],
            // 折叠标记悬停态：鼠标位于左侧 gutter 时显示未折叠行的下向折叠箭头（VS Code 默认行为）
            nutGutterHovered: false,
            // 编辑器装饰（§3.6）：textarea 光标 / 选区原始偏移（0 基字符偏移，经 syncCaret 同步）、
            // 正文滚动偏移（装饰覆盖层不随 pre 滚动，按滚动偏移反向平移矩形）与几何重算触发位
            nutCaretStart: 0,
            nutCaretEnd: 0,
            // 折叠态 textarea 的光标 / 选区偏移（全文偏移域，经 syncNutFoldCaret 同步；-1 = 未同步，
            // 进入折叠视图时置 -1，避免沿用编辑态残留光标绘制当前行 / 同类词）
            nutFoldCaretStart: -1,
            nutFoldCaretEnd: -1,
            decorX: 0,
            decorY: 0,
            decorTick: 0,
            changeStamp: 0,
            tagColor: localStorage.getItem("pvf-tag-color") || "#ff6b9d"
        };
    },
    computed: {
        isCurrentModified() {
            if (!this.currentFile || !this.archive) return false;
            return this.archive.isFileModified(this.currentFile.index);
        },
        isCurrentDeleted() {
            if (!this.currentFile || !this.archive) return false;
            return this.archive.isFileDeleted(this.currentFile.index);
        },
        isCurrentRenamed() {
            if (!this.currentFile || !this.archive) return false;
            return this.archive.isFileRenamed(this.currentFile.index);
        },
        modifiedCount() {
            return this.archive ? this.archive.modifiedCount : 0;
        },
        deletedCount() {
            return this.archive ? this.archive.deletedCount : 0;
        },
        renamedCount() {
            return this.archive ? this.archive.renamedCount : 0;
        },
        hasChanges() {
            return this.archive ? this.archive.hasChanges : false;
        },
        headerStats() {
            if (!this.archive || !this.archive.header) return null;
            const h = this.archive.header;
            // TW 无分块（bodySize 占位 0、groups 为空）：用 archive.bodySize（明文总字节）兜底
            const body = this.archive.bodySize != null ? this.archive.bodySize : h.bodySize;
            const totalOrig = this.archive.groups.length > 0 ? this.archive.groups[this.archive.groups.length - 1].originalSize : body;
            return {
                fileCount: h.fileCount,
                groupCount: h.groupCount,
                bodySize: formatBytes(body),
                totalOrig: formatBytes(totalOrig),
                format: this.archive.headerFormat,
                formatLabel: this.archive.headerFormatLabel
            };
        },
        isEditable() {
            return !this.isLargeFile && this.currentFile && (this.currentFile.dataType === 1 || this.currentFile.dataType === 3);
        },
        // 只读归档（REPACK/60CN）：隐藏右键菜单修改类入口，仅保留导出（docs/pvf-repack-format.md §4）
        isReadonlyArchive() {
            return !!(this.archive && this.archive.headerFormat === PvfFormat.REPACK);
        },
        highlightMode() {
            const f = this.currentFile;
            if (!f) return "pvf";
            // .nut 明文 Squirrel 脚本按代码风格高亮（TW 层 dataType 恒为 1，判定须置于 dataType 之前）
            if (f.name && /\.nut$/i.test(f.name)) return "nut";
            if (f.dataType === 1) return "pvf";
            // .xui 为 XML 文本，按 XML 高亮
            if (f.name && /\.xui$/i.test(f.name)) return "xml";
            return "plaintext";
        },
        dataTypeLabel() {
            if (!this.currentFile) return "";
            const t = this.currentFile.dataType;
            if (t === 1) return "脚本";
            if (t === 3) return "文本";
            return "二进制";
        },
        isLst() {
            const f = this.currentFile;
            return !!(f && this.archive && this.archive.isLstFile(f));
        },
        isStringTable() {
            const f = this.currentFile;
            return !!(f && this.archive && /^stringtable\.bin$/i.test(f.name));
        },
        isStrFile() {
            const f = this.currentFile;
            return !!(f && this.archive && /\.str$/i.test(f.name));
        },
        editLines() {
            return this.editText ? this.editText.split("\n") : [];
        },
        // ---- 大文件全量虚拟滚动 ----
        largeTotalHeight() {
            return this.largeFullLines.length * LARGE_VIRTUAL_LINE_H;
        },
        largeVisibleRows() {
            const lines = this.largeFullLines;
            const total = lines.length;
            if (!total) return [];
            const viewH = this.largeViewHeight > 0 ? this.largeViewHeight : 300;
            const start = Math.max(0, Math.floor(this.largeScrollTop / LARGE_VIRTUAL_LINE_H) - LARGE_VIRTUAL_BUFFER);
            const end = Math.min(total, Math.ceil((this.largeScrollTop + viewH) / LARGE_VIRTUAL_LINE_H) + LARGE_VIRTUAL_BUFFER);
            const cur = this.largeSearchIndex >= 0 ? this.largeSearchMatches[this.largeSearchIndex] : -1;
            const rows = [];
            const activeQ = this.largeSearchQuery.trim();
            for (let i = start; i < end; i++) {
                const isCurrent = i === cur;
                let html = this._largeRowHtml(i);
                if (isCurrent && activeQ) html = this._markLargeSearch(html);
                rows.push({ no: i + 1, top: i * LARGE_VIRTUAL_LINE_H, html, current: isCurrent });
            }
            return rows;
        },
        foldableLines() {
            const lines = this.editLines;
            const result = new Set();
            const stack = [];
            for (let i = 0; i < lines.length; i++) {
                const openMatch = /^\s*\[([^\]\[`{}]+)\]\s*$/.exec(lines[i]);
                const closeMatch = /^\s*\[\/([^\]\[`{}]+)\]\s*$/.exec(lines[i]);
                if (openMatch && PVF_BLOCK_TAGS.has(openMatch[1].toLowerCase())) {
                    stack.push({ tag: openMatch[1].toLowerCase(), lineIndex: i });
                }
                if (closeMatch) {
                    const closeTagName = closeMatch[1].toLowerCase();
                    for (let j = stack.length - 1; j >= 0; j--) {
                        if (stack[j].tag === closeTagName) {
                            result.add(stack[j].lineIndex);
                            stack.splice(j, 1);
                            break;
                        }
                    }
                }
            }
            return result;
        },
        foldedLineSet() {
            const lines = this.editLines;
            const result = new Set();
            for (let i = 0; i < lines.length; i++) {
                if (/^\s*\[[^\]]+\]\s*⋯\s*\d+\s+lines?\s*folded\s*⋯\s*\[\/[^\]]+\]\s*$/.test(lines[i])) {
                    result.add(i);
                }
            }
            return result;
        },
        gutterHtml() {
            const lines = this.editLines;
            // nut：行号左侧渲染折叠箭头图标（可折叠 = 下向箭头 / 已折叠 = 右向箭头，空标记占位保持对齐）
            if (this.highlightMode === "nut") return this.nutGutterHtml;
            const parts = [];
            for (let i = 0; i < lines.length; i++) {
                parts.push(String(i + 1));
            }
            return parts.join("\n");
        },
        // ---- nut 花括号折叠（纯展示折叠，docs/pvf-tw-nut-script.md §3.5）----
        // 可折叠行（编辑态 gutter 标记用）：花括号配对区块的开括号行
        nutFoldableLines() {
            if (this.highlightMode !== "nut" || !this.editText) return new Set();
            return new Set(findNutFoldRanges(this.editText).keys());
        },
        // 折叠视图可见行 [{ line, no, folded }]；无折叠时为 null（回编辑态）
        nutFoldView() {
            if (this.highlightMode !== "nut" || !this.editText || this.nutFolds.length === 0) return null;
            return buildNutFoldLines(this.editText, this.nutFolds);
        },
        // 编辑态 gutter：行号 + 折叠箭头列（版式为「行号在左、箭头在右」，对齐 VS Code 行号右侧的
        // 16px 装饰槽位；未折叠行的下向箭头仅鼠标移入 gutter 时显示）
        nutGutterHtml() {
            const rows = this.editLines.map((_, i) => ({ line: i, no: i + 1 }));
            const marks = buildNutGutterMarks(rows, this.nutFoldableLines, [], this.nutGutterHovered);
            return marks.map(m => `${m.no}<span class="pvf-fold-mark">${nutFoldIcon(m.mark)}</span>`).join("\n");
        },
        // 折叠态 gutter：仅可见行、原始行号（跳号）；已折叠起始行常显右向箭头，未折叠可折叠行悬停显下向箭头
        nutFoldGutterHtml() {
            const marks = buildNutGutterMarks(this.nutFoldView || [], this.nutFoldableLines, this.nutFolds, this.nutGutterHovered);
            return marks.map(m => `${m.no}<span class="pvf-fold-mark">${nutFoldIcon(m.mark)}</span>`).join("\n");
        },
        // 折叠态 textarea 取值：仅可见行（折叠区间开行 / 闭行保留、隐藏行不输出），
        // 与高亮正文层同源，保证两层逐行对齐（§3.5「折叠态可编辑」）
        nutFoldEditableText() {
            return this.nutFoldView ? buildNutFoldEditableText(this.editText, this.nutFolds) : "";
        },
        // 折叠态正文：逐行高亮可见行（纯展示层，占位符由覆盖层 nutFoldMarkers 渲染）
        nutFoldHtml() {
            const text = this.nutFoldEditableText;
            if (!text && !this.nutFoldView) return "";
            return text
                .split("\n")
                .map(line => hljs.highlight(line, { language: "squirrel" }).value)
                .join("\n");
        },
        // 折叠占位符覆盖层：⋯ 定位到折叠起始行行末（锚点列 × 字符宽 + 内边距），
        // 层容器不接收鼠标事件、仅占位符自身可交互（否则整层遮住折叠态 textarea）。
        // 锚点列由 buildNutFoldMarkerAnchors 给出（行末之后一格、tab 计 4 列、不做可见性过滤——
        // 视口外的折叠行同样产出，纵向裁剪由覆盖层的固定视口裁剪层承担）。
        nutFoldMarkers() {
            const view = this.nutFoldView;
            const m = this.getEditorMetrics();
            if (!view || !m) return [];
            void this.decorTick; // 依赖：几何缓存失效（挂载 / 切换文件 / 缩放）后重算
            return buildNutFoldMarkerAnchors(view, this.editLines, 4).map(a => ({
                key: `fold-${a.line}`,
                line: a.line,
                left: m.paddingLeft + (a.column - 1) * m.charWidth,
                top: m.paddingTop + a.row * m.lineHeight
            }));
        },
        // ---- 编辑器装饰（§3.6）：折叠整行底色 / 缩进辅助线（含活动块）/ 同类词 / 当前行 ----
        // 可见行 [{ line, row（视图行序，决定矩形纵向位置）, folded }]：编辑态为全部行，折叠态为折叠视图可见行
        nutDecorRows() {
            if (this.highlightMode !== "nut" || !this.editText) return [];
            const view = this.nutFoldView;
            if (view) return view.map((row, i) => ({ line: row.line, row: i, folded: !!row.folded }));
            return this.editLines.map((_, i) => ({ line: i, row: i, folded: false }));
        },
        // 一级缩进单位（辅助线列几何的一级宽度，与「格式化」同源；层级本身由区块嵌套数给出）
        nutIndentUnit() {
            return this.editText ? detectNutIndentUnit(this.editText) : "\t";
        },
        // 光标 / 选区（0 基行号、1 基可见列）；偏移越界按文本长度收敛。
        // 折叠态与编辑态的偏移域不同（折叠态 textarea 只含可见行），分开存放、互不沿用：
        // 折叠态偏移 < 0（未同步）时不绘制当前行与同类词，避免进入折叠视图即出现残留光标
        nutDecorCaret() {
            if (this.highlightMode !== "nut" || !this.editText) return null;
            const folded = !!this.nutFoldView;
            const rawStart = folded ? this.nutFoldCaretStart : this.nutCaretStart;
            const rawEnd = folded ? this.nutFoldCaretEnd : this.nutCaretEnd;
            if (rawStart < 0 || rawEnd < 0) return null;
            const text = this.editText;
            const clamp = v => Math.max(0, Math.min(Number.isFinite(v) ? v : 0, text.length));
            const start = this._nutOffsetToPosition(clamp(rawStart));
            const end = this._nutOffsetToPosition(clamp(rawEnd));
            return {
                line: start.line,
                column: start.column,
                selection: { startLine: start.line, startColumn: start.column, endLine: end.line, endColumn: end.column }
            };
        },
        // 整行矩形（折叠整行底色 / 当前行边框）：仅随纵向滚动平移，横向滚动下左右贯通整行
        nutDecorRowRects() {
            const m = this.getEditorMetrics();
            const rows = this.nutDecorRows;
            if (!m || rows.length === 0) return [];
            void this.decorTick; // 依赖：几何缓存失效（挂载 / 切换文件 / 缩放）后重算
            const caret = this.nutDecorCaret;
            const rects = [];
            for (const row of rows) {
                const top = m.paddingTop + row.row * m.lineHeight;
                if (row.folded) rects.push({ key: `fold-${row.row}`, cls: "pvf-decor-fold", top });
                if (caret && caret.line === row.line) rects.push({ key: `current-${row.row}`, cls: "pvf-decor-current", top });
            }
            return rects;
        },
        // 列锚定矩形（缩进辅助线 / 活动块 / 同类词）：随横向与纵向滚动双向平移
        nutDecorCellRects() {
            const m = this.getEditorMetrics();
            const rows = this.nutDecorRows;
            const text = this.editText;
            // 超大文本仅保留整行矩形（折叠底色 / 当前行），辅助线与同类词矩形不构造
            if (!m || !text || rows.length === 0 || text.length > NUT_DECOR_MAX_CHARS) return [];
            void this.decorTick;
            const unitColumns = this.nutIndentUnit === "\t" ? 4 : this.nutIndentUnit.length;
            // 区块区域辅助线（§3.6）：只对跨行 {} 区块的区域内部行（开括号下一行 ~ 闭括号前一行）绘制
            const levels = computeNutBlockGuideLevels(text);
            const caret = this.nutDecorCaret;
            const active = caret ? findNutActiveIndentGuide(levels, caret.line) : null;
            const occ = caret ? findNutWordOccurrences(text, caret.line, caret.column, { selection: caret.selection }) : null;
            const cells = [];
            for (const row of rows) {
                const top = m.paddingTop + row.row * m.lineHeight;
                const level = levels[row.line] || 0;
                for (let g = 1; g <= level; g++) {
                    const isActive = !!active && active.indent !== 0 && active.indent === g && row.line >= active.startLine && row.line <= active.endLine;
                    cells.push({
                        key: `g-${row.row}-${g}`,
                        cls: isActive ? "pvf-decor-guide pvf-decor-guide-active" : "pvf-decor-guide",
                        // 上游同款列几何：辅助线列 = (层级 - 1) × 一级缩进宽 + 1（VS Code
                        // indentGuide = (indentLvl - 1) * indentSize + 1），深一层不压在文字上；
                        // 矩形宽 = 一个缩进字符宽，1px 线由 inset box-shadow 画在左沿
                        left: m.paddingLeft + (g - 1) * unitColumns * m.charWidth,
                        top,
                        width: m.charWidth
                    });
                }
            }
            if (occ) {
                const rowByLine = new Map(rows.map(r => [r.line, r.row]));
                for (const hit of occ.matches) {
                    const row = rowByLine.get(hit.line);
                    if (row == null) continue;
                    cells.push({
                        key: `occ-${hit.line}-${hit.startColumn}`,
                        cls: occ.kind === "selection" ? "pvf-decor-occurrence pvf-decor-occurrence-selection" : "pvf-decor-occurrence",
                        left: m.paddingLeft + (hit.startColumn - 1) * m.charWidth,
                        top: m.paddingTop + row * m.lineHeight,
                        width: Math.max(1, hit.endColumn - hit.startColumn) * m.charWidth
                    });
                }
            }
            return cells;
        },
        // 装饰覆盖层滚动偏移（CSS 变量）：整行层取纵向、列锚定层取双向
        decorScroll() {
            return { "--decor-x": `${this.decorX}px`, "--decor-y": `${this.decorY}px` };
        },
        fileTree() {
            if (!this.archive) return null;
            this.changeStamp; // 依赖：删除/重命名等变更后强制重建缓存树
            // 树缓存：50 万文件全量 filter+排序+建树只发生在结构变更时一次，
            // 避免每次 _deleted 变化都触发全量重建（此前每次删除都同步卡顿）。
            if (!this._treeCache) {
                this._treeCache = buildFileTree(this.archive.files.filter(f => !this.archive.isFileDeleted(f.index)));
            }
            return this._treeCache;
        },
        visibleFileCount() {
            const tree = this.fileTree;
            return tree ? tree.total : 0;
        },
        isSearching() {
            return this.effectiveQuery.toLowerCase().trim().length > 0;
        },
        visibleNodes() {
            const tree = this.fileTree;
            if (!tree) return [];
            const result = [];
            const q = this.effectiveQuery.toLowerCase().trim();
            const searching = q.length > 0;

            if (!searching) {
                const expanded = this.expandedPaths;
                function walk(node, depth) {
                    for (const child of node.children) {
                        result.push({ node: child, depth });
                        if (child.isDir && expanded.has(child.path)) {
                            walk(child, depth + 1);
                        }
                    }
                }
                walk(tree, 0);
                return result;
            }

            // 搜索：路径子串包含，命中文件 + 祖先目录链，命中目录自动展开
            const visiblePaths = new Set();
            function mark(node) {
                let has = false;
                if (!node.isDir) {
                    has = node.pathLower.includes(q);
                    if (has) visiblePaths.add(node.path);
                } else {
                    for (const child of node.children) {
                        if (mark(child)) has = true;
                    }
                    if (has) visiblePaths.add(node.path);
                }
                return has;
            }
            mark(tree);
            function walk(node, depth) {
                for (const child of node.children) {
                    if (!visiblePaths.has(child.path)) continue;
                    result.push({ node: child, depth });
                    if (child.isDir) walk(child, depth + 1);
                }
            }
            walk(tree, 0);
            return result;
        },
        renderWindow() {
            const items = this.visibleNodes;
            const start = Math.max(0, Math.floor(this.scrollTop / this.rowHeight) - 8);
            const end = Math.min(items.length, start + Math.ceil(this.containerHeight / this.rowHeight) + 16);
            return {
                start,
                end,
                items: items.slice(start, end),
                total: items.length
            };
        },
        visibleFileCount() {
            if (!this.archive) return 0;
            return this.archive.files.filter(f => !this.archive.isFileDeleted(f.index)).length;
        },
        hasSyntaxErrors() {
            return this.validationErrors.length > 0;
        },
        syntaxSummary() {
            if (this.validationErrors.length === 0) return "语法检查通过";
            return `语法错误 ${this.validationErrors.length} 处`;
        }
    },
    watch: {
        editText() {
            if (!this.isFolding) {
                this.textDirty = this.editText !== this.originalText;
            }
            this.scheduleHighlight();
            this.scheduleValidation();
        },
        currentFile() {
            this.textDirty = false;
            this.validationErrors = [];
            this.validationVisible = false;
        },
        searchQuery(v) {
            clearTimeout(this._searchTimer);
            if (!v) {
                this.effectiveQuery = "";
                return;
            }
            this._searchTimer = setTimeout(() => {
                this.effectiveQuery = v;
            }, 150);
        }
    },
    mounted() {
        // 大文件行高亮缓存：非响应式（避免 computed 内 set 触发响应式失效循环）
        this.largeRowCache = new Map();
        window.addEventListener("keydown", this.onWindowKeydown);
        window.addEventListener("resize", this.onWindowResize);
        window.addEventListener("click", this.hideContextMenu);
        // 代码引用规则装配（?raw 动态导入，Node 端由测试脚本显式注入）；加载完成前悬浮暂无该区块，无害
        ensureCodeRefLoaded();
        // 编辑器装饰几何：挂载后 refs 可用时失效缓存并触发重算（首次渲染 computed 早于 refs）
        this.$nextTick(() => {
            this._editorMetrics = null;
            this.decorTick++;
            this.syncCaret();
            this.syncDecorScroll();
        });
    },
    beforeUnmount() {
        window.removeEventListener("keydown", this.onWindowKeydown);
        window.removeEventListener("resize", this.onWindowResize);
        window.removeEventListener("click", this.hideContextMenu);
        document.removeEventListener("mousemove", this.onDragMove);
        document.removeEventListener("mouseup", this.onDragEnd);
        if (this.highlightTimer) clearTimeout(this.highlightTimer);
        if (this.validationTimer) clearTimeout(this.validationTimer);
        if (this._searchTimer) clearTimeout(this._searchTimer);
        if (this._largeSearchTimer) clearTimeout(this._largeSearchTimer);
        if (this._largeResizeObserver) this._largeResizeObserver.disconnect();
        if (this._resizeRaf) cancelAnimationFrame(this._resizeRaf);
        if (this._largeResizeRaf) cancelAnimationFrame(this._largeResizeRaf);
        this.archive = null;
    },
    methods: {
        formatBytes,
        // ---- File loading ----
        handleFileSelect(event) {
            const file = event.target.files[0];
            if (file) this.loadPvf(file);
            event.target.value = "";
        },
        async loadPvf(file) {
            this.loading = true;
            this.loadingMessage = "读取文件中...";
            try {
                const buffer = await file.arrayBuffer();
                this.loadingMessage = "正在解析中...";
                // 先按重打包归档（60CN 基线）明文魔数探测（27 字节内无歧义），再按
                // JP/JPAG/CN（original/guard/protected）解析，失败则按繁体 TW 解析
                let arch = null;
                let loadError = null;
                if (RepackPvfArchive.sniff(buffer)) {
                    arch = new RepackPvfArchive(buffer);
                    await arch.parse();
                } else {
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
                }
                this.archive = arch;
                this._treeCache = null;
                this.fileName = file.name;
                // Use auto-detected encoding from archive
                this.strEncoding = arch.strEncoding;
                this.expandedPaths.clear();
                this.selectedPath = "";
                this.currentFile = null;
                this.editText = "";
                this.originalText = "";
                this.textDirty = false;
                this.isLargeFile = false;
                this.largeFilePreviewHtml = "";
                this.largeFileLineCount = 0;
                this.loading = false;
                this.$nextTick(() => this.updateContainerHeight());
                this.addLog(`加载 ${file.name} 成功：${arch.header.fileCount} 文件，${arch.headerFormatLabel}${arch.header.groupCount ? `，${arch.header.groupCount} 分块` : ""}`, "success");
                console.info(
                    `[PVF] 加载 ${file.name} 成功，文件标识：${arch.headerFormat}（${arch.headerFormatLabel}）${arch.headerFormat === PvfFormat.TW || arch.headerFormat === PvfFormat.REPACK ? "" : `，保存导出将使用${arch.headerFormat === PvfFormat.GUARD ? arch.headerFormatLabel + "（0x55 XOR）" : arch.headerFormatLabel}包头加密规则`}`
                );
            } catch (err) {
                this.loading = false;
                console.warn("PVF load failed:", err);
                const msg = err && err.message ? err.message : "未知错误，请确认选择的是有效的 Script.pvf 文件。";
                this.addLog(`加载失败：${msg}`, "error");
                alertModal({ title: "PVF 文件错误", message: msg });
            }
        },
        updateContainerHeight() {
            if (this.$refs.listEl) this.containerHeight = this.$refs.listEl.clientHeight;
        },
        onListScroll() {
            this.scrollTop = this.$refs.listEl ? this.$refs.listEl.scrollTop : 0;
        },
        // ---- Tree interactions ----
        toggleFolder(node) {
            if (this.expandedPaths.has(node.path)) {
                this.expandedPaths.delete(node.path);
            } else {
                this.expandedPaths.add(node.path);
            }
        },
        onNodeClick(node) {
            const now = Date.now();
            if (this._lastClickNode === node && now - (this._lastClickTime || 0) < 350) return;
            this._lastClickNode = node;
            this._lastClickTime = now;
            this.selectedPath = node.path;
            if (node.isDir) {
                this.toggleFolder(node);
            } else {
                this.switchToFile(node.file);
            }
        },
        // ---- Tag color ----
        onTagColorChange(e) {
            this.tagColor = e.target.value;
            localStorage.setItem("pvf-tag-color", this.tagColor);
        },
        // ---- PVF text formatting (indent for nested block tags) ----
        applyFormatting(text) {
            if (!text || !this.currentFile || this.currentFile.dataType !== 1) return text;
            // .nut 明文 Squirrel 脚本自带缩进，加载不自动重排（显式触发见 formatNutClick）
            if (/\.nut$/i.test(this.currentFile.name || "")) return text;
            return this.formatPvfText(text);
        },
        // .nut Squirrel 缩进格式化（docs/pvf-tw-nut-script.md §3.4，仅显式触发）：
        // 对当前编辑文本重排花括号层级缩进并进入脏态，经既有保存链写盘；
        // 仅重排 ASCII 空白与行首缩进，字符串 / 注释内容逐字保留；光标按原行号恢复。
        formatNutClick() {
            if (!this.currentFile || !/\.nut$/i.test(this.currentFile.name || "")) return;
            // 折叠态 textarea 只承载可见行、字符偏移与全文不一致，先展开回编辑态再按全文重排
            if (this.nutFolds.length > 0) this.expandAllNutFolds();
            const el = this.$refs.editorEl;
            const sel = el ? el.selectionStart : 0;
            const linesBefore = this.editText.split("\n");
            let line = 0;
            let col = 0;
            for (let i = 0, off = 0; i < linesBefore.length; i++) {
                const len = linesBefore[i].length;
                if (sel <= off + len) {
                    line = i;
                    col = sel - off;
                    break;
                }
                off += len + 1;
            }
            const formatted = formatNutText(this.editText);
            if (formatted === this.editText) return;
            this.editText = formatted;
            const formattedLines = formatted.split("\n");
            if (line < formattedLines.length) {
                const pos = formattedLines.slice(0, line).reduce((a, l) => a + l.length + 1, 0) + Math.min(col, formattedLines[line].length);
                this.$nextTick(() => {
                    if (this.$refs.editorEl) this.$refs.editorEl.setSelectionRange(pos, pos);
                });
            }
        },
        formatPvfText(text) {
            const indentUnit = "    ";
            const lines = text.split("\n");
            const result = [];
            let depth = 0;
            let inBacktick = false;

            for (const line of lines) {
                const trimmed = line.trim();
                let lineStartInBacktick = inBacktick;
                for (let j = 0; j < line.length; j++) {
                    if (line[j] === "`") {
                        if (inBacktick && j + 1 < line.length && line[j + 1] === "`") {
                            j++;
                            continue;
                        }
                        inBacktick = !inBacktick;
                    }
                }
                if (lineStartInBacktick || (inBacktick && trimmed.startsWith("`"))) {
                    result.push(lineStartInBacktick ? line : indentUnit.repeat(depth) + trimmed);
                    continue;
                }
                const openMatch = /^\[([^\]\[`{}]+)\]$/.exec(trimmed);
                const closeMatch = /^\[\/([^\]\[`{}]+)\]$/.exec(trimmed);
                const isTag = /^\[\/?[^\]\[`{}]+\]$/.test(trimmed);
                const isMarker = /^\{[0-9]+=/.test(trimmed);

                if (openMatch && PVF_BLOCK_TAGS.has(openMatch[1].toLowerCase())) {
                    result.push(indentUnit.repeat(depth) + trimmed);
                    depth++;
                } else if (closeMatch) {
                    depth = Math.max(0, depth - 1);
                    result.push(indentUnit.repeat(depth) + trimmed);
                } else if (isTag || isMarker) {
                    result.push(indentUnit.repeat(depth) + trimmed);
                } else if (trimmed === "" || trimmed.startsWith("#")) {
                    result.push(line);
                } else {
                    result.push(indentUnit.repeat(depth) + trimmed);
                }
            }
            return result.join("\n");
        },
        // ---- Block tag folding ----
        onEditorMouseDown(e) {
            if (!this.editText) return;
            const ta = this.$refs.editorEl;
            if (!ta) return;
            const m = this.getEditorMetrics();
            if (!m) return;
            const rect = ta.getBoundingClientRect();
            const relY = e.clientY - rect.top;
            const row = Math.floor((relY + ta.scrollTop - m.paddingTop) / m.lineHeight);
            if (row < 0 || row >= this.editLines.length) return;
            if (this.foldableLines.has(row) || this.foldedLineSet.has(row)) {
                e.preventDefault();
                this.toggleFold(row);
            }
        },
        onEditorBeforeInput(e) {
            if (this.foldedLineSet.size === 0) return;
            const ta = e.target;
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            const before = this.editText.substring(0, start);
            const startLine = before.split("\n").length - 1;
            if (start !== end) {
                const selected = this.editText.substring(start, end);
                const lineCount = selected.split("\n").length;
                for (let i = 0; i < lineCount; i++) {
                    if (this.foldedLineSet.has(startLine + i)) {
                        e.preventDefault();
                        return;
                    }
                }
            } else {
                if (this.foldedLineSet.has(startLine)) {
                    e.preventDefault();
                    return;
                }
                if (e.inputType === "deleteContentBackward" && start > 0 && before.endsWith("\n")) {
                    if (this.foldedLineSet.has(startLine - 1)) {
                        e.preventDefault();
                        return;
                    }
                }
                if (e.inputType === "deleteContentForward") {
                    const after = this.editText.substring(end);
                    if (after.startsWith("\n")) {
                        const nextLine = startLine + 1;
                        if (this.foldedLineSet.has(nextLine)) {
                            e.preventDefault();
                            return;
                        }
                    }
                }
            }
        },
        toggleFold(lineIndex) {
            const lines = this.editLines;
            if (lineIndex < 0 || lineIndex >= lines.length) return;
            if (this.foldedLineSet.has(lineIndex)) {
                this.unfoldLine(lineIndex);
            } else if (this.foldableLines.has(lineIndex)) {
                this.foldBlock(lineIndex);
            }
        },
        foldBlock(openLineIndex) {
            const lines = this.editLines;
            const openLine = lines[openLineIndex];
            const tagMatch = /^\s*(\[([^\]\[`{}]+)\])\s*$/.exec(openLine);
            if (!tagMatch) return;
            const tagName = tagMatch[2];
            const closeTag = `[/${tagName}]`;
            let closeLineIndex = -1;
            let depth = 0;
            for (let i = openLineIndex + 1; i < lines.length; i++) {
                const m = /^\s*(\[\/?[^\]\[`{}]+\])\s*$/.exec(lines[i]);
                if (!m) continue;
                const t = m[1];
                if (t === closeTag) {
                    if (depth === 0) {
                        closeLineIndex = i;
                        break;
                    }
                    depth--;
                } else if (t === tagMatch[1]) {
                    depth++;
                }
            }
            if (closeLineIndex < 0 || closeLineIndex <= openLineIndex + 1) return;
            const lineCount = closeLineIndex - openLineIndex + 1;
            const content = lines.slice(openLineIndex, closeLineIndex + 1).join("\n");
            const indent = (openLine.match(/^\s*/) || [""])[0];
            const placeholder = `${indent}${tagMatch[1]} ⋯ ${lineCount} lines folded ⋯ ${closeTag}`;
            const wasDirty = this.textDirty;
            this.isFolding = true;
            const newLines = [...lines];
            newLines.splice(openLineIndex, lineCount, placeholder);
            this.editText = newLines.join("\n");
            this.isFolding = false;
            if (!wasDirty) {
                this.originalText = this.editText;
                this.textDirty = false;
            }
            this.folds.push({ tag: tagName.toLowerCase(), content, placeholder: placeholder.trim() });
            this.$nextTick(() => this.syncScroll());
        },
        unfoldLine(lineIndex) {
            const lines = this.editLines;
            const line = lines[lineIndex].trim();
            const foldIdx = this.folds.findIndex(f => f.placeholder === line);
            if (foldIdx < 0) return;
            const fold = this.folds[foldIdx];
            const wasDirty = this.textDirty;
            this.isFolding = true;
            const newLines = [...lines];
            newLines.splice(lineIndex, 1, fold.content);
            this.editText = newLines.join("\n");
            this.isFolding = false;
            if (!wasDirty) {
                this.originalText = this.editText;
                this.textDirty = false;
            }
            this.folds.splice(foldIdx, 1);
            this.$nextTick(() => this.syncScroll());
        },
        unfoldAll() {
            if (this.folds.length === 0) return;
            const wasDirty = this.textDirty;
            this.isFolding = true;
            let text = this.editText;
            for (let i = this.folds.length - 1; i >= 0; i--) {
                const fold = this.folds[i];
                const idx = text.lastIndexOf(fold.placeholder);
                if (idx >= 0) {
                    text = text.substring(0, idx) + fold.content + text.substring(idx + fold.placeholder.length);
                }
            }
            this.editText = text;
            this.isFolding = false;
            if (!wasDirty) {
                this.originalText = this.editText;
                this.textDirty = false;
            }
            this.folds = [];
            this.$nextTick(() => this.syncScroll());
        },
        switchToFile(file) {
            // Deferred check: compare only when switching
            if (this.textDirty && this.editText !== this.originalText && this.isEditable) {
                confirmModal({
                    title: "未保存的修改",
                    message: `当前文件有未保存的修改，是否保存后切换？`,
                    confirmText: "保存并切换",
                    cancelText: "丢弃修改"
                }).then(ok => {
                    if (ok) {
                        this.stageChange().then(() => this.loadFileContent(file));
                    } else {
                        this.loadFileContent(file);
                    }
                });
            } else {
                this.loadFileContent(file);
            }
        },
        onNodeContext(e, node) {
            e.preventDefault();
            e.stopPropagation();
            this.contextMenu.show = true;
            this.contextMenu.x = e.clientX;
            this.contextMenu.y = e.clientY;
            this.contextMenu.node = node;
        },
        hideContextMenu() {
            this.contextMenu.show = false;
            this.contextMenu.node = null;
        },
        // ---- File content loading ----
        async loadFileContent(file) {
            if (this._loadingFileIndex === file.index) return;
            this._loadingFileIndex = file.index;
            this.currentFile = file;
            this.editText = "";
            this.originalText = "";
            this.highlightedHtml = "";
            this.readonlyPreviewHtml = "";
            this.textDirty = false;
            this._editorMetrics = null;
            this._hlCache = null;
            this.folds = [];
            this.nutFolds = [];
            this.nutGutterHovered = false;
            // 装饰层随文件切换复位：光标 / 选区与滚动偏移归零，并失效几何缓存
            this.nutCaretStart = 0;
            this.nutCaretEnd = 0;
            this.decorX = 0;
            this.decorY = 0;
            this.decorTick++;
            this.isLargeFile = false;
            this.largeFilePreviewHtml = "";
            this.largeFileLineCount = 0;
            this.largeFullLines = [];
            this.largeFullView = false;
            this.largeFullLoading = false;
            this.largeScrollTop = 0;
            this.largeViewHeight = 0;
            this.clearLargeSearch();
            this.largeRowCache.clear();
            if (this._largeResizeObserver) {
                this._largeResizeObserver.disconnect();
                this._largeResizeObserver = null;
            }

            if (file.isDir) {
                this.originalText = "[目录标记]";
                this.editText = "[目录标记]";
                this._loadingFileIndex = null;
                return;
            }

            this.loading = true;
            this.loadingMessage = "加载文件内容...";
            try {
                const data = await this.archive.getFileData(file);
                if (this._loadingFileIndex !== file.index) {
                    this._loadingFileIndex = null;
                    return;
                }
                if (!data) {
                    this.originalText = "[无法读取文件数据]";
                    this.editText = this.originalText;
                    this.loading = false;
                    this._loadingFileIndex = null;
                    return;
                }
                const text = await (async () => {
                    if (this.archive.isLstFile(file)) {
                        this.loadingMessage = "解析列表名称...";
                        const t = await this.archive.decodeLstWithNames(file);
                        if (this._loadingFileIndex !== file.index) {
                            this._loadingFileIndex = null;
                            return null;
                        }
                        return t;
                    }
                    // 编辑展示走缩进版解码（docs/pvfine-external-reference.md §4）：dataType=1 token 流
                    // 标签行与值区行首缩进；原 decodeContent 保持无缩进，名称/元数据/导出等路径不受影响
                    return this.archive.decodeContentForEdit(file, data);
                })();
                if (text === null) return;
                // 超大文件：跳过格式化/高亮/校验/全量 textarea 渲染，只读预览前 N 行；
                // 保存全量行数组，供「加载全部内容」进入虚拟滚动浏览时零二次解码复用。
                if (text.length > LARGE_FILE_CHAR_LIMIT) {
                    const lines = text.split("\n");
                    this.largeFullLines = lines;
                    const previewText = lines.slice(0, LARGE_FILE_PREVIEW_LINES).join("\n");
                    const formatted = this.applyFormatting(previewText);
                    this.isLargeFile = true;
                    this.largeFileLineCount = lines.length;
                    this.largeFilePreviewHtml = this._renderHighlighted(formatted) + "\n";
                    this.originalText = "";
                    this.editText = "";
                    this.loading = false;
                    this._loadingFileIndex = null;
                    return;
                }
                const formatted = this.applyFormatting(text);
                this.originalText = formatted;
                this.editText = formatted;
                // 只读归档（REPACK/60CN）预览：明文文本按 PVF 语法高亮渲染（标签着色 + lst 名称染灰），
                // 与 highlightMode 无关（60CN 文件 dataType 恒 0，highlightMode 为 plaintext）；
                // .str 文件走 TW/CN 同款 key>text 行格式渲染（前缀红 / > 淡蓝 / 内容灰，注释绿）
                if (this.isReadonlyArchive && !this.isLargeFile) {
                    try {
                        if (this.isStrFile || this.isStringTable) {
                            this.readonlyPreviewHtml = this._renderKeyValueText(formatted);
                        } else {
                            this.readonlyPreviewHtml = this.annotateRefs(this.grayLstNames(this.annotateTagSpans(hljs.highlight(formatted, { language: "pvf" }).value), formatted));
                        }
                    } catch {
                        this.readonlyPreviewHtml = this.annotateTagSpans(this.escapeHtml(formatted));
                    }
                }
                this.loading = false;
                this._loadingFileIndex = null;
                this.$nextTick(() => {
                    if (this.$refs.editorEl) this.$refs.editorEl.scrollTop = 0;
                    this.syncScroll();
                    this.updateHighlight();
                    this.runValidation();
                    this.validationVisible = false;
                });
            } catch (err) {
                this.loading = false;
                this._loadingFileIndex = null;
                alertModal({ title: "加载失败", message: err.message });
            }
        },
        // ---- Editing ----
        async stageChange() {
            if (!this.currentFile || !this.textDirty) return;
            if (this.folds.length > 0) this.unfoldAll();
            if (!this.textDirty) return;
            if (this.currentFile.isDir || (this.currentFile.dataType !== 1 && this.currentFile.dataType !== 3)) {
                alertModal({ title: "无法编辑", message: "仅支持编辑 Type 1 (脚本) 和 Type 3 (文本) 文件。" });
                return;
            }
            // 语法检查：脚本文件不通过则禁止保存
            if (this.highlightMode === "pvf" && !this.ensureValid("保存")) return;

            this.isStaging = true;
            await new Promise(r => setTimeout(r, 50));

            try {
                this.archive.setFileContent(this.currentFile.index, this.editText);
                this.originalText = this.editText;
                this.textDirty = false;
            } catch (err) {
                alertModal({ title: "编码失败", message: err.message });
            }
            this.isStaging = false;
        },
        revertCurrent() {
            if (!this.currentFile || (!this.isCurrentModified && !this.isCurrentDeleted && !this.archive.isFileRenamed(this.currentFile.index))) return;
            confirmModal({ title: "撤销修改", message: `确认撤销 <code>${this.currentFile.fullpath}</code> 的修改？` }).then(ok => {
                if (ok) {
                    const idx = this.currentFile.index;
                    this.archive.revertFile(idx);
                    this._treeCache = null;
                    this.changeStamp++;
                    // Reload from archive
                    const file = this.archive.files[idx];
                    this.loadFileContent(file);
                }
            });
        },
        revertAll() {
            if (!this.archive || !this.hasChanges) return;
            const total = this.modifiedCount + this.deletedCount + this.renamedCount;
            confirmModal({ title: "撤销全部修改", message: `确认撤销全部 ${total} 项修改？` }).then(ok => {
                if (ok) {
                    this.archive.revertAll();
                    this._treeCache = null;
                    this.changeStamp++;
                    this.strEncoding = this.archive.strEncoding;
                    if (this.currentFile) {
                        this.loadFileContent(this.archive.files[this.currentFile.index]);
                    }
                }
            });
        },
        // ---- Delete ----
        deleteNode(node) {
            if (!node) return;
            if (node.isDir) {
                const files = this.archive.files.filter(f => !this.archive.isFileDeleted(f.index) && f.fullpath.startsWith(node.path + "/"));
                if (files.length === 0) {
                    alertModal({ title: "无法删除", message: "该目录为空。" });
                    return;
                }
                confirmModal({ title: "删除目录", message: `确认删除目录 <code>${node.path}</code> 及其下 ${files.length} 个文件？` }).then(ok => {
                    if (ok) {
                        files.forEach(f => this.archive.deleteFile(f.index));
                        this._treeCache = null;
                        this.changeStamp++;
                        if (this.currentFile && files.some(f => f.index === this.currentFile.index)) {
                            this.currentFile = null;
                            this.editText = "";
                            this.originalText = "";
                        }
                    }
                });
            } else {
                confirmModal({
                    title: "删除文件",
                    message: `确认删除 <code>${node.file.fullpath}</code>？<br/><span style="font-size:0.75rem;color:var(--text-muted)">删除后可在保存时生效，撤销全部修改可恢复。</span>`
                }).then(ok => {
                    if (ok) {
                        this.archive.deleteFile(node.file.index);
                        this._treeCache = null;
                        this.changeStamp++;
                        if (this.currentFile && this.currentFile.index === node.file.index) {
                            this.currentFile = null;
                            this.editText = "";
                            this.originalText = "";
                        }
                    }
                });
            }
        },
        // ---- Rename with full reference checking ----
        async renameNode(node) {
            if (!node) return;
            const isFolder = node.isDir;
            const oldName = isFolder ? node.name : node.file.name;
            const newName = window.prompt(`重命名${isFolder ? "目录" : "文件"} "${oldName}" 为:`, oldName);
            if (!newName || newName === oldName) return;

            this.loading = true;
            this.loadingMessage = "重命名并检查引用中...";
            try {
                let renameMappings = [];

                if (isFolder) {
                    const result = this.archive.renameFolder(node.path, newName);
                    renameMappings = result.mappings;
                } else {
                    const fileIndex = node.file.index;
                    const result = this.archive.renameFile(fileIndex, newName);
                    renameMappings = [{ old: result.oldFullpath, new: result.newFullpath }];
                }

                // Build thorough replace mappings (with and without extension)
                const searchMappings = this.archive.buildPathMappings(renameMappings);

                // Reference DETECTION: every path renamed as part of a folder
                // rename shares the old folder prefix, so searching just that one
                // prefix is a sound pre-filter (no false negatives) and turns an
                // O(files * paths) scan into O(files * 1). fixReferences below
                // still rewrites each specific old->new path within matched files.
                const detectPaths = isFolder ? [node.path + "/"] : searchMappings.map(m => m.old);
                const refs = await this.archive.findReferencesMulti(detectPaths);

                let fixedCount = 0;
                if (refs.length > 0) {
                    const proceed = await confirmModal({
                        title: "发现引用",
                        message: `在 ${refs.length} 个文件中发现指向该${isFolder ? "目录" : "文件"}的引用，是否全量修复？`,
                        confirmText: "全量修复",
                        cancelText: "仅重命名"
                    });
                    if (proceed) {
                        fixedCount = await this.archive.fixReferences(searchMappings, refs);
                    }
                }

                this.loading = false;
                this._treeCache = null;
                this.changeStamp++;

                // Reload current file if it was affected
                if (this.currentFile) {
                    const affected = renameMappings.some(m => m.old === this.currentFile.fullpath);
                    if (affected) {
                        this.currentFile = this.archive.files[this.currentFile.index];
                    }
                }

                const msg =
                    `已重命名${isFolder ? "目录" : "文件"}为 <code>${newName}</code>。` +
                    (isFolder ? ` 影响 ${renameMappings.length} 个文件。` : "") +
                    (refs.length > 0 ? ` 引用修复: ${fixedCount}/${refs.length}` : " 无外部引用");
                alertModal({ title: "重命名完成", message: msg });
            } catch (err) {
                this.loading = false;
                alertModal({ title: "重命名失败", message: err.message });
            }
        },
        // ---- Export ----
        async exportNode(node) {
            if (!node || node.isDir) {
                alertModal({ title: "无法导出", message: "暂不支持导出整个目录。" });
                return;
            }
            this.loading = true;
            this.loadingMessage = "导出文件中...";
            try {
                const result = await this.archive.exportFile(node.file);
                if (!result) {
                    alertModal({ title: "导出失败", message: "无法读取文件数据。" });
                    this.loading = false;
                    return;
                }
                const url = URL.createObjectURL(result.blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = result.filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                this.loading = false;
            } catch (err) {
                this.loading = false;
                alertModal({ title: "导出失败", message: err.message });
            }
        },
        // ---- Import ----
        triggerImport(node) {
            if (!node || node.isDir) {
                alertModal({ title: "无法导入", message: "请选择一个文件进行导入替换。" });
                return;
            }
            if (node.file.dataType !== 1 && node.file.dataType !== 3) {
                confirmModal({
                    title: "导入二进制文件",
                    message: `将以原始字节替换 <code>${node.file.fullpath}</code> 的内容，确认继续？`
                }).then(ok => {
                    if (ok) {
                        this.importTarget = { kind: "binary", fileIndex: node.file.index };
                        this.$nextTick(() => this.$refs.importInputEl && this.$refs.importInputEl.click());
                    }
                });
            } else {
                this.importTarget = { kind: "text", fileIndex: node.file.index };
                this.$nextTick(() => this.$refs.importInputEl && this.$refs.importInputEl.click());
            }
        },
        async handleImportSelect(event) {
            const file = event.target.files[0];
            event.target.value = "";
            if (!file || !this.importTarget) return;

            const target = this.importTarget;
            this.importTarget = null;
            this.loading = true;
            this.loadingMessage = "导入文件中...";
            try {
                const arch = this.archive;
                const targetFile = arch.files[target.fileIndex];
                if (target.kind === "text") {
                    const text = await file.text();
                    arch.setFileContent(target.fileIndex, text);
                    if (this.currentFile && this.currentFile.index === target.fileIndex) {
                        const formatted = this.applyFormatting(text);
                        this.originalText = formatted;
                        this.editText = formatted;
                        this.textDirty = false;
                        this.folds = [];
                        this.updateHighlight();
                    }
                } else {
                    const buf = new Uint8Array(await file.arrayBuffer());
                    arch.setFileRawData(target.fileIndex, buf);
                    if (this.currentFile && this.currentFile.index === target.fileIndex) {
                        const data = await arch.getFileData(targetFile);
                        const text = arch.decodeContent(targetFile, data);
                        const formatted = this.applyFormatting(text);
                        this.originalText = formatted;
                        this.editText = formatted;
                        this.textDirty = false;
                        this.folds = [];
                        this.updateHighlight();
                    }
                }
                this.loading = false;
                alertModal({ title: "导入成功", message: `已将 <code>${file.name}</code> 的内容导入到 <code>${targetFile.fullpath}</code>。` });
            } catch (err) {
                this.loading = false;
                alertModal({ title: "导入失败", message: err.message });
            }
        },
        // ---- Encoding switching ----
        changeEncoding(enc) {
            if (!this.archive || this.strEncoding === enc) return;
            // 有未保存的编辑时提示：切换编码会按新编码重新解码，未保存内容将丢失
            const apply = () => {
                this.loading = true;
                this.loadingMessage = "切换编码中...";
                this.$nextTick(async () => {
                    try {
                        // setEncoding 会清空字符串缓存并按新编码重新解析所有文件名/路径
                        this.archive.setEncoding(enc);
                        this.strEncoding = enc;
                        // 重新读取当前文件（按新编码解码）
                        if (this.currentFile && !this.currentFile.isDir) {
                            const file = this.archive.files[this.currentFile.index];
                            this.currentFile = file;
                            const data = await this.archive.getFileData(file);
                            if (data) {
                                let text;
                                if (this.archive.isLstFile(file)) {
                                    this.loadingMessage = "解析列表名称...";
                                    text = await this.archive.decodeLstWithNames(file);
                                    if (this._loadingFileIndex !== file.index) {
                                        this._loadingFileIndex = null;
                                        return;
                                    }
                                } else {
                                    text = this.archive.decodeContent(file, data);
                                }
                                const formatted = this.applyFormatting(text);
                                this.originalText = formatted;
                                this.editText = formatted;
                                this.textDirty = false;
                                this.folds = [];
                                this.selectedPath = file.fullpath;
                                this._editorMetrics = null;
                                this.decorTick++;
                                this.$nextTick(() => {
                                    this.updateHighlight();
                                    this.runValidation();
                                    this.validationVisible = false;
                                    this.syncScroll();
                                });
                            }
                        }
                    } catch (err) {
                        alertModal({ title: "编码切换失败", message: err.message });
                    }
                    this.loading = false;
                });
            };
            if (this.textDirty && this.editText !== this.originalText && this.isEditable) {
                confirmModal({
                    title: "未保存的修改",
                    message: "切换编码将丢弃当前文件未保存的修改，是否继续？",
                    confirmText: "继续切换",
                    cancelText: "取消"
                }).then(ok => {
                    if (ok) apply();
                });
            } else {
                apply();
            }
        },
        // ---- Save PVF ----
        async downloadPvf() {
            if (!this.archive) return;
            // 重打包归档（REPACK/60CN）为只读展示层：编辑回写未实现（docs/pvf-repack-format.md §4）
            if (this.archive.headerFormat === PvfFormat.REPACK) {
                alertModal({ title: "只读格式", message: "该归档为重打包格式（60CN），暂不支持保存导出。" });
                return;
            }
            if (this.folds.length > 0) this.unfoldAll();
            // 自动暂存当前文件的未保存编辑
            if (this.textDirty && this.isEditable) {
                if (this.highlightMode === "pvf" && !this.ensureValid("保存")) return;
                this.isStaging = true;
                await new Promise(r => setTimeout(r, 50));
                try {
                    this.archive.setFileContent(this.currentFile.index, this.editText);
                    this.originalText = this.editText;
                    this.textDirty = false;
                    this.addLog(`已暂存：${this.currentFile.fullpath}`, "info");
                } catch (err) {
                    alertModal({ title: "编码失败", message: err.message });
                    this.isStaging = false;
                    return;
                }
                this.isStaging = false;
            }
            if (!this.hasChanges) {
                alertModal({ title: "无修改", message: "尚未修改任何文件，无需导出。" });
                return;
            }

            this.saving = true;
            this.saveProgress = 0;
            this.saveProgressText = "准备重建 PVF...";

            try {
                const result = await this.archive.saveAs((curr, total, phase) => {
                    if (phase === "verify") {
                        this.saveProgress = 100;
                        this.saveProgressText = "自校验中...";
                        return;
                    }
                    this.saveProgress = Math.round((curr / total) * 100);
                    this.saveProgressText = `${this.archive.headerFormat === PvfFormat.TW ? "重建文件" : "重建分块"} ${curr} / ${total}...`;
                });
                this.saveProgressText = "下载中...";

                const blob = new Blob([result], { type: "application/octet-stream" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = sanitizeFilename(this.fileName.replace(/\.pvf$/i, "") + ".modified.pvf");
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                this.saving = false;
                this.addLog(`导出完成：${this.modifiedCount} 修改、${this.deletedCount} 删除、${this.renamedCount} 重命名，大小 ${formatBytes(result.length)}`, "success");
                alertModal({
                    title: "导出完成",
                    message: `已导出 ${this.modifiedCount} 个修改、${this.deletedCount} 个删除、${this.renamedCount} 个重命名，新 PVF 大小 ${formatBytes(result.length)}。`
                });
            } catch (err) {
                this.saving = false;
                console.error(err);
                this.addLog(`导出失败：${err.message}`, "error");
                alertModal({ title: "导出失败", message: err.message });
            }
        },
        // ---- Keyboard navigation ----
        handleKeydown(e) {
            if (!this.archive) return;
            if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
            if (e.key === "ArrowDown") {
                e.preventDefault();
                this.selectByOffset(1);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                this.selectByOffset(-1);
            }
        },
        selectByOffset(delta) {
            const items = this.visibleNodes;
            if (items.length === 0) return;
            let curIdx = items.findIndex(it => it.node.path === this.selectedPath);
            if (curIdx < 0) curIdx = -1 + delta;
            let next = Math.max(0, Math.min(items.length - 1, curIdx + delta));
            while (next < items.length && items[next].node.isDir) {
                next = next + delta;
                if (next < 0 || next >= items.length) return;
            }
            if (next >= 0 && next < items.length && !items[next].node.isDir) {
                this.onNodeClick(items[next].node);
                const top = next * this.rowHeight;
                const bottom = top + this.rowHeight;
                if (this.$refs.listEl) {
                    if (top < this.$refs.listEl.scrollTop) this.$refs.listEl.scrollTop = top;
                    else if (bottom > this.$refs.listEl.scrollTop + this.$refs.listEl.clientHeight) this.$refs.listEl.scrollTop = bottom - this.$refs.listEl.clientHeight;
                }
            }
        },
        close() {
            if (this.archive && this.hasChanges) {
                const total = this.modifiedCount + this.deletedCount + this.renamedCount;
                confirmModal({ title: "确认关闭", message: `有 ${total} 项未保存的修改，确认关闭编辑器？` }).then(ok => {
                    if (ok) this.$router.push({ name: "Game" });
                });
            } else {
                this.$router.push({ name: "Game" });
            }
        },
        // ---- Window handlers ----
        onWindowKeydown(e) {
            // Ctrl/Cmd + S：保存当前文件（暂存到归档）
            if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
                if (this.archive) {
                    e.preventDefault();
                    if (this.currentFile && this.isEditable) this.stageChange();
                }
                return;
            }
            // Ctrl/Cmd + Z：撤销当前文件已保存的修改（无修改时放行原生文本撤销）
            if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
                if (this.archive && this.currentFile && (this.isCurrentModified || this.isCurrentDeleted || this.isCurrentRenamed)) {
                    e.preventDefault();
                    this.revertCurrent();
                }
                return;
            }
            if (e.key === "Escape" && this.contextMenu.show) {
                this.hideContextMenu();
            }
        },
        onWindowResize() {
            // 合并同帧内的多次 resize 事件，只在下一帧处理一次，避免窗口拖拽期间反复触发
            // 强制 reflow（读取 clientHeight）+ 列表渲染造成的布局抖动。
            if (this._resizeRaf) return;
            this._resizeRaf = requestAnimationFrame(() => {
                this._resizeRaf = 0;
                this.updateContainerHeight();
            });
        },
        // ---- Overlay editor: scroll sync + tab + highlight ----
        syncScroll() {
            if (this.$refs.highlightEl && this.$refs.editorEl) {
                this.$refs.highlightEl.scrollTop = this.$refs.editorEl.scrollTop;
                this.$refs.highlightEl.scrollLeft = this.$refs.editorEl.scrollLeft;
            }
            if (this.$refs.gutterEl && this.$refs.editorEl) {
                this.$refs.gutterEl.scrollTop = this.$refs.editorEl.scrollTop;
            }
            this.syncDecorScroll();
        },
        // 装饰覆盖层滚动偏移：高亮层 / 折叠正文层为独立滚动容器，装饰层用反向平移跟随
        syncDecorScroll() {
            const src = this.$refs.editorEl || this.$refs.foldEditorEl || this.$refs.foldBodyEl;
            if (!src) return;
            this.decorX = src.scrollLeft;
            this.decorY = src.scrollTop;
        },
        // 光标 / 选区同步（textarea selectionStart / selectionEnd → 装饰覆盖层输入）
        syncCaret() {
            const ta = this.$refs.editorEl;
            if (!ta) return;
            this.nutCaretStart = ta.selectionStart;
            this.nutCaretEnd = ta.selectionEnd;
        },
        // 0 基字符偏移 → { line（0 基）、column（1 基可见列） }
        _nutOffsetToPosition(offset) {
            const text = this.editText || "";
            const pos = Math.max(0, Math.min(Number.isFinite(offset) ? offset : 0, text.length));
            let line = 0;
            let lineStart = 0;
            for (let i = 0; i < pos; i++) {
                if (text.charCodeAt(i) === 10) {
                    line++;
                    lineStart = i + 1;
                }
            }
            const content = this.editLines[line] == null ? "" : this.editLines[line];
            return { line, column: this._nutVisibleColumn(content, pos - lineStart) };
        },
        // 行内原始下标 → 可见列（制表符按 tab-size 4 折算，与装饰矩形线性换算一致）
        _nutVisibleColumn(lineText, rawIndex) {
            let column = 1;
            const end = Math.min(rawIndex, lineText.length);
            for (let i = 0; i < end; i++) column += lineText[i] === "\t" ? 4 : 1;
            return column;
        },
        onEditorKeydown(e) {
            if (e.key === "Tab") {
                e.preventDefault();
                const ta = e.target;
                const start = ta.selectionStart;
                const end = ta.selectionEnd;
                const indent = "    ";
                this.editText = this.editText.slice(0, start) + indent + this.editText.slice(end);
                this.$nextTick(() => {
                    ta.selectionStart = ta.selectionEnd = start + indent.length;
                    this.syncScroll();
                });
            }
        },
        scheduleHighlight() {
            if (this.highlightTimer) clearTimeout(this.highlightTimer);
            // textarea 文本透明、可见文本来自高亮层 <pre>，因此高亮刷新越快输入回显越及时。
            // 小文件高亮耗时极低，用 0ms（下一宏任务）近乎实时刷新；大文件拉长延时避免逐键阻塞主线程。
            const len = this.editText ? this.editText.length : 0;
            const delay = len > 80000 ? 300 : len > 20000 ? 100 : 0;
            this.highlightTimer = setTimeout(() => this.updateHighlight(), delay);
        },
        updateHighlight() {
            if (this.highlightTimer) {
                clearTimeout(this.highlightTimer);
                this.highlightTimer = null;
            }
            const text = this.editText || "";
            const mode = this.highlightMode;
            const isLst = this.isLst;
            // 缓存命中：文本与模式均未变化则跳过重复高亮（避免加载/编码切换等处重复计算）
            if (this._hlCache && this._hlCache.text === text && this._hlCache.mode === mode && this._hlCache.isLst === isLst) {
                return;
            }
            let html;
            if (this.isStringTable || this.isStrFile) {
                html = this._renderKeyValueText(text);
            } else if (!text || text.length > 500000) {
                html = this.annotateTagSpans(this.escapeHtml(text));
            } else if (mode === "pvf") {
                try {
                    const result = hljs.highlight(text, { language: "pvf" });
                    html = this.annotateRefs(this.grayLstNames(this.annotateTagSpans(result.value), text));
                } catch (e) {
                    html = this.annotateRefs(this.grayLstNames(this.annotateTagSpans(this.escapeHtml(text)), text));
                }
            } else if (mode === "nut") {
                // .nut Squirrel 代码高亮：不叠加 PVF 标签注解（无 [tag] / lst 名称语义）
                try {
                    html = hljs.highlight(text, { language: "squirrel" }).value;
                } catch (e) {
                    html = this.escapeHtml(text);
                }
            } else if (mode === "xml") {
                try {
                    const result = hljs.highlight(text, { language: "xml" });
                    html = this.annotateTagSpans(result.value);
                } catch (e) {
                    html = this.annotateTagSpans(this.escapeHtml(text));
                }
            } else {
                // 其余类型（如 Type 3 纯文本）无注册语言，回退转义文本
                html = this.annotateTagSpans(this.escapeHtml(text));
            }
            if (this.folds.length > 0) {
                const textLines = text.split("\n");
                const htmlLines = html.split("\n");
                for (let i = 0; i < textLines.length && i < htmlLines.length; i++) {
                    if (/^\s*\[[^\]]+\]\s*⋯\s*\d+\s+lines?\s*folded\s*⋯\s*\[\/[^\]]+\]\s*$/.test(textLines[i])) {
                        htmlLines[i] = `<span class="pvf-folded-line">${htmlLines[i]}</span>`;
                    }
                }
                html = htmlLines.join("\n");
            }
            html += "\n";
            this._hlCache = { text, mode, isLst, html };
            this.highlightedHtml = html;
        },
        // 高亮文本 -> HTML（用于超大文件只读预览，不带折叠处理）
        _renderHighlighted(text) {
            if (!text) return "";
            if (this.isStringTable || this.isStrFile) return this._renderKeyValueText(text);
            const mode = this.highlightMode;
            try {
                if (mode === "pvf") return this.annotateRefs(this.grayLstNames(this.annotateTagSpans(hljs.highlight(text, { language: "pvf" }).value), text));
                if (mode === "nut") return hljs.highlight(text, { language: "squirrel" }).value;
                if (mode === "xml") return this.annotateTagSpans(hljs.highlight(text, { language: "xml" }).value);
            } catch (e) {
                /* fall through to escaped text */
            }
            return this.annotateTagSpans(this.escapeHtml(text));
        },
        // .str 与 .bin（stringtable.bin）统一解析渲染规则：
        // 每行 `前缀>内容` 拆为三部分，各部分内部颜色统一（前缀红 / > 淡蓝 / 内容灰）；
        // `#PVF_File` 头与 `//` 开头行视为注释，按注释绿（#6a9955）渲染（§9.3.1）；
        // 无 `>` 的行整体按内容灰。
        _renderKeyValueLine(line) {
            const t = String(line).trimStart();
            if (t.startsWith("#") || t.startsWith("//")) {
                return '<span class="hljs-comment">' + this.escapeHtml(line) + "</span>";
            }
            const sep = line.indexOf(">");
            if (sep > 0) {
                return (
                    '<span class="hljs-pvf-bin-id">' +
                    this.escapeHtml(line.slice(0, sep)) +
                    "</span>" +
                    '<span class="hljs-pvf-bin-sep">' +
                    this.escapeHtml(line[sep]) +
                    "</span>" +
                    '<span class="hljs-pvf-bin-text">' +
                    this.escapeHtml(line.slice(sep + 1)) +
                    "</span>"
                );
            }
            return '<span class="hljs-pvf-bin-text">' + this.escapeHtml(line) + "</span>";
        },
        _renderKeyValueText(text) {
            const lines = String(text || "").split("\n");
            const out = new Array(lines.length);
            for (let i = 0; i < lines.length; i++) out[i] = this._renderKeyValueLine(lines[i]);
            return out.join("\n");
        },
        // 为 [xxx] 标签的 hljs-type span 注入 data-tag 属性，便于浮窗解析
        annotateTagSpans(html) {
            if (!html) return html;
            return html.replace(/<span class="hljs-type">(\[\/?[^\]<]*\])<\/span>/g, (m, tag) => {
                const name = parseTagName(tag);
                const info = getTagInfo(name);
                const known = info && info.category !== "other" ? " known" : "";
                const block = info && info.block ? " block" : "";
                const closing = tag.startsWith("[/") ? " closing" : "";
                return `<span class="hljs-type pvf-tag${known}${block}${closing}" data-tag="${this.escapeAttr(name)}">${tag}</span>`;
            });
        },
        escapeAttr(s) {
            return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        },
        // 当前 .lst 文件解码时追加的引用文件名称映射（行号 -> 名称原文），
        // 仅包含实际追加了名称的行；渲染时按行定位，不做高亮。
        _currentLstNameMap() {
            if (!this.isLst || !this.archive || !this.currentFile) return new Map();
            return this.archive.getLstNameMap(this.currentFile) || new Map();
        },
        // 把 HTML 行内行尾的 nameText（可见文本）整体替换为灰色 span（不走 hljs 高亮，
        // 名称内部的 [xxx] / 数字等不再产生高亮 token，整体统一灰色展示）；
        // 行尾不匹配（如用户已编辑该行）则原样返回，避免误染。
        // 注意：hljs 输出中转义了 & < >，比较与计数须用转义后的名称（escapeHtml(nameText)）。
        _grayRowName(rowHtml, nameText) {
            const escaped = this.escapeHtml(nameText);
            let strip = "";
            for (let j = 0; j < rowHtml.length; j++) {
                if (rowHtml[j] === "<") {
                    const k = rowHtml.indexOf(">", j);
                    if (k < 0) break;
                    j = k;
                    continue;
                }
                strip += rowHtml[j];
            }
            const tailStart = strip.length - escaped.length;
            if (tailStart < 0 || strip.slice(tailStart) !== escaped) return rowHtml;
            let vis = 0;
            let startIdx = -1;
            for (let j = 0; j < rowHtml.length; j++) {
                if (rowHtml[j] === "<") {
                    const k = rowHtml.indexOf(">", j);
                    if (k < 0) break;
                    j = k;
                    continue;
                }
                if (vis === tailStart) {
                    startIdx = j;
                    break;
                }
                vis++;
            }
            let endIdx = startIdx;
            let vis2 = 0;
            while (endIdx < rowHtml.length && vis2 < escaped.length) {
                if (rowHtml[endIdx] === "<") {
                    const k = rowHtml.indexOf(">", endIdx);
                    if (k < 0) break;
                    endIdx = k + 1;
                    continue;
                }
                vis2++;
                endIdx++;
            }
            if (startIdx < 0 || endIdx <= startIdx) return rowHtml;
            return rowHtml.slice(0, startIdx) + '<span class="hljs-pvf-name">' + escaped + "</span>" + rowHtml.slice(endIdx);
        },
        // .lst 增强解码在行尾追加的引用文件名称：不走 highlight.js 高亮，
        // 按解码器记录的行号映射整体替换为灰色 span 展示（路径/数字/标签仍正常高亮）。
        grayLstNames(html, text) {
            if (!this.isLst) return html;
            const map = this._currentLstNameMap();
            if (!map || map.size === 0) return html;
            const textLines = String(text || "").split("\n");
            const htmlLines = html.split("\n");
            let changed = false;
            for (const [lineNo, name] of map) {
                const t = textLines[lineNo];
                if (t == null || !name || !t.endsWith(name)) continue;
                const rowHtml = htmlLines[lineNo];
                if (rowHtml == null) continue;
                const grayed = this._grayRowName(rowHtml, name);
                if (grayed !== rowHtml) {
                    htmlLines[lineNo] = grayed;
                    changed = true;
                }
            }
            return changed ? htmlLines.join("\n") : html;
        },
        // 为 .lst 反引号引用路径注入 data-ref 属性（仅 .lst 文件），供大文件预览区点击快捷跳转
        annotateRefs(html) {
            if (!this.isLst) return html;
            return html.replace(/<span class="hljs-string">(`(?:[^`]|``)*`)<\/span>/g, (m, bt) => {
                const ref = bt.slice(1, -1).replace(/``/g, "`");
                return `<span class="hljs-string hljs-pvf-ref" data-ref="${this.escapeAttr(ref)}">${bt}</span>`;
            });
        },
        // 大文件预览区点击引用路径 -> 跳转对应文件
        onHlClick(e) {
            const el = e.target && e.target.closest ? e.target.closest("[data-ref]") : null;
            if (!el) return;
            const ref = el.getAttribute("data-ref");
            if (!this.archive || !this.currentFile || ref == null) return;
            const target = this.archive.getLstRefTarget(this.currentFile, ref);
            if (target && !this.archive.isFileDeleted(target.index)) {
                this.switchToFile(target);
            } else {
                this.addLog(`未找到引用文件：${ref}`, "error");
            }
        },
        // ---- 大文件全量虚拟滚动 ----
        // 「加载全部内容」：复用 loadFileContent 大文件分支已保存的全量行数组，进入虚拟滚动视图
        async loadLargeFileFull() {
            if (this.largeFullLoading) return;
            if (!this.largeFullLines.length && this.currentFile) {
                // 防御：极端情况下全量行缺失，重新解码一次
                this.largeFullLoading = true;
                try {
                    const data = await this.archive.getFileData(this.currentFile);
                    if (data) {
                        const text = this.archive.isLstFile(this.currentFile) ? await this.archive.decodeLstWithNames(this.currentFile) : this.archive.decodeContent(this.currentFile, data);
                        if (text) this.largeFullLines = text.split("\n");
                    }
                } catch (err) {
                    this.addLog(`加载全量内容失败：${err.message || err}`, "error");
                    this.largeFullLoading = false;
                    return;
                }
            }
            this.largeFullView = true;
            this.$nextTick(() => {
                const el = this.$refs.largeVScrollEl;
                if (el) {
                    this.largeViewHeight = el.clientHeight;
                    el.scrollTop = 0;
                    this.addLog(`[虚拟滚动] 加载完成：容器高=${el.clientHeight}px 可滚动高=${el.scrollHeight}px 总行=${this.largeFullLines.length}`, "info");
                    if (this._largeResizeObserver) this._largeResizeObserver.disconnect();
                    this._largeResizeObserver = new ResizeObserver(() => {
                        // 同一帧内的多次尺寸回调合并为一次视图重算，避免 DevTools 挤压视口时高频重渲染
                        if (this._largeResizeRaf) return;
                        this._largeResizeRaf = requestAnimationFrame(() => {
                            this._largeResizeRaf = 0;
                            const h = el.clientHeight;
                            if (h > 0 && h !== this.largeViewHeight) this.largeViewHeight = h;
                        });
                    });
                    this._largeResizeObserver.observe(el);
                }
                this.largeScrollTop = 0;
                this.largeFullLoading = false;
            });
        },
        exitLargeFileFull() {
            this.largeFullView = false;
            this.largeScrollTop = 0;
            this.largeViewHeight = 0;
            this.clearLargeSearch();
            if (this._largeResizeObserver) {
                this._largeResizeObserver.disconnect();
                this._largeResizeObserver = null;
            }
            if (this._largeResizeRaf) cancelAnimationFrame(this._largeResizeRaf);
            this._largeResizeRaf = 0;
        },
        onLargeScroll(e) {
            const el = e.target;
            this.largeScrollTop = el.scrollTop;
            const h = el.clientHeight;
            if (h > 0 && h !== this.largeViewHeight) this.largeViewHeight = h;
            if (!this._largeScrollLogCount) this._largeScrollLogCount = 0;
            if (this._largeScrollLogCount < 5) {
                this.addLog(`[虚拟滚动] scrollTop=${el.scrollTop} viewH=${this.largeViewHeight} rows=${this.largeVisibleRows.length}`, "info");
                this._largeScrollLogCount++;
            }
        },
        // ---- 大文件全量搜索 ----
        onLargeSearchInput() {
            if (this._largeSearchTimer) clearTimeout(this._largeSearchTimer);
            this._largeSearchTimer = setTimeout(() => this.runLargeSearch(), 300);
        },
        // 搜索：原始行子串匹配；未命中时用 name 字符串表映射增强（如 `name_97` -> 中文名称）再匹配
        async runLargeSearch() {
            const q = this.largeSearchQuery.trim();
            this.largeSearchMatches = [];
            this.largeSearchIndex = -1;
            if (!q) return;
            let strMap = null;
            if (this.archive) {
                if (!this.largeSearchNameLoading) this.largeSearchNameLoading = true;
                try {
                    strMap = await this.archive.getStrNameMap();
                } catch (err) {
                    this.addLog(`加载名称映射失败：${err.message || err}`, "error");
                }
                this.largeSearchNameLoading = false;
            }
            const lines = this.largeFullLines;
            const matches = [];
            const hasMap = strMap && strMap.size > 0;
            const reKey = /[A-Za-z_][A-Za-z0-9_]*_\d+/gi;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.includes(q)) {
                    matches.push(i);
                    continue;
                }
                if (hasMap && line.replace(reKey, w => strMap.get(w) || w).includes(q)) matches.push(i);
            }
            this.largeSearchMatches = matches;
            this._jumpToLargeMatch(matches.length ? 0 : -1);
            this.addLog(`搜索「${q}」：${matches.length} 处匹配`, matches.length ? "info" : "error");
        },
        // 跳转到第 idx 个匹配行（滚动画中并高亮）
        _jumpToLargeMatch(idx) {
            this.largeSearchIndex = idx;
            const lineIndex = idx >= 0 ? this.largeSearchMatches[idx] : -1;
            if (lineIndex < 0) return;
            const el = this.$refs.largeVScrollEl;
            if (!el) return;
            const viewH = this.largeViewHeight > 0 ? this.largeViewHeight : 300;
            const target = Math.max(0, lineIndex * LARGE_VIRTUAL_LINE_H - Math.floor(viewH / 2) + LARGE_VIRTUAL_LINE_H / 2);
            el.scrollTop = target;
        },
        nextLargeMatch() {
            const n = this.largeSearchMatches.length;
            if (!n) return;
            this._jumpToLargeMatch((this.largeSearchIndex + 1) % n);
        },
        prevLargeMatch() {
            const n = this.largeSearchMatches.length;
            if (!n) return;
            this._jumpToLargeMatch((this.largeSearchIndex - 1 + n) % n);
        },
        clearLargeSearch() {
            if (this._largeSearchTimer) clearTimeout(this._largeSearchTimer);
            this.largeSearchQuery = "";
            this.largeSearchMatches = [];
            this.largeSearchIndex = -1;
            this.largeSearchNameLoading = false;
        },
        // 单行高亮渲染（含 .lst 引用标注/灰色名称），按行号 LRU 缓存
        _largeRowHtml(i) {
            const no = i + 1;
            let html = this.largeRowCache.get(no);
            if (html !== undefined) return html;
            const line = this.largeFullLines[i] || "";
            const mode = this.highlightMode;
            if (this.isStringTable || this.isStrFile) {
                html = this._renderKeyValueLine(line);
            } else {
                try {
                    if (mode === "pvf") html = hljs.highlight(line, { language: "pvf" }).value;
                    else if (mode === "xml") html = hljs.highlight(line, { language: "xml" }).value;
                    else html = this.escapeHtml(line);
                } catch (err) {
                    html = this.escapeHtml(line);
                }
                html = this.annotateTagSpans(html);
                if (this.isLst) {
                    const name = this._currentLstNameMap().get(i);
                    if (name && line.endsWith(name)) html = this._grayRowName(html, name);
                    html = this.annotateRefs(html);
                }
            }
            if (this.largeRowCache.size >= LARGE_ROW_CACHE_LIMIT) {
                const first = this.largeRowCache.keys().next().value;
                if (first !== undefined) this.largeRowCache.delete(first);
            }
            this.largeRowCache.set(no, html);
            return html;
        },
        // 当前匹配行内，对搜索词注入 <mark> 高亮（大小写不敏感，仅首个命中）
        _markLargeSearch(html) {
            const q = this.largeSearchQuery.trim();
            if (!q) return html;
            const idx = html.toUpperCase().indexOf(q.toUpperCase());
            if (idx < 0) return html;
            return html.slice(0, idx) + "<mark>" + html.slice(idx, idx + q.length) + "</mark>" + html.slice(idx + q.length);
        },
        // 编辑区点击：命中反引号引用路径（.lst）时快捷跳转对应文件。
        // 高亮层 pre 在 textarea 之下（pointer-events:none），无法直接命中，故按行列换算。
        onEditorClick(e) {
            if (!this.isLst) return;
            const ta = this.$refs.editorEl;
            if (!ta || !this.editText) return;
            const m = this.getEditorMetrics();
            if (!m) return;
            const rect = ta.getBoundingClientRect();
            const relX = e.clientX - rect.left;
            const relY = e.clientY - rect.top;
            const row = Math.floor((relY + ta.scrollTop - m.paddingTop) / m.lineHeight);
            const col = Math.floor((relX + ta.scrollLeft - m.paddingLeft) / m.charWidth);
            if (row < 0 || row >= this.editLines.length || col < 0) return;
            const ref = refInLine(this.editLines[row], col);
            if (!ref) return;
            const target = this.archive && this.archive.getLstRefTarget(this.currentFile, ref);
            if (target && !this.archive.isFileDeleted(target.index)) {
                this.switchToFile(target);
            } else {
                this.addLog(`未找到引用文件：${ref}`, "error");
            }
        },
        // ---- 标签浮窗：依据鼠标所在行判断是否为 [xxx] 标签 ----
        // 高亮层 pre 设有 pointer-events:none 且位于 textarea 之下，无法直接命中；
        // PVF 中每个 [xxx] 标签独占一行（解码器将每个 type-3 token 输出为单独一行），
        // 因此在 textarea 上按行命中即可，避免坐标→字符偏移的复杂换算。
        onEditorMouseMove(e) {
            if (!this.editText) {
                if (this.tooltip.show) this.tooltip.show = false;
                return;
            }
            const ta = this.$refs.editorEl;
            if (!ta) {
                this.tooltip.show = false;
                return;
            }
            const m = this.getEditorMetrics();
            if (!m) {
                this.tooltip.show = false;
                return;
            }
            const rect = ta.getBoundingClientRect();
            const relY = e.clientY - rect.top;
            const row = Math.floor((relY + ta.scrollTop - m.paddingTop) / m.lineHeight);
            if (row < 0) {
                ta.style.cursor = "text";
                this.tooltip.show = false;
                return;
            }
            const lines = this.editLines;
            if (row >= lines.length) {
                ta.style.cursor = "text";
                this.tooltip.show = false;
                return;
            }
            const isFoldable = this.foldableLines.has(row) || this.foldedLineSet.has(row);
            ta.style.cursor = isFoldable ? "pointer" : "text";
            const line = lines[row];
            const foldedMatch = /^\s*\[([^\]]+)\]\s*⋯\s*(\d+)\s+lines?\s*folded\s*⋯\s*\[\/[^\]]+\]\s*$/.exec(line);
            if (foldedMatch) {
                const fold = this.folds.find(f => f.placeholder === line.trim());
                if (fold) {
                    const preview = fold.content.length > 2000 ? fold.content.substring(0, 2000) + "\n⋯" : fold.content;
                    this.tooltip.show = true;
                    this.tooltip.html = `<div class="pvf-tip-name">[${foldedMatch[1]}] ⋯ ${foldedMatch[2]} lines</div><pre class="pvf-fold-preview">${this.escapeHtml(preview)}</pre>`;
                    this.positionTooltip(e);
                    return;
                }
            }
            if (this.highlightMode !== "pvf") {
                if (this.tooltip.show) this.tooltip.show = false;
                return;
            }
            const mm = /^\s*(\[\/?[^\]\[`{}]+\])\s*$/.exec(lines[row]);
            if (mm) {
                let html = renderTagTooltip(mm[1]);
                // 代码引用规则（docs/pvf-tag-code-ref-rules.md）：按当前文件 × 标签匹配，追加到既有浮窗末尾
                const refHtml = renderCodeRefTipHtml(this.currentFile && this.currentFile.name, mm[1]);
                if (refHtml) html += refHtml;
                if (html) {
                    this.tooltip.show = true;
                    this.tooltip.html = html;
                    this.positionTooltip(e);
                    return;
                }
            }
            this.tooltip.show = false;
        },
        onEditorMouseLeave() {
            this.tooltip.show = false;
            if (this.$refs.gutterEl) this.$refs.gutterEl.style.cursor = "default";
        },
        // 只读归档（REPACK/60CN）文本预览的标签悬浮：按行高换算行号，标签可与参数同行
        // （明文形态 `[rarity] 2`，不锚定行尾），追加「代码引用」区块（docs/pvf-tag-code-ref-rules.md）
        onReadonlyMouseMove(e) {
            if (!this.isReadonlyArchive || !this.editText) {
                this.tooltip.show = false;
                return;
            }
            const pre = e.currentTarget;
            const cs = getComputedStyle(pre);
            const lineHeight = parseFloat(cs.lineHeight) || 18;
            const paddingTop = parseFloat(cs.paddingTop) || 0;
            const rect = pre.getBoundingClientRect();
            const row = Math.floor((e.clientY - rect.top + pre.scrollTop - paddingTop) / lineHeight);
            const lines = this.editLines;
            if (row < 0 || row >= lines.length) {
                this.tooltip.show = false;
                return;
            }
            const mm = /^\s*(\[\/?[^\]\[`{}]+\])/.exec(lines[row]);
            if (mm) {
                let html = renderTagTooltip(mm[1]);
                const refHtml = renderCodeRefTipHtml(this.currentFile && this.currentFile.name, mm[1]);
                if (refHtml) html += refHtml;
                if (html) {
                    this.tooltip.show = true;
                    this.tooltip.html = html;
                    this.positionTooltip(e);
                    return;
                }
            }
            this.tooltip.show = false;
        },
        // ---- nut 纯展示折叠：gutter 命中与折叠状态维护（docs/pvf-tw-nut-script.md §3.5）----
        // 行号 gutter 的垂直坐标 → 文本行号（gutter 与正文同高、同 padding / 行高，scrollTop 同步）
        _rowFromGutterY(e, el) {
            const g = el || this.$refs.gutterEl;
            const m = this.getEditorMetrics();
            if (!g || !m) return -1;
            const rect = g.getBoundingClientRect();
            return Math.floor((e.clientY - rect.top + g.scrollTop - m.paddingTop) / m.lineHeight);
        },
        // 编辑态 gutter 点击：命中可折叠行则进入折叠视图（正文点击不触发，避免影响光标定位）
        onGutterMouseDown(e) {
            if (this.highlightMode !== "nut" || !this.editText) return;
            const row = this._rowFromGutterY(e);
            if (row < 0 || row >= this.editLines.length) return;
            if (this.nutFoldableLines.has(row)) {
                e.preventDefault();
                this.collapseNutFold(row);
            }
        },
        // 折叠态 gutter 点击：右向箭头行展开该区块；可折叠行（悬停下向箭头）可继续折叠其它区块
        onNutFoldGutterMouseDown(e) {
            const view = this.nutFoldView;
            if (!view) return;
            const row = this._rowFromGutterY(e, this.$refs.foldGutterEl);
            const target = view[row];
            if (!target) return;
            if (target.folded) {
                e.preventDefault();
                this.expandNutFold(target.line);
            } else if (this.nutFoldableLines.has(target.line)) {
                e.preventDefault();
                this.collapseNutFold(target.line);
            }
        },
        // gutter 悬停：仅在鼠标位于左侧 gutter 时显示未折叠行的下向箭头（已折叠起始行右向箭头常显）
        onNutGutterHover(hovered) {
            if (this.nutGutterHovered === hovered) return;
            this.nutGutterHovered = hovered;
        },
        // 编辑态 gutter hover：可折叠行显示可点击光标；其它模式回落既有悬浮逻辑
        onGutterMouseMove(e) {
            const g = this.$refs.gutterEl;
            if (this.highlightMode === "nut" && this.editText && g) {
                this.onNutGutterHover(true);
                const row = this._rowFromGutterY(e);
                const can = row >= 0 && row < this.editLines.length && this.nutFoldableLines.has(row);
                g.style.cursor = can ? "pointer" : "default";
                this.tooltip.show = false;
                return;
            }
            if (g) g.style.cursor = "default";
            this.onEditorMouseMove(e);
        },
        // 折叠态 gutter hover：箭头行显示可点击光标
        onNutFoldGutterMouseMove(e) {
            const g = this.$refs.foldGutterEl;
            const view = this.nutFoldView;
            if (!g || !view) return;
            this.onNutGutterHover(true);
            const target = view[this._rowFromGutterY(e, g)];
            const can = !!target && (target.folded || this.nutFoldableLines.has(target.line));
            g.style.cursor = can ? "pointer" : "default";
            this.tooltip.show = false;
        },
        // 折叠占位符点击：命中 ⋯ 则展开该区块（VS Code 占位符可点击）
        onNutFoldBodyClick(e) {
            const el = e.target && typeof e.target.closest === "function" ? e.target.closest(".pvf-fold-ellipsis") : null;
            if (!el) return;
            const line = Number(el.getAttribute("data-line"));
            if (Number.isInteger(line)) this.expandNutFold(line);
        },
        // 折叠态输入：textarea 只承载可见行，输入结果按行差分并回完整文本、折叠区间按行数差平移；
        // 跨折叠边界（会把隐藏行纳入替换区、或把新行插入隐藏区）不执行本次输入，改为展开相应区间
        // 后由用户在展开态继续（§3.5「折叠区间保护」，杜绝隐藏内容被误删）
        onNutFoldInput(e) {
            const ta = e.target;
            const merged = mergeNutFoldEdit(this.editText, this.nutFolds, ta.value);
            if (merged.blocked) {
                if (merged.expand.length) {
                    this.nutFolds = this.nutFolds.filter(f => !merged.expand.includes(f.open));
                }
                this.$nextTick(() => {
                    const el = this.$refs.foldEditorEl;
                    if (!el) return;
                    const pos = Math.min(el.selectionStart, this.nutFoldEditableText.length);
                    el.value = this.nutFoldEditableText;
                    el.setSelectionRange(pos, pos);
                });
                return;
            }
            if (merged.text !== this.editText) this.editText = merged.text;
            if (merged.folds !== this.nutFolds) this.nutFolds = merged.folds;
        },
        // 折叠态滚动 → 同步高亮正文层 / gutter / 装饰覆盖层（滚动容器为折叠态 textarea）
        onNutFoldScroll() {
            const ta = this.$refs.foldEditorEl;
            if (!ta) return;
            if (this.$refs.foldBodyEl) {
                this.$refs.foldBodyEl.scrollTop = ta.scrollTop;
                this.$refs.foldBodyEl.scrollLeft = ta.scrollLeft;
            }
            if (this.$refs.foldGutterEl) this.$refs.foldGutterEl.scrollTop = ta.scrollTop;
            this.syncDecorScroll();
        },
        // 折叠态光标同步（textarea 偏移 → 全文偏移；与编辑态偏移域分离）
        syncNutFoldCaret() {
            const ta = this.$refs.foldEditorEl;
            if (!ta) return;
            this.nutFoldCaretStart = this._nutFoldOffsetToDoc(ta.selectionStart);
            this.nutFoldCaretEnd = this._nutFoldOffsetToDoc(ta.selectionEnd);
        },
        // 折叠态 textarea 字符偏移 → 全文字符偏移（按可见行描述映射行号，行内偏移一致）
        _nutFoldOffsetToDoc(off) {
            const view = this.nutFoldView;
            if (!view || view.length === 0) return 0;
            const value = this.nutFoldEditableText;
            const pos = Math.max(0, Math.min(Number.isFinite(off) ? off : 0, value.length));
            let row = 0;
            let lineStart = 0;
            for (let i = 0; i < pos; i++) {
                if (value.charCodeAt(i) === 10) {
                    row++;
                    lineStart = i + 1;
                }
            }
            if (row >= view.length) return this.editText.length;
            const docLine = view[row].line;
            let docStart = 0;
            for (let i = 0; i < docLine; i++) docStart += (this.editLines[i] == null ? "" : this.editLines[i]).length + 1;
            return docStart + (pos - lineStart);
        },
        // 折叠 / 展开：仅改 nutFolds 状态（不改 editText，不进入脏态）
        collapseNutFold(openLine) {
            const closeLine = findNutFoldRanges(this.editText).get(openLine);
            if (closeLine == null) return;
            const anchor = this._nutFoldScrollAnchor();
            this.nutFolds = toggleNutFoldRange(this.nutFolds, openLine, closeLine);
            this._afterNutFoldChange(anchor);
        },
        expandNutFold(openLine) {
            const next = this.nutFolds.filter(f => f.open !== openLine);
            if (next.length === this.nutFolds.length) return;
            const anchor = this._nutFoldScrollAnchor();
            this.nutFolds = next;
            this._afterNutFoldChange(anchor);
        },
        expandAllNutFolds() {
            if (this.nutFolds.length === 0) return;
            const anchor = this._nutFoldScrollAnchor();
            this.nutFolds = [];
            this._afterNutFoldChange(anchor);
        },
        // 折叠状态变更前：记录视口锚点（视口顶部真实行号 + 行内偏移）。编辑态与折叠态是 v-if / v-else
        // 两棵互斥子树，变更会重建滚动容器（scrollTop 归零），必须捕获后在新视图里还原（§3.5）。
        _nutFoldScrollAnchor() {
            const m = this.getEditorMetrics();
            const ta = this.nutFoldView ? this.$refs.foldEditorEl : this.$refs.editorEl;
            if (!m || !ta) return null;
            return captureNutScrollAnchor(this.nutFoldView || null, ta.scrollTop, m.paddingTop, m.lineHeight);
        },
        // 折叠状态变更后：按锚点把同一真实行还原到视口顶部（先于各层滚动量同步，否则同步会把 0 带过去）
        _restoreNutFoldScroll(anchor) {
            if (!anchor) return;
            const m = this.getEditorMetrics();
            const view = this.nutFoldView;
            const ta = view ? this.$refs.foldEditorEl : this.$refs.editorEl;
            if (!m || !ta) return;
            ta.scrollTop = resolveNutScrollTop(view || null, anchor, m.paddingTop, m.lineHeight);
        },
        // 折叠状态变更后：重置折叠态光标（避免残留），并在视图切换后恢复视口 / 同步滚动与装饰偏移
        _afterNutFoldChange(anchor) {
            this.nutFoldCaretStart = -1;
            this.nutFoldCaretEnd = -1;
            this.$nextTick(() => {
                this._restoreNutFoldScroll(anchor);
                this.syncScroll();
                this.onNutFoldScroll();
                this.syncDecorScroll();
            });
        },
        getEditorMetrics() {
            if (this._editorMetrics) return this._editorMetrics;
            // 折叠态回落折叠态 textarea / 正文层 / 高亮层（同 padding、字号、行高）
            const ta = this.$refs.editorEl || this.$refs.foldEditorEl || this.$refs.foldBodyEl || this.$refs.highlightEl;
            if (!ta) return null;
            const cs = getComputedStyle(ta);
            const fontSize = parseFloat(cs.fontSize) || 13;
            let lineHeight = parseFloat(cs.lineHeight);
            if (isNaN(lineHeight) || lineHeight === 0) {
                // 回落取行网格变量（§3.6「行坐标约定」：整数固定行高）。不再回落 fontSize × 1.6——
                // 相对行高为非整数（0.8rem 字号下 20.48px），与浏览器 LayoutUnit 取整后的实际推进
                // 逐行累积漂移，装饰矩形会随行号偏移。
                const fromVar = parseFloat(cs.getPropertyValue("--nut-editor-line-height"));
                lineHeight = Number.isFinite(fromVar) && fromVar > 0 ? fromVar : 20;
            }
            const paddingTop = parseFloat(cs.paddingTop) || 0;
            const paddingLeft = parseFloat(cs.paddingLeft) || 0;
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
            const charWidth = ctx.measureText("0").width || fontSize * 0.6;
            this._editorMetrics = { fontSize, lineHeight, paddingTop, paddingLeft, charWidth };
            return this._editorMetrics;
        },
        positionTooltip(e) {
            const w = 380;
            const x = e.clientX + 14;
            this.tooltip.x = x + w > window.innerWidth ? Math.max(8, e.clientX - w - 14) : x;
            // 浮窗限高 min(70vh, 520px)，贴近视口底部时上移避免溢出
            const maxH = Math.min(window.innerHeight * 0.7, 520);
            this.tooltip.y = e.clientY + 14 + maxH > window.innerHeight ? Math.max(8, window.innerHeight - maxH - 8) : e.clientY + 14;
        },
        // ---- 语法格式检查（防抖）----
        scheduleValidation() {
            if (this.validationTimer) clearTimeout(this.validationTimer);
            // 校验结果在输入时不可见（面板默认收起），可较大延时；大文件进一步拉长以减少阻塞。
            const len = this.editText ? this.editText.length : 0;
            const delay = len > 80000 ? 700 : len > 20000 ? 350 : 150;
            this.validationTimer = setTimeout(() => this.runValidation(), delay);
        },
        runValidation() {
            if (!this.isEditable || this.highlightMode !== "pvf" || (this.archive && this.archive.headerFormat === PvfFormat.TW)) {
                this.validationErrors = [];
                this._valCache = null;
                return;
            }
            const text = this.editText;
            if (this._valCache && this._valCache.text === text) {
                return;
            }
            this.validationErrors = validatePvfText(text);
            this._valCache = { text, errors: this.validationErrors };
            if (this.validationErrors.length === 0) {
                this.addLog(`语法检查通过：${this.currentFile.fullpath}`, "success");
            } else {
                this.addLog(`语法错误 ${this.validationErrors.length} 处：${this.currentFile.fullpath}`, "error");
            }
        },
        // 阻断保存/下载入口：返回 true 表示通过
        ensureValid(action) {
            this.runValidation();
            this.validationVisible = true;
            if (this.validationErrors.length > 0) {
                const list = this.validationErrors
                    .slice(0, 5)
                    .map(e => `第 ${e.line} 行：${e.message}`)
                    .join("<br/>");
                const more = this.validationErrors.length > 5 ? `<br/>…等共 ${this.validationErrors.length} 处错误` : "";
                alertModal({ title: `${action}失败`, message: `语法格式存在错误，请先修复：<br/>${list}${more}` });
                return false;
            }
            return true;
        },
        escapeHtml(s) {
            return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        },
        addLog(message, type = "info") {
            const time = new Date().toLocaleTimeString();
            this.logs.push({ time, message, type });
            if (this.logs.length > 200) this.logs.shift();
            this.$nextTick(() => {
                const el = this.$refs.logEl;
                if (el) el.scrollTop = el.scrollHeight;
            });
        },
        clearLogs() {
            this.logs = [];
        },
        startDrag(type, e) {
            e.preventDefault();
            e.stopPropagation();
            this.drag = {
                type,
                startX: e.clientX,
                startY: e.clientY,
                initWidth: this.sidebarWidth,
                initHeight: this.logHeight
            };
            document.addEventListener("mousemove", this.onDragMove);
            document.addEventListener("mouseup", this.onDragEnd);
        },
        onDragMove(e) {
            if (!this.drag) return;
            if (this.drag.type === "sidebar") {
                const delta = e.clientX - this.drag.startX;
                this.sidebarWidth = Math.max(180, Math.min(500, this.drag.initWidth + delta));
            } else if (this.drag.type === "log") {
                const delta = this.drag.startY - e.clientY;
                this.logHeight = Math.max(80, Math.min(400, this.drag.initHeight + delta));
            }
        },
        onDragEnd() {
            this.drag = null;
            document.removeEventListener("mousemove", this.onDragMove);
            document.removeEventListener("mouseup", this.onDragEnd);
            this.$nextTick(() => this.updateContainerHeight());
        }
    }
};
</script>

<template>
    <Teleport to="body">
        <div class="pvf-overlay" :style="{ '--pvf-tag-color': tagColor }" @contextmenu.prevent>
            <!-- Loading overlay -->
            <div v-if="loading" class="pvf-modal-loading">
                <div class="spinner-lg"></div>
                <p class="pvf-loading-text">
                    {{ loadingMessage }}<span class="pvf-loading-dots"><span>.</span><span>.</span><span>.</span></span>
                </p>
            </div>

            <!-- Saving overlay -->
            <div v-if="saving" class="pvf-modal-loading">
                <div class="spinner-lg"></div>
                <p>{{ saveProgressText }}</p>
                <div class="progress-bar"><div class="progress-fill" :style="{ width: saveProgress + '%' }"></div></div>
            </div>

            <!-- Staging overlay -->
            <div v-if="isStaging" class="pvf-modal-loading">
                <div class="spinner-lg"></div>
                <p>保存中...</p>
            </div>

            <!-- Context menu -->
            <Transition name="ctx">
                <div v-if="contextMenu.show" class="pvf-ctx-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @click.stop>
                    <template v-if="contextMenu.node">
                        <div class="pvf-ctx-header">{{ contextMenu.node.isDir ? "📁 " + contextMenu.node.name : contextMenu.node.name }}</div>
                        <button
                            v-if="!contextMenu.node.isDir"
                            class="pvf-ctx-item"
                            @click="
                                exportNode(contextMenu.node);
                                hideContextMenu();
                            ">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            <span>导出文件</span>
                        </button>
                        <button
                            v-if="!contextMenu.node.isDir && !isReadonlyArchive"
                            class="pvf-ctx-item"
                            @click="
                                triggerImport(contextMenu.node);
                                hideContextMenu();
                            ">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="17 8 12 3 7 8" />
                                <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                            <span>导入替换</span>
                        </button>
                        <button
                            v-if="!isReadonlyArchive"
                            class="pvf-ctx-item"
                            @click="
                                renameNode(contextMenu.node);
                                hideContextMenu();
                            ">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                            </svg>
                            <span>重命名</span>
                        </button>
                        <button
                            v-if="!isReadonlyArchive && !contextMenu.node.isDir && contextMenu.node.file && archive.isFileModified(contextMenu.node.file.index)"
                            class="pvf-ctx-item"
                            @click="
                                selectedPath = contextMenu.node.path;
                                currentFile = contextMenu.node.file;
                                revertCurrent();
                                hideContextMenu();
                            ">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="1 4 1 10 7 10" />
                                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                            </svg>
                            <span>撤销修改</span>
                        </button>
                        <div class="pvf-ctx-divider"></div>
                        <button
                            v-if="!isReadonlyArchive"
                            class="pvf-ctx-item danger"
                            @click="
                                deleteNode(contextMenu.node);
                                hideContextMenu();
                            ">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                            <span>删除{{ contextMenu.node.isDir ? "目录" : "文件" }}</span>
                        </button>
                    </template>
                </div>
            </Transition>

            <!-- File picker (no archive loaded) -->
            <div v-if="!archive" class="pvf-picker-screen">
                <div class="pvf-picker-card">
                    <div class="pvf-picker-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                            <line x1="12" y1="22.08" x2="12" y2="12" />
                        </svg>
                    </div>
                    <!-- <h2>PVF 编辑器</h2> -->
                    <!-- <p>选择 Script.pvf 文件进行在线编辑</p> -->
                    <button class="btn btn-primary" @click="$refs.fileInputEl && $refs.fileInputEl.click()">
                        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        选择 Script.pvf 文件
                    </button>
                    <input ref="fileInputEl" type="file" accept=".pvf" style="display: none" @change="handleFileSelect" />
                    <button class="btn btn-outline-secondary pvf-cancel-btn" @click="close">取消</button>
                    <p class="pvf-picker-hint">所有解析与编辑在浏览器中完成</p>
                </div>
            </div>

            <!-- Editor workspace -->
            <div v-if="archive" class="pvf-workspace">
                <!-- Top toolbar -->
                <div class="pvf-topbar">
                    <div class="pvf-topbar-left">
                        <button class="pvf-icon-btn" @click="close" title="返回">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6" /></svg>
                        </button>
                        <span class="pvf-topbar-title">
                            <svg class="pvf-topbar-title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">
                                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                                <line x1="12" y1="22.08" x2="12" y2="12" />
                            </svg>
                            <span class="pvf-topbar-title-text">{{ fileName }}</span>
                        </span>
                        <span v-if="headerStats" class="pvf-topbar-stats">
                            <span :class="['pvf-format-badge', 'pvf-format-' + headerStats.format]" :title="'包头加密规则：' + headerStats.formatLabel">{{ headerStats.formatLabel }}</span>
                            {{ headerStats.fileCount.toLocaleString() }} 文件<span v-if="headerStats.groupCount"> · {{ headerStats.groupCount.toLocaleString() }} 分块</span> ·
                            {{ headerStats.bodySize }} / {{ headerStats.totalOrig }}
                        </span>
                        <div class="pvf-topbar-search">
                            <svg class="pvf-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="11" cy="11" r="8" />
                                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                            <input v-model="searchQuery" type="text" class="pvf-search" placeholder="搜索文件路径..." />
                            <button v-if="searchQuery" type="button" class="pvf-search-clear" title="清除" @click="searchQuery = ''">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="pvf-topbar-right">
                        <label v-if="archive" class="pvf-tag-color-picker" title="标签颜色">
                            <span class="pvf-tag-color-label">标签色</span>
                            <input type="color" :value="tagColor" @input="onTagColorChange" />
                        </label>
                        <!-- 无用 -->
                        <!-- <select v-if="archive" class="pvf-encoding-select" :value="strEncoding" title="字符串编码（影响 Type 1 脚本内容与文件名解析）" @change="changeEncoding($event.target.value)">
                            <option v-for="enc in ENCODINGS" :key="enc.value" :value="enc.value">{{ enc.label }}</option>
                        </select> -->
                        <span v-if="hasChanges" class="pvf-mod-count">
                            <span v-if="modifiedCount > 0">{{ modifiedCount }} 修改</span>
                            <span v-if="modifiedCount > 0 && deletedCount > 0"> · </span>
                            <span v-if="deletedCount > 0">{{ deletedCount }} 删除</span>
                            <span v-if="(modifiedCount > 0 || deletedCount > 0) && renamedCount > 0"> · </span>
                            <span v-if="renamedCount > 0">{{ renamedCount }} 重命名</span>
                        </span>
                        <button v-if="hasChanges" class="btn btn-sm btn-outline-secondary" @click="revertAll">全部撤销</button>
                        <button class="pvf-icon-btn" :disabled="!hasChanges && !textDirty" @click="downloadPvf" data-tip="导出 PVF">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                                <polyline points="17 21 17 13 7 13 7 21" />
                                <polyline points="7 3 7 8 15 8" />
                            </svg>
                        </button>
                    </div>
                </div>

                <!-- Body -->
                <div class="pvf-body">
                    <!-- Top zone: sidebar + editor -->
                    <div class="pvf-body-top">
                        <!-- Sidebar (file tree) -->
                        <div class="pvf-sidebar" :style="{ width: sidebarWidth + 'px', flexShrink: 0 }">
                            <div ref="listEl" class="pvf-list" @scroll="onListScroll" @keydown="handleKeydown" tabindex="0">
                                <div v-if="renderWindow.total === 0" class="pvf-list-empty">
                                    {{ isSearching ? "无匹配文件" : "无文件" }}
                                </div>
                                <div :style="{ height: renderWindow.start * rowHeight + 'px' }"></div>
                                <div
                                    v-for="(item, idx) in renderWindow.items"
                                    :key="renderWindow.start + '-' + idx"
                                    class="pvf-tree-row"
                                    :class="{
                                        selected: item.node.path === selectedPath,
                                        folder: item.node.isDir
                                    }"
                                    :style="{ paddingLeft: 8 + item.depth * 14 + 'px' }"
                                    :title="item.node.path"
                                    @click="onNodeClick(item.node)"
                                    @contextmenu="onNodeContext($event, item.node)">
                                    <span v-if="item.node.isDir" class="pvf-tree-chevron" :class="{ expanded: isSearching || expandedPaths.has(item.node.path) }">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                                    </span>
                                    <span v-else class="pvf-tree-chevron"></span>
                                    <span class="pvf-tree-icon">
                                        <svg v-if="item.node.isDir" class="pvf-tree-ico pvf-ico-folder" viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
                                        </svg>
                                        <svg
                                            v-else-if="item.node.file.dataType === 1 || isReadonlyArchive"
                                            class="pvf-tree-ico pvf-ico-script"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                            stroke-linecap="round"
                                            stroke-linejoin="round">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                            <polyline points="14 2 14 8 20 8" />
                                            <line x1="9" y1="13" x2="15" y2="13" />
                                            <line x1="9" y1="17" x2="13" y2="17" />
                                        </svg>
                                        <svg
                                            v-else-if="item.node.file.dataType === 3"
                                            class="pvf-tree-ico pvf-ico-text"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                            stroke-linecap="round"
                                            stroke-linejoin="round">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                            <polyline points="14 2 14 8 20 8" />
                                            <line x1="9" y1="13" x2="15" y2="13" />
                                            <line x1="9" y1="17" x2="13" y2="17" />
                                        </svg>
                                        <svg
                                            v-else
                                            class="pvf-tree-ico pvf-ico-binary"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                            stroke-linecap="round"
                                            stroke-linejoin="round">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                            <polyline points="14 2 14 8 20 8" />
                                            <line x1="9" y1="13" x2="15" y2="13" />
                                            <line x1="9" y1="17" x2="13" y2="17" />
                                        </svg>
                                    </span>
                                    <span class="pvf-tree-name">{{ item.node.name }}</span>
                                    <span v-if="!item.node.isDir && item.node.file && archive.isFileModified(item.node.file.index)" class="pvf-mod-dot">●</span>
                                </div>
                                <div :style="{ height: Math.max(0, (renderWindow.total - renderWindow.end) * rowHeight) + 'px' }"></div>
                            </div>
                            <div class="pvf-list-footer">
                                <span>{{ visibleNodes.length.toLocaleString() }} / {{ visibleFileCount.toLocaleString() }} 项</span>
                                <span v-if="deletedCount > 0" class="pvf-footer-deleted">已删 {{ deletedCount }}</span>
                            </div>
                        </div>

                        <!-- Drag handle: sidebar <-> editor -->
                        <div class="pvf-drag-v" @mousedown="startDrag('sidebar', $event)"></div>

                        <!-- Editor -->
                        <div class="pvf-editor">
                            <div v-if="currentFile" class="pvf-editor-toolbar">
                                <span class="pvf-editor-path">{{ currentFile.fullpath }}</span>
                                <span class="pvf-editor-tag">{{ dataTypeLabel }}</span>
                                <span class="pvf-editor-meta">{{ formatBytes(currentFile.dataSize) }}</span>
                                <span v-if="textDirty || isCurrentModified" class="pvf-mod-badge dirty">已修改</span>
                                <div class="pvf-editor-spacer"></div>
                                <button v-if="highlightMode === 'nut' && nutFolds.length" class="pvf-largefile-btn pvf-icon-text-btn" @click="expandAllNutFolds" title="展开全部折叠区块">
                                    <svg
                                        class="pvf-btn-icon"
                                        viewBox="0 0 16 16"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="1.6"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        aria-hidden="true">
                                        <path d="M4 2.5 7.5 6 11 2.5M4 13.5 7.5 10 11 13.5M2.5 8h10" />
                                    </svg>
                                    展开全部
                                </button>
                                <button v-if="highlightMode === 'nut'" class="pvf-largefile-btn" @click="formatNutClick" title="按 Squirrel 花括号层级重排缩进（显式触发，保存后才写入文件）">
                                    格式化
                                </button>
                            </div>
                            <div v-if="currentFile && isEditable" class="pvf-editor-area">
                                <!-- nut 折叠视图（§3.5）：高亮层只读渲染可见行，其上叠加可编辑 textarea（非折叠区照常编辑） -->
                                <div v-if="nutFoldView" class="pvf-code-editor pvf-fold-editor">
                                    <div
                                        ref="foldGutterEl"
                                        class="pvf-code-gutter"
                                        @mousedown="onNutFoldGutterMouseDown"
                                        @mousemove="onNutFoldGutterMouseMove"
                                        @mouseenter="onNutGutterHover(true)"
                                        @mouseleave="onNutGutterHover(false)">
                                        <pre class="pvf-gutter-pre" v-html="nutFoldGutterHtml"></pre>
                                    </div>
                                    <div class="pvf-code-main">
                                        <div class="pvf-code-decor" :style="decorScroll" aria-hidden="true">
                                            <div class="pvf-decor-vrows">
                                                <div v-for="r in nutDecorRowRects" :key="r.key" :class="r.cls" :style="{ top: r.top + 'px' }"></div>
                                            </div>
                                            <div class="pvf-decor-cells">
                                                <div v-for="c in nutDecorCellRects" :key="c.key" :class="c.cls" :style="{ top: c.top + 'px', left: c.left + 'px', width: c.width + 'px' }"></div>
                                            </div>
                                        </div>
                                        <pre ref="foldBodyEl" class="pvf-code-highlight" aria-hidden="true" v-html="nutFoldHtml"></pre>
                                        <textarea
                                            ref="foldEditorEl"
                                            :value="nutFoldEditableText"
                                            class="pvf-code-textarea pvf-fold-input"
                                            spellcheck="false"
                                            @input="onNutFoldInput"
                                            @scroll="onNutFoldScroll"
                                            @keyup="syncNutFoldCaret"
                                            @mouseup="syncNutFoldCaret"
                                            @select="syncNutFoldCaret"></textarea>
                                        <div class="pvf-fold-markers">
                                            <div class="pvf-fold-marker-scroll" :style="decorScroll">
                                                <span
                                                    v-for="m in nutFoldMarkers"
                                                    :key="m.key"
                                                    class="pvf-fold-ellipsis"
                                                    :data-line="m.line"
                                                    :style="{ left: m.left + 'px', top: m.top + 'px' }"
                                                    title="点击展开该区块"
                                                    @click="onNutFoldBodyClick"
                                                    >⋯</span
                                                >
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div v-else class="pvf-code-editor">
                                    <div
                                        ref="gutterEl"
                                        class="pvf-code-gutter"
                                        @mousedown="onGutterMouseDown"
                                        @mousemove="onGutterMouseMove"
                                        @mouseenter="onNutGutterHover(true)"
                                        @mouseleave="onNutGutterHover(false)">
                                        <pre class="pvf-gutter-pre" v-html="gutterHtml"></pre>
                                    </div>
                                    <div class="pvf-code-main">
                                        <div class="pvf-code-decor" :style="decorScroll" aria-hidden="true">
                                            <div class="pvf-decor-vrows">
                                                <div v-for="r in nutDecorRowRects" :key="r.key" :class="r.cls" :style="{ top: r.top + 'px' }"></div>
                                            </div>
                                            <div class="pvf-decor-cells">
                                                <div v-for="c in nutDecorCellRects" :key="c.key" :class="c.cls" :style="{ top: c.top + 'px', left: c.left + 'px', width: c.width + 'px' }"></div>
                                            </div>
                                        </div>
                                        <pre ref="highlightEl" class="pvf-code-highlight" aria-hidden="true" v-html="highlightedHtml"></pre>
                                        <textarea
                                            ref="editorEl"
                                            v-model="editText"
                                            class="pvf-code-textarea"
                                            spellcheck="false"
                                            @scroll="syncScroll"
                                            @keydown="onEditorKeydown"
                                            @keyup="syncCaret"
                                            @mousedown="onEditorMouseDown"
                                            @mouseup="syncCaret"
                                            @select="syncCaret"
                                            @beforeinput="onEditorBeforeInput"
                                            @mousemove="onEditorMouseMove"
                                            @mouseleave="onEditorMouseLeave"
                                            @click="onEditorClick"
                                            placeholder="编辑文件内容..."></textarea>
                                    </div>
                                </div>
                                <!-- 语法错误面板 -->
                                <Transition name="ctx">
                                    <div v-if="hasSyntaxErrors && validationVisible" class="pvf-syntax-panel">
                                        <div class="pvf-syntax-panel-head">
                                            <span>语法错误 ({{ validationErrors.length }})</span>
                                            <button class="pvf-syntax-panel-close" @click="validationVisible = false">×</button>
                                        </div>
                                        <ul class="pvf-syntax-list">
                                            <li v-for="(err, i) in validationErrors" :key="i">
                                                <span class="pvf-err-line">L{{ err.line }}</span>
                                                <span class="pvf-err-msg">{{ err.message }}</span>
                                            </li>
                                        </ul>
                                    </div>
                                </Transition>
                                <!-- 标签浮窗 -->
                                <Transition name="tip">
                                    <div v-if="tooltip.show" class="pvf-tooltip" :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }" v-html="tooltip.html"></div>
                                </Transition>
                            </div>
                            <div v-else-if="currentFile && isLargeFile" class="pvf-editor-area pvf-largefile">
                                <div class="pvf-largefile-banner">
                                    文件过大（{{ largeFileLineCount.toLocaleString() }} 行）。
                                    <template v-if="!largeFullView">
                                        仅预览前 {{ largeFilePreviewLines.toLocaleString() }} 行。
                                        <button class="pvf-largefile-btn" @click="loadLargeFileFull" :disabled="largeFullLoading">{{ largeFullLoading ? "加载中..." : "加载全部内容" }}</button>
                                    </template>
                                    <template v-else>
                                        已加载全部内容（虚拟滚动浏览，点击反引号引用可跳转）。
                                        <button class="pvf-largefile-btn" @click="exitLargeFileFull">收起为预览</button>
                                    </template>
                                </div>
                                <div class="pvf-largefile-search" v-if="largeFullView">
                                    <svg class="pvf-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <circle cx="11" cy="11" r="8"></circle>
                                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                                    </svg>
                                    <div class="pvf-largefile-search-wrap">
                                        <input
                                            v-model="largeSearchQuery"
                                            type="text"
                                            class="pvf-search-input"
                                            placeholder="搜索内容..."
                                            @input="onLargeSearchInput"
                                            @keydown.enter.prevent="nextLargeMatch"
                                            @keydown.shift.enter.prevent="prevLargeMatch"
                                            @keydown.esc.prevent="clearLargeSearch" />
                                        <button v-if="largeSearchQuery" type="button" class="pvf-search-clear" title="清除 (Esc)" @click="clearLargeSearch">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                                                <line x1="6" y1="6" x2="18" y2="18"></line>
                                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                            </svg>
                                        </button>
                                    </div>
                                    <span v-if="largeSearchNameLoading" class="pvf-search-count loading">加载名称映射...</span>
                                    <span v-else-if="largeSearchMatches.length" class="pvf-search-count">{{ largeSearchIndex + 1 }} / {{ largeSearchMatches.length }}</span>
                                    <span v-else-if="largeSearchQuery.trim()" class="pvf-search-count none">无匹配</span>
                                    <button class="pvf-search-nav" title="上一个 (Shift+Enter)" :disabled="!largeSearchMatches.length" @click="prevLargeMatch">↑</button>
                                    <button class="pvf-search-nav" title="下一个 (Enter)" :disabled="!largeSearchMatches.length" @click="nextLargeMatch">↓</button>
                                </div>
                                <pre v-if="!largeFullView" class="pvf-largefile-preview" v-html="largeFilePreviewHtml" @click="onHlClick"></pre>
                                <div v-else class="pvf-largefile-vscroll">
                                    <div class="pvf-largefile-gutter" aria-hidden="true">
                                        <div
                                            v-for="row in largeVisibleRows"
                                            :key="'g' + row.no"
                                            class="pvf-largefile-gline"
                                            :class="{ current: row.current }"
                                            :style="{ top: row.top - largeScrollTop + 'px' }">
                                            {{ row.no }}
                                        </div>
                                    </div>
                                    <div ref="largeVScrollEl" class="pvf-largefile-preview pvf-largefile-vcontent" @scroll.passive="onLargeScroll">
                                        <div
                                            v-for="row in largeVisibleRows"
                                            :key="'c' + row.no"
                                            class="pvf-largefile-cline"
                                            :class="{ current: row.current }"
                                            :style="{ top: row.top + 'px' }"
                                            v-html="row.html"
                                            @click="onHlClick"></div>
                                        <div class="pvf-largefile-spacer" :style="{ height: largeTotalHeight + 'px' }"></div>
                                    </div>
                                </div>
                            </div>
                            <div v-else-if="currentFile" class="pvf-editor-area">
                                <!-- 只读归档（REPACK/60CN）文本预览：PVF 语法高亮 + 标签/代码引用悬浮
                                     （docs/pvf-repack-format.md §4，归档内为明文文本） -->
                                <pre
                                    v-if="isReadonlyArchive && readonlyPreviewHtml"
                                    class="pvf-ro-preview"
                                    v-html="readonlyPreviewHtml"
                                    @mousemove="onReadonlyMouseMove"
                                    @mouseleave="onEditorMouseLeave"></pre>
                                <div v-else class="pvf-readonly">
                                    <p>该文件类型 (Type {{ currentFile.dataType }}) 不支持文本编辑。</p>
                                    <p class="pvf-readonly-hint">可使用右键导出原始字节。</p>
                                </div>
                            </div>
                            <div v-else class="pvf-empty">
                                <div class="pvf-empty-icon">📂</div>
                                <p>从左侧选择文件查看内容</p>
                                <p class="pvf-empty-hint">右键文件可导出、导入、重命名、删除</p>
                            </div>
                        </div>
                    </div>

                    <!-- Drag handle: top zone <-> log -->
                    <div class="pvf-drag-h" @mousedown="startDrag('log', $event)"></div>

                    <!-- Bottom log panel -->
                    <div class="pvf-log-panel" :style="{ height: logHeight + 'px' }">
                        <div class="pvf-log-header">
                            <div class="pvf-log-header-left">
                                <span class="pvf-log-title">日志</span>
                                <span v-if="currentFile && isEditable && highlightMode === 'pvf'" class="pvf-syntax-state" :class="{ ok: !hasSyntaxErrors, err: hasSyntaxErrors }">
                                    <span class="pvf-syntax-dot"></span>{{ syntaxSummary }}
                                </span>
                            </div>
                            <button class="pvf-log-clear" @click="clearLogs">清空</button>
                        </div>
                        <div ref="logEl" class="pvf-log-content">
                            <div v-if="logs.length === 0" class="pvf-log-empty">暂无日志</div>
                            <div v-for="(log, i) in logs" :key="i" class="pvf-log-item" :class="'pvf-log-' + log.type">
                                <span class="pvf-log-time">{{ log.time }}</span>
                                <span class="pvf-log-msg">{{ log.message }}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Hidden inputs -->
                <input ref="importInputEl" type="file" style="display: none" @change="handleImportSelect" />
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
.pvf-overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: var(--bg);
    display: flex;
    flex-direction: column;
}

/* ---- Loading / Saving overlay ---- */
.pvf-modal-loading {
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
.pvf-loading-icon {
    width: 56px;
    height: 56px;
    color: var(--accent);
    animation: pvf-pulse 1.2s ease-in-out infinite;
}
.pvf-loading-icon svg {
    width: 100%;
    height: 100%;
}
@keyframes pvf-pulse {
    0%,
    100% {
        transform: scale(1);
        opacity: 0.6;
    }
    50% {
        transform: scale(1.12);
        opacity: 1;
    }
}
.pvf-loading-text {
    color: var(--text);
    font-size: 0.9rem;
}
.pvf-loading-dots span {
    animation: pvf-dots 1.4s infinite;
    opacity: 0;
}
.pvf-loading-dots span:nth-child(1) {
    animation-delay: 0s;
}
.pvf-loading-dots span:nth-child(2) {
    animation-delay: 0.2s;
}
.pvf-loading-dots span:nth-child(3) {
    animation-delay: 0.4s;
}
@keyframes pvf-dots {
    0%,
    60%,
    100% {
        opacity: 0;
    }
    30% {
        opacity: 1;
    }
}
.spinner-lg {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(255, 255, 255, 0.15);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
}
@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}
.pvf-modal-loading p {
    color: var(--text);
    font-size: 0.9rem;
}
.progress-bar {
    width: 300px;
    height: 6px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    overflow: hidden;
}
.progress-fill {
    height: 100%;
    background: var(--accent-gradient);
    transition: width 0.2s ease;
    border-radius: 3px;
}

/* ---- File picker ---- */
.pvf-picker-screen {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
}
.pvf-picker-card {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 48px;
}
.pvf-picker-icon {
    color: var(--accent);
    line-height: 0;
}
.pvf-picker-icon svg {
    width: 56px;
    height: 56px;
}
.pvf-picker-card h2 {
    margin: 0;
    font-size: 1.4rem;
    color: var(--text);
}
.pvf-picker-card > p {
    color: var(--text-muted);
    font-size: 0.9rem;
    margin: 0 0 16px;
}
.pvf-picker-card .btn {
    min-width: 180px;
}
.pvf-cancel-btn {
    margin-top: 8px;
    min-width: 180px;
}
.pvf-picker-hint {
    margin-top: 20px;
    font-size: 0.75rem;
    color: var(--text-muted);
    opacity: 0.6;
}

/* ---- Workspace ---- */
.pvf-workspace {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

/* ---- Top toolbar ---- */
.pvf-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    height: 48px;
    background: var(--bg-2);
    border-bottom: 1px solid var(--surface-border);
    flex-shrink: 0;
    gap: 12px;
}
.pvf-topbar-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
}
.pvf-icon-btn {
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
.pvf-icon-btn:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.06);
}
.pvf-icon-btn svg {
    width: 18px;
    height: 18px;
}
.pvf-icon-btn[data-tip] {
    position: relative;
}
.pvf-icon-btn[data-tip]::after {
    content: attr(data-tip);
    position: absolute;
    bottom: -30px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 4px 8px;
    font-size: 0.7rem;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s;
    z-index: 2100;
}
.pvf-icon-btn[data-tip]:hover::after {
    opacity: 1;
}
.pvf-topbar-title {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-weight: 600;
    color: var(--text);
    font-size: 0.9rem;
    white-space: nowrap;
    min-width: 0;
}
.pvf-topbar-title-icon {
    width: 17px;
    height: 17px;
    color: var(--accent);
    flex-shrink: 0;
}
.pvf-topbar-title-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.pvf-topbar-search {
    position: relative;
    display: flex;
    align-items: center;
    flex-shrink: 0;
    margin-left: 4px;
}
.pvf-topbar-search .pvf-search-icon {
    left: 9px;
}
.pvf-topbar-search .pvf-search {
    width: 220px;
    height: 30px;
    padding: 0 28px 0 30px;
    box-sizing: border-box;
    border-radius: 6px;
}
.pvf-topbar-stats {
    font-size: 0.75rem;
    color: var(--text-muted);
    white-space: nowrap;
}
.pvf-format-badge {
    display: inline-block;
    padding: 1px 7px;
    border-radius: 9px;
    font-size: 0.68rem;
    font-weight: 600;
    vertical-align: middle;
    border: 1px solid;
    margin-right: 2px;
}
.pvf-format-guard {
    color: #e8a33d;
    border-color: #e8a33d55;
    background: #e8a33d18;
}
.pvf-format-original {
    color: #3d9de8;
    border-color: #3d9de855;
    background: #3d9de818;
}
.pvf-format-protected {
    color: #ff6b60;
    border-color: #ff6b6055;
    background: linear-gradient(135deg, #e0524a28, #ff6b6018);
    box-shadow: 0 0 0 1px #ff6b6014 inset;
}
.pvf-format-tw {
    color: #b57ef0;
    border-color: #b57ef055;
    background: #b57ef018;
}
.pvf-format-repack {
    color: #3ecf8e;
    border-color: #3ecf8e55;
    background: #3ecf8e18;
}
.pvf-topbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
}
.pvf-mod-count {
    font-size: 0.78rem;
    color: var(--accent);
    font-weight: 500;
    white-space: nowrap;
}
.btn-sm {
    height: 30px;
    padding: 0 12px;
    font-size: 0.78rem;
    border-radius: 6px;
    box-sizing: border-box;
}
.btn-icon {
    width: 14px;
    height: 14px;
}

/* ---- Body ---- */
.pvf-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.pvf-body-top {
    flex: 1;
    display: flex;
    overflow: hidden;
    min-height: 0;
}

/* ---- Drag handles ---- */
.pvf-drag-v {
    width: 4px;
    cursor: col-resize;
    background: var(--surface-border);
    flex-shrink: 0;
    transition: background 0.15s;
}
.pvf-drag-v:hover {
    background: var(--accent);
}
.pvf-drag-h {
    height: 4px;
    cursor: row-resize;
    background: var(--surface-border);
    flex-shrink: 0;
    transition: background 0.15s;
}
.pvf-drag-h:hover {
    background: var(--accent);
}

/* ---- Log panel ---- */
.pvf-log-panel {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    background: var(--bg-2);
    border-top: 1px solid var(--surface-border);
    overflow: hidden;
}
.pvf-log-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 12px;
    border-bottom: 1px solid var(--surface-border);
    flex-shrink: 0;
}
.pvf-log-header-left {
    display: flex;
    align-items: center;
    gap: 10px;
}
.pvf-log-title {
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--text-muted);
}
.pvf-log-clear {
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.68rem;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
}
.pvf-log-clear:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.06);
}
.pvf-log-content {
    flex: 1;
    overflow-y: auto;
    padding: 4px 12px;
    font-size: 0.72rem;
    font-family: "SF Mono", "Cascadia Code", Consolas, monospace;
}
.pvf-log-content::-webkit-scrollbar {
    width: 6px;
}
.pvf-log-content::-webkit-scrollbar-track {
    background: transparent;
}
.pvf-log-content::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.12);
    border-radius: 3px;
}
.pvf-log-empty {
    color: var(--text-muted);
    font-style: italic;
    padding: 8px 0;
}
.pvf-log-item {
    display: flex;
    gap: 8px;
    padding: 2px 0;
    line-height: 1.5;
}
.pvf-log-time {
    color: var(--text-muted);
    flex-shrink: 0;
    opacity: 0.6;
}
.pvf-log-msg {
    word-break: break-all;
}
.pvf-log-success .pvf-log-msg {
    color: #9ece6a;
}
.pvf-log-error .pvf-log-msg {
    color: var(--error);
}
.pvf-log-warning .pvf-log-msg {
    color: #e0af68;
}
.pvf-log-info .pvf-log-msg {
    color: var(--text);
}

/* ---- Sidebar ---- */
.pvf-sidebar {
    border-right: 1px solid var(--surface-border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-2);
}
.pvf-search-icon {
    position: absolute;
    left: 18px;
    top: 50%;
    transform: translateY(-50%);
    width: 14px;
    height: 14px;
    color: var(--text-muted);
    pointer-events: none;
}
.pvf-search {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 7px;
    padding: 6px 12px 6px 30px;
    color: var(--text);
    font-size: 0.8rem;
    outline: none;
    font-family: system-ui, sans-serif;
    box-sizing: border-box;
}
.pvf-search:focus {
    border-color: var(--accent);
}
.pvf-search-clear {
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
.pvf-search-clear:hover {
    color: var(--text);
    background: var(--border);
}
.pvf-search-clear svg {
    display: block;
    width: 12px;
    height: 12px;
}
.pvf-list {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    position: relative;
    outline: none;
}
.pvf-list::-webkit-scrollbar {
    width: 8px;
}
.pvf-list::-webkit-scrollbar-track {
    background: transparent;
}
.pvf-list::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.12);
    border-radius: 4px;
}
.pvf-list::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.2);
}
.pvf-list {
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
}
.pvf-list::-webkit-scrollbar,
.pvf-code-highlight::-webkit-scrollbar,
.pvf-code-textarea::-webkit-scrollbar,
.pvf-syntax-panel::-webkit-scrollbar,
.pvf-syntax-list::-webkit-scrollbar,
.pvf-largefile-preview::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}
.pvf-list::-webkit-scrollbar-track,
.pvf-code-highlight::-webkit-scrollbar-track,
.pvf-code-textarea::-webkit-scrollbar-track,
.pvf-syntax-panel::-webkit-scrollbar-track,
.pvf-syntax-list::-webkit-scrollbar-track,
.pvf-largefile-preview::-webkit-scrollbar-track {
    background: transparent;
}
.pvf-list::-webkit-scrollbar-thumb,
.pvf-code-highlight::-webkit-scrollbar-thumb,
.pvf-code-textarea::-webkit-scrollbar-thumb,
.pvf-syntax-panel::-webkit-scrollbar-thumb,
.pvf-syntax-list::-webkit-scrollbar-thumb,
.pvf-largefile-preview::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.12);
    border-radius: 4px;
}
.pvf-list::-webkit-scrollbar-thumb:hover,
.pvf-code-highlight::-webkit-scrollbar-thumb:hover,
.pvf-code-textarea::-webkit-scrollbar-thumb:hover,
.pvf-syntax-panel::-webkit-scrollbar-thumb:hover,
.pvf-syntax-list::-webkit-scrollbar-thumb:hover,
.pvf-largefile-preview::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.2);
}
.pvf-list-empty {
    padding: 24px 14px;
    color: var(--text-muted);
    font-size: 0.8rem;
    text-align: center;
}
.pvf-tree-row {
    height: 24px;
    display: flex;
    align-items: center;
    padding-right: 10px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    border-left: 2px solid transparent;
    user-select: none;
    font-size: 0.78rem;
}
.pvf-tree-row:hover {
    background: rgba(255, 255, 255, 0.04);
}
.pvf-tree-row.selected {
    background: rgba(91, 140, 255, 0.14);
    border-left-color: var(--accent);
}
.pvf-tree-row.folder.selected {
    background: rgba(91, 140, 255, 0.08);
    border-left-color: rgba(91, 140, 255, 0.5);
}
.pvf-tree-chevron {
    width: 14px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
}
.pvf-tree-chevron svg {
    width: 12px;
    height: 12px;
    transition: transform 0.15s ease;
}
.pvf-tree-chevron.expanded svg {
    transform: rotate(90deg);
}
.pvf-tree-icon {
    width: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin: 0 4px;
}
.pvf-tree-ico {
    width: 15px;
    height: 15px;
    color: var(--text-muted);
}
.pvf-ico-folder {
    color: #dcb67a;
}
.pvf-ico-script {
    color: #5b8cff;
}
.pvf-ico-text {
    color: #9ece6a;
}
.pvf-ico-binary {
    color: #e0af68;
}
.pvf-tree-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: "SF Mono", "Cascadia Code", Consolas, monospace;
    font-size: 0.74rem;
    color: var(--text);
}
.pvf-tree-row.folder .pvf-tree-name {
    font-weight: 500;
}
.pvf-mod-dot {
    color: var(--error);
    font-size: 0.6rem;
    margin-left: 4px;
    flex-shrink: 0;
}
.pvf-list-footer {
    padding: 5px 12px;
    border-top: 1px solid var(--surface-border);
    font-size: 0.65rem;
    color: var(--text-muted);
    flex-shrink: 0;
    font-family: "SF Mono", monospace;
    display: flex;
    justify-content: space-between;
}
.pvf-footer-deleted {
    color: var(--error);
}

/* ---- Context menu ---- */
.pvf-ctx-menu {
    position: fixed;
    z-index: 2200;
    min-width: 180px;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
    padding: 4px;
    font-family: system-ui, sans-serif;
}
.pvf-ctx-header {
    padding: 6px 10px;
    font-size: 0.72rem;
    color: var(--text-muted);
    border-bottom: 1px solid var(--surface-border);
    margin-bottom: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 240px;
}
.pvf-ctx-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 0.8rem;
    border-radius: 5px;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s;
}
.pvf-ctx-item:hover {
    background: rgba(91, 140, 255, 0.12);
}
.pvf-ctx-item.danger {
    color: var(--error);
}
.pvf-ctx-item.danger:hover {
    background: rgba(255, 91, 110, 0.12);
}
.pvf-ctx-item svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
}
.pvf-ctx-divider {
    height: 1px;
    background: var(--surface-border);
    margin: 4px 0;
}
.ctx-enter-active,
.ctx-leave-active {
    transition:
        opacity 0.12s ease,
        transform 0.12s ease;
}
.ctx-enter-from,
.ctx-leave-to {
    opacity: 0;
    transform: scale(0.96);
}

/* ---- Editor ---- */
.pvf-editor {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg);
}
.pvf-editor-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    height: 38px;
    border-bottom: 1px solid var(--surface-border);
    flex-shrink: 0;
    background: var(--bg-2);
}
.pvf-editor-path {
    font-family: "SF Mono", "Cascadia Code", Consolas, monospace;
    font-size: 0.76rem;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
}
.pvf-editor-tag {
    font-size: 0.66rem;
    padding: 2px 7px;
    border-radius: 4px;
    background: rgba(187, 154, 247, 0.12);
    color: #bb9af7;
    font-weight: 500;
    flex-shrink: 0;
    font-family: "SF Mono", monospace;
}
.pvf-tag-color-picker {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
    cursor: pointer;
}
.pvf-tag-color-label {
    font-size: 0.68rem;
    color: var(--text-muted);
    font-family: "SF Mono", monospace;
    white-space: nowrap;
}
.pvf-tag-color-picker input[type="color"] {
    width: 22px;
    height: 22px;
    border: 1px solid var(--border);
    border-radius: 5px;
    cursor: pointer;
    padding: 0;
    background: transparent;
}
.pvf-tag-color-picker input[type="color"]::-webkit-color-swatch-wrapper {
    padding: 2px;
}
.pvf-tag-color-picker input[type="color"]::-webkit-color-swatch {
    border: none;
    border-radius: 3px;
}
.pvf-encoding-select {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.76rem;
    height: 30px;
    padding: 0 8px;
    outline: none;
    flex-shrink: 0;
    cursor: pointer;
    box-sizing: border-box;
    font-family: "SF Mono", monospace;
}
.pvf-encoding-select:focus {
    border-color: var(--accent);
}
.pvf-encoding-select option {
    background: var(--bg-2);
    color: var(--text);
}
.pvf-editor-meta {
    font-size: 0.68rem;
    color: var(--text-muted);
    font-family: "SF Mono", monospace;
    flex-shrink: 0;
}
.pvf-editor-spacer {
    flex: 1;
}
.pvf-mod-badge {
    font-size: 0.62rem;
    padding: 2px 7px;
    border-radius: 4px;
    background: rgba(255, 91, 110, 0.16);
    color: var(--error);
    font-weight: 500;
    flex-shrink: 0;
}
.pvf-editor-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
/* ---- Overlay code editor (highlighted pre + transparent textarea) ---- */
.pvf-code-editor {
    /* 编辑器行网格：整数固定行高（§3.6「行坐标约定」）。相对行高 1.6 在 0.8rem 字号下为 20.48px，
       浏览器按 LayoutUnit(1/64px) 取整后实际逐行推进 20.46875px，与装饰覆盖层 JS 换算逐行累积
       漂移（2000 行约 22px）；整数像素在该网格上精确可表示，正文层 / gutter 层 / 装饰层 / 装饰
       矩形高度四处共用同值，保证矩形与行盒严格对齐（与大文件虚拟滚动 LARGE_VIRTUAL_LINE_H 一致）。 */
    --nut-editor-line-height: 20px;
    display: flex;
    flex: 1;
    overflow: hidden;
}
.pvf-code-gutter {
    flex-shrink: 0;
    overflow: hidden;
    background: var(--bg-2);
    border-right: 1px solid var(--surface-border);
    user-select: none;
    cursor: default;
    box-sizing: border-box;
}
.pvf-gutter-pre {
    margin: 0;
    /* 右内边距 8px → 2px（§3.5「折叠箭头列靠右」）：gutter 宽度内容自适应、行内容右对齐，折叠箭头列
       （16px 槽位）右侧间距只由这里决定，收紧后行号与箭头列整体右移 6px（列间距与槽位宽不变），
       箭头更贴近正文侧。编辑态与折叠态共用本规则，不按视图区分——否则切换折叠时行号列会横向跳变。 */
    padding: 14px 2px 14px 10px;
    font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
    font-size: 0.8rem;
    line-height: var(--nut-editor-line-height, 20px);
    white-space: pre;
    text-align: right;
    color: var(--text-muted);
    box-sizing: border-box;
}
/* nut 折叠箭头列：行号为「行号 + 箭头列」，本列恒为 gutter 最右侧一列（对齐 VS Code 装饰槽位：
   行号左侧、正文右侧无此槽位——VS Code 的 decorationsLeft = lineNumbersLeft + lineNumbersWidth，
   折叠开启时槽位宽 +16px）。固定 16px 见方（内联盒高 16px 小于行高，不改变 gutter 行高），
   使箭头显隐不引起列宽抖动；该列由 v-html 注入，必须经 :deep() 命中 scoped 样式——否则空标记
   宽度塌缩为 0、有标记时被字形撑开，gutter 为内容自适应宽度，悬停显示箭头即导致列宽变化。 */
.pvf-code-gutter :deep(.pvf-fold-mark) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    vertical-align: middle;
    color: var(--text-muted);
    opacity: 0.75;
}
.pvf-code-gutter :deep(.pvf-fold-icon) {
    display: block;
    width: 16px;
    height: 16px;
}
/* 折叠占位符覆盖层（2026-09-11「折叠态可编辑」修正）：折叠正文层改为纯展示层（.pvf-code-highlight
   自身 pointer-events: none），输入由覆盖其上的折叠态 textarea 承担，因此 ⋯ 点击改由本层承担——
   层容器保持 pointer-events: none、仅占位符自身 auto，避免整层遮住 textarea 使非折叠区无法编辑。
   层随正文滚动反向平移（与装饰列锚定层同款 transform），z-index 高于 textarea（2）。 */
/* 折叠占位符覆盖层（§3.5 裁剪修正）：外层只做**固定视口裁剪**（inset + overflow: hidden），
   本身不带滚动跟随的 transform——裁剪窗口因此固定在编辑区；平移交给内层 .pvf-fold-marker-scroll。
   原实现把 overflow: hidden 与跟随滚动的 transform 放在同一元素，裁剪窗口会随内容移动，只有
   首屏内容内的 ⋯ 能被绘制（折叠行底色 / gutter 箭头正常、唯独 ⋯ 缺失，见文档 §3.5）。 */
.pvf-fold-markers {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 3;
    font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
    font-size: 0.8rem;
    line-height: var(--nut-editor-line-height, 20px);
}
/* 内层：随滚动反向平移（与装饰覆盖层 .pvf-decor-cells 同构），占位符随内容移动、裁剪窗口固定 */
.pvf-fold-marker-scroll {
    position: absolute;
    inset: 0;
    transform: translate3d(calc(-1 * var(--decor-x, 0px)), calc(-1 * var(--decor-y, 0px)), 0);
}
/* 折叠占位符 ⋯（VS Code 同款字符）：仅自身可点击展开该区块 */
.pvf-fold-markers :deep(.pvf-fold-ellipsis) {
    position: absolute;
    padding-left: 6px;
    color: var(--text-muted);
    opacity: 0.7;
    cursor: pointer;
    pointer-events: auto;
    white-space: pre;
}
.pvf-fold-markers :deep(.pvf-fold-ellipsis:hover) {
    opacity: 1;
}
/* 折叠起始行底色：改由装饰覆盖层的整行矩形承担（VS Code 整行装饰，§3.6），不再使用行内底色包裹元素 */
.pvf-code-main {
    position: relative;
    flex: 1;
    overflow: hidden;
    background: var(--bg);
}
/* 装饰覆盖层（§3.6）：折叠整行底色 / 缩进辅助线（含活动块）/ 同类词矩形 / 当前行边框。
   绘制于文字之下（z-index: 0，正文层 z-index: 1 且背景透明），与编辑器同为 pointer-events: none，
   不夺取 textarea 的鼠标、选区与光标行为；字号 / 行高与正文层一致，行高取 --nut-editor-line-height
   （整数固定值，见 §3.6「行坐标约定」与 .pvf-code-editor 注释）。
   整行矩形层仅随纵向滚动平移（横向滚动下仍左右贯通整行），列锚定层双向平移。 */
.pvf-code-decor {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 0;
    font-size: 0.8rem;
    line-height: var(--nut-editor-line-height, 20px);
}
.pvf-decor-vrows {
    position: absolute;
    inset: 0;
    transform: translate3d(0, calc(-1 * var(--decor-y, 0px)), 0);
}
.pvf-decor-cells {
    position: absolute;
    inset: 0;
    transform: translate3d(calc(-1 * var(--decor-x, 0px)), calc(-1 * var(--decor-y, 0px)), 0);
}
.pvf-decor-vrows > div,
.pvf-decor-cells > div {
    position: absolute;
    height: var(--nut-editor-line-height, 20px);
}
.pvf-decor-vrows > div {
    left: 0;
    right: 0;
}
.pvf-decor-fold {
    /* 主题强调色半透明（VS Code editor.foldBackground = 选区底色 30%，本仓取强调色低透明度） */
    background: rgba(91, 140, 255, 0.12);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.pvf-decor-current {
    border: 1px solid var(--line-highlight-border, #282828);
    box-sizing: border-box;
}
.pvf-decor-guide {
    box-shadow: inset 1px 0 0 0 var(--guide-color, rgba(120, 120, 120, 0.4));
}
.pvf-decor-guide-active {
    box-shadow: inset 1px 0 0 0 var(--guide-color-active, rgba(190, 190, 190, 0.65));
}
/* 同类词（VS Code editor.wordHighlightBackground 深色默认 #575757B8） */
.pvf-decor-occurrence {
    background: var(--word-highlight-bg, rgba(87, 87, 87, 0.72));
    border-radius: 2px;
}
/* 选中词：同底色 + 1px 边框（VS Code wordHighlightStrong 以边框区分） */
.pvf-decor-occurrence-selection {
    border: 1px solid var(--word-highlight-strong-border, #575757);
    box-sizing: border-box;
}
.pvf-code-highlight,
.pvf-code-textarea {
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 14px 18px;
    border: none;
    font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
    font-size: 0.8rem;
    line-height: var(--nut-editor-line-height, 20px);
    tab-size: 4;
    white-space: pre;
    overflow: auto;
    box-sizing: border-box;
}
.pvf-code-highlight {
    background: transparent;
    color: var(--text);
    pointer-events: none;
    z-index: 1;
}
.pvf-code-textarea {
    background: transparent;
    color: transparent;
    caret-color: var(--accent);
    resize: none;
    outline: none;
    z-index: 2;
}
.pvf-code-textarea::placeholder {
    color: var(--text-muted);
    opacity: 0.5;
}
.pvf-code-textarea::selection {
    background: rgba(91, 140, 255, 0.3);
}
/* ---- highlight.js token colors (VS Code Dark+ inspired) ---- */
.pvf-code-highlight :deep(.hljs-comment),
.pvf-largefile-preview :deep(.hljs-comment),
.pvf-ro-preview :deep(.hljs-comment) {
    color: #6a9955;
}
.pvf-code-highlight :deep(.hljs-string),
.pvf-largefile-preview :deep(.hljs-string),
.pvf-ro-preview :deep(.hljs-string) {
    color: #ce9178;
}
.pvf-code-highlight :deep(.hljs-keyword),
.pvf-largefile-preview :deep(.hljs-keyword),
.pvf-ro-preview :deep(.hljs-keyword) {
    color: #c586c0;
    font-weight: 500;
}
.pvf-code-highlight :deep(.hljs-type),
.pvf-largefile-preview :deep(.hljs-type),
.pvf-ro-preview :deep(.hljs-type) {
    color: var(--pvf-tag-color);
}
.pvf-code-highlight :deep(.hljs-number),
.pvf-largefile-preview :deep(.hljs-number),
.pvf-ro-preview :deep(.hljs-number) {
    color: #b5cea8;
}
.pvf-code-highlight :deep(.hljs-title),
.pvf-largefile-preview :deep(.hljs-title),
.pvf-ro-preview :deep(.hljs-title) {
    color: #9cdcfe;
}
/* ---- .nut Squirrel token 覆盖扩充（docs/pvf-tw-nut-script.md §3.3）---- */
.pvf-code-highlight :deep(.hljs-constant),
.pvf-largefile-preview :deep(.hljs-constant),
.pvf-ro-preview :deep(.hljs-constant) {
    color: #d7ba7d;
}
.pvf-code-highlight :deep(.hljs-title.function_),
.pvf-largefile-preview :deep(.hljs-title.function_),
.pvf-ro-preview :deep(.hljs-title.function_) {
    color: #dcdcaa;
}
.pvf-code-highlight :deep(.hljs-title.class_),
.pvf-largefile-preview :deep(.hljs-title.class_),
.pvf-ro-preview :deep(.hljs-title.class_) {
    color: #4ec9b0;
}
.pvf-code-highlight :deep(.hljs-property),
.pvf-largefile-preview :deep(.hljs-property),
.pvf-ro-preview :deep(.hljs-property) {
    color: #9cdcfe;
}
.pvf-code-highlight :deep(.hljs-variable),
.pvf-largefile-preview :deep(.hljs-variable),
.pvf-ro-preview :deep(.hljs-variable) {
    color: #9cdcfe;
}
.pvf-code-highlight :deep(.hljs-literal),
.pvf-largefile-preview :deep(.hljs-literal),
.pvf-ro-preview :deep(.hljs-literal) {
    color: #569cd6;
}
.pvf-code-highlight :deep(.hljs-operator),
.pvf-largefile-preview :deep(.hljs-operator),
.pvf-ro-preview :deep(.hljs-operator) {
    color: #9a9a9a;
}
.pvf-code-highlight :deep(.hljs-pvf-name),
.pvf-largefile-preview :deep(.hljs-pvf-name),
.pvf-ro-preview :deep(.hljs-pvf-name) {
    color: #9a9a9a;
}
.pvf-code-highlight :deep(.hljs-pvf-bin-id),
.pvf-largefile-preview :deep(.hljs-pvf-bin-id),
.pvf-ro-preview :deep(.hljs-pvf-bin-id) {
    color: #f92672;
}
.pvf-code-highlight :deep(.hljs-pvf-bin-sep),
.pvf-largefile-preview :deep(.hljs-pvf-bin-sep),
.pvf-ro-preview :deep(.hljs-pvf-bin-sep) {
    color: #4d4756;
}
.pvf-code-highlight :deep(.hljs-pvf-bin-text),
.pvf-largefile-preview :deep(.hljs-pvf-bin-text),
.pvf-ro-preview :deep(.hljs-pvf-bin-text) {
    color: #9a9a9a;
}
.pvf-code-highlight :deep(.hljs-pvf-ref),
.pvf-largefile-preview :deep(.hljs-pvf-ref),
.pvf-ro-preview :deep(.hljs-pvf-ref) {
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: rgba(206, 145, 120, 0.45);
    text-underline-offset: 3px;
}
.pvf-largefile-preview :deep(.hljs-pvf-ref:hover),
.pvf-code-highlight :deep(.hljs-pvf-ref:hover) {
    background: rgba(206, 145, 120, 0.15);
}
.pvf-largefile-preview :deep(.pvf-ref-hint) {
    color: var(--text-muted);
    font-size: 0.72rem;
}
.pvf-code-highlight :deep(.hljs-char.escape),
.pvf-largefile-preview :deep(.hljs-char.escape),
.pvf-ro-preview :deep(.hljs-char.escape) {
    color: #d7ba7d;
}
/* ---- XML (.xui) token colors ---- */
.pvf-code-highlight :deep(.hljs-meta),
.pvf-largefile-preview :deep(.hljs-meta),
.pvf-ro-preview :deep(.hljs-meta) {
    color: #808080;
    font-style: italic;
}
.pvf-code-highlight :deep(.hljs-tag),
.pvf-largefile-preview :deep(.hljs-tag),
.pvf-ro-preview :deep(.hljs-tag) {
    color: #808080;
}
.pvf-code-highlight :deep(.hljs-tag .hljs-name),
.pvf-largefile-preview :deep(.hljs-tag .hljs-name),
.pvf-ro-preview :deep(.hljs-tag .hljs-name) {
    color: #569cd6;
}
.pvf-code-highlight :deep(.hljs-tag .hljs-attr),
.pvf-largefile-preview :deep(.hljs-tag .hljs-attr),
.pvf-ro-preview :deep(.hljs-tag .hljs-attr) {
    color: #9cdcfe;
}
.pvf-code-highlight :deep(.hljs-tag .hljs-string),
.pvf-largefile-preview :deep(.hljs-tag .hljs-string),
.pvf-ro-preview :deep(.hljs-tag .hljs-string) {
    color: #ce9178;
}
.pvf-readonly {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--text-muted);
    font-size: 0.85rem;
}
.pvf-readonly-hint {
    font-size: 0.72rem;
    opacity: 0.7;
}
/* 只读归档（REPACK/60CN）文本预览：与编辑器正文同款等宽字体与行高，独立滚动 */
.pvf-ro-preview {
    flex: 1;
    min-height: 0;
    overflow: auto;
    margin: 0;
    padding: 12px 16px;
    font-family: "SF Mono", "Cascadia Code", Consolas, monospace;
    font-size: 0.78rem;
    line-height: 18px;
    white-space: pre;
    tab-size: 4;
    color: var(--text-primary);
    user-select: text;
}
.pvf-largefile {
    overflow: hidden;
}
.pvf-largefile-banner {
    flex-shrink: 0;
    padding: 8px 14px;
    background: rgba(91, 140, 255, 0.1);
    color: var(--accent);
    font-size: 0.75rem;
    border-bottom: 1px solid var(--border);
}
.pvf-largefile-preview {
    flex: 1;
    margin: 0;
    padding: 14px 18px;
    background: var(--bg);
    color: var(--text);
    font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
    font-size: 0.74rem;
    line-height: 1.55;
    overflow: auto;
    white-space: pre;
    user-select: text;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
}
.pvf-largefile-btn {
    margin-left: 8px;
    padding: 2px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: rgba(91, 140, 255, 0.12);
    color: var(--accent);
    font-size: 0.72rem;
    cursor: pointer;
    transition: all 0.2s;
}
.pvf-largefile-btn:hover:not(:disabled) {
    background: rgba(91, 140, 255, 0.24);
}
.pvf-largefile-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
/* 带图标的文字按钮（折叠「展开全部」等）：图标与文字同一行居中对齐。
   不复用纯图标方形类 .pvf-icon-btn（其 30×30 尺寸来自返回 / 导出两个方形图标按钮，与本类叠加后
   内容盒仅剩 8px，会把四字标签压成每行一个汉字并纵向溢出按钮）；图标尺寸由本类作用域选择器给出，
   特异度（0,2,1）高于 .pvf-icon-btn svg（0,1,1），确保 12px 生效。 */
.pvf-icon-text-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}
.pvf-icon-text-btn .pvf-btn-icon {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
}
/* ---- 大文件全量浏览：虚拟滚动（固定行高，见 LARGE_VIRTUAL_LINE_H） ---- */
/* ---- 大文件全量浏览：搜索工具条 ---- */
.pvf-largefile-search {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: var(--bg-2);
    border-bottom: 1px solid var(--border);
}
.pvf-largefile-search .pvf-search-icon {
    width: 14px;
    height: 14px;
    color: var(--text-muted);
    flex-shrink: 0;
}
.pvf-largefile-search-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
}
.pvf-search-input {
    width: 100%;
    padding: 4px 28px 4px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    font-size: 0.74rem;
    outline: none;
    box-sizing: border-box;
}
.pvf-search-input:focus {
    border-color: var(--accent);
}
.pvf-search-count {
    flex-shrink: 0;
    font-size: 0.72rem;
    color: var(--text-muted);
    white-space: nowrap;
}
.pvf-search-count.none {
    color: var(--error);
}
.pvf-search-count.loading {
    color: var(--accent);
}
.pvf-search-nav {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.2s;
}
.pvf-search-nav:hover:not(:disabled) {
    color: var(--text);
    background: rgba(255, 255, 255, 0.06);
}
.pvf-search-nav:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}
.pvf-largefile-gline.current {
    background: rgba(91, 140, 255, 0.3);
    color: var(--text);
    font-weight: 600;
}
.pvf-largefile-cline.current {
    background: rgba(91, 140, 255, 0.18);
    box-shadow: inset 2px 0 0 var(--accent);
}
.pvf-largefile-cline mark {
    background: rgba(255, 196, 0, 0.4);
    color: inherit;
    border-radius: 2px;
    padding: 0 1px;
}
.pvf-largefile-vscroll {
    flex: 1;
    display: flex;
    overflow: hidden;
    min-height: 0;
}
.pvf-largefile-gutter {
    position: relative;
    flex-shrink: 0;
    width: 64px;
    overflow: hidden;
    background: var(--bg-2);
    border-right: 1px solid var(--surface-border);
    padding-top: 14px;
    padding-bottom: 14px;
    user-select: none;
}
.pvf-largefile-gline {
    position: absolute;
    left: 0;
    right: 0;
    height: 20px;
    line-height: 20px;
    padding-right: 10px;
    text-align: right;
    font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
    font-size: 0.72rem;
    color: var(--text-muted);
    overflow: hidden;
}
.pvf-largefile-vcontent {
    position: relative;
}
.pvf-largefile-cline {
    position: absolute;
    left: 0;
    min-width: 100%;
    width: max-content;
    box-sizing: border-box;
    height: 20px;
    line-height: 20px;
    padding-right: 18px;
    white-space: pre;
    overflow: hidden;
}
.pvf-largefile-spacer {
    width: 1px;
    height: 100%;
}
.pvf-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    color: var(--text-muted);
}
.pvf-empty-icon {
    font-size: 48px;
    opacity: 0.3;
}
.pvf-empty-hint {
    font-size: 0.72rem;
    opacity: 0.6;
}

.tip-enter-active,
.tip-leave-active {
    transition: opacity 0.12s ease;
}
.tip-enter-from,
.tip-leave-to {
    opacity: 0;
}

/* 已收录标签下划线提示 */
.pvf-code-highlight :deep(.pvf-tag.known) {
    cursor: help;
    border-bottom: 1px dashed rgba(78, 201, 176, 0.5);
}
.pvf-code-highlight :deep(.pvf-tag) {
    cursor: help;
}
/* 可折叠块标签样式 */
.pvf-code-highlight :deep(.pvf-tag.block:not(.closing)) {
    border-bottom: 1px dashed rgba(91, 140, 255, 0.45);
}
/* 折叠占位行样式 */
.pvf-code-highlight :deep(.pvf-folded-line) {
    background: rgba(224, 175, 104, 0.08);
    border-radius: 3px;
    padding: 0 2px;
}

/* ---- 语法状态徽章 ---- */
.pvf-syntax-state {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 0.7rem;
    color: var(--text-muted);
    white-space: nowrap;
}
.pvf-syntax-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-muted);
    flex-shrink: 0;
}
.pvf-syntax-state.ok {
    color: #9ece6a;
}
.pvf-syntax-state.ok .pvf-syntax-dot {
    background: #9ece6a;
}
.pvf-syntax-state.err {
    color: var(--error);
}
.pvf-syntax-state.err .pvf-syntax-dot {
    background: var(--error);
    animation: pvf-blink 1s ease-in-out infinite;
}
@keyframes pvf-blink {
    50% {
        opacity: 0.3;
    }
}

/* ---- 语法错误面板 ---- */
.pvf-syntax-panel {
    position: absolute;
    right: 12px;
    bottom: 12px;
    width: 320px;
    max-height: 40%;
    overflow-y: auto;
    background: var(--bg-2);
    border: 1px solid rgba(255, 91, 110, 0.4);
    border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
    z-index: 40;
    font-family: system-ui, sans-serif;
}
.pvf-syntax-panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 12px;
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--error);
    border-bottom: 1px solid var(--surface-border);
}
.pvf-syntax-panel-close {
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
    padding: 0 4px;
}
.pvf-syntax-panel-close:hover {
    color: var(--text);
}
.pvf-syntax-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
}
.pvf-syntax-list li {
    display: flex;
    gap: 8px;
    padding: 5px 12px;
    font-size: 0.72rem;
    border-bottom: 1px solid var(--surface-border);
}
.pvf-syntax-list li:last-child {
    border-bottom: none;
}
.pvf-err-line {
    font-family: "SF Mono", monospace;
    color: var(--error);
    font-weight: 600;
    flex-shrink: 0;
}
.pvf-err-msg {
    color: var(--text-muted);
    word-break: break-all;
}
</style>

<style>
/* 标签浮窗样式：浮窗内容为 v-html 注入（无 scoped data 属性），
   必须使用非 scoped 样式；类名 pvf-tooltip / pvf-tip-* 全局唯一。 */
/* ---- 标签浮窗 ---- */
.pvf-tooltip {
    position: fixed;
    z-index: 2200;
    max-width: 380px;
    min-width: 180px;
    max-height: min(70vh, 520px);
    overflow: hidden;
    padding: 10px 12px;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
    font-family:
        system-ui,
        -apple-system,
        sans-serif;
    font-size: 0.74rem;
    line-height: 1.55;
    color: var(--text);
    pointer-events: none;
    user-select: none;
}
/* 标题区：标签名 + 分类徽标 + 块标签徽标 同行基线对齐 */
.pvf-tip-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    margin-bottom: 6px;
}
.pvf-tip-name {
    font-family: "SF Mono", "Cascadia Code", Consolas, monospace;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--pvf-tag-color);
}
.pvf-tip-cat {
    display: inline-block;
    font-size: 0.62rem;
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-muted);
}
/* 分类徽标按类别着色（深色主题语法色系；底色取同色低透明度） */
.pvf-tip-cat.cat-appearance {
    background: rgba(78, 201, 176, 0.14);
    color: #4ec9b0;
}
.pvf-tip-cat.cat-attribute {
    background: rgba(86, 156, 214, 0.14);
    color: #569cd6;
}
.pvf-tip-cat.cat-battle {
    background: rgba(244, 135, 113, 0.14);
    color: #f48771;
}
.pvf-tip-cat.cat-skill {
    background: rgba(197, 134, 192, 0.14);
    color: #c586c0;
}
.pvf-tip-cat.cat-item {
    background: rgba(220, 220, 170, 0.14);
    color: #dcdcaa;
}
.pvf-tip-cat.cat-control {
    background: rgba(215, 186, 125, 0.14);
    color: #d7ba7d;
}
.pvf-tip-cat.cat-system {
    background: rgba(156, 220, 254, 0.14);
    color: #9cdcfe;
}
.pvf-tip-cat.cat-community {
    background: rgba(106, 153, 85, 0.16);
    color: #6a9955;
}
.pvf-tip-block {
    display: inline-block;
    font-size: 0.62rem;
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(255, 91, 110, 0.14);
    color: var(--error);
}
.pvf-tip-desc {
    color: var(--text);
    margin-bottom: 2px;
}
/* 社区说明：注释绿（与人工项目说明的文本色区分） */
.pvf-tip-desc-c {
    color: #6a9955;
}
/* 区块小标题：上侧细分割线分隔信息层级 */
.pvf-tip-section {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.64rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    border-top: 1px solid var(--border);
    margin: 8px 0 4px;
    padding-top: 7px;
}
.pvf-tip-param {
    display: grid;
    grid-template-columns: auto auto auto 1fr;
    gap: 6px;
    align-items: center;
    margin-bottom: 3px;
    font-size: 0.7rem;
}
.pvf-tip-pname {
    font-family: "SF Mono", monospace;
    color: #9cdcfe;
    font-weight: 500;
}
.pvf-tip-ptype {
    font-family: "SF Mono", monospace;
    font-size: 0.62rem;
    padding: 1px 5px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-muted);
}
.pvf-tip-req {
    font-size: 0.6rem;
    padding: 1px 5px;
    border-radius: 3px;
    background: rgba(255, 91, 110, 0.14);
    color: var(--error);
}
.pvf-tip-opt {
    font-size: 0.6rem;
    padding: 1px 5px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-muted);
}
.pvf-tip-pdesc {
    color: var(--text-muted);
}
.pvf-tip-example {
    display: block;
    font-family: "SF Mono", "Cascadia Code", Consolas, monospace;
    font-size: 0.7rem;
    background: rgba(255, 255, 255, 0.05);
    padding: 4px 7px;
    border-radius: 4px;
    color: #ce9178;
    word-break: break-all;
}
/* 社区注释行：注释绿逐条展示（区别于人工备注的斜体弱化） */
.pvf-tip-cmt {
    font-size: 0.68rem;
    color: #6a9955;
    margin: 2px 0;
    padding-left: 10px;
    text-indent: -10px;
}
.pvf-tip-cmt::before {
    content: "·";
    margin-right: 6px;
    color: rgba(106, 153, 85, 0.7);
}
/* 人工备注：斜体弱化 */
.pvf-tip-remark {
    margin-top: 6px;
    font-size: 0.66rem;
    color: var(--text-muted);
    font-style: italic;
}
/* 代码引用区块：左侧细竖条与标签说明部分分区 */
.pvf-tip-refs {
    margin-top: 4px;
    padding-left: 8px;
    border-left: 2px solid rgba(91, 140, 255, 0.35);
}
.pvf-tip-cond {
    font-size: 0.62rem;
    color: var(--text-muted);
    margin: 0 0 3px;
    padding-left: 12px;
}
.pvf-tip-more {
    font-size: 0.62rem;
    color: var(--text-muted);
    font-style: italic;
    margin-top: 4px;
}
.pvf-fold-preview {
    margin: 6px 0 0;
    padding: 8px 10px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 6px;
    font-family: "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
    font-size: 0.7rem;
    line-height: 1.5;
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 400px;
    overflow-y: auto;
}
</style>
