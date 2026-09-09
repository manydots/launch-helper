// ============================================================
//  PVF 标签代码引用规则（ItemCodeHoverConfig）
//  数据源 src/utils/ItemCodeHoverConfig.xml 为外部代码智能提示配置的原样归档，
//  字段语义与规则模型见 docs/pvf-tag-code-ref-rules.md。
//  职责：XML 轻量解析 → 规则模型；按「文件 × 标签」匹配；渲染标签浮窗「代码引用」区块。
//  仅展示层增强：不参与解码 / 编码，解码层行为不变。
//  双端约束：浏览器端经 Vite ?raw 动态导入自动装配；Node 端（测试脚本）
//  读 XML 后调用 configureCodeRef 显式注入。
// ============================================================

// ---- 名称与值解析工具 ----

// [xxx] / xxx -> xxx（小写，折叠连续空白）；空串原样返回（表示「任意标签」）
function normalizeTagName(raw) {
    let t = String(raw == null ? "" : raw).trim();
    if (t.startsWith("[")) t = t.slice(1);
    if (t.endsWith("]")) t = t.slice(0, -1);
    return t.trim().replace(/\s+/g, " ").toLowerCase();
}

// "0,1,2" / "9,1,2,3,4,5,6,7,8" / "-1" -> 数值数组；空串 -> []
function parseCsvInts(s) {
    const out = [];
    for (const part of String(s == null ? "" : s).split(",")) {
        const v = part.trim();
        if (!v) continue;
        const n = Number(v);
        if (Number.isFinite(n)) out.push(n);
    }
    return out;
}

// "stackable,equipment" -> ["stackable","equipment"]；保留原文大小写
function parseCsvStrings(s) {
    const out = [];
    for (const part of String(s == null ? "" : s).split(",")) {
        const v = part.trim();
        if (v) out.push(v);
    }
    return out;
}

function parseAttrs(attrStr) {
    const attrs = {};
    if (!attrStr) return attrs;
    const re = /([\w-]+)="([^"]*)"/g;
    let m;
    while ((m = re.exec(attrStr)) !== null) attrs[m[1]] = m[2];
    return attrs;
}

// ---- 规则模型 ----

// kind: "Section" | "SectionGroup" | "SectionRange"
function buildRule(kind, file, attrs) {
    const rule = {
        file: String(file || ""),
        tag: normalizeTagName(attrs.SectionName),
        indexes: [],
        rangeStart: null,
        group: null,
        lst: parseCsvStrings(attrs.LstFileName),
        description: attrs.Description || "",
        parentTag: attrs.ParentSectionName ? normalizeTagName(attrs.ParentSectionName) : null,
        ignoreCodes: parseCsvInts(attrs.IgnoreItemCode),
        validations: []
    };
    if (kind === "SectionRange") {
        rule.rangeStart = Number.isFinite(Number(attrs.StartIndex)) ? Number(attrs.StartIndex) : 0;
    } else if (kind === "SectionGroup") {
        rule.group = [];
        rule.lst = [];
        rule.description = "";
    } else {
        rule.indexes = parseCsvInts(attrs.Index);
    }
    return rule;
}

