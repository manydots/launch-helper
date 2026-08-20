import { readFileSync } from "node:fs";
import { TwPvfArchive } from "../src/utils/pvfToolTw.js";
import hljs from "highlight.js/lib/core";
import { registerPvfLanguage } from "../src/utils/pvfHighlight.js";

const PVF_PATH = process.argv[2] || "C:/Users/Administrator/Desktop/PVF/70TW/Script.pvf";
const buf = readFileSync(PVF_PATH);
const arch = new TwPvfArchive(buf);
await arch.parse();
arch._twInitStringTables();

// ================= 注释渲染规则断言（§9.3.1：#PVF_File 与 // 均按 #6a9955 注释色） =================
registerPvfLanguage(hljs);
const hlCom = (s) => hljs.highlight(s, { language: "pvf" }).value;
const asComment = (s) => /<span class="hljs-comment">/.test(hlCom(s));
console.log("comment-token: #PVF_File ->", asComment("#PVF_File") ? "PASS" : "FAIL",
    "| // 注释 ->", asComment("// 韩文注释行") ? "PASS" : "FAIL",
    "| 行首缩进 // ->", asComment("    // 缩进注释") ? "PASS" : "FAIL");

// ================= 权威解析器（输出 §9.2 pvfUtility 明文格式） =================
const EFFECT = ["NONE","DODGE","LINEARDODGE","DARK","XOR","MONOCHROME","SPACEDISTORT"];
const DAMAGE = ["NORMAL","SUPERARMOR","UNBREAKABLE"];
const FLIP = ["", "HORIZON", "VERTICAL", "ALL"];
const TAG = { 0:"LOOP",1:"SHADOW",3:"COORD",7:"IMAGE RATE",8:"IMAGE ROTATE",9:"RGBA",
  10:"INTERPOLATION",11:"GRAPHIC EFFECT",12:"DELAY",13:"DAMAGE TYPE",14:"DAMAGE BOX",
  15:"ATTACK BOX",16:"PLAY SOUND",17:"PRELOAD",18:"SPECTRUM",23:"SET FLAG",24:"FLIP TYPE",
  25:"LOOP START",26:"LOOP END",27:"CLIP",28:"OPERATION" };

function makeReader(data){
  let i = 0;
  const rd = {
    byte(){ return data[i++]; },
    u16(){ const v = data[i]|(data[i+1]<<8); i+=2; return v; },
    i16(){ const v = (data[i]|(data[i+1]<<8))<<16>>16; i+=2; return v; },
    i32(){ const v = (data[i]|(data[i+1]<<8)|(data[i+2]<<16)|(data[i+3]<<24))|0; i+=4; return v; },
    f32(){ const dv=new DataView(data.buffer, data.byteOffset+i, 4); const v=dv.getFloat32(0,true); i+=4; return v; },
    str(len){ // 权威：Encoding.ASCII.GetString，>0x7F 变 '?'
      const raw = data.subarray(i, i+len); i+=len;
      let s = "";
      for (const b of raw) s += b < 0x80 ? String.fromCharCode(b) : "?";
      return s;
    },
    pos(){ return i; }
  };
  return rd;
}
const pct = b => (256.0 + b) % 256.0;
const norm = s => String(s).replace(/\r\n/g, "\n");
const fmtF = v => Number(v.toPrecision(7)).toString();

