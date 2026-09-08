# NPK 归档预览与编辑格式（JP / TW / ImagePacks2）

## 1. 概述

本模块在 launch-helper 中提供 **NPK**（客户端 `ImagePacks2`）归档的**预览与编辑**能力：选择单个 `.NPK` 文件，解密条目名并解码 IMG 帧，以 PNG 预览；支持 IMG 帧替换、导入/导出、保存（下载修改后的 NPK）。适配 JP（日服）与 TW（台服）NPK 格式。

音频 / 视频类文件走**不转码预览**通道（§6）：NPK 归档（如 SoundPacks 音频包）内的 `.ogg` 条目、`.avi` 条目，以及独立的专有加密 `.avi` 视频文件（见 §6.2），均按**原始字节直接切片**交给浏览器 `<audio>` / `<video>` 播放，不做任何像素 / 容器转码（加密 AVI 仅做无损解密还原）。

实现为纯前端解析（`src/utils/npkTool.js`），零第三方依赖：zlib 解压使用浏览器原生 `DecompressionStream("deflate")`，PNG 编码手写（IHDR / IDAT / IEND + CRC32），BMP 编码手写，SHA256 用 WebCrypto（Node 回退 `node:crypto`）。

**加解密算法保持不变**：条目名解密/加密沿用原有 XOR 算法；保存时重建 NPK 头部、条目表与 SHA256 校验（参考权威工具 ExtractorSharp 的 `NpkCoder.WriteNpk / CompileHash` 布局）。

## 2. 格式规则（JP / TW）

### 2.1 NPK 归档头

| 偏移 | 长度 | 字段 | 说明 |
|---|---|---|---|
| 0 | 16 | 魔数 | 归档魔数（16 字节 ASCII，含尾部 `\0`；字面值以源码为准） |
| 16 | 4 | uint32 LE | 条目数 `count` |
| 20 | count × 264 | 条目表 | 见 2.2 |

### 2.2 NPK 条目表（每条 264 字节）

| 偏移 | 长度 | 字段 | 说明 |
|---|---|---|---|
| 0 | 4 | uint32 LE | 数据偏移 `offset` |
| 4 | 4 | uint32 LE | 数据长度 `size` |
| 8 | 256 | 加密名 | 见 2.3 |

条目数据区为 IMG 文件（IMG 魔数，字面值以源码为准）。越界（`offset + size > 文件长度`）或重名条目忽略。

### 2.3 条目名加密（XOR）

256 字节名称按字节异或，Key 构造：

```text
固定 ASCII 前缀（39 字节）
+ 循环填充 3 字节 ASCII 填充串至满 256 字节
```

前缀与填充串的字面值以 `src/utils/npkTool.js` 的密钥构造实现为准。