// ---- XML 轻量解析（不依赖 DOM，Node 与浏览器通用）----
// 仅识别固定节点集合：root / File / Section / SectionGroup / Index / ValidationSection；
// XML 声明与注释先剔除。属性值不允许出现引号本身（与本配置的书写约定一致）。
const TAG_RE = /<(\/?)([A-Za-z_][\w-]*)((?:\s+[\w-]+="[^"]*")*)\s*(\/?)>/g;

export function parseItemCodeHoverConfig(xmlText) {
    const xml = String(xmlText || "")
        .replace(/<\?[\s\S]*?\?>/g, "")
        .replace(/<!--[\s\S]*?-->/g, "");
    const rules = [];
    let curFile = null;
    let curRule = null;
    TAG_RE.lastIndex = 0;
    let m;
    while ((m = TAG_RE.exec(xml)) !== null) {
        const closing = m[1] === "/";
        const name = m[2];
        const attrs = parseAttrs(m[3]);
        const selfClose = m[4] === "/";
        if (closing) {
            if (name === "Section" || name === "SectionGroup" || name === "SectionRange") curRule = null;
            else if (name === "File") curFile = null;
            continue;
        }
        switch (name) {
            case "File":
                curFile = attrs.FileName || "";
                break;
            case "Section":
            case "SectionGroup":
            case "SectionRange": {
                if (!curFile) break;
                const rule = buildRule(name, curFile, attrs);
                rules.push(rule);
                if (!selfClose) curRule = rule;
                break;
            }
            case "Index": {
                if (!curRule || !curRule.group) break;
                curRule.group.push({
                    index: Number.isFinite(Number(attrs.Value)) ? Number(attrs.Value) : -1,
                    lst: parseCsvStrings(attrs.LstFileName),
                    description: attrs.Description || "",
                    ignoreCodes: parseCsvInts(attrs.IgnoreItemCode)
                });
                break;
            }
            case "ValidationSection": {
                if (!curRule) break;
                const idx = attrs.Index == null ? "" : String(attrs.Index).trim();
                curRule.validations.push({
                    tag: normalizeTagName(attrs.Name),
                    index: idx === "" ? null : Number.isFinite(Number(idx)) ? Number(idx) : null,
                    value: attrs.Value == null ? "" : attrs.Value,
                    currentLine: attrs.CurrentLine === "True"
                });
                break;
            }
            default:
                break;
        }
    }
    return rules;
}

// ---- 索引与匹配 ----

let _rules = [];
let _byTag = new Map();
let _anyTag = [];

function rebuildIndex(rules) {
    _rules = rules;
    _byTag = new Map();
    _anyTag = [];
    for (const r of rules) {
        if (!r.tag) {
            _anyTag.push(r);
        } else {
            if (!_byTag.has(r.tag)) _byTag.set(r.tag, []);
            _byTag.get(r.tag).push(r);
        }
    }
}

// 注入配置文本（Node 端显式调用；浏览器端由 ensureCodeRefLoaded 自动调用）
export function configureCodeRef(xmlText) {
    rebuildIndex(parseItemCodeHoverConfig(xmlText));
}

let _loadPromise = null;
// 浏览器端装配：Vite ?raw 动态导入；Node 端该导入必然失败，静默降级为显式注入
export function ensureCodeRefLoaded() {
    if (!_loadPromise) {
        _loadPromise = import("./ItemCodeHoverConfig.xml?raw")
            .then(mod => {
                configureCodeRef(mod.default);
            })
            .catch(() => {});
    }
    return _loadPromise;
}

// "*.equ" 通配（后缀匹配）或精确路径匹配；大小写不敏感
function matchFilePattern(pattern, fileName) {
    const p = String(pattern || "").toLowerCase();
    const f = String(fileName || "").toLowerCase();
    if (!p || !f) return false;
    if (p.startsWith("*.")) return f.endsWith(p.slice(1));
    if (p === "*") return true;
    return f === p;
}

// 按「文件 × 标签」匹配全部候选规则（含 SectionName 为空的任意标签规则）。
// 不执行父标签 / 验证条件的上下文判定——悬浮场景无完整块结构，候选规则连同
// 条件一并展示，由阅读者自行甄别（见 docs/pvf-tag-code-ref-rules.md §3.3）。
export function matchCodeRefRules(fileName, tagName) {
    const t = normalizeTagName(tagName);
    if (!t) return [];
    const pool = (_byTag.get(t) || []).concat(_anyTag);
    if (!pool.length) return [];
    return pool.filter(r => matchFilePattern(r.file, fileName));
}

// ---- 浮窗渲染 ----
// 复用 pvfTags.js 标签浮窗样式类；无命中规则返回空串（不追加区块）。

function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatLst(lst) {
    return lst.map(x => `${x}.lst`).join(" | ");
}

// 单条规则 -> 行描述数组（SectionGroup 逐列展开）
function ruleToLines(rule) {
    const lines = [];
    const conds = [];
    if (rule.parentTag) conds.push(`位于 [${rule.parentTag}] 内`);
    for (const v of rule.validations) {
        const where = v.tag ? `[${v.tag}]` : v.currentLine ? "当前行" : "所属标签";
        const at = v.index == null ? "" : `第 ${v.index} 列`;
        conds.push(`当 ${where} ${at ? at + " " : ""}值为 ${v.value || "(空)"}`);
    }
    if (rule.ignoreCodes.length) conds.push(`忽略 ${rule.ignoreCodes.join(",")}`);
    const condHtml = conds.length ? conds.join(" · ") : "";
    if (rule.group && rule.group.length) {
        for (const g of rule.group) {
            lines.push({
                cols: `列 ${g.index}`,
                lst: formatLst(g.lst),
                desc: g.description,
                condHtml
            });
        }
    } else {
        const cols = rule.indexes.length && rule.rangeStart == null ? `列 ${rule.indexes.join("、")}` : rule.rangeStart != null ? `列 ${rule.rangeStart} 起` : "全部列";
        lines.push({ cols, lst: formatLst(rule.lst), desc: rule.description, condHtml });
    }
    return lines;
}

// 单浮窗内引用规则行展示上限（超出截断，末尾以计数行提示；浮窗不可滚动，见文档 §3.3）
const MAX_REF_LINES = 10;

// 全量收集去重后的引用规则行（全局去重 key 含文件模式——同文件内去重、跨文件保留）
function collectRefLines(rules) {
    const out = [];
    const seen = new Set();
    for (const r of rules) {
        for (const line of ruleToLines(r)) {
            const key = `${r.file}|${line.cols}|${line.lst}|${line.desc}|${line.condHtml}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ file: r.file, cols: line.cols, lst: line.lst, desc: line.desc, condHtml: line.condHtml });
        }
    }
    return out;
}

export function renderCodeRefTipHtml(fileName, tagName) {
    const rules = matchCodeRefRules(fileName, tagName);
    if (!rules.length) return "";
    const allLines = collectRefLines(rules);
    const shown = allLines.slice(0, MAX_REF_LINES);
    const hidden = allLines.length - shown.length;
    const parts = [];
    let lastFile = null;
    for (const line of shown) {
        if (line.file !== lastFile) {
            parts.push(`<div class="pvf-tip-section">代码引用（${escapeHtml(line.file)}）</div>`);
            lastFile = line.file;
        }
        parts.push(
            `<div class="pvf-tip-param">` +
                `<span class="pvf-tip-pname">${escapeHtml(line.cols)}</span>` +
                (line.lst ? `<span class="pvf-tip-ptype">${escapeHtml(line.lst)}</span>` : "") +
                (line.desc ? `<span class="pvf-tip-pdesc">${escapeHtml(line.desc)}</span>` : "") +
                `</div>`
        );
        if (line.condHtml) {
            parts.push(`<div class="pvf-tip-cond">${escapeHtml(line.condHtml)}</div>`);
        }
    }
    if (hidden > 0) {
        parts.push(`<div class="pvf-tip-more">⋯ 另有 ${hidden} 条引用规则</div>`);
    }
    return `<div class="pvf-tip-refs">${parts.join("")}</div>`;
}
