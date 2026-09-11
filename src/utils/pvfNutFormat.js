// ============================================================
//  Squirrel (.nut) 缩进格式化
//  规则与语义边界见 docs/pvf-tw-nut-script.md §3.4。
//  借鉴参考项目 vscode-squirrel（Bitbucket marcinbar91/vscode-squirrel，MIT）
//  的 indent-only 缩进重排规则，并修正其已知缺陷：
//  ① new-slot 操作符 <- 不被拆为 < -（仅重缩进，不做 token 重排）；
//  ② 花括号计数按 token 级状态机，字符串 / 注释内容不参与计数与层级判定；
//  ③ @"..." verbatim 多行字符串（无转义、可含真实换行）内部行逐字保留。
//  本仓附加规则：
//  ④ 行首闭合与行内计数互斥（行首首个 } 只由行首减层承担一次，不重复扣层）；
//  ⑤ 悬挂单语句体缩进（省略 {} 的控制流换行体按悬挂体逐级缩进）；
//  ⑥ 独立 { 吸附到上一行函数头 / 控制流行尾（Allman → K&R，带空格）；
//  ⑦ 空行压缩（连续空行只保留一个，块注释 / verbatim 延续期间空行保留）；
//  ⑧ 函数间空行保证 + 注释吸附（注释块与 function 一体、注释块上方空行保证）；
//  ⑨ else 吸附（`} \n else \n {` → `} else {`，含 else if）；
//  ⑩ 嵌套区块缩进（显示缩进栈：闭合行与开括号行左对齐，case 取所属 switch frame）。
//  语义边界（显式触发）：仅经编辑器工具栏「格式化」按钮调用，不自动重排；
//  格式化仅重排 ASCII 空白与行首缩进（含 { / else 吸附与空行增删），保存后文件
//  字节真实变化，Squirrel 语义与编码分支判定不变（字符串 / 注释内容逐字保留）。
// ============================================================

// 跨行状态机状态：0 = 代码 / 1 = 块注释 / 2 = 引号字符串（"..."、'...'，含转义，行内闭合）
// / 3 = verbatim 字符串（@"..."，无转义，可跨行）。行注释不跨行（行尾结束）。
const S_CODE = 0;
const S_BLOCK = 1;
const S_STRING = 2;
const S_VERB = 3;

// 悬挂单语句体控制流词（省略 {} 的换行体；switch 必带 {} 不悬挂；else 裸词豁免行尾判定）
const HANGING_HEAD = new Set(["if", "for", "foreach", "while"]);

// 关键字集合（运算符空格规范化的一元判定：前一 token 为关键字时 `+` / `-` 按一元处理）
const NUT_KEYWORD_SET = new Set([
    "as",
    "break",
    "case",
    "catch",
    "class",
    "clone",
    "const",
    "continue",
    "default",
    "delete",
    "do",
    "else",
    "extends",
    "for",
    "foreach",
    "function",
    "if",
    "in",
    "instanceof",
    "local",
    "resume",
    "return",
    "static",
    "switch",
    "this",
    "throw",
    "try",
    "typeof",
    "while",
    "yield",
    "constructor",
    "destructor",
    "base"
]);

// 预扫描：逐行记录 token 级信息（跨行状态推进 + 有效代码区花括号净变化 + 行首词 / 行尾字符）
function scanLines(lines) {
    let state = S_CODE;
    let quote = "";
    const recs = [];
    for (const line of lines) {
        const rec = {
            delta: 0,
            firstWord: null,
            firstChar: null,
            lastChar: null,
            continued: state !== S_CODE,
            endState: state,
            endInComment: false
        };
        const n = line.length;
        let j = 0;
        let word = null;
        let wordStart = -1;
        while (j < n) {
            const ch = line[j];
            const nx = j + 1 < n ? line[j + 1] : "";
            if (state === S_BLOCK) {
                if (ch === "*" && nx === "/") {
                    state = S_CODE;
                    j += 2;
                    continue;
                }
                j++;
                continue;
            }
            if (state === S_VERB) {
                if (ch === '"') {
                    state = S_CODE;
                    j++;
                    continue;
                }
                j++;
                continue;
            }
            if (state === S_STRING) {
                if (ch === "\\") {
                    j += 2;
                    continue;
                }
                if (ch === quote) {
                    state = S_CODE;
                    j++;
                    continue;
                }
                j++;
                continue;
            }
            // S_CODE：行首字符 / 行尾有效字符记录（仅代码区字符；注释 / 字符串内容不记）
            if (rec.firstChar === null && ch !== " " && ch !== "\t") rec.firstChar = ch;
            if (ch === "/" && nx === "/") {
                // 行注释收尾：break，行尾在注释内（吸附判定须排除）
                rec.endInComment = true;
                break;
            }
            if (ch === "/" && nx === "*") {
                state = S_BLOCK;
                j += 2;
                continue;
            }
            if (ch !== " " && ch !== "\t") rec.lastChar = ch;
            if (wordStart < 0 && /[A-Za-z_]/.test(ch)) {
                wordStart = j;
                j++;
                continue;
            }
            if (wordStart >= 0) {
                if (/[A-Za-z0-9_]/.test(ch)) {
                    j++;
                    continue;
                }
                if (word === null) word = line.slice(wordStart, j);
                wordStart = -1;
                // 不消费当前字符，继续按代码符号处理
                continue;
            }
            if (ch === "@" && nx === '"') {
                state = S_VERB;
                j += 2;
                continue;
            }
            if (ch === '"' || ch === "'") {
                state = S_STRING;
                quote = ch;
                j++;
                continue;
            }
            if (ch === "{") {
                rec.delta++;
            } else if (ch === "}") {
                // 行首首个 } 的层级效应由行首减层承担一次（firstChar），不再计入净变化，
                // 否则嵌套闭合链每层重复扣一级导致层级错位（2026-09-10 修正，金样本见测试段 4）
                if (rec.firstChar === "}" && !rec.firstCloseSkipped) rec.firstCloseSkipped = true;
                else rec.delta--;
            }
            j++;
        }
        if (wordStart >= 0 && word === null) word = line.slice(wordStart);
        rec.firstWord = word;
        rec.endState = state;
        recs.push(rec);
    }
    return recs;
}

