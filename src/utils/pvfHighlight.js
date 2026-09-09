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
                // Squirrel new-slot 操作符 <-（枚举赋值高频），弱化为灰色以突出名字与值
                {
                    className: "operator",
                    match: /<-/
                },
                {
                    className: "title",
                    match: /(?<=\bfunction\s+)[A-Za-z_]\w*/
                }
            ]
        };
    });
}
