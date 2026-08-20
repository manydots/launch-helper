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
