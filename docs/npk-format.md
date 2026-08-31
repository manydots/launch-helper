# NPK 归档预览与编辑格式（JP / TW / ImagePacks2）

## 1. 概述

本模块在 launch-helper 中提供 **NPK**（客户端 `ImagePacks2`）归档的**预览与编辑**能力：选择单个 `.NPK` 文件，解密条目名并解码 IMG 帧，以 PNG 预览；支持 IMG 帧替换、导入/导出、保存（下载修改后的 NPK）。适配 JP（日服）与 TW（台服）NPK 格式。

实现为纯前端解析（`src/utils/npkTool.js`），零第三方依赖：zlib 解压使用浏览器原生 `DecompressionStream("deflate")`，PNG 编码手写（IHDR / IDAT / IEND + CRC32），BMP 编码手写，SHA256 用 WebCrypto（Node 回退 `node:crypto`）。

**加解密算法保持不变**：条目名解密/加密沿用原有 XOR 算法；保存时重建 NPK 头部、条目表与 SHA256 校验（参考权威工具 ExtractorSharp 的 `NpkCoder.WriteNpk / CompileHash` 布局）。

## 2. 格式规则（JP / TW）

### 2.1 NPK 归档头

| 偏移 | 长度 | 字段 | 说明 |
|---|---|---|---|
| 0 | 16 | 魔数 | `NeoplePack_Bill`（ASCII，含尾部 `\0`） |
| 16 | 4 | uint32 LE | 条目数 `count` |
| 20 | count × 264 | 条目表 | 见 2.2 |

### 2.2 NPK 条目表（每条 264 字节）

| 偏移 | 长度 | 字段 | 说明 |
|---|---|---|---|
| 0 | 4 | uint32 LE | 数据偏移 `offset` |
| 4 | 4 | uint32 LE | 数据长度 `size` |
| 8 | 256 | 加密名 | 见 2.3 |

条目数据区为 IMG 文件（魔数 `Neople Img File`）。越界（`offset + size > 文件长度`）或重名条目忽略。

### 2.3 条目名加密（XOR）

256 字节名称按字节异或，Key 构造：

```text
"puchikon@neople dungeon and fighter "（ASCII，39 字节）
+ 循环填充 "DNF"（ASCII）至满 256 字节
```

解密后取首个 `\0` 之前的 ASCII 文本，`\` 统一转 `/`，截断到 `.img`（含扩展名）或首个非法字符（非字母数字 / `/` / `_` / `-` / `.`）。

### 2.4 IMG 帧索引

IMG 文件头：

| 偏移 | 长度 | 字段 | 说明 |
|---|---|---|---|
| 0 | 16 | 魔数 | `Neople Img File` |
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

- `src/utils/npkTool.js`：NPK 解析 / IMG 帧解析 / 帧解码 / PNG / BMP 编码 / IMG 与 NPK 重建。
  - `NPK_FORMATS`：加解密算法注册表，每项 `{ id, label, magic, parse }`；当前实现 **JP / TW**（二者格式同构，共用 XOR 名称解密实现），后续其它客户端类型在注册表追加实现即可。
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
- `src/components/NpkViewer.vue`：选择 `.NPK` → IMG 树列表 → 点击 IMG 静态预览首帧，点击帧节点切换到指定帧，自动播放可在顶栏配置间隔与模式（无限重复 / 播放一次）。
- **编辑能力**（顶栏按钮，参考 ExtractorSharp 操作逻辑）：
  - **替换**：替换当前帧为本地图片（自动缩放至帧尺寸，可选保持原格式 / ARGB1555 / ARGB4444 / ARGB8888）。
  - **导入**：导入 `.img` 文件替换当前条目（校验 `Neople Img File` 魔数，规范化重建帧）。
  - **导出**：导出当前帧为 PNG / JPEG / WebP / BMP（多格式贴图），或导出整个 IMG `.img` 字节。
  - **保存**：下载修改后的 NPK（每次编辑后内存缓冲整体重建，加解密算法保持不变）。
  - 修改后显示「N 处修改」角标；所有成功/失败提示使用项目标准弹窗（`useModal`）。
- **加解密算法下拉选择**：顶栏格式下拉（`NPK_FORMATS` 列表），当前为「JP / TW」；切换格式后重新解析当前文件，便于后期扩展其它客户端 NPK 类型。
  - JP 与 TW（台服）格式同构：魔数与条目名 XOR 密钥一致，实测台服 NPK（如 `sprite_interface2_charactercreate.NPK`，IMG v2 / ARGB8888）可直接按 JP 规则解析预览，无需独立加解密实现。
- 入口：`src/App.vue` 右上角「NPK 预览」按钮 → 路由 `/Npk`。

## 4. 测试脚本

`test/npk-verify.mjs`（运行方式：`node test/npk-verify.mjs <NPK路径>`，默认目标见文件头注释）：

| 检查项 | 断言 |
|---|---|
| NPK 魔数 | `NeoplePack_Bill` |
| 条目数 | 与头字段一致，> 0 |
| 名称解密 | 对照 Key XOR 算法逐条解密，格式正确 |
| IMG 帧头 | version == 2、帧索引可解析 |
| zlib 解压 | 解压长度 == width × height × bpp |
| PNG 编码 | 签名 `89 50 4E 47`、IHDR 尺寸一致 |

`test/npk-roundtrip.mjs`（运行方式：`node test/npk-roundtrip.mjs <NPK路径>`）——编辑/保存写回链路的 round-trip 验证，不写盘：

| 检查项 | 断言 |
|---|---|
| 原始解析 | `parseNpk` 成功，找到可编辑 IMG |
| 帧重编码 | 逐帧 `encodeFrameFromRgba` 尺寸/压缩合法 |
| IMG 重建 | `encodeImg` 产出魔数 `Neople Img File` 的合法 IMG |
| NPK 重建 | `encodeNpk` 产出魔数 `NeoplePack_Bill` 的合法 NPK |
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
| 导入非 IMG 文件 | 校验魔数 `Neople Img File`，不合法则弹窗提示 |
| 导入 IMG 版本非 v2 | `readImgFull` 抛错，弹窗提示不支持的版本 |
| 保存时加密算法 | 条目名保留原有 XOR 加密（`encryptName` 与 `decryptName` 对称）；SHA256 校验对齐 ExtractorSharp `CompileHash` 语义 |
| 超大归档 | 条目表一次性解析（每条目 264 字节），PNG 按需解码单帧；编辑时整体重建 NPK 内存（`encodeNpk` 异步 + `WebCrypto SHA256`） |
