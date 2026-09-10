// ============================================================
//  PVF Script Language Definition for highlight.js
//  Handles: comments (#), backtick strings (with `` escape),
//  markers ({N=...}), tags ([...]), numbers, identifiers.
// ============================================================

export function registerPvfLanguage(hljs) {
    if (hljs.getLanguage("pvf")) return;

    const BACKTICK_STRING = {
        className: "string",
        match: /`(?:[^`]|``)*`/
    };

    hljs.registerLanguage("pvf", function (hljs) {
        return {
            name: "PVF Script",
            disableAutodetect: true,
            contains: [
                {
                    className: "comment",
                    begin: "#",
                    end: "$"
                },
                // `//` 行注释（#PVF_File 明文文本的注释行与 # 规则同色，见 docs/pvf-tw-format.md §9.3.1）
                {
                    className: "comment",
                    begin: /\/\//,
                    end: "$"
                },
                BACKTICK_STRING,
                {
                    className: "keyword",
                    begin: /\{[0-9]+=/,
                    end: /\}/,
                    contains: [BACKTICK_STRING]
                },
                {
                    className: "type",
                    begin: /\[/,
                    end: /\]/,
                    contains: [BACKTICK_STRING]
                },
                {
                    className: "number",
                    match: /-?\d+\.\d+|-?\d+/
                },
                {
                    className: "title",
                    match: /[^\s`{}[\]#]+/
                }
            ]
        };
    });
}

// ============================================================
//  Squirrel Language Definition for highlight.js（.nut 明文脚本）
//  Handles: line/block comments, quoted strings, keywords,
//  numbers (decimal/hex/float), function titles.
//  见 docs/pvf-tw-nut-script.md §3.3。
// ============================================================

export function registerNutLanguage(hljs) {
    if (hljs.getLanguage("squirrel")) return;

    const NUT_KEYWORDS =
        "as break case catch class clone const continue default delete do else extends " +
        "for foreach function if in instanceof local resume return static switch this " +
        "throw try typeof while yield constructor destructor base";

    // hljs contains 规则优先于 keywords 检测：调用规则与裸标识符兜底规则须以负向先行
    // 排除关键字与 literal，否则关键字被兜底规则误染、keywords 检测永不生效
    // （`if (` / `for (` 此前即被调用规则误染为函数色，既有断言靠其它关键字凑数未暴露）。
    const NUT_RESERVED =
        "as|break|case|catch|class|clone|const|continue|default|delete|do|else|extends|" +
        "for|foreach|function|if|in|instanceof|local|resume|return|static|switch|this|" +
        "throw|try|typeof|while|yield|constructor|destructor|base|true|false|null";
    const NUT_NOT_KEYWORD = r => "\\b(?!\\b(?:" + r + ")\\b)";

    hljs.registerLanguage("squirrel", function (hljs) {
        return {
            name: "Squirrel",
            disableAutodetect: true,
            keywords: {
                keyword: NUT_KEYWORDS,
                literal: "null true false"
            },
            contains: [
                hljs.C_LINE_COMMENT_MODE,
                hljs.C_BLOCK_COMMENT_MODE,
                // @"..." verbatim 字符串（无转义）
                {
                    className: "string",
                    begin: '@"',
                    end: '"',
                    relevance: 0
                },
                hljs.QUOTE_STRING_MODE,
                hljs.APOS_STRING_MODE,
                hljs.C_NUMBER_MODE,
                // function 参数列表（括号内标识符着 variable 类）
                {
                    className: "params",
                    begin: /(?<=\bfunction\s+[A-Za-z_]\w*\s*)\(/,
                    end: /\)/,
                    contains: [{ className: "variable", match: /[A-Za-z_]\w*/ }]
                },
                // `.` 后成员属性：置于调用规则前，成员链统一浅蓝
                {
                    className: "property",
                    match: /(?<=\.)[A-Za-z_]\w*/
                },
                // function 定义处函数名（与调用处同类，定义 / 调用视觉一致）
                {
                    className: "title.function",
                    match: /(?<=\bfunction\s+)[A-Za-z_]\w*/
                },
                // 函数调用名：标识符后紧跟 `(`；排除关键字（if/for 等控制流由 keywords 接管）
                {
                    className: "title.function",
                    match: new RegExp(NUT_NOT_KEYWORD(NUT_RESERVED) + "[A-Za-z_]\\w*(?=\\s*\\()")
                },
                // class / extends 后类名
                {
                    className: "title.class",
                    match: /(?<=\b(?:class|extends)\s+)[A-Za-z_]\w*/
                },
                // Squirrel new-slot 操作符 <-（枚举赋值高频），弱化为灰色以突出名字与值
                {
                    className: "operator",
                    match: /<-/
                },
                // 全大写常量 / 枚举名：置于最后（有调用括号时函数色优先，数字/字符串已被先前规则消费）
                {
                    className: "constant",
                    match: /\b[A-Z][A-Z0-9_]+\b/
                },
                // 裸标识符兜底着 variable 类（参数 / 局部变量 / 使用处；浅蓝）；
                // 排除关键字与 literal（keywords 检测接管）
                {
                    className: "variable",
                    match: new RegExp(NUT_NOT_KEYWORD(NUT_RESERVED) + "[A-Za-z_]\\w*\\b")
                }
            ]
        };
    });
}
