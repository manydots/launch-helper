// EUC-KR / CP949 Encoder — generates Unicode→CP949 mapping at load time
// by leveraging the browser's built-in TextDecoder('euc-kr').
// 用于 .nut 等韩文源明文脚本的编辑回写（docs/pvf-tw-nut-script.md §3.2）：
// 与解码侧（净化流 CP949 直解）对称，保存时按原始字节语义还原
// （损坏标记「占쏙옙」循环 ↔ EF BF BD 循环交织对称、逐字节守恒）。

let _euckrMap = null;

function getEuckrMap() {
    if (_euckrMap) return _euckrMap;

    const decoder = new TextDecoder("euc-kr");
    _euckrMap = new Map();

    for (let high = 0x81; high <= 0xfd; high++) {
        for (let low = 0x40; low <= 0xfe; low++) {
            if (low === 0x7f) continue;
            const str = decoder.decode(new Uint8Array([high, low]));
            // 仅收录单字符且非替换符的有效映射（替换符不可编码，编码侧显式降级 0x3F）
            if (str.length === 1 && str.charCodeAt(0) !== 0xfffd) {
                _euckrMap.set(str.charCodeAt(0), (high << 8) | low);
            }
        }
    }

    return _euckrMap;
}

export function encodeEUCKR(text) {
    const map = getEuckrMap();
    const bytes = [];

    for (const char of text) {
        const code = char.codePointAt(0);

        if (code < 0x80) {
            bytes.push(code);
            continue;
        }

        const euckrCode = map.get(code);
        if (euckrCode !== undefined) {
            bytes.push((euckrCode >> 8) & 0xff);
            bytes.push(euckrCode & 0xff);
        } else {
            bytes.push(0x3f);
        }
    }

    return new Uint8Array(bytes);
}

// 单字符 CP949 编码查询：返回 16 位 CP949 码（高字节为区号）或 undefined（不可编码）
export function euckrCode(ch) {
    const code = typeof ch === "string" ? ch.codePointAt(0) : ch;
    return getEuckrMap().get(code);
}