// 悬挂单语句行判定：省略 {} 的控制流行（行内花括号净变化为 0；if / for / foreach / while
// 要求行尾有效字符为 ")"；else 裸词豁免）；单行带体的 if (a) return b;（行尾 ;）不悬挂
function isHangingLine(rec) {
    if (rec.delta !== 0 || rec.continued) return false;
    if (rec.firstWord === "else") return true;
    return HANGING_HEAD.has(rec.firstWord) && rec.lastChar === ")";
}

// 二元运算符集合（两端补空格）与不参与规范化的多字符形态
const OPS_MULTI = ["<-", "<=", ">=", "==", "!=", "&&", "||"]; // 两端补空格（多字符优先识别）
const OPS_SINGLE = "+-*/%^<>="; // 单字符二元（两端补空格）

// 运算符空格规范化（2026-09-10 增补）：代码行内二元运算符两端缺失空格时补单个空格；
// 一元形态（-1 / x = -1 / !obj / i++ / ++i）与字符串（"..." / '...' / @"..."）/
// // /* */ 注释内容不处理（token 级状态机跳过）；`.` 成员点不处理；已有空格保持不重复。
// 仅单行处理（跨行延续行由调用方整行原样保留，不经此函数）。
function padOperatorSpacing(code) {
    let out = "";
    let state = S_CODE;
    let quote = "";
    let i = 0;
    const n = code.length;
    while (i < n) {
        const ch = code[i];
        const nx = i + 1 < n ? code[i + 1] : "";
        if (state === S_STRING) {
            out += ch;
            if (ch === "\\") {
                out += nx || "";
                i += 2;
                continue;
            }
            if (ch === quote) state = S_CODE;
            i++;
            continue;
        }
        if (state === S_VERB) {
            out += ch;
            if (ch === '"') state = S_CODE;
            i++;
            continue;
        }
        if (state === S_BLOCK) {
            out += ch;
            if (ch === "*" && nx === "/") {
                out += "/";
                i += 2;
                state = S_CODE;
                continue;
            }
            i++;
            continue;
        }
        // S_CODE
        if (ch === "/" && nx === "/") {
            out += code.slice(i); // 行注释原样收尾
            break;
        }
        if (ch === "/" && nx === "*") {
            out += "/*";
            i += 2;
            state = S_BLOCK;
            continue;
        }
        if (ch === "@" && nx === '"') {
            out += '@"';
            i += 2;
            state = S_VERB;
            continue;
        }
        if (ch === '"' || ch === "'") {
            out += ch;
            state = S_STRING;
            quote = ch;
            i++;
            continue;
        }
        // 多字符二元运算符（两端补空格；<= >= == != 不被单字符拆开）
        const two = code.slice(i, i + 2);
        if (OPS_MULTI.includes(two)) {
            if (out.length && !/[\s]$/.test(out)) out += " ";
            out += two;
            if (i + 2 < n && !/[\s]/.test(code[i + 2])) out += " ";
            i += 2;
            continue;
        }
        if (ch === "+" && nx === "+") {
            out += "++"; // ++ / -- 不参与规范化
            i += 2;
            continue;
        }
        if (ch === "-" && nx === "-") {
            out += "--";
            i += 2;
            continue;
        }
        if (OPS_SINGLE.includes(ch)) {
            // 一元判定（仅 + -）：前一非空白 token 非操作数（如行首、运算符后）或为关键字
            //（如 `return -1`）→ 一元，前后均不补
            let unary = false;
            if (ch === "+" || ch === "-") {
                let k = out.length - 1;
                while (k >= 0 && (out[k] === " " || out[k] === "\t")) k--;
                const tailWord = out.slice(0, k + 1).match(/[A-Za-z_]\w*$/);
                unary = !(k >= 0 && /[A-Za-z0-9_)\]"']/.test(out[k])) || (tailWord && NUT_KEYWORD_SET.has(tailWord[0]));
            }
            if (out.length && !/[\s]$/.test(out) && !unary) out += " ";
            out += ch;
            if (!unary && i + 1 < n && !/[\s]/.test(code[i + 1])) out += " ";
            i++;
            continue;
        }
        out += ch;
        i++;
    }
    return out;
}

// ============================================================
//  Squirrel (.nut) 花括号折叠（纯展示折叠，严格对照 VS Code 编辑器）
//  规则与交互语义见 docs/pvf-tw-nut-script.md §3.5。
//  折叠只影响渲染视图，不改动文本模型；不共用 PVF 块标签折叠的文本占位机制。
//  仅「开闭行之间至少一行可隐藏内容」（close - open >= 2）的跨行 {} 区块可折叠；
//  折叠后保留闭括号行（VS Code 缩进折叠区不含闭括号行）；字符串（"..." / '...' /
//  @"..." verbatim）与 // /* */ 注释内的花括号不参与配对（与格式化状态机同源）。
// ============================================================

// 逐行 token 级扫描，返回 Map<开括号行, 配对闭括号行>（0 基行号）。
// 同行 {}（open === close）不登记；未闭合 { 不登记；同一行多个 { 时取该行最外层区块
//（该行首个 { 的配对闭行最后写入，覆盖内层结果）。
// 折叠区下限与 VS Code 一致：开闭行之间须至少有一行可隐藏内容（close - open >= 2），
// 相邻开闭行（空体）不成区。
export function findNutFoldRanges(text) {
    const lines = String(text == null ? "" : text)
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n");
    const stack = [];
    const ranges = new Map();
    let state = S_CODE;
    let quote = "";
    for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        const n = line.length;
        let j = 0;
        while (j < n) {
            const ch = line[j];
            const nx = j + 1 < n ? line[j + 1] : "";
            if (state === S_BLOCK) {
                if (ch === "*" && nx === "/") {
                    state = S_CODE;
                    j += 2;
                    continue;
                }
                j++;
                continue;
            }
            if (state === S_VERB) {
                if (ch === '"') {
                    state = S_CODE;
                    j++;
                    continue;
                }
                j++;
                continue;
            }
            if (state === S_STRING) {
                if (ch === "\\") {
                    j += 2;
                    continue;
                }
                if (ch === quote) {
                    state = S_CODE;
                    j++;
                    continue;
                }
                j++;
                continue;
            }
            if (ch === "/" && nx === "/") break; // 行注释收尾
            if (ch === "/" && nx === "*") {
                state = S_BLOCK;
                j += 2;
                continue;
            }
            if (ch === "@" && nx === '"') {
                state = S_VERB;
                j += 2;
                continue;
            }
            if (ch === '"' || ch === "'") {
                state = S_STRING;
                quote = ch;
                j++;
                continue;
            }
            if (ch === "{") {
                stack.push(li);
            } else if (ch === "}") {
                const open = stack.pop();
                if (open !== undefined && li - open >= 2) ranges.set(open, li);
            }
            j++;
        }
    }
    return ranges;
}

