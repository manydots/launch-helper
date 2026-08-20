// Big5 Encoder — generates Unicode→Big5 mapping at load time
// by leveraging the browser's built-in TextDecoder('big5').

let _big5Map = null;

function getBig5Map() {
    if (_big5Map) return _big5Map;

    const decoder = new TextDecoder("big5");
    _big5Map = new Map();

    // Big5 双字节区：高字节 0x81~0xFE，低字节 0x40~0x7E 与 0xA1~0xFE
    for (let high = 0x81; high <= 0xfe; high++) {
        for (let low = 0x40; low <= 0xfe; low++) {
            if (low === 0x7f) continue;
            const str = decoder.decode(new Uint8Array([high, low]));
            if (str.length === 1) {
                _big5Map.set(str.charCodeAt(0), (high << 8) | low);
            }
        }
    }

    return _big5Map;
}

export function encodeBig5(text) {
    const map = getBig5Map();
    const bytes = [];

    for (const char of text) {
        const code = char.codePointAt(0);

        if (code < 0x80) {
            bytes.push(code);
            continue;
        }

        const big5Code = map.get(code);
        if (big5Code !== undefined) {
            bytes.push((big5Code >> 8) & 0xff);
            bytes.push(big5Code & 0xff);
        } else {
            bytes.push(0x3f);
        }
    }

    return new Uint8Array(bytes);
}
