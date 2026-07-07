// ============================================================
//  PVF 脚本语法格式检查
//  与 encodeType1Text (pvfTool.js) 的解析规则保持一致：
//    - 反引号字符串 `...`（`` 转义）必须闭合，可跨多行
//    - 标记 {N=...} 必须闭合 }
//    - 标签 [...] 需闭合 ]；同行无 ] 时视为以 [ 开头的裸 token
//      （原始 Script.pvf 中存在此类数据，如 [/BEHAVI，不应报错）
//    - 数字字面量必须合法
//    - 注释 # 仅在行内有效
//  返回错误数组：[{ line, message }]
//  若返回空数组则表示通过。
// ============================================================

export function validatePvfText(text) {
    if (!text) return [];
    const errors = [];
    const lines = text.split("\n");

    // 反引号字符串可跨多行，状态需在整个文本内延续
    let inBacktick = false;
    let backtickStartLine = 0;
    let backtickStartCol = 0;

    for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        const lineNo = li + 1;
        let i = 0;

        while (i < line.length) {
            const ch = line[i];

            // 注释：未在反引号内时 # 到行末
            if (!inBacktick && ch === "#") {
                break;
            }

            // 反引号字符串（含 `` 转义）
            if (ch === "`") {
                if (inBacktick) {
                    if (line[i + 1] === "`") {
                        i += 2; // 转义
                        continue;
                    }
                    inBacktick = false;
                    i++;
                    continue;
                }
                inBacktick = true;
                backtickStartLine = lineNo;
                backtickStartCol = i;
                i++;
                continue;
            }

            // 标签 [xxx]
            if (!inBacktick && ch === "[") {
                const end = line.indexOf("]", i + 1);
                if (end < 0) {
                    // 同行无闭合 ]：视为以 [ 开头的裸 token（原始数据中存在，如 [/BEHAVI）
                    i++;
                    while (i < line.length && !/[\s`{}\[\]#]/.test(line[i])) i++;
                    continue;
                }
                const inner = line.substring(i + 1, end);
                if (inner.length === 0) {
                    errors.push({ line: lineNo, message: "标签内容为空 []" });
                } else if (/[`\[\]{}]/.test(inner)) {
                    errors.push({ line: lineNo, message: `标签 [${inner}] 内含非法字符` });
                }
                i = end + 1;
                continue;
            }

            // 标记 {N=...}
            if (!inBacktick && ch === "{") {
                const m = /^\{([0-9]+)=/.exec(line.substring(i));
                if (m) {
                    const end = findMarkerEnd(line, i + 1);
                    if (end < 0) {
                        errors.push({ line: lineNo, message: `标记 ${m[0]} 缺少闭合 }` });
                        break;
                    }
                    i = end + 1;
                    continue;
                }
                // 非法 {
                errors.push({ line: lineNo, message: "非法的 { 标记（应为 {数字=...}）" });
                i++;
                continue;
            }

            // 裸数字 / 标识符
            if (!inBacktick && !/[\s`{}\[\]#]/.test(ch)) {
                const start = i;
                while (i < line.length && !/[\s`{}\[\]#]/.test(line[i])) i++;
                const token = line.substring(start, i);
                const numOk = /^-?\d+$/.test(token) || /^-?\d*\.\d+$/.test(token) || /^-?\d+\.\d*$/.test(token);
                if (!numOk) {
                    // 非数字的裸标识符允许（会作为字符串 token），仅检查是否含非法字符
                    if (/[`{}]/.test(token)) {
                        errors.push({ line: lineNo, message: `标识符 "${token}" 含非法字符` });
                    }
                }
                continue;
            }

            i++;
        }
        // 行末仍在反引号内：字符串可能延续到下一行，此处不报错
    }

    // 全部行结束后仍在反引号内 -> 未闭合
    if (inBacktick) {
        errors.push({
            line: backtickStartLine,
            message: `反引号字符串未闭合（从第 ${backtickStartLine} 行第 ${backtickStartCol + 1} 列开始）`
        });
    }

    return errors;
}

// 在 marker 内查找 } 闭合位置（忽略反引号内的 }）
function findMarkerEnd(line, start) {
    let inBacktick = false;
    for (let i = start; i < line.length; i++) {
        if (line[i] === "`") {
            if (inBacktick && line[i + 1] === "`") {
                i++;
                continue;
            }
            inBacktick = !inBacktick;
            continue;
        }
        if (!inBacktick && line[i] === "}") return i;
    }
    return -1;
}
