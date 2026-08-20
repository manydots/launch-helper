import { readFileSync, writeFileSync } from "node:fs";
import { PvfArchive } from "../src/utils/pvfTool.js";
import { decodeUtf16LE, decodeKoreanMojibakeUtf16, recoverKoreanFromGbkText } from "../src/utils/encoding.js";
import { encodeGBK, gbkCode } from "../src/utils/gbkEncoder.js";

const buf = readFileSync(process.argv[2] || "C:/Users/Administrator/Desktop/PVF/86JP/Script.pvf");
const archive = new PvfArchive(buf);
await archive.parse();
console.log("format:", archive.headerFormatLabel, "| strEncoding:", archive.strEncoding);
const find = n => archive.files.find(x => x.fullpath === n || x.name === n);

// ---- 1. 名字型 .lst 激进恢复 ----
for (const f of ["npcname.lst", "monstername.lst", "aicharactername.lst", "passiveobjectname.lst", "skillname0.lst", "skillname3.lst"]) {
    const node = find(f);
    if (!node) { console.log(`${f}: NOT FOUND`); continue; }
    const text = await archive.decodeLstWithNames(node);
    const lines = text.split("\n").filter(l => l.trim());
    console.log(`\n==== ${f} (${lines.length} 行, loose=${archive._isLooseNameLst(node)}) 前 40 行 ====`);
    for (const ln of lines.slice(0, 40)) console.log("  " + ln);
}

// ---- 1.5 JPAG 断言段：根目录 .lst name 带 ./ 前缀时白名单必须仍命中（fullpath 判定） ----
if (archive.headerFormatLabel === "JPAG") {
    const nameLsts = ["npcname.lst", "monstername.lst", "aicharactername.lst", "passiveobjectname.lst", "itemname.lst", "skillname0.lst"];
    let looseHit = 0;
    for (const f of nameLsts) {
        const node = find(f);
        if (!node) { console.log(`  !! ${f} NOT FOUND`); continue; }
        const loose = archive._isLooseNameLst(node);
        if (loose) looseHit++;
        else console.log(`  !! 白名单未命中: ${f} name=${JSON.stringify(node.name)}`);
    }
    console.log(`\n[JPAG] 名字型 .lst 白名单命中: ${looseHit}/${nameLsts.length}（应为 ${nameLsts.length}/${nameLsts.length}）`);
    const samples = {
        "aicharactername.lst": [["奔扼切胶,倔绢磷篮八荤", "굴라학스,얼어죽은검사"], ["箕胶扼", "샤스라"], ["锅靛乔葱胶", "번드피닉스"]],
        "itemname.lst": [["(备)碍锋肯", "(구)강룡완"], ["(备)扒胶葛农", "(구)건스모크"]],
        "monstername.lst": [["绊喉赴", "고블린"], ["芭措穿榜", "거대누골"], ["疤里捞绊喉赴", "겁쟁이고블린"]],
        "npcname.lst": [["父柳", "만진"], ["器挪", "포킨"], ["霸矫魄", "게시판"]],
        "passiveobjectname.lst": [["累篮唱公A", "작은나무A"], ["单胶概摹:朝俺", "데스매치:날개"]],
        "skillname0.lst": [["啊靛", "가드"], ["窜傍曼", "단공참"], ["静矾胶飘", "쓰러스트"]],
    };
    for (const [fn, pairs] of Object.entries(samples)) {
        const node = find(fn);
        const text = await archive.decodeLstWithNames(node);
        let ok = 0;
        for (const [moji, expect] of pairs) {
            const hit = text.split("\n").some(l => l.includes("`" + expect + "`") || l.includes("`" + expect));
            if (hit) ok++; else console.log(`  !! ${fn}: ${moji} 未恢复为 ${expect}`);
        }
        console.log(`[JPAG] ${fn} 行内恢复断言: ${ok}/${pairs.length}`);
    }
}

// ---- 2. itemname / quest 不受激进恢复影响 ----
for (const f of ["itemname.lst", "epicquest.lst"]) {
    const node = find(f);
    const text = await archive.decodeLstWithNames(node);
    const lines = text.split("\n").filter(l => l.trim());
    const hasChinese = lines.some(l => /[\u4e00-\u9fff]/.test(l));
    console.log(`\n==== ${f} (${lines.length} 行, loose=${archive._isLooseNameLst(node)}, 含汉字=${hasChinese}) 前 6 行 ====`);
    for (const ln of lines.slice(0, 6)) console.log("  " + ln);
}

