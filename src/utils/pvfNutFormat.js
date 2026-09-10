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

// 缩进重排（Tab 1 级；显示缩进栈：闭合行与开括号行左对齐；case/default 取所属 switch frame；
// 悬挂体链；独立 { 吸附；else 吸附；空行压缩与函数间空行保证；空行保持；行尾空白清理；
// 字符串 / verbatim / 块注释跨行行逐字保留）
export function formatNutText(code) {
    if (code == null) return "";
    const lines = String(code).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
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
        // else 行吸附（2026-09-10 增补）：上一条非空代码行行尾有效字符为 "}" → 合并为 "} else"
        if (rec.firstWord === "else" && rec.firstChar !== "}" && lastNonEmptySrc >= 0) {
            const lr = recs[lastNonEmptySrc];
            if (!lr.continued && lr.endState === S_CODE && !lr.endInComment && lr.lastChar === "}") {
                result[lastNonEmptyOut] += " else";
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
        result.push(initialIndent + "\t".repeat(eff) + padOperatorSpacing(trimmed));
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
