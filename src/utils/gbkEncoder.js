// GBK Encoder — generates Unicode→GBK mapping at load time
// by leveraging the browser's built-in TextDecoder('gbk').

let _gbkMap = null;

function getGbkMap() {
    if (_gbkMap) return _gbkMap;

    const decoder = new TextDecoder("gbk");
    _gbkMap = new Map();

    for (let high = 0x81; high <= 0xfe; high++) {
        for (let low = 0x40; low <= 0xfe; low++) {
            if (low === 0x7f) continue;
            const str = decoder.decode(new Uint8Array([high, low]));
            if (str.length === 1) {
                _gbkMap.set(str.charCodeAt(0), (high << 8) | low);
            }
        }
    }

    return _gbkMap;
}

export function encodeGBK(text) {
    const map = getGbkMap();
    const bytes = [];

    for (const char of text) {
        const code = char.codePointAt(0);

        if (code < 0x80) {
            bytes.push(code);
            continue;
        }

        const gbkCode = map.get(code);
        if (gbkCode !== undefined) {
            bytes.push((gbkCode >> 8) & 0xff);
            bytes.push(gbkCode & 0xff);
        } else {
            bytes.push(0x3f);
        }
    }

    return new Uint8Array(bytes);
}

// 单字符 GBK 编码查询：返回 16 位 GBK 码（高字节为区号）或 undefined（不可编码）
export function gbkCode(ch) {
    const code = ch.codePointAt(0);
    if (code < 0x80) return code;
    return getGbkMap().get(code);
}