// 折叠区间归一化：按开行升序排序，过滤非法区间（非整数 / open >= close）；
// 新区间若被已有区间包含（已在折叠中）则不登记；新区间若包含已折叠子区间则原子区间被吸收。
// folds 为 [{ open, close }]（0 基真实行号，含端点），返回新数组（不改动入参）。
export function toggleNutFoldRange(folds, open, close) {
    const cur = (Array.isArray(folds) ? folds : []).filter(f => f && Number.isInteger(f.open) && Number.isInteger(f.close) && f.open < f.close);
    if (!Number.isInteger(open) || !Number.isInteger(close) || open >= close) return cur;
    if (cur.some(f => f.open <= open && close <= f.close)) return cur;
    const next = cur.filter(f => !(open <= f.open && f.close <= close));
    next.push({ open, close });
    next.sort((a, b) => a.open - b.open || b.close - a.close);
    return next;
}

// 折叠视图行：返回可见行描述 [{ line, no, folded }]（line = 0 基真实行号、no = 1 基原始显示行号、
// folded = 折叠区间起始行，渲染时行尾追加 ⋯）。按压并保留 VS Code 的缩进折叠版式：折叠区不含
// 闭括号行——区间起始行与闭括号行均保留，仅开闭行之间的行不输出；行号取原始行号，折叠后自然
// 跳号。空 folds 返回全行可见。
export function buildNutFoldLines(text, folds) {
    const lines = String(text == null ? "" : text)
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n");
    const ranges = (Array.isArray(folds) ? folds : []).filter(f => f && Number.isInteger(f.open) && Number.isInteger(f.close) && f.open < f.close).sort((a, b) => a.open - b.open || b.close - a.close);
    // 已折叠区间的开行集合：`folded` 按「该行是否为某个已折叠区间的开行」判定，而非「首个命中区间的开行」——
    // `} else {` 这类双重角色行既是前块闭行、又是后块开行，两块同时折叠时该行仍可见，且必须带折叠标记
    // （行尾 ⋯ 可展开后块），否则后块只能从 gutter 箭头展开。
    const foldedStarts = new Set(ranges.map(f => f.open));
    const out = [];
    for (let no = 0; no < lines.length; no++) {
        // 严格位于任一折叠区间内部的行才隐藏（区间开行与闭行均保留）
        if (ranges.some(f => no > f.open && no < f.close)) continue;
        out.push({ line: no, no: no + 1, folded: foldedStarts.has(no) });
    }
    return out;
}

// Gutter 折叠标记：严格对照 VS Code 默认「鼠标悬停才显示」的折叠控件行为。
// rows 为可见行描述（buildNutFoldLines 输出）；foldableLines 为可折叠行集合（开括号行）；
// folds 为已折叠区间；hovered 为鼠标是否位于左侧 gutter。
// 已折叠起始行常显 "collapsed"（VS Code 折叠态箭头不随鼠标隐藏）；未折叠的可折叠行仅 hovered
// 时为 "expanded"；其余行为空标记。标记只给语义值、不给字符字形（字形由展示层图标承担）；
// 调用方按固定宽度渲染空标记，保证标记显隐不改变行号列宽。
export function buildNutGutterMarks(rows, foldableLines, folds, hovered) {
    const foldedStarts = new Set();
    for (const f of Array.isArray(folds) ? folds : []) {
        if (f && Number.isInteger(f.open) && Number.isInteger(f.close) && f.open < f.close) foldedStarts.add(f.open);
    }
    const foldable = foldableLines instanceof Set ? foldableLines : new Set(Array.isArray(foldableLines) ? foldableLines : []);
    return (Array.isArray(rows) ? rows : []).map(r => {
        const line = r && Number.isInteger(r.line) ? r.line : -1;
        let mark = "";
        if (foldedStarts.has(line)) mark = "collapsed";
        else if (hovered && foldable.has(line)) mark = "expanded";
        return { line, no: r && Number.isInteger(r.no) ? r.no : line + 1, mark };
    });
}

// 折叠占位符锚点（§3.5，2026-09-11 修正）：按折叠视图可见行给出折叠起始行 ⋯ 的定位锚点
// [{ line, row, column }]——line = 0 基真实行号；row = 视图行序（0 基，纵向位置 = 上内边距 +
// row × 行高）；column = **行末之后一格**的可见列（= 行可见宽度 + 1，制表符按 tabSize 折算），
// 展示层按 x = 左内边距 + (column - 1) × 字符宽 换算（取末字符格会让 ⋯ 叠在行末字符上）。
// `folded` 语义与 buildNutFoldLines 一致（含 `} else {` 双重角色行）；**不做可见性过滤**——视口外的
// 折叠行同样产出锚点，纵向裁剪由覆盖层（固定视口裁剪，不随内容平移）负责。
export function buildNutFoldMarkerAnchors(rows, lines, tabSize = 4) {
    const size = Number.isFinite(tabSize) && tabSize > 0 ? tabSize : 4;
    const src = Array.isArray(lines) ? lines : [];
    const out = [];
    (Array.isArray(rows) ? rows : []).forEach((r, row) => {
        if (!r || !r.folded) return;
        const line = Number.isInteger(r.line) ? r.line : -1;
        const text = line >= 0 && line < src.length && src[line] != null ? String(src[line]) : "";
        out.push({ line, row, column: nutVisibleColumnAt(text, text.length, size) });
    });
    return out;
}

// 折叠切换视口锚点（§3.5「折叠切换保持视口锚点」，2026-09-11 修正）：编辑视图与折叠视图是 v-if /
// v-else 两棵互斥子树，任何折叠状态变更都会重建滚动容器（新 textarea 的 scrollTop 归零），故变更**前**
// 把滚动位置换算为「视口顶部对应的真实行号 + 行内像素偏移」，变更后按锚点还原。行号取**真实行号**而非
// 视图行序，折叠区间上方的可见行数变化才不会让视口漂移。rows 为折叠态可见行描述（nutFoldView）；
// 编辑态传 null 走恒等映射（行号即视图行序），避免为大文件构造全行描述。
export function captureNutScrollAnchor(rows, scrollTop, paddingTop, lineHeight) {
    const list = Array.isArray(rows) ? rows : null;
    const h = lineHeight > 0 ? lineHeight : 1;
    const top = Number.isFinite(scrollTop) ? scrollTop : 0;
    const pad = Number.isFinite(paddingTop) ? paddingTop : 0;
    const row = Math.max(0, Math.floor((top - pad) / h));
    if (list && list.length === 0) return { line: 0, intra: 0 };
    if (!list) return { line: row, intra: top - pad - row * h };
    const idx = Math.min(row, list.length - 1);
    const line = list[idx] && Number.isInteger(list[idx].line) ? list[idx].line : idx;
    return { line, intra: top - pad - idx * h };
}