function parseAniText(d){
  if (d.length < 4) return { error: "too small" };
  try {
    const rd = makeReader(d);
    const out = ["#PVF_File"];
    const frameMax = rd.u16();
    if (frameMax > 5000) return { error: "frameMax implausible " + frameMax };
    const imgCount = rd.u16();
    if (imgCount > 1000) return { error: "imgCount implausible " + imgCount };
    const imgList = [];
    for (let i=0;i<imgCount;i++){
      const len = rd.i32();
      if (len <= 0 || len > 512 || rd.pos()+len > d.length) return { error: `img ${i} len bad ${len}` };
      imgList.push(rd.str(len));
    }
    const overallCount = rd.u16();
    for (let j=0;j<overallCount;j++){
      const tag = rd.u16();
      if (tag===0 || tag===1) { out.push(`[${TAG[tag]}]`, String(rd.byte())); }
      else if (tag===3 || tag===28) { out.push(`[${TAG[tag]}]`, String(rd.u16())); }
      else if (tag===18) {
        out.push("[SPECTRUM]", String(rd.byte()));
        out.push("[SPECTRUM TERM]", String(rd.i32()));
        out.push("[SPECTRUM LIFE TIME]", String(rd.i32()));
        out.push("[SPECTRUM COLOR]", [pct(rd.byte()), pct(rd.byte()), pct(rd.byte()), pct(rd.byte())].join("\t"));
        const se = rd.u16();
        out.push("[SPECTRUM EFFECT]", `\`${EFFECT[se] ?? String(se)}\``);
      } else return { error: `overall tag ${tag} (${j}/${overallCount})` };
    }
    out.push("[FRAME MAX]", String(frameMax));
    for (let k=0;k<frameMax;k++){
      out.push("", `[FRAME${String(k).padStart(3,"0")}]`);
      const boxLines = [];
      const boxCount = rd.u16();
      for (let l=0;l<boxCount;l++){
        const tag = rd.u16();
        if (tag!==15 && tag!==14) return { error: `frame${k} box tag ${tag} (${l}/${boxCount})` };
        const six = [];
        for (let b=0;b<6;b++) six.push(rd.i32());
        boxLines.push(`[${TAG[tag]}]`, six.join("\t"));
      }
      const imgIndex = rd.i16();
      out.push("[IMAGE]");
      if (imgIndex >= 0){
        if (imgIndex > imgList.length-1) return { error: `frame${k} imgIndex ${imgIndex} oob` };
        out.push(`\`${imgList[imgIndex]}\``, String(rd.u16()));
      } else out.push("``", "0");
      out.push("[IMAGE POS]", `${rd.i32()}\t${rd.i32()}`);
      const frameItemCount = rd.u16();
      for (let i=0;i<frameItemCount;i++){
        const tag = rd.u16();
        const t = TAG[tag] ?? ("TAG"+tag);
        switch(tag){
          case 0: case 1: case 10: out.push(`[${t}]`, String(rd.byte())); break;
          case 3: out.push(`[${t}]`, String(rd.u16())); break;
          case 17: out.push(`[${t}]`, "1"); break;
          case 7: out.push(`[${t}]`, `${fmtF(rd.f32())}\t${fmtF(rd.f32())}`); break;
          case 8: out.push(`[${t}]`, fmtF(rd.f32())); break;
          case 9: out.push(`[${t}]`, [pct(rd.byte()), pct(rd.byte()), pct(rd.byte()), pct(rd.byte())].join("\t")); break;
          case 11: {
            const e = rd.u16();
            out.push(`[${t}]`, `\`${EFFECT[e] ?? String(e)}\``);
            if (e===5) out.push([pct(rd.byte()), pct(rd.byte()), pct(rd.byte())].join("\t"));
            if (e===6) out.push(`${rd.i16()}\t${rd.i16()}`);
            break;
          }
          case 12: out.push(`[${t}]`, String(rd.i32())); break;
          case 13: { const v = rd.u16(); out.push(`[${t}]`, `\`${DAMAGE[v] ?? String(v)}\``); break; }
          case 16: { const len=rd.i32(); if(len<=0||len>512||rd.pos()+len>d.length) return { error:`frame${k} sound len ${len}` }; out.push(`[${t}]`, `\`${rd.str(len)}\``); break; }
          case 23: out.push(`[${t}]`, String(rd.i32())); break;
          case 24: { const v = rd.u16(); out.push(`[${t}]`, `\`${FLIP[v] ?? String(v)}\``); break; }
          case 25: out.push(`[${t}]`); break;
          case 26: out.push(`[${t}]`, String(rd.i32())); break;
          case 27: out.push(`[${t}]`, `${rd.i16()}\t${rd.i16()}\t${rd.i16()}\t${rd.i16()}`); break;
          default: return { error: `frame${k} item tag ${tag} (${i}/${frameItemCount})` };
        }
      }
      out.push(...boxLines);
    }
    return { ok: true, text: out.join("\n") + "\n", consumed: rd.pos(), total: d.length };
  } catch(e){
    return { error: "exception " + e.message };
  }
}