// ---- 3. sTrW 回归 ----
const strW = archive.strWBuf;
let total = 0, changed = 0, invalid = 0;
let wp = 0;
while (wp + 1 < strW.length) {
    let end = wp;
    while (end + 1 < strW.length && !(strW[end] === 0 && strW[end + 1] === 0)) end += 2;
    if (end > wp) {
        total++;
        const raw = decodeUtf16LE(strW.subarray(wp, end));
        const fixed = decodeKoreanMojibakeUtf16(strW.subarray(wp, end));
        if (fixed !== raw) {
            changed++;
            if (!/[\u2500-\u257F\u00A0-\u00FF]/.test(raw) && !/\s/.test(raw)) invalid++;
        }
    }
    wp = end + 2;
}
console.log(`\nsTrW: total=${total} changed=${changed} invalidChanged=${invalid}`);

// ---- 4. 误伤面统计：恢复结果含 %/数字/换行（原 pvf-jp-widen §2 + odd-scan） ----
let wp2 = 0;
const odd = [];
while (wp2 + 1 < strW.length) {
    let end = wp2;
    while (end + 1 < strW.length && !(strW[end] === 0 && strW[end + 1] === 0)) end += 2;
    if (end > wp2) {
        const raw = decodeUtf16LE(strW.subarray(wp2, end));
        const fixed = decodeKoreanMojibakeUtf16(strW.subarray(wp2, end));
        if (fixed !== raw && /[%\d\n]/.test(fixed)) odd.push({ raw, fixed });
    }
    wp2 = end + 2;
}
writeFileSync("E:/github/launch-helper/test/strw-odd.txt", odd.map(o => `${JSON.stringify(o.raw)} -> ${JSON.stringify(o.fixed)}`).join("\n"), "utf8");
const pct = odd.filter(o => /%/.test(o.fixed));
const nl = odd.filter(o => /\n/.test(o.fixed));
console.log(`\n误伤面: 恢复含 %/数字/换行 ${odd.length} 条（% ${pct.length} / 换行 ${nl.length}），见 test/strw-odd.txt`);

// ---- 5. 谚文汉字标注恢复验证（原 pvf-jp-hanja-verify + lst-hanja） ----
for (const name of ["skillname3.lst", "itemname.lst"]) {
    const node = find(name);
    const text = await archive.decodeLstWithNames(node);
    const out = [];
    out.push(`==== ${name} (${archive._isLooseNameLst(node) ? "loose" : "strict"}) ====`);
    out.push("--- 含谚文汉字标注行 ---");
    for (const line of text.split("\n")) {
        if (/[\u4E00-\u9FFF\uF900-\uFAFF]/.test(line)) out.push(line);
    }
    writeFileSync(`E:/github/launch-helper/test/lst-hanja-rows-${name.replace(".lst", "")}.txt`, out.join("\n"), "utf8");
    console.log(`\n==== ${name}: 谚文汉字标注行 ${out.length - 2} 条（见 test/lst-hanja-rows-${name.replace(".lst", "")}.txt）====`);
    for (const probe of ["체이서 : 화", "십문자도 - 자", "(구)강룡완", "(구)건스모크"]) {
        const hit = out.filter(l => l.includes(probe));
        console.log(`  命中 ${probe}: ${hit.length} 行`);
    }
}

// ---- 6. 关键字 GBK 码 ↔ euc-kr 实测（原 pvf-jp-chars 核心断言） ----
const d = new TextDecoder("euc-kr");
for (const [ch, expect] of [["成", "B3C9"], ["夙", "D9ED"], ["猢", "E2A9"], ["佶", "D9A5"], ["滢", "E4DE"]]) {
    const g = gbkCode(ch);
    const hex = g == null ? "null" : g.toString(16).toUpperCase();
    console.log(`GBK 实测: ${ch}=${hex} ${hex === expect ? "OK" : "!! 预期 " + expect}`);
}