// 视口锚点还原：在新可见行集合里把锚点行映射回视图行序并换算为 scrollTop。映射优先级——
// ① 锚点行仍可见：精确命中该行；② 锚点行被本次折叠隐藏：退到其**之前**最后一个可见行（内容上方保持
// 不动，不向下跳）；③ 早于全部可见行：取首行；④ 晚于全部可见行：取末行。行内偏移原样保留，结果不为负
// （上限由浏览器按 scrollHeight 钳制）。rows 为空数组（折叠态无可见行）返回 0；null 走恒等映射。
export function resolveNutScrollTop(rows, anchor, paddingTop, lineHeight) {
    const list = Array.isArray(rows) ? rows : null;
    if (list && list.length === 0) return 0;
    const h = lineHeight > 0 ? lineHeight : 1;
    const pad = Number.isFinite(paddingTop) ? paddingTop : 0;
    const target = anchor && Number.isInteger(anchor.line) ? anchor.line : 0;
    const intra = anchor && Number.isFinite(anchor.intra) ? anchor.intra : 0;
    if (!list) return Math.max(0, pad + Math.max(0, target) * h + intra);
    let idx = -1;
    for (let i = 0; i < list.length; i++) {
        const line = list[i] && Number.isInteger(list[i].line) ? list[i].line : i;
        if (line === target) {
            idx = i;
            break;
        }
        if (line < target) idx = i;
        else break;
    }
    if (idx < 0) idx = 0;
    return Math.max(0, pad + idx * h + intra);
}

// ============================================================
//  .nut 折叠态编辑（§3.5「折叠态可编辑」，2026-09-11 对齐 VS Code）
//  折叠只作用于显示层：editText 始终保存完整文本；折叠态 textarea 只承载「可见行」文本，输入
//  发生后按行做前缀 / 后缀公共段差分，定位被改动的真实行区间并回填，其余行原样保留；折叠区间
//  按行数差平移（区间整体在替换区之后 → 平移；开行 / 闭行落在替换区内 → 钉到替换区边界）。
//  跨折叠边界的行级改动（把隐藏行纳入替换区、或把新行插入隐藏区内部）会丢失 / 掩藏隐藏内容，
//  一律不执行并返回待展开的区间（blocked），由展示层展开后交由用户继续——VS Code 会直接删除
//  选区内的隐藏文本，本仓选择先展开以杜绝误删（有意差异，见文档 §3.5 / §5）。
// ============================================================

// 归一化行数组（与 findNutFoldRanges / buildNutFoldLines 同款：CRLF / CR → LF）
function nutNormLines(text) {
    return String(text == null ? "" : text)
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n");
}

// 归一化折叠区间：过滤非法（非整数 / 同行 / 逆序）、外层吸收内层、按开行升序
function normalizeNutFolds(folds) {
    const list = (Array.isArray(folds) ? folds : []).filter(f => f && Number.isInteger(f.open) && Number.isInteger(f.close) && f.open < f.close).sort((a, b) => a.open - b.open || b.close - a.close);
    const out = [];
    for (const f of list) {
        if (out.some(o => o.open <= f.open && f.close <= o.close)) continue;
        out.push({ open: f.open, close: f.close });
    }
    return out;
}

// 可见行下标：严格位于某折叠区间内部的行隐藏（区间开行 / 闭行保留，与 buildNutFoldLines 一致）
function visibleNutLineIndices(lineCount, folds) {
    const ranges = normalizeNutFolds(folds);
    const out = [];
    for (let i = 0; i < lineCount; i++) {
        if (ranges.some(f => i > f.open && i < f.close)) continue;
        out.push(i);
    }
    return out;
}

// 折叠态 textarea 取值：全部可见行以 LF 连接（行尾统一 LF——textarea 值本身即 LF 归一化）
export function buildNutFoldEditableText(text, folds) {
    const lines = nutNormLines(text);
    return visibleNutLineIndices(lines.length, folds)
        .map(i => lines[i])
        .join("\n");
}

// 折叠态编辑并回完整文本：返回 { text, folds, blocked, expand }
// blocked 为真时 text / folds 原样返回（本次输入不生效），expand 为需展开的折叠区间开行集合。
export function mergeNutFoldEdit(text, folds, nextVisibleText) {
    const src = String(text == null ? "" : text);
    const ranges = normalizeNutFolds(folds);
    const lines = nutNormLines(src);
    const visible = visibleNutLineIndices(lines.length, ranges);
    const prevVisible = visible.map(i => lines[i]);
    const nextNormalized = String(nextVisibleText == null ? "" : nextVisibleText)
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");
    const nextVisible = nextNormalized.split("\n");
    if (prevVisible.length === nextVisible.length && prevVisible.every((v, i) => v === nextVisible[i])) {
        return { text: src, folds: ranges, blocked: false, expand: [] };
    }

    // 前缀 / 后缀公共段 → 被改动的 textarea 行区间 [p, len - s)
    let p = 0;
    const maxP = Math.min(prevVisible.length, nextVisible.length);
    while (p < maxP && prevVisible[p] === nextVisible[p]) p++;
    let s = 0;
    while (s < maxP - p && prevVisible[prevVisible.length - 1 - s] === nextVisible[nextVisible.length - 1 - s]) s++;
    const oldCount = prevVisible.length - p - s;
    const newRegion = nextVisible.slice(p, nextVisible.length - s);

    // 被替换的真实行区间 [spanStart, spanEnd]；纯插入时 spanEnd = spanStart - 1（空区间）
    let spanStart;
    let spanEnd;
    if (oldCount > 0) {
        spanStart = visible[p];
        spanEnd = visible[p + oldCount - 1];
    } else {
        spanStart = p < visible.length ? visible[p] : lines.length;
        spanEnd = spanStart - 1;
    }

    // 保护：替换区覆盖整段折叠区间（隐藏行将被删）、或新行插入隐藏区内部 → 不执行
    const expand = ranges.filter(f => (oldCount > 0 ? f.open >= spanStart && f.close <= spanEnd : spanStart > f.open && spanStart <= f.close)).map(f => f.open);
    if (expand.length > 0) return { text: src, folds: ranges, blocked: true, expand };

    // 行数组重建（未涉及行原样保留），行尾沿用源文件主流行尾
    const rebuilt = lines.slice(0, spanStart).concat(newRegion, lines.slice(spanEnd + 1));
    const mergedText = rebuilt.join(/\r\n/.test(src) ? "\r\n" : "\n");

    // 折叠区间平移：整体在替换区之后 → 按行数差平移；开行 / 闭行落在替换区内 → 钉到替换区边界
    const delta = newRegion.length - oldCount;
    const nextFolds = [];
    for (const f of ranges) {
        let open = f.open;
        let close = f.close;
        if (oldCount === 0) {
            if (open >= spanStart) open += delta;
            if (close >= spanStart) close += delta;
        } else if (close < spanStart) {
            // 区间整体在替换区之前：不变
        } else if (open > spanEnd) {
            open += delta;
            close += delta;
        } else {
            if (open >= spanStart) open = spanStart;
            if (close <= spanEnd) close = spanStart + Math.max(0, newRegion.length - 1);
        }
        if (open < close) nextFolds.push({ open, close });
    }

    // 自洽校验：并回后按新区间取出的可见行文本必须等于用户输入，否则一律保护（不执行）
    const mergedFolds = normalizeNutFolds(nextFolds);
    if (buildNutFoldEditableText(mergedText, mergedFolds) !== nextNormalized) {
        const affected = ranges.filter(f => !(spanEnd < f.open) && !(spanStart > f.close)).map(f => f.open);
        return { text: src, folds: ranges, blocked: true, expand: affected };
    }
    return { text: mergedText, folds: mergedFolds, blocked: false, expand: [] };
}

