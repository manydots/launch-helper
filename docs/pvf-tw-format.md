# 繁体 PVF（TW）二进制解析协议

> launch-helper 已有 JP / JPAG / CN 三种格式解析（见 `src/utils/pvfCodec.js`、`pvfTool.js`），
> 繁体 PVF 是**完全不同的归档布局**，本文记录其二进制协议，供解析实现参考；
> 与 `pvf-item-grant-parsing.md`（脚本语义层）互补。

## 0. 与 JP/CN 格式的本质差异

| 维度 | JP (original) / JPAG (guard) / CN (protected) | 繁体 TW |
|---|---|---|
| 头部 | 固定 0x30 字节，魔数 0x69706b6e | 变长：`guidLen(4) + guid(guidLen)` 引导，**无固定魔数** |
| 文件索引 | 0x18 字节文件表 + sTrA/sTrW 字符串池（偏移引用） | **文件树**：文件名内联，每条 `20 + 文件名长` 字节 |
| 数据区 | 分块（GRPI 分组）+ zlib 压缩 | **无压缩**，文件数据 4 字节对齐顺序排列 |
| 字符串 | 字符串池分区 sTrA/sTrW | 独立文件 `stringtable.bin`（按索引引用） |
| 加密 | PRNG 密钥流（HeaD/BodY/GRPI/sTrA/sTrW） | 每 4 字节 `ROR6(dword ^ key ^ checksum)` |
| 文件大小 | header.bodySize 声明 | 数据区从 `fileTreeLength + 0x38` 连续到文件尾（尾部可选标记） |

## 1. 整体布局

```
+--------------------------------------------------------------+
| 头部（4 + guidLen + 16 字节，明文）                            |
|    guidLen(int32)  Guid(guidLen)  FileVersion(int32)          |
|    fileTreeLength(int32)  fileTreeChecksum(uint32)            |
|    fileCount(int32)                                           |
+--------------------------------------------------------------+
| 文件树（fileTreeLength 字节，加密）                             |
|    fileCount 条记录，每条 = 20 + FileNameLen 字节               |
+--------------------------------------------------------------+
| 数据区（明文存储，每文件按 4 字节对齐，逐文件加密）               |
|    文件 i 偏移 = dataBase + item[i].DataOffset                 |
|    dataBase = fileTreeLength + 0x38（工具硬编码，隐含 guidLen=36）|
+--------------------------------------------------------------+
| 尾部标记（可选，42 字节）                                       |
|    \0 "This pvf Pack was created by pvfUtility."              |
+--------------------------------------------------------------+
```

## 2. 头部字段（OpenPvfPack，PvfPack.Core.cs）

| 偏移 | 类型 | 字段 |
|---|---|---|
| 0 | int32 | guidLen（GUID 字节数） |
| 4 | byte[] | Guid（guidLen 字节） |
| 4 + guidLen | int32 | FileVersion（实测 TW 文件为 0x102EA） |
| 8 + guidLen | int32 | fileTreeLength（文件树加密字节数） |
| 12 + guidLen | uint32 | fileTreeChecksum |
| 16 + guidLen | int32 | fileCount（文件数） |
| 20 + guidLen | byte[] | 文件树（已加密） |

**无魔数**：头部首 4 字节是 guidLen（真实 TW 文件为 36），无法用固定签名识别，
只能靠布局合理性 + 文件树解密结果校验（见 §7 探测策略）。

## 3. 文件树条目（每条 20 + FileNameLen 字节）

