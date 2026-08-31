# NPK 归档预览格式（JP / ImagePacks2）

## 1. 概述

本模块在 launch-helper 中提供**只读** NPK（客户端 `ImagePacks2`）归档预览能力：选择单个 `.NPK` 文件，解密条目名并解码 IMG 帧，以 PNG 预览。适配 JP（日服）NPK 格式。

实现为纯前端解析（`src/utils/npkTool.js`），零第三方依赖：zlib 解压使用浏览器原生 `DecompressionStream("deflate")`，PNG 编码手写（IHDR / IDAT / IEND + CRC32）。

## 2. 格式规则（JP）

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

- `src/utils/npkTool.js`：NPK 解析 / IMG 帧解析 / 帧解码 / PNG 编码。
  - `NPK_FORMATS`：加解密算法注册表，每项 `{ id, label, magic, parse }`；当前仅实现 **JP**（XOR 名称解密），后续其它客户端类型在注册表追加实现即可。
  - `parseNpk(buffer, format)` → `{ entries: [{ name, offset, size }], count }`
  - `readImgEntry(buffer, entry)` → `{ frames: [...] }`（静态预览用正常帧）
  - `decodeFrameToPng(buffer, entry, frame)` → `Promise<Uint8Array>`（PNG 字节）
  - `encodePng(width, height, rgba)` → `Uint8Array`
- `src/components/NpkViewer.vue`：选择 `.NPK` → 条目列表 → 点击条目静态预览首帧，帧号步进器切换。
- **加解密算法下拉选择**：顶栏格式下拉（`NPK_FORMATS` 列表），当前为「JP」；切换格式后重新解析当前文件，便于后期扩展其它客户端 NPK 类型。
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

## 5. 边界情况

| 场景 | 行为 |
|---|---|
| 非 NPK 文件（魔数不符） | `parseNpk` 抛错，界面提示无效文件 |
| 条目数据非 IMG（魔数不符） | 该条目标记不可预览，列表可浏览 |
| 不支持像素格式 / 压缩 | 解码抛错，界面提示 |
| 链接帧 | 静态预览跳过（不展开），帧计数不含链接帧 |
| 超大归档 | 条目表一次性解析（每条目 264 字节），PNG 按需解码单帧 |