// ============================================================
//  .nut 缩进风格检测（对照 VS Code 编辑器格式化语义，规则见 docs/pvf-tw-nut-script.md §3.4）
//  参考：code-server 所服务的编辑器语义——格式化器经 FormattingOptions 接收编辑器按文件
//  检测出的 tabSize / insertSpaces，缩进风格随文件而定；检测算法对照 VS Code 的缩进猜测
//  （行首 tab / 空格行数多数判定 + 相邻有内容行行首缩进差直方图猜宽度）。
//  本仓回落：无缩进证据（全平铺 / 行数持平）时沿用既定 Tab 单级。
// ============================================================
const NUT_INDENT_TAB_SIZE_CANDIDATES = [2, 4, 6, 8, 3, 5, 7]; // 偶优先，限 [2, 8]
const NUT_INDENT_MAX_TAB_SIZE = 8;
const NUT_INDENT_DEFAULT_TAB_SIZE = 4;
const NUT_INDENT_MAX_LINES = 10000;

// 相邻两条有内容行的行首缩进差（换算为空格当量）。混用 tab / 空格（缩进段内两种都存在）或
// 无法整除时返回 0；逗号对齐行（上一行行尾为 ","、本行缩进含空格差）标记为对齐（对照简化：
// 仅保留 VS Code 判定的对齐意图，其余列位置启发式略去），调用方跳过该行不作宽度证据。
function nutIndentSpacesDiff(aText, aIndent, bText, bIndent) {
    let i = 0;
    const min = Math.min(aIndent, bIndent);
    while (i < min && aText[i] === bText[i]) i++;
    let aSpaces = 0;
    let aTabs = 0;
    let bSpaces = 0;
    let bTabs = 0;
    for (let j = i; j < aIndent; j++) aText[j] === " " ? aSpaces++ : aTabs++;
    for (let j = i; j < bIndent; j++) bText[j] === " " ? bSpaces++ : bTabs++;
    if ((aSpaces > 0 && aTabs > 0) || (bSpaces > 0 && bTabs > 0)) return { diff: 0, looksLikeAlignment: false };
    const tabsDiff = Math.abs(aTabs - bTabs);
    const spacesDiff = Math.abs(aSpaces - bSpaces);
    if (tabsDiff === 0) {
        const looksLikeAlignment = spacesDiff > 0 && aText.length > 0 && aText[aText.length - 1] === ",";
        return { diff: spacesDiff, looksLikeAlignment };
    }
    if (spacesDiff % tabsDiff === 0) return { diff: spacesDiff / tabsDiff, looksLikeAlignment: false };
    return { diff: 0, looksLikeAlignment: false };
}

// 检测文本的一级缩进单位：tab 单级（"\t"）或 N 空格单级（N ∈ [2, 8]，空格风格时由缩进差直方图猜出）。
// 空格宽度猜测顺序 2/4/6/8/3/5/7，2 需达到 4 的 2/3 才反超，无得分兜底 4（与 VS Code 同款阈值）。
export function detectNutIndentUnit(text) {
    const lines = String(text == null ? "" : text)
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n");
    const count = Math.min(lines.length, NUT_INDENT_MAX_LINES);
    let tabLines = 0;
    let spaceLines = 0;
    let prevText = "";
    let prevIndent = 0;
    const diffCount = new Array(NUT_INDENT_MAX_TAB_SIZE + 1).fill(0);
    for (let li = 0; li < count; li++) {
        const line = lines[li];
        let n = 0;
        let tabs = 0;
        let spaces = 0;
        let hasContent = false;
        for (; n < line.length; n++) {
            if (line[n] === "\t") tabs++;
            else if (line[n] === " ") spaces++;
            else {
                hasContent = true;
                break;
            }
        }
        if (!hasContent) continue; // 空行 / 纯空白行不作证据
        if (tabs > 0) tabLines++;
        else if (spaces > 1) spaceLines++;
        const { diff, looksLikeAlignment } = nutIndentSpacesDiff(prevText, prevIndent, line, n);
        if (looksLikeAlignment) continue; // 对齐行既不作风格证据，也不更新比较基准
        if (diff <= NUT_INDENT_MAX_TAB_SIZE) diffCount[diff]++;
        prevText = line;
        prevIndent = n;
    }
    // 风格判定：行首含 tab 的行数与行首空格数 > 1 的行数取多数（持平沿用本仓默认 insertSpaces = false）
    let insertSpaces = false;
    if (tabLines !== spaceLines) insertSpaces = tabLines < spaceLines;
    if (!insertSpaces) return "\t";
    let tabSize = NUT_INDENT_DEFAULT_TAB_SIZE;
    let best = 0;
    for (const candidate of NUT_INDENT_TAB_SIZE_CANDIDATES) {
        if (diffCount[candidate] > best) {
            best = diffCount[candidate];
            tabSize = candidate;
        }
    }
    if (tabSize === 4 && diffCount[4] > 0 && diffCount[2] > 0 && diffCount[2] >= (diffCount[4] * 2) / 3) tabSize = 2;
    return " ".repeat(tabSize);
}