| 偏移 | 类型 | 字段 |
|---|---|---|
| 0 | uint32 | FileNameBytesChecksum（文件名哈希，见 §5） |
| 4 | int32 | FileNameLen |
| 8 | byte[] | FileNameBytes（文件名+路径，Big5/GBK 等按区域编码，小写化，`\`→`/`） |
| 8 + FileNameLen | int32 | DataLen（文件真实数据长度） |
| 12 + FileNameLen | uint32 | Checksum（数据校验，见 §6） |
| 16 + FileNameLen | int32 | DataOffset（相对数据区起点的偏移） |

遍历推进：`index += FileNameLen + 20`；读到第 fileCount 条结束。
文件数据实际长度 `TrueLen = (DataLen + 3) & ~3`（4 字节对齐，解密块按 TrueLen 读）。

**数据区起点**：实现约定 `dirTreeOffset = fileTreeLength + 0x38`。
严格推导应为 `20 + guidLen + fileTreeLength`，二者仅在 guidLen == 36 时相等。
TW 目标文件 guidLen 实测 = 36，与约定一致。

## 4. 数据区加密（PvfAlgorithmOrigin.cs）

文件树与每个文件的数据使用同一套逐 4 字节算法，但 key/checksum 不同：

```
解密：ROR6(  dword ^ key ^ checksum )
加密：ROL6(  dword ) ^ checksum ^ key        （互逆）
key  = 0x81A79011                            （2175242257，加密/解密同 key）
```

- 按 4 字节小端读取、运算后再写回；块长必须为 4 的倍数（文件树天然如此；文件数据用 TrueLen）。
- 文件树：`checksum = CreateBuffKey(明文文件树, fileTreeLength, (uint)fileCount)`
- 文件数据：`checksum = CreateBuffKey(明文数据, TrueLen, FileNameBytesChecksum)`

## 5. 文件名哈希（DataHelper.GetFileNameHashCode）

```csharp
hash = 0x1505;
foreach (byte t in 文件名编码字节) hash = 0x21 * hash + t;   // uint 环绕
return hash * 0x21;
```

即 Horner 多项式 ×33，初值 0x1505，结果再乘 0x21。实测与文件树中的
FileNameBytesChecksum 一致（`passiveobject/.../subdodgenotarget.ani` → 0x662E）。

## 6. 数据校验 CreateBuffKey（CRC32 变体）

标准 CRC32 表驱动（多项式 0xEDB88320），但初值为文件名哈希取反，结果再取反：

```
crc = ~FileNameBytesHash
for each byte b in 明文数据（TrueLen 字节）:
    crc = (crc >> 8) ^ table[(crc ^ b) & 0xFF]