解密后取首个 `\0` 之前的 ASCII 文本，`\` 统一转 `/`，截断到 `.img`（含扩展名）或首个非法字符（非字母数字 / `/` / `_` / `-` / `.`）。

### 2.4 IMG 帧索引

IMG 文件头：

| 偏移 | 长度 | 字段 | 说明 |
|---|---|---|---|
| 0 | 16 | 魔数 | IMG 魔数（16 字节 ASCII；字面值以源码为准） |
| 16 | 4 | uint32 LE | 索引区长度 `indexLength` |
| 20 | 4 | uint32 LE | 保留（0） |
| 24 | 4 | uint32 LE | version（须为 2） |
| 28 | 4 | uint32 LE | 帧数 `frameCount` |
| 32 | indexLength | 帧索引 | 见下 |
| 32 + indexLength | — | 像素数据区 | 按帧顺序连续存放 |

帧索引逐条解析，`pos` 从 32 开始，像素游标 `pixelCursor` 从 `32 + indexLength` 开始：

- **type == 0x11（链接帧）**：8 字节 `type + linkIndex`，记录指向同文件另一帧；静态预览跳过链接帧（不展开）。
- **其它 type（像素帧）**：36 字节 `type / compression / width / height / size / keyX / keyY / maxWidth / maxHeight`，像素数据在 `pixelCursor`，随后 `pixelCursor += size`。

### 2.5 像素格式

| type | 格式 | bpp | 说明 |
|---|---|---|---|
| 0x0E | ARGB1555 | 2 | 1 位 alpha |
| 0x0F | ARGB4444 | 2 | 4 位分量 |
| 0x10 | ARGB8888 | 4 | 8 位分量 |

### 2.6 压缩

| compression | 方式 |
|---|---|
| 5 | 未压缩（`encoded.length == width × height × bpp`） |
| 6 | zlib（`DecompressionStream("deflate")`） |

S4A21GmTool 对非 0 统一走 zlib 尝试解压、失败回退原始字节；本实现按 compression 值区分（0/5 未压缩、6 zlib），JP 文件实测全为 6。

### 2.7 画布与 Blit

帧数据解码后为 `width × height` 的 RGBA；若带 `keyX/keyY/maxWidth/maxHeight` 偏移画布，则按 S4A21GmTool `NpkImageDecoder.Blit` 语义混合到画布（alpha 混合，普通覆盖 + 半透明合成），PNG 输出为画布尺寸。

## 3. 实现

- `src/utils/npkTool.js`：NPK 解析 / IMG 帧解析 / 帧解码 / PNG / BMP 编码 / IMG 与 NPK 重建（API 清单按功能描述，导出函数名以源码为准）。
  - `NPK_FORMATS`：加解密算法注册表，每项 `{ id, label, magic, parse }`；当前所有 NPK 使用同一套加解密格式（统一归档魔数 + XOR 名称加密）。
  - `parseNpk(buffer, format)` → `{ entries: [{ name, offset, size }], count }`
  - `readImgEntry(buffer, entry)` → `{ frames: [...] }`（静态预览用正常帧）
  - `readImgFull(buffer, entry)` → `{ frames: [...] }`（含链接帧 + pixelOffset，编辑用）
  - `decodeFrameToPng(buffer, entry, frame)` → `Promise<Uint8Array>`（PNG 字节）
  - `encodePng(width, height, rgba)` → `Uint8Array`
  - `encodeBmp(width, height, rgba)` → `Uint8Array`（32-bit BGRA，零依赖）
  - `encodePixels(rgba, w, h, type)` → `Uint8Array`（RGBA → ARGB1555/4444/8888）
  - `encodeFrameFromRgba(rgba, w, h, type, keyX, keyY, maxW, maxH)` → `Promise<frame>`（zlib 压缩像素帧）
  - `encodeImg(frames)` → `Promise<Uint8Array>`（重建 IMG v2）
  - `encodeNpk(entries)` → `Promise<Uint8Array>`（重建 NPK：头部 + 条目名加密 + SHA256 校验，布局对齐 ExtractorSharp）
  - `readEntryData(buffer, entry)` → `Uint8Array`（切取 NPK 条目原始字节，不解析内容）
  - 加密视频签名检测（16 字节 ASCII 签名，见 §6.2）→ `boolean`
  - 加密视频无损解密（见 §6.2）→ `{ data, originalSize, alignedSize }`
  - `detectMediaKind(name)` → `"audio" | "video" | null`（按条目名后缀 `.ogg` / `.avi` 分类媒体条目）
  - `extractAviVideoStream(data)` → `{ frames, fps, frameCount, width, height, audioChunks, audioByteRate, audioFormatTag }`（解析 AVI 容器：movi 内 `\d{2}dc` 视频 ES 帧 + `\d{2}wb` 音频 chunk，帧率取 `avih dwMicroSecPerFrame`（钳制 10–120），尺寸取 MPEG 序列头；见 §6.4）
  - `isMpegVideoEs(es)` → `boolean`（ES 头部 4KB 内出现 MPEG 序列起始码 `00 00 01 B3` 判定为 MPEG-1/2 视频；见 §6.4）
  - `muxMpegEsToTs(frames, fps, audioChunks, audioByteRate)` → `Uint8Array`（MPEG-ES 封装为 MPEG-TS 供 JSMpeg 软解：视频 PES stream_id 0xE0 / PID 0x100，音频可选 0xC0 / 0x101，188 字节包 + adaptation field 补位，0 字节占位帧跳过；见 §6.4）
- `src/components/NpkView.vue`：选择 `.NPK` → IMG 树列表 → 点击 IMG 静态预览首帧，点击帧节点切换到指定帧，自动播放可在顶栏配置间隔与模式（无限重复 / 播放一次）。
  - **媒体条目预览**（§6.3）：树列表中 `.ogg` / `.avi` 条目显示为媒体叶子节点，点击后在预览区以原生 `<audio>` / `<video>` 控件播放原始字节（加密 AVI 先解密）；提供「导出」导出原始字节（加密 AVI 导出解密后数据）。
  - **独立媒体文件**：文件选择器接受 `.npk / .avi / .ogg`；选择独立 `.avi`（含加密视频签名）或 `.ogg` 文件时直接进入媒体播放视图，无需 NPK 归档。
- **编辑能力**（顶栏按钮，参考 ExtractorSharp 操作逻辑）：
  - **替换**：替换当前帧为本地图片（自动缩放至帧尺寸，可选保持原格式 / ARGB1555 / ARGB4444 / ARGB8888）。
  - **导入**：导入 `.img` 文件替换当前条目（校验 IMG 魔数，规范化重建帧）。
  - **导出**：导出当前帧为 PNG / JPEG / WebP / BMP（多格式贴图），或导出整个 IMG `.img` 字节。
  - **保存**：下载修改后的 NPK（每次编辑后内存缓冲整体重建，加解密算法保持不变）。
  - 修改后显示「N 处修改」角标；所有成功/失败提示使用项目标准弹窗（`useModal`）。
- **加解密算法下拉选择**：顶栏格式下拉（`NPK_FORMATS` 列表）；当注册表仅有一项时，下拉框自动隐藏。
- 入口：`src/App.vue` 右上角「NPK 预览」按钮 → 路由 `/Npk`。

## 4. 测试脚本

`test/npk-verify.mjs`（运行方式：`node test/npk-verify.mjs <NPK路径> [加密AVI路径] [带音频加密AVI路径]`，默认目标见文件头注释；第 2 参数为独立加密 AVI（`PVF/test/creator.avi`），第 3 参数为带音频加密 AVI（`PVF/test/ATFighterGrappler.avi`），均为可选）。NPK 断言：

| 检查项 | 断言 |
|---|---|
| NPK 魔数 | 16 字节归档魔数（字面值以源码为准） |
| 条目数 | 与头字段一致，> 0 |
| 名称解密 | 对照 Key XOR 算法逐条解密，格式正确 |
| IMG 帧头 | version == 2、帧索引可解析（NPK 无 `.img` 条目时跳过该组断言） |
| zlib 解压 | 解压长度 == width × height × bpp |
| PNG 编码 | 签名 `89 50 4E 47`、IHDR 尺寸一致 |

媒体条目断言（NPK 含 `.ogg` / `.avi` 条目时执行）：

| 检查项 | 断言 |
|---|---|
| M1 媒体条目分类 | `detectMediaKind` 对 `.ogg` 条目返回 `audio`，`.avi` 条目返回 `video` |
| M2 条目切片 | `readEntryData` 切片长度 == 条目 `size` |
| M3 OGG 数据头 | `.ogg` 条目原始字节以 `OggS` 魔数开始（数据区未加密，见 §6.1） |
| M4 AVI 解密（条目内） | `.avi` 条目若带加密视频签名，解密后以 `RIFF` + `AVI ` 开始且长度 == originalSize |

独立加密 AVI 断言（传入第 2 参数时执行）：

| 检查项 | 断言 |
|---|---|
| V1 签名检测 | 加密视频签名检测函数返回 true |
| V2 解密大小 | 解密函数输出长度 == 头部 `originalSize` 字段 |
| V3 容器头 | 解密输出以 `RIFF` + `AVI ` 开始 |
| V4 头部一致性 | 头部 `count == 1`、`alignedSize + 0x20 == 文件总长` |
| V5 解密全量自洽 | 按加密端公式（密文[i] = 明文[i] ^ 明文[i-1024]）将解密输出重加密，与原始密文媒体区**逐字节一致**（覆盖含音频区在内的全部输出，证明确为无损还原） |

AVI 软解链路断言（V 组之后执行，docs/npk-format.md §6.4）：

| 检查项 | 断言 |
|---|---|
| W1 ES 提取 | `extractAviVideoStream` 提取 92 个 `00dc` 帧、帧率 ≈ 29.97fps |
| W2 MPEG 判定 | `isMpegVideoEs` 命中序列头 `00 00 01 B3`，序列尺寸 800×600 |
| W3 TS 结构 | `muxMpegEsToTs` 输出按 188 字节对齐、每包 sync 0x47、PES 以 `00 00 01 E0` 开始 |
| W4 mux/demux 回环 | 以 JSMpeg `Demuxer.TS` 反解 TS 流，重组 payload 与原始 ES 逐字节一致、PTS 单调递增 |
| W5 合成音频回环 | 以合成含 MP2 音频 AVI 验证音视频双流封装：双流 payload 均逐字节还原、音频 PTS 从 0 单调递增 |

带音频加密 AVI 断言（传入第 3 参数时执行，样例 `PVF/test/ATFighterGrappler.avi`）：

| 检查项 | 断言 |
|---|---|
| W6a 音频流存在 | 解密输出 `extractAviVideoStream` 提取到 `NNwb` 音频 chunk（> 0）且 `auds` strf 平均字节率 > 0 |
| W6b 音频格式 | `wFormatTag` 为 MPEG 层 II/III（`0x50` / `0x55`） |
| W6c 音频帧头 | 全部音频 chunk 以 MPEG 音频同步字起始（高字节 `0xFF`、次字节掩码 `0xE0`）——音频区经解密后为合法编码帧 |
| W6d 解密自洽（含音频区） | 对带音频样例按 V5 同款公式重加密，与原始密文全量逐字节一致 |

媒体断言的默认样例为用户提供的实导出文件（相对路径登记，各机器基线根目录不同）：`PVF/test/sounds_char_creator.npk`（SoundPacks 音频包，70 个 `.ogg` 条目）、`PVF/test/creator.avi`（加密 AVI）、`PVF/test/sprite_common_etc.NPK`（IMG 基线归档）。

`test/npk-roundtrip.mjs`（运行方式：`node test/npk-roundtrip.mjs <NPK路径>`）——编辑/保存写回链路的 round-trip 验证，不写盘：

| 检查项 | 断言 |
|---|---|
| 原始解析 | `parseNpk` 成功，找到可编辑 IMG |
| 帧重编码 | 逐帧 `encodeFrameFromRgba` 尺寸/压缩合法 |
| IMG 重建 | `encodeImg` 产出带 IMG 魔数的合法 IMG |
| NPK 重建 | `encodeNpk` 产出带归档魔数的合法 NPK |
| SHA256 校验 | 重建 NPK 的校验字段与 `node:crypto` 参考值一致（`Math.floor(headerLen/17)*17` 对齐 C# 整数除法） |
| 重新解析 | 重建 NPK 条目数 / 条目名（XOR 加密未变）/ IMG 帧数均与原文件一致，帧 0 可解码为 PNG |

## 5. 边界情况

| 场景 | 行为 |
|---|---|
| 非 NPK 文件（魔数不符） | `parseNpk` 抛错，界面提示无效文件 |
| 条目数据非 IMG（魔数不符） | 该 IMG 标记不可预览，树列表可浏览 |
| 不支持像素格式 / 压缩 | 解码抛错，界面提示 |
| 链接帧 | 静态预览跳过（不展开），帧计数不含链接帧；替换/编辑时保留链接帧结构 |
| 替换帧时导入图尺寸不同 | 自动缩放至帧尺寸（保持画布语义） |
| 导入非 IMG 文件 | 校验 IMG 魔数，不合法则弹窗提示 |
| 导入 IMG 版本非 v2 | `readImgFull` 抛错，弹窗提示不支持的版本 |
| 保存时加密算法 | 条目名保留原有 XOR 加密（`encryptName` 与 `decryptName` 对称）；SHA256 校验对齐 ExtractorSharp `CompileHash` 语义 |
| 超大归档 | 条目表一次性解析（每条目 264 字节），PNG 按需解码单帧；编辑时整体重建 NPK 内存（`encodeNpk` 异步 + `WebCrypto SHA256`） |
| NPK 内 `.ogg` / `.avi` 条目 | 不参与 IMG 帧解析与编辑，树列表显示为媒体叶子节点，点击走 §6.3 不转码预览 |
| 自动播放进行中重载 NPK / 切换加解密格式 | 先停止帧播放定时器再置空 IMG 信息；播放回调对 IMG 信息缺失自守卫（缺失即停），杜绝定时器残留访问空引用（修复 NpkView `imgInfo` 空引用崩溃） |
| 浏览器无法播放媒体 | `<audio>` / `<video>` 触发 `error` 事件时预览区显示提示（容器 / 编码不受支持），提供导出字节供本地播放器查看 |

## 6. 音频 / 视频条目预览（SoundPacks / OGG / AVI）

### 6.1 NPK 内音频 / 视频条目（SoundPacks 等）

SoundPacks 类 NPK（音频包）与 ImagePacks2 使用**同一归档格式**：归档魔数 + 264 字节条目表 + 条目名标准 XOR 加密（§2.3）。差异仅在条目数据区：

- 条目名后缀为 `.ogg`（音频）或 `.avi`（视频），条目数据区为**原始媒体字节，无额外加密层**——按条目 `offset / size` 直接切片即为完整媒体文件（`.ogg` 条目切片以 `OggS` 魔数开始，`.avi` 条目切片可能为 §6.2 的签名加密视频）。
- 实测样例：`PVF/test/sounds_char_creator.npk`（70 个 `sounds/char/creator/*.ogg` 条目，全部切片即 `OggS`）。

预览策略为**不转码解析**：切片字节直接包成 `audio/ogg` / `video/x-msvideo` Blob 交给浏览器原生 `<audio>` / `<video>` 控件播放；不在解析层做音频元信息（时长 / 采样率）或视频帧的解码。

### 6.2 加密视频容器格式（专有 16 字节 ASCII 签名）

独立 `.avi` 文件（NPK 内 `.avi` 条目同样可能采用）常为专有加密容器，头部 32 字节：

| 偏移 | 长度 | 字段 | 说明 |
|---|---|---|---|
| 0x00 | 16 | 签名 | 16 字节 ASCII（无 `\0`）；字面值以源码为准 |
| 0x10 | 4 | uint32 LE | 条目数（实测固定 1） |
| 0x14 | 4 | uint32 LE | 版本号（实测固定 1） |
| 0x18 | 4 | uint32 LE | 原始媒体大小 `originalSize` |
| 0x1C | 4 | uint32 LE | 对齐后媒体大小 `alignedSize`（向上对齐 1024） |
| 0x20 | alignedSize | 媒体数据 | 前 1024 字节**明文**，其后逐字节 XOR 自引用加密 |

解密算法（无损，输出恰为原始 AVI 文件字节）：

```text
media = file[0x20..]
out[i] = media[i]                       （i < 1024）
out[i] = media[i] XOR out[i - 1024]     （i >= 1024）
输出截断至 originalSize
```

实测样例：`PVF/test/creator.avi`（签名 / count=1 / version=1 / originalSize=1176024 / alignedSize=1176576，文件总长 1176608 = 0x20 + alignedSize，解密后以 `RIFF····AVI ` 开始）。
带音频实测样例：`PVF/test/ATFighterGrappler.avi`（656 帧、约 29.97fps、838 个 MP2 音频 chunk，wFormatTag `0x50`、平均字节率 16000）：解密输出按加密端公式（密文[i] = 明文[i] ^ 明文[i-1024]）重加密后与原始密文媒体区**全量逐字节一致**——算法的正确性覆盖含音频区在内的全部输出（`test/npk-verify.mjs` V5 / W6d 断言）。

预览时先做加密视频签名检测，命中则解密后播放，否则按原始字节直接播放。

### 6.3 NpkView 预览行为

- **归档内**：树列表中 `.ogg` / `.avi` 条目为媒体叶子节点（音频 / 视频图标区分于 IMG）；点击切出原始字节 → 加密 AVI 解密 → Blob URL 播放。预览区显示条目名、媒体类型、原始大小与加密标记，并提供「导出」按钮（`.ogg` 导出原始字节；加密 `.avi` 导出解密后 AVI）。
- **独立文件**：文件选择器接受 `.npk / .avi / .ogg`；选择媒体文件时进入独立播放视图（含加密 AVI 的「导出解密后的 AVI」入口）。
- **MPEG 编码 AVI 的软解播放**（§6.4）：MPEG-1/2 编码走 TS 封装 + JSMpeg canvas 渲染（自动播放、播放/暂停控制）；非 MPEG 编码回退 `<video>` 原生路径，播放失败时提示可导出后用本地播放器查看，不阻塞其它条目浏览。
- **导出提示**：`MPEG` 编码（软解播放路径）的 AVI 导出完成弹窗附带提示——MP2 音频需 VLC / PotPlayer 等第三方播放器（Windows 自带播放器无 MPEG 音频解码器，会无声，见 §6.4）。
- **自动播放**：点击媒体条目 / 选择媒体文件后自动播放（autoplay 属性 + 显式 `play()` 兜底；被浏览器自动播放策略拒绝时静默降级为手动播放）。
- 媒体条目不参与帧替换 / 导入 IMG / 帧导出等 IMG 编辑能力（相应按钮按当前选中类型自动禁用）。

### 6.4 AVI 视频的网页直接播放（MPEG 编码判定 + TS 封装软解）

解密后的 AVI 容器能否在网页直接播放，取决于**视频编码**而非容器：

- 浏览器 `<video>` 原生不支持 AVI 容器（Chromium / Firefox）。
- 实测样例 `PVF/test/creator.avi` 的视频 ES 流以 `00 00 01 B3`（MPEG 序列头）开始，且无序列扩展头（`00 00 01 B5`），为 **MPEG-1 视频**（800×600、约 29.97fps、92 帧、单视频流 handler `MPG1`）。主流浏览器 `<video>` 均不支持 MPEG-1/2 解码，即使重封装为 MP4 也不可播放。
- 因此 MPEG 编码的 AVI 走**软解播放**：`src/utils/jsmpeg.min.js`（JSMpeg，MIT 协议，单文件零依赖，MPEG-1/2 软件解码 + WebGL 渲染）负责解码渲染。集成链路：

```text
AVI 条目字节 →（加密则 §6.2 解密）→ extractAviVideoStream（movi 提取 00dc ES 流 + avih 帧率）
→ isMpegVideoEs（序列头判定）→ muxMpegEsToTs（ES 逐帧封装为 MPEG-TS：PES stream_id 0xE0，
PTS 按 90kHz 时钟 × 帧号递增，TS 包 188 字节、单 PID 0x100、包尾用 adaptation field stuffing 补齐）
→ Blob(video/mp2t) → JSMpeg.Player（canvas 渲染，audio: false，progressive: false）
```

- JSMpeg 的 `Demuxer.TS` 按 PES 起始码识别流（不要求 PAT/PMT），按 stream_id（`TS.STREAM.VIDEO_1 = 0xE0`）连接解码器；TS 包不满 184 字节时必须用 adaptation field 补位，禁止直接垫 `0xFF`（会污染 ES 码流）。
- 非 MPEG 编码的 AVI（无法判定或浏览器原生可解码的编码）回退 `<video>` 原生播放路径；软解加载 / 播放失败时同样回退兜底提示与导出。
- **0 字节占位帧不封装**：样例中存在 0 字节 `00dc` chunk（drop frame 占位），生成 PES 会落入 JSMpeg 的解析边缘行为（PES 头位于 stuffing 后且 PES 长度 0 时不产生回调），封装时直接跳过，PTS 按原帧号保持时间轴。
- **音频链路**：`extractAviVideoStream` 同步提取 `NNwb` 音频 chunk 与音频流 `strf`（WAVEFORMATEX）的平均字节率；MPEG 层 II/III 音频（wFormatTag `0x50` / `0x55`）随视频一起封装（音频 PES stream_id `0xC0`、PID `0x101`，PTS = 90kHz × 累计字节 / 平均字节率），JSMpeg `audio: true` 经 `MP2Audio` 解码器 + WebAudio 输出出声。PCM 等其它音频格式不支持（不封装）。
- **控制栏**（仿 `<video>` 控件）：软解播放配底部控制栏——播放/暂停（结束后变重播）、可拖动进度条（`input[type=range]`，**拖动中节流 100ms 实时 `seek` 同步画面**：播放态由解码循环续播，暂停态 `seek` 仅定位解码位置、需手动 `video.decode()` 推进一帧刷新画面；松手按最终位置定位，暂停态自动恢复播放）、等宽字体时间显示（当前 / 总时长，总时长 = 帧数 / 帧率）；进度经 250ms 定时器从 `player.currentTime` 刷新。
- **播放结束判定**：JSMpeg 播放结尾回调为 `onEnded`（`updateForStaticFile` 检测到数据耗尽且来源已完成时内部 `pause()` 并触发；`onCompleted` 仅为 Source 的**数据加载完成**回调，非 Player 播放结束语义，不能用于结束判定）。播放结束后 `currentTime` 冻结在**末帧解码时间**（严格小于总时长 = 帧数 / 帧率，约差末帧时长），故进入结束态（`jsmpegEnded`）后进度定时器 tick **直接返回、不再刷新**，进度保持满格、时间显示总时长，滑块停留在最终位置；`onEnded` 因异常未触发时以「播放中进度连续 4 次 250ms 无推进」兜底判定（数据耗尽后 `currentTime` 冻结），判定后同样进入结束态并锁定满格。手动暂停不误判（仅播放态参与判定）；重播（seek 0 播放）与拖动进度条均会清除结束态并恢复定时器刷新。
- **导出防呆**：顶栏「导出 → 导出整个 IMG」对媒体条目统一改走媒体导出（加密视频导出解密后 AVI）；导出字节为无损解密的完整 AVI（含音频流），与第三方解密工具输出逐字节一致（已实证）。

实测验证（2026-09-07，`test/npk-verify.mjs` W 组）：`PVF/test/creator.avi` 提取 92 帧、帧率 29.97fps、序列头 800×600；`muxMpegEsToTs` 输出经 JSMpeg `Demuxer.TS`（Node 侧以 `?raw` 同源加载）反解，重组 payload 与原始 MPEG-ES **逐字节一致**、PTS 单调递增；另以合成含 MP2 音频的 AVI 验证音视频双流回环（视频/音频 payload 均逐字节还原、音频 PTS 从 0 单调递增）。全量 29 passed / 0 failed。

游戏 `Video` 目录实测（2026-09-07，381 个 `.avi`，无 `.bk2` / `.bin`）：抽样解析确认多数宣传 / 转职 / 片头视频（`ClassChange*.avi`、`130411_*`、`130415_*`、`atf_tutorial_intro.avi` 等）**带 MPEG 层 II 音频流**（`auds` / wFormatTag `0x50`，平均字节率 16000-24000）；技能图标动画（160×90）与 `creator` 系列为纯视频。以 `ClassChange0.avi`（655 帧 + 838 个 MP2 音频 chunk，帧头 `FFFD`）全链路验证：音视频时长吻合（21.9 秒），双流封装经 JSMpeg 反解 payload 均逐字节还原。

**已知数据特征（非解析错误）**：实测样例 `creator.avi` 与 `ghostM.avi`（早期样本，已由用户替换）均**只含单视频流**（`vids`/`MPG1`，idx1 全部为 `00dc`，movi 无 `NNwb` 音频 chunk）——播放无声为文件本体不含音频数据所致，非解析或播放链路缺陷；含音频的 AVI（如 `ClassChange0.avi`）走上述音频链路出声。

**导出文件播放兼容性（Windows 自带播放器无声）**：解密后 AVI 为 MPEG-1 视频 + MPEG 层 II（MP2）音频。Windows 自带播放器（电影和电视 / Windows 媒体播放器）不内置 MPEG 音频解码器，播放导出的 AVI 时可能出现画面正常但**无声**——属播放器解码能力限制，**文件本体完整**（`PVF/test/ATFighterGrappler.avi` 字节级验证：解密重加密全量自洽、全部 838 个音频 chunk 为合法 MP2 帧）；建议以 VLC / PotPlayer 等第三方播放器播放。导出完成弹窗对 MPEG 编码文件附带该提示（见 §6.3）。

实测验证（2026-09-07，dev 环境浏览器实测）：`PVF/test/sounds_char_creator.npk` 加载后 70 个 `.ogg` 条目均显示为媒体叶子节点，点击后 `<audio>` 就绪可播（readyState 4、时长解析正常）；`PVF/test/creator.avi` 独立加载命中加密检测并显示「已解密预览」，MPEG 编码走软解播放，浏览器不支持 AVI 容器时正确显示兜底提示与「导出解密后的 AVI」入口，导出字节以 `RIFF····AVI ` 开始；独立媒体 ↔ NPK 归档双向切换状态无残留。文件选择器为根级常驻，顶栏「打开」按钮任意状态下可切换文件。