// ================= 全量扫描：独立解析器 vs 真实实现 =================
const anis = arch.files.filter(f => /\.ani$/i.test(f.name));
console.log("total .ani:", anis.length);

let okFull = 0, okPartial = 0, fail = 0, empty = 0, mismatch = 0;
const failByType = {};
const sampleFails = {};
for (const f of anis){
  const d = await arch.getFileData(f);
  if (d.length === 0) { empty++; continue; }
  const r = parseAniText(d);
  if (!r.ok) { fail++; const key = r.error; failByType[key]=(failByType[key]||0)+1; if(!sampleFails[key]) sampleFails[key]=f.name; continue; }
  if (r.consumed !== r.total) { okPartial++; const key="partial "+(r.total-r.consumed)+"B"; failByType[key]=(failByType[key]||0)+1; if(!sampleFails[key]) sampleFails[key]=f.name; continue; }
  okFull++;
  const impl = arch.decodeContent(f, d);
  if (impl !== r.text) {
    mismatch++;
    if (mismatch <= 3) {
      const il = impl.split("\n"), al = r.text.split("\n");
      let di = -1;
      for (let i=0;i<Math.max(il.length,al.length);i++){
        if (il[i] !== al[i]) { di = i; break; }
      }
      console.log(`\n!! OUTPUT MISMATCH: ${f.name} (${d.length}B)`);
      console.log("  authoritative lines:", JSON.stringify(r.text.split("\n").slice(0,6)));
      console.log("  impl lines:         ", JSON.stringify(impl.split("\n").slice(0,6)));
      console.log("  首个差异行", di, "impl:", JSON.stringify(il[di]), "auth:", JSON.stringify(al[di]));
    }
  }
}
console.log("ok full:", okFull, "ok partial:", okPartial, "fail:", fail, "empty:", empty, "| 输出与权威明文不一致:", mismatch);
console.log("failures by type:", failByType);
console.log("samples:", sampleFails);

// ================= 关键样例抽查（§12.3 验证表） =================
const targets = [
  "equipment/equipmentdefaultcustomanimation.ani",
  "map/grim/animation/stone0.ani",
  "common/activestatus/animation/badeffect2.ani",
  "event/event.kor.str",
  "n_string.lst"
];
for (const nm of targets){
  const f = arch.files.find(x => x.name.toLowerCase() === nm);
  if (!f) { console.log("### NOT FOUND:", nm); continue; }
  const d = await arch.getFileData(f);
  const text = arch.decodeContent(f, d);
  console.log(`\n### ${nm} (${d.length}B) -> ${text.split("\n").length} 行`);
  console.log(text.split("\n").slice(0, 10).join("\n"));
}
console.log("\n### equipmentdefaultcustomanimation.ani 关键断言:");
const fe = arch.files.find(x => x.name.toLowerCase() === "equipment/equipmentdefaultcustomanimation.ani");
const te = arch.decodeContent(fe, await arch.getFileData(fe));
console.log("  [IMAGE POS] 行:", te.split("\n").find(l => l.startsWith("[IMAGE POS]")));

// ================= badeffect2.ani 权威期望输出核对（对照 86JP 实导出） =================
const fb = arch.files.find(x => x.name.toLowerCase() === "common/activestatus/animation/badeffect2.ani");
const db = await arch.getFileData(fb);
const rb = parseAniText(db);
if (!rb.ok) {
  console.log("\n!! badeffect2.ani 独立解析失败:", rb.error);
} else {
  const expectHead = [
    "#PVF_File", "[SHADOW]", "0", "[FRAME MAX]", "12",
    "", "[FRAME000]", "[IMAGE]", "`Common/ActiveStatus/BadEffect2.img`", "0",
    "[IMAGE POS]", "-14\t-69", "[IMAGE RATE]", "1\t-1", "[DELAY]", "80"
  ].join("\n");
  const gotHead = rb.text.split("\n").slice(0, 16).join("\n");
  const headOk = gotHead === expectHead;
  console.log("\n### badeffect2.ani 权威头 16 行核对:", headOk ? "PASS" : "FAIL");
  if (!headOk) {
    console.log("  期望:", JSON.stringify(expectHead));
    console.log("  实际:", JSON.stringify(gotHead));
  }
  const frameCount = rb.text.match(/\[FRAME\d{3}\]/g)?.length ?? 0;
  console.log("  [FRAMExxx] 标签数:", frameCount, frameCount === 12 ? "PASS" : "FAIL");
  const imgPosCount = rb.text.match(/\[IMAGE POS\]/g)?.length ?? 0;
  console.log("  [IMAGE POS] 数:", imgPosCount, imgPosCount === 12 ? "PASS" : "FAIL");
  const delayCount = rb.text.match(/\[DELAY\]\n80/g)?.length ?? 0;
  console.log("  [DELAY] 80 数:", delayCount, delayCount === 12 ? "PASS" : "FAIL");
}