// 缩进重排（一级缩进单位按文件既有风格检测（见 detectNutIndentUnit）；显示缩进栈：闭合行与
// 开括号行左对齐；case/default 取所属 switch frame；悬挂体链；独立 { 吸附；else 吸附；
// 空行压缩与函数间空行保证；空行保持；行尾空白清理；字符串 / verbatim / 块注释跨行行逐字保留）
export function formatNutText(code) {
    if (code == null) return "";
    const lines = String(code).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const indentUnit = detectNutIndentUnit(code);
    const recs = scanLines(lines);

    // 整体基准缩进：保持首非空行的原缩进（不改变文件整体基准排版）
    let initialIndent = "";
    for (const line of lines) {
        if (line.trim() !== "") {
            initialIndent = (line.match(/^\s*/) || [""])[0];
            break;
        }
    }

    // 函数间空行保证（2026-09-10 增补）+ 注释吸附（同批）：
    // 顶层 function 定义行与上一条非空代码行之间至少一个空行（函数上方注释块整体分隔，
    // 空行插在注释块前）；注释块与 function 之间已有的空行删除（注释紧贴函数一体）。
    // 以模拟层级判定顶层（level === 0）。
    const blankAfter = new Set();
    const blankDel = new Set();
    const isCommentLine = r => r.firstChar === "/" && r.firstWord === null;
    let simLevel = 0;
    for (let i = 0; i < lines.length; i++) {
        const rec = recs[i];
        if (!rec.continued && lines[i].trim() !== "" && rec.firstWord === "function" && simLevel === 0) {
            // 向上跳过 function 行上方连续空行
            let j = i - 1;
            let skippedBlank = false;
            while (j >= 0 && lines[j].trim() === "") {
                skippedBlank = true;
                j--;
            }
            if (j >= 0 && (recs[j].continued || isCommentLine(recs[j]))) {
                // 函数上方为注释块：与 function 之间已有的空行删除（注释一体）
                if (skippedBlank) for (let k = j + 1; k < i; k++) blankDel.add(k);
                // 继续向上跳过注释块：上方代码行后保证空行（注释块上方已有空行则不插）
                let k2 = j;
                while (k2 >= 0 && (recs[k2].continued || isCommentLine(recs[k2]))) k2--;
                if (k2 >= 0 && lines[k2].trim() !== "") blankAfter.add(k2);
            } else if (j >= 0 && j === i - 1) {
                // 紧贴代码行（无注释块、无空行）→ 插空行；已有空行（j < i-1）或文件头 → 不处理
                blankAfter.add(j);
            }
        }
        // 模拟层级（与输出层显示栈深度一致：行首 } 减层一次 + 行内花括号净变化）
        if (!rec.continued && lines[i].trim() !== "" && rec.firstChar === "}") {
            simLevel = Math.max(simLevel - 1, 0);
        }
        simLevel = Math.max(simLevel + rec.delta, 0);
    }

    const result = [];
    // 显示缩进栈：每个已开 { 区块记录 { disp: 开括号行显示缩进, isSwitch: 是否 switch 块 }；
    // 闭合 } 行取栈顶显示缩进（与开括号行左对齐）并出栈；case / default 取所属 switch frame
    const stack = [];
    // 上一条非空代码行的显示缩进（吸附 { 的 frame 显示缩进取该值——吸附目标行
    // 可能为闭合 } 行，其 frame 已出栈，不能取当前栈顶）
    let lastEff = 0;
    let lastWasEmpty = false;
    let lastNonEmptySrc = -1;
    let lastNonEmptyOut = -1;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const rec = recs[i];
        const trimmed = line.trim();
        if (trimmed === "") {
            // 延续态（块注释 / verbatim 期间）空行：属字符串 / 注释内容，逐字保留不压缩
            if (rec.continued) {
                result.push(line);
                continue;
            }
            // 注释吸附（2026-09-10 增补）：注释块与 function 之间已有的空行删除
            if (blankDel.has(i)) continue;
            // 连续空行压缩（2026-09-10 增补）：≥2 连续空行只保留一个
            if (lastWasEmpty) continue;
            result.push("");
            lastWasEmpty = true;
            continue;
        }
        lastWasEmpty = false;
        // 字符串 / verbatim / 块注释跨行延续行：逐字保留（不重排，修正缺陷 ③）
        if (rec.continued) {
            result.push(line);
            // 罕见：延续行内花括号（verbatim 闭合后同行代码），同步显示栈
            if (rec.delta > 0) {
                for (let n = 0; n < rec.delta; n++) {
                    stack.push({ disp: stack.length ? stack[stack.length - 1].disp + 1 : 0, isSwitch: false });
                }
            } else {
                for (let n = 0; n < -rec.delta; n++) stack.pop();
            }
            lastNonEmptySrc = i;
            lastNonEmptyOut = result.length - 1;
            continue;
        }
        // 悬挂体链：向前数连续悬挂控制流行（连续 if/else/for/... 单语句体逐级缩进）
        let hangCount = 0;
        for (let j = i - 1; j >= 0; j--) {
            if (lines[j].trim() === "" || recs[j].continued) break;
            if (!isHangingLine(recs[j])) break;
            hangCount++;
        }
        // else 行吸附（2026-09-10 增补；2026-09-11 修正：保留 else 之后的原文，不再只拼关键字字面量）：
        // 上一条非空代码行行尾有效字符为 "}" → 合并为 "} else"；else 之后的内容（`if (cond)` / `{`）经
        // 运算符空格归一后一并拼接，Allman 形态 `}` / `else if (cond)` / `{` 得 `} else if (cond) {`。
        // 旧实现只拼 `" else"` 即 continue，把 else 行剩余文本整体丢弃——else-if 链条件尽失、输出
        // 退化为连续 `} else {`（语义破坏）。`else` 单独成行时 rest 为空，输出 `} else`（与既有形态一致）。
        if (rec.firstWord === "else" && rec.firstChar !== "}" && lastNonEmptySrc >= 0) {
            const lr = recs[lastNonEmptySrc];
            if (!lr.continued && lr.endState === S_CODE && !lr.endInComment && lr.lastChar === "}") {
                const rest = trimmed.slice("else".length).trim();
                result[lastNonEmptyOut] += rest === "" ? " else" : " else " + padOperatorSpacing(rest);
                // 吸附行可能自带开块 `{`（`else if (cond) {`）：显示栈同步——新 frame 的显示缩进取
                // 上一行（`}` 行）的显示缩进，与该 `}` 行此前弹出的 frame 一致（`{` 吸附分支同款）；
                // 缺此同步会使吸附行的块体层级少一级。
                if (rec.delta > 0) {
                    for (let n = 0; n < rec.delta; n++) stack.push({ disp: lastEff, isSwitch: false });
                } else if (rec.delta < 0) {
                    for (let n = 0; n < -rec.delta; n++) stack.pop();
                }
                lastNonEmptySrc = i;
                continue;
            }
        }
        // 独立 { 行吸附：上一条非空代码行行尾有效字符为 ")" 或行首词为 else（吸附后的 else 行）
        // （Allman → K&R；吸附后前置一个空格，2026-09-10 经用户确认为带空格形态）
        if (trimmed === "{" && lastNonEmptySrc >= 0) {
            const lr = recs[lastNonEmptySrc];
            if (!lr.continued && lr.endState === S_CODE && !lr.endInComment && (lr.lastChar === ")" || lr.firstWord === "else")) {
                result[lastNonEmptyOut] += " {";
                // 开块 frame：显示缩进 = 吸附目标行（函数头 / else 行）的输出缩进（lastEff；
                // 目标行可能为闭合 } 行，其 frame 已出栈，不能取当前栈顶）
                stack.push({ disp: lastEff, isSwitch: false });
                lastNonEmptySrc = i;
                continue;
            }
        }
        // 显示缩进计算（2026-09-10 显示缩进栈方案）
        const top = stack.length ? stack[stack.length - 1] : null;
        let eff;
        if (rec.firstChar === "}") {
            // 闭合行与对应开括号行左对齐（取栈顶显示缩进）
            eff = stack.length ? stack[stack.length - 1].disp : 0;
        } else if (stack.length && stack[stack.length - 1].isSwitch) {
            // switch 块内：case / default 行 = switch 显示缩进 + 1，case 体行 = + 2
            eff = stack[stack.length - 1].disp + (rec.firstWord === "case" || rec.firstWord === "default" ? 1 : 2);
        } else if (stack.length) {
            eff = stack[stack.length - 1].disp + 1;
        } else {
            eff = 0;
        }
        eff += hangCount;
        result.push(initialIndent + indentUnit.repeat(eff) + padOperatorSpacing(trimmed));
        lastEff = eff;
        lastNonEmptySrc = i;
        lastNonEmptyOut = result.length - 1;
        if (blankAfter.has(i)) {
            // 函数间空行保证：该行输出后插入一个空行（其后为顶层 function 定义行）
            result.push("");
            lastWasEmpty = true;
        }
        // 显示栈同步：行首闭合出栈一次（firstChar === "}"），行内净变化再补 push / pop
        if (rec.firstChar === "}") stack.pop();
        if (rec.delta > 0) {
            for (let n = 0; n < rec.delta; n++) stack.push({ disp: eff, isSwitch: rec.firstWord === "switch" });
        } else {
            for (let n = 0; n < -rec.delta; n++) stack.pop();
        }
    }
    return result.join("\n");
}

