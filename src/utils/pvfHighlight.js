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