return ~crc
```

## 7. 探测策略（无魔数下的识别）

由于头部无固定签名，建议按以下顺序尝试，全部通过才算 TW：

1. `guidLen` 在合理区间（如 4 ~ 4096）且 `4 + guidLen + 20` 不越界；
2. fileVersion / fileTreeLength / fileCount 非负，fileCount 合理（>0 且 < 10^7），
   布局总长不超文件大小；
3. 用 §4 解密文件树后，**首条目校验**：`FileNameLen` 在 (0, 4096] 且首条
   FileNameBytesChecksum 与 §5 对首文件名重算结果一致；
4. （可选加分项）文件尾部 42 字节等于 `\0This pvf Pack was created by pvfUtility.`
   则说明文件被台服工具链重打包过（服务端原版无此标记）。

## 8. 脚本文件格式（*.etc / *.lst / *.str 等）

### 8.1 魔数与条目流

- 文件头 2 字节：`0xB0 0xD0`（LE uint16 = 0xD0B0），`PvfFile.IsScriptFile` 以此判断。
- 从偏移 2 起，每 **5 字节**一个条目：`[type:1][data:int32 LE]`，直到 `DataLen - 4`。

### 8.2 类型表（ScriptFileStruct.ScriptType）

| type | 名称 | 文本表示 | 说明 |
|---|---|---|---|
| 2 | Int | `123` | 整数（\t 分隔） |
| 3 | IntEx | `{3=123}` | 命令式整数 |
| 4 | Float | `1.5` | IEEE754 单精度（\t 分隔） |
| 5 | Section | `[xxx]` / `[/xxx]` | 节标签，data = 字符串表索引；闭合节名 = `[/` + 节名去头 + `]` |
| 6 | Command | `{6=`text`}` | 命令，data = 字符串表索引 |
| 7 | String | `` `text` `` | 字符串，data = 字符串表索引 |
| 8 | CommandSeparator | `{8=`text`}` | 命令分隔，data = 字符串表索引 |
| 9 | StringLink 前置 | （合并到 10） | data = stringlist 文件 id（strlst id） |
| 10 | StringLinkIndex | `<id::name`text`>` | data = 字符串表索引（引用名）；文本取自 strlst 文件 |

- type 9 + type 10 固定成对出现（编译时 `CompileType10Item` 写入 10 字节：
  `[9][int32:id][10][int32:strtable_idx]`）。
- type 5 出现时若有同名闭合标签，中间内容为节的子项，可嵌套。

### 8.3 字符串表引用（Stringtable.bin）

脚本条目中的字符串 data 一律是 `stringtable.bin` 的**索引**（非偏移）。该文件本身
是归档内普通文件，结构：

```
+4 字节: count（字符串数）
+count*4 字节: offset[0..count]（绝对定位值 = 数据区起点 - 4 + 累计长度，含一个末尾哨兵）
数据区起点（第一个字符串位置）: 4 + (count+1)*4
字符串 i 字节区间: [offset[i] + 4, offset[i+1] + 4)
```

- 解码用区域编码（EncodingType）：TW=950(Big5) / CN=936(GBK) / KR=949 / JP=932 / UTF8=65001，
  解码后 TrimEnd('\0')。
- 实测 TW 文件：184375 条，`[0] = "[name]"`（NameLabel 即为 `[name]` 索引，
  脚本里节名/`[name]` 都通过该索引匹配）。
- 新字符串追加时写入新偏移并重建整表（`CreateStringTable`）。

### 8.4 文本表示（#PVF_File 方言）

```
#PVF_File
[equipment]
[name] `守护之魂`
[rarity] 2
[type] `[weapon]`
{6=`50`} 7 8            ← 命令与数字混排
<0::text1`你好`>        ← 字符串链接（type9+type10）
[/equipment]
```

- 节/字符串/命令各占一行；数字（int/float）以 \t 追加同行。
- 字符串链接 `<id::name`text`>`：id 为 strlst 文件 id，name 为引用键名，
  text 是 strlst 文件里 `name>text` 行的内容；可配置是否自动内联文本。
- 解析器从偏移 2 步进 5 字节逐条目扫描，未知类型报错但继续。

### 8.5 strlst 文件（StringView，默认 n_string.lst）

字符串链接引用的是归档内一组 strlst 文件。`n_string.lst` 本身是脚本文件
（0xD0B0 头），从偏移 2 起每 **10 字节**一组：

```
[9][int32: strlst 文件 id][10][int32: 字符串表索引 = strlst 文件名]
```

按文件名（归档内真实路径 = 该 lst 所在目录 + 文件名）读取对应 strlst 文件，
其内容为明文文本（区域编码），格式：

```
name>内容
other>另一条
// 注释行（跳过）
```

`GetStrText(strlstId, key)` 即按 id 定位文件、按 key 查 `key>text` 行。

## 9. 70 ANI 文件（Ani70Encoder.cs，简）

- `Is70AniFile`：非脚本且短名含 `.ani`（排除 `.ani.als`）。
- 明文判断：头部 10 字节 ASCII == `[FRAME MAX]`。
- 二进制格式：`[int32:动画头偏移][int32:tag表偏移][int32:帧数据偏移]` 后接
  tag 表（LOOP/SHADOW/COORD/IMAGE_RATE/... 见 ANIData 枚举，共 26 种）与帧数据，
  各 tag 按 [int32 标签][int32 数据] 序列解码。launch-helper 若只需浏览，
  可将此类文件按原始二进制展示。

## 10. 尾部标记

部分台服工具链保存（`SavePvfPack`）时在数据区末尾追加 42 字节：

```
00 54 68 69 73 20 70 76 66 20 50 61 63 6B ... 2E
= \0 "This pvf Pack was created by pvfUtility."
```

读取时 `IsEditbyPu` 用它判断"是否被改过"；无此标记的为原版。

## 11. 参考实现要点（launch-helper 集成）

- 解密：`pvfDecryptTw(buf, key, checksum)` 逐 4 字节 `ROR6(dw ^ key ^ checksum)`，
  文件树与文件数据共用，key = 0x81A79011。
- 编码：文件树按 §5 哈希排序（`OrderBy(FileNameBytesChecksum)`），条目 = 哈希/长度/
  文件名/DataLen/Checksum/DataOffset，`fileTreeLength = Σ(FileNameLen+20) + 3 & ~3`。
- 字符串表按索引引用，**编辑脚本必须同步维护 stringtable.bin**（删除/追加条目）。
- 已实测验证：`/Users/genergy/Desktop/frida/a70s2精简更新pvf/Script.pvf`
  （81.5MB，guidLen=36，ver=0x102EA，182903 文件，184375 条字符串）解析全链路正确。