// ============================================================
//  编辑器装饰语义（缩进辅助线 / 活动块 / 同类词高亮）
//  规则、语义边界与已登记差异见 docs/pvf-tw-nut-script.md §3.6（VS Code 对照）。
//  纯函数、不改动文本模型：列一律为「可见列」（1 基，制表符按 tabSize 折算），
//  供组件装饰覆盖层按等宽几何线性换算（x = 左边距 + (可见列 - 1) × 字符宽）。
// ============================================================

// 词分隔符集合（VS Code wordHelper.USUAL_WORD_SEPARATORS 同款，登记备查；实际词提取以
// 词正则 NUT_WORD_RE 的补集为准，两者等价）。
export const NUT_WORD_SEPARATORS = "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?";
// 词正则（VS Code wordHelper.DEFAULT_WORD_REGEXP 同款）
const NUT_WORD_RE = /[a-zA-Z0-9_]+/g;
// 同类词高亮上限（防御性上限，避免超大文件构造过多矩形；超出置 truncated = true）
const NUT_OCCURRENCE_MAX_MATCHES = 2000;
// 选区高亮最大长度（VS Code editor.selectionHighlightMaxLength 默认 200；0 为不限）
const NUT_SELECTION_HIGHLIGHT_MAX_LENGTH = 200;

// 按 \n 切行（CRLF / CR 归一，与解析层同款）
function nutDecorSplitLines(text) {
    return String(text == null ? "" : text)
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n");
}

// 可见列宽：制表符按 tabSize 折算（与展示层 tab-size 线性几何一致）
function nutVisibleWidth(ch, tabSize) {
    return ch === "\t" ? tabSize : 1;
}

// 行内原始下标 → 可见列（1 基）
function nutVisibleColumnAt(line, index, tabSize) {
    let col = 1;
    const end = Math.min(index, line.length);
    for (let i = 0; i < end; i++) col += nutVisibleWidth(line[i], tabSize);
    return col;
}

// 逐行区块辅助线层级（docs/pvf-tw-nut-script.md §3.6「区块区域辅助线」用户规则）：
// 辅助线只由**跨行 `{}` 区块**产生，某区块的辅助线只绘制在其区域内部行上——开括号行的
// 下一行 ~ 闭括号行的前一行。层级 = 该行所在跨行花括号区块的嵌套数：逐区块在 open+1 处
// 差分 +1、在 close 处差分 -1，前缀和即该行层级（区域内部行判定天然覆盖空白行，辅助线连续）。
// 配对与折叠同源（findNutFoldRanges：字符串 / verbatim / 注释内花括号不配对、同行 {} 不成区、
// 相邻开闭行（无内部行）不成区、未闭合 { 不成区），故单行展示语句与未由花括号开出的缩进
// （悬挂单语句体 / 条件续行 / case 体更深缩进等）均不产生辅助线。
export function computeNutBlockGuideLevels(text) {
    const lines = nutDecorSplitLines(text);
    const levels = new Array(lines.length).fill(0);
    for (const [open, close] of findNutFoldRanges(text)) {
        levels[open + 1] += 1;
        levels[close] -= 1;
    }
    let depth = 0;
    for (let i = 0; i < lines.length; i++) {
        depth += levels[i];
        levels[i] = depth;
    }
    return levels;
}