// ================= 损坏 strlst 已知特征断言（§8.7：保持原始 Big5 解析） =================
const fcorr = arch.files.find(x => x.name.toLowerCase() === "event/event.kor.str");
if (fcorr) {
    const dcorr = await arch.getFileData(fcorr);
    const textCorr = arch.decodeContent(fcorr, dcorr);
    // 制作时损坏的 strlst：按 Big5 解码显示伪中文（嚙篁嚙課度無…），非解析器问题，保持原始解析
    const pseudoCn = /嚙篁嚙課度無/.test(textCorr);
    const asciiOk = textCorr.includes("event_id_1_start>") && textCorr.includes("LEVEL UP");
    const notBinary = !/^\[二进制文件/.test(textCorr);
    console.log("\n损坏 strlst 断言: 保持 Big5 原始解析(伪中文):", pseudoCn ? "PASS" : "FAIL",
        "| key/ASCII 保留:", asciiOk ? "PASS" : "FAIL",
        "| 不误判二进制:", notBinary ? "PASS" : "FAIL");
} else {
    console.log("\n损坏 strlst 断言: event/event.kor.str NOT FOUND");
}

// ================= 全量：明文 ani（#PVF_File / [FRAME MAX] 开头）展示验证 =================
let plainAni = 0;
for (const f of anis){
  const d = await arch.getFileData(f);
  if (d.length === 0) continue;
  const head = new TextDecoder("latin1").decode(d.subarray(0, 10));
  if (head === "[FRAME MAX]") plainAni++;
}
console.log("\nplaintext ani ([FRAME MAX]) count:", plainAni);

// ================= .str 全量：无二进制误判 =================
const strs = arch.files.filter(f => /\.str$/i.test(f.name));
console.log("\n.total .str:", strs.length);
let strBin = 0;
for (const f of strs){
  const d = await arch.getFileData(f);
  if (d.length === 0) continue;
  const text = arch.decodeContent(f, d);
  if (/^\[二进制文件/.test(text)) { strBin++; console.log("  binary-shown:", f.name, "(" + d.length + "B)"); }
}
console.log("str binary-shown count:", strBin);

// ================= 真实实现：hex 回退 / 空动画统计 =================
let aniFail = 0, aniEmpty = 0;
const aniFailList = [];
for (const f of anis){
  const d = await arch.getFileData(f);
  if (d.length === 0) continue;
  const text = arch.decodeContent(f, d);
  if (/^数据 \(/.test(text)) { aniFail++; if (aniFailList.length < 10) aniFailList.push(f.name); }
  if (/^\[FRAME MAX\]\r?\n0/.test(text) || /^#PVF_File\r?\n\[FRAME MAX\]\r?\n0/.test(text)) aniEmpty++;
}
console.log("ani decode hex-fallback count:", aniFail, aniFailList, "| frameCount=0:", aniEmpty);

// ================= 复杂样例（盒/声音/特效）字段核对 =================
let shown = 0;
for (const f of anis){
  const d = await arch.getFileData(f);
  const r = parseAniText(d);
  if (r.ok && r.consumed===r.total &&
      (r.text.includes("[ATTACK BOX]") || r.text.includes("[DAMAGE BOX]") ||
       r.text.includes("[PLAY SOUND]") || r.text.includes("[CLIP]") || r.text.includes("[SPECTRUM]"))){
    console.log(`\ncomplex sample: ${f.name}`);
    console.log(r.text.split("\n").filter(l => /^\[|^#PVF_File|^\t|^``/.test(l)).slice(0, 14).join("\n"));
    if (++shown >= 2) break;
  }
}