// 光标所在活动缩进块（VS Code getActiveIndentGuide 语义）：返回 { startLine, endLine, indent }
// （0 基行号，行范围含端点）。两处特判：光标位于开括号行（下一行层级 = 当前层级 + 1）取子块；
// 光标位于块尾闭行（上一行层级 - 1 = 当前层级）取父块；层级为 0 时不延伸（仅当前行）。
// levels 为 computeNutBlockGuideLevels 的逐行层级；line 为 0 基行号。
export function findNutActiveIndentGuide(levels, line) {
    const lineCount = Array.isArray(levels) ? levels.length : 0;
    if (lineCount === 0 || !Number.isInteger(line) || line < 0 || line >= lineCount) return null;
    const initialIndent = levels[line];
    let startLine = line;
    let endLine = line;
    let indent = initialIndent;
    let goUp = true;
    let goDown = true;
    for (let distance = 0; goUp || goDown; distance++) {
        const upLine = line - distance;
        const downLine = line + distance;
        if (distance > 1 && upLine < 0) goUp = false;
        if (distance > 1 && downLine > lineCount - 1) goDown = false;
        const upLevel = goUp && upLine >= 0 ? levels[upLine] : -1;
        const downLevel = goDown && downLine <= lineCount - 1 ? levels[downLine] : -1;
        if (distance === 0) continue;
        if (distance === 1) {
            if (downLine <= lineCount - 1 && downLevel >= 0 && initialIndent + 1 === downLevel) {
                // 开括号行：活动块取子块
                goUp = false;
                startLine = downLine;
                endLine = downLine;
                indent = downLevel;
                continue;
            }
            if (upLine >= 0 && upLevel >= 0 && upLevel - 1 === initialIndent) {
                // 块尾闭行：活动块取父块
                goDown = false;
                startLine = upLine;
                endLine = upLine;
                indent = upLevel;
                continue;
            }
            startLine = line;
            endLine = line;
            indent = initialIndent;
            if (indent === 0) return { startLine, endLine, indent };
        }
        if (goUp) {
            if (upLevel >= indent) startLine = upLine;
            else goUp = false;
        }
        if (goDown) {
            if (downLevel >= indent) endLine = downLine;
            else goDown = false;
        }
    }
    return { startLine, endLine, indent };
}

// 取某行指定可见列处的词（VS Code getWordAtText + DEFAULT_WORD_REGEXP 语义）：词正则为
// [A-Za-z0-9_]+；两端含端点判定（startColumn <= column <= endColumn），故光标紧邻词首 / 词尾仍命中。
// 返回 { word, startColumn, endColumn }（1 基可见列，endColumn 为词后一列），未命中返回 null。
export function nutWordAtColumn(lineText, column, tabSize = 4) {
    const line = String(lineText == null ? "" : lineText);
    const size = Number.isFinite(tabSize) && tabSize > 0 ? tabSize : 4;
    if (!Number.isFinite(column) || column < 1) return null;
    NUT_WORD_RE.lastIndex = 0;
    let match;
    while ((match = NUT_WORD_RE.exec(line)) !== null) {
        const startColumn = nutVisibleColumnAt(line, match.index, size);
        const endColumn = startColumn + match[0].length;
        if (startColumn <= column && endColumn >= column) return { word: match[0], startColumn, endColumn };
    }
    return null;
}

// 光标（或选区）处词的全部出现处（VS Code 文本型同类词高亮路径 + wordHighlighter._run 选区门控）：
// 词取 selection 起点（有选区时）或光标处；多行选区不参与；选区须落在同一个词内或恰好包住该词；
// 选区可见列长度上限 200（0 为不限）。匹配为整词（词正则 token 全等）、区分大小写、全文件纯文本匹配
// （注释 / 字符串内同名单词同样命中，与 VS Code 文本型路径一致，不做语义过滤）。
// 返回 { word, kind: "word" | "selection", matches: [{ line, startColumn, endColumn }], truncated }；
// 不满足高亮条件返回 null。options: { selection, tabSize, maxMatches }。
export function findNutWordOccurrences(text, line, column, options = {}) {
    const tabSize = Number.isFinite(options.tabSize) && options.tabSize > 0 ? options.tabSize : 4;
    const selection = options.selection || null;
    if (selection && selection.startLine !== selection.endLine) return null; // 多行选区不参与高亮
    const hasSelection = !!(selection && (selection.startLine !== selection.endLine || selection.startColumn !== selection.endColumn));
    const lineIndex = hasSelection ? selection.startLine : line;
    const caretColumn = hasSelection ? selection.startColumn : column;
    const lines = nutDecorSplitLines(text);
    if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) return null;
    const target = nutWordAtColumn(lines[lineIndex], caretColumn, tabSize);
    if (!target) return null;
    if (hasSelection) {
        // 选区须落在同一个词内或恰好包住该词
        if (selection.startColumn < target.startColumn || selection.endColumn > target.endColumn) return null;
        const maxSelectionLength = Number.isFinite(options.maxSelectionLength) && options.maxSelectionLength >= 0 ? options.maxSelectionLength : NUT_SELECTION_HIGHLIGHT_MAX_LENGTH;
        if (maxSelectionLength > 0 && selection.endColumn - selection.startColumn > maxSelectionLength) return null;
    }
    const maxMatches = Number.isInteger(options.maxMatches) && options.maxMatches > 0 ? options.maxMatches : NUT_OCCURRENCE_MAX_MATCHES;
    const matches = [];
    let truncated = false;
    for (let li = 0; li < lines.length && !truncated; li++) {
        const content = lines[li];
        NUT_WORD_RE.lastIndex = 0;
        let match;
        while ((match = NUT_WORD_RE.exec(content)) !== null) {
            if (match[0] !== target.word) continue; // 整词 + 区分大小写
            if (matches.length >= maxMatches) {
                truncated = true;
                break;
            }
            const startColumn = nutVisibleColumnAt(content, match.index, tabSize);
            matches.push({ line: li, startColumn, endColumn: startColumn + match[0].length });
        }
    }
    return { word: target.word, kind: hasSelection ? "selection" : "word", matches, truncated };
}
