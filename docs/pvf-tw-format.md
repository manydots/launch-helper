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

### 8.6 strlst 明文识别（`_twLooksLikeStrList`）

strlst 文件是明文 `key>text` 行（含韩文等多字节文本时，可打印率可能不足 70%，
会被 `_twDecodeBinaryText` 误判为二进制）。识别规则：采样前 64 行，按字节扫描行结构，
`//` 注释行忽略，`key>text` 行（含 `>`）计数，空行忽略；至少 1 行 `key>text`
且其数量 ≥ 其它非空行数即判定为 strlst 明文，按区域编码解码展示（不显示为二进制）。
其余文本判定顺序不变：UTF-16LE 检测 → 可打印率 → 二进制标记。

### 8.7 损坏 strlst 已知数据特征（不修复）

**已知数据特征（非解析错误）**：`event/event.kor.str`（99952B，1187 行）在**制作时已被损坏**
--原始内容为韩文（`Level Up` / `DNF` 活动等，与 `etc/etc.kor.str` 同名 key 的中文版内容
不同），存储链路为「韩文 EUC-KR -> 被 UTF-8 解码器净化：非法字节替换为
U+FFFD（`EF BF BD`）、恰好合法的 2 字节序列（如 `D2 AB`）保留、ASCII 原样 -> 以 UTF-8
保存」。实测全文件 **18021 个 `EF BF BD` 序列**；4KB 采样 733 个替换符（正常 strlst 恒为 0）。
注释行 `// ???????` 的 `?` 为字面 ASCII 0x3F（制作时替换），原文不可恢复。

**展示策略：保持原始 Big5 解析（不修复）**。该文件按区域编码（Big5）解码会
把 `EF BF BD` 错位读成 `嚙篁嚙課度無…` 伪中文（语义垃圾但每字符是合法 Big5），
此为文件本体损坏的必然结果，**非解析器问题**。曾尝试「检测损坏 -> 净化展示
（ASCII 保留、损坏处 `�`）」与「跨文件对照恢复」两种方案，均被要求还原为
原始 Big5 解析；最终保持 `_twDecodeBinaryText` 的 strlst 分支按 `twEncoding`
直接解码（与修复前一致），不做损坏检测与净化。字节级验证已确认该文件真实
存储为 UTF-8 混合流（FFFD + 残留 Big5 组 + ASCII），原文韩文不可恢复。

## 9. 70 ANI 文件

- `Is70AniFile`：非脚本且短名含 `.ani`（排除 `.ani.als`）。
- 明文判断：头部 10 字节 ASCII == `[FRAME MAX]`，此类文件按明文文本直接展示
  （见 §9.3 #PVF_File 规则）。
- 二进制格式（小端，权威来源见 AGENTS.md「权威参考」）：

```
头部:
  u16 frameMax          帧数
  u16 imgCount          图片数
  imgCount 次:           图片路径列表
    i32 len
    len 字节 ASCII 路径
  u16 overallCount      全局项数量
  overallCount 次:      全局项（u16 tag + 数据，tag 见 ANIData 枚举）
    LOOP(0) / SHADOW(1):        u8 值
    COORD(3) / OPERATION(28):   u16 值
    SPECTRUM(18):               u8 强度 + i32 间隔 + i32 持续 + 4×u8 颜色 + u16 特效
    其它 tag: 解析失败

每帧（frameMax 次）:
  u16 boxCount          攻击/受击盒数量
  boxCount 次:
    u16 tag             14=DAMAGE_BOX / 15=ATTACK_BOX，其它失败
    6 × i32             盒六参数
  i16 imgIndex          图片索引（-1 表示无图片）
  若 imgIndex >= 0:      u16 imgIdx（图片内序号）
  i32 x
  i32 y
  u16 frameItemCount    帧项数量
  frameItemCount 次:     帧项（u16 tag + 数据）
    LOOP(0)/SHADOW(1)/INTERPOLATION(10): u8
    COORD(3):                            u16
    PRELOAD(17):                         无数据
    IMAGE_RATE(7):                       2 × f32
    IMAGE_ROTATE(8):                     f32
    RGBA(9):                             4 × u8
    GRAPHIC_EFFECT(11):                  u16 特效序号（0=NONE 1=DODGE 2=LINEARDODGE
                                         3=DARK 4=XOR 5=MONOCHROME 6=SPACEDISTORT）
                                         5 追加 3×u8（RGB）；6 追加 2×i16
    DELAY(12):                           i32
    DAMAGE_TYPE(13):                     u16（0=NORMAL 1=SUPERARMOR 2=UNBREAKABLE）
    PLAY_SOUND(16):                      i32 长度 + ASCII 声音路径
    SET_FLAG(23):                        i32
    FLIP_TYPE(24):                       u16（1=HORIZON 2=VERTICAL 3=ALL）
    LOOP_START(25):                      无数据
    LOOP_END(26):                        i32
    CLIP(27):                            4 × i16
    其它 tag: 解析失败
```

- 解析器（`_twDecodeAni`）按上述布局逐步消费；任一字段越界/未知 tag 即整体失败，
  回退为原始 hex 展示。帧数=0 是合法空动画（如 6 字节 `charge2.ani`），不算失败。

### 9.2 解码输出格式（与权威明文导出一致）

`_twDecodeAni` 的二进制解码输出必须是权威格式的**同款明文文本**
（`#PVF_File` 开头，直接可被 pvfUtility 重新导入），逐行对齐权威格式定义：

```
#PVF_File
[LOOP]                       ← 全局项（overall），每个 tag 占 2 行
0
[SHADOW]
1
[FRAME MAX]
12
                             ← 每帧前空一行
[FRAME000]                   ← 帧号 D3 补零
[IMAGE]
`Common/ActiveStatus/BadEffect2.img`
0                            ← imgIdx（u16），imgIndex<0 时输出 `` 和 0
[IMAGE POS]
-14	-69                      ← i32 x \t i32 y
[IMAGE RATE]                 ← 帧项 tag + 数据（帧项顺序 = 文件顺序）
1	-1                        ← 2 × f32（\t 分隔）
[DELAY]
80
[ATTACK BOX]                 ← 盒在帧项之后统一追加
0	0	0	0	0	0
[DAMAGE BOX]
0	0	0	0	0	0

[FRAME001]
...
```

输出规则：

| 元素 | 输出 |
|---|---|
| 头 | 首行 `#PVF_File`（空行分隔各段） |
| 全局项 LOOP/SHADOW | `[LOOP]`/`[SHADOW]` + u8 值，各占一行 |
| 全局项 COORD/OPERATION | `[COORD]`/`[OPERATION]` + u16 值 |
| 全局项 SPECTRUM | `[SPECTRUM]` + u8 强度；`[SPECTRUM TERM]` + i32；`[SPECTRUM LIFE TIME]` + i32；`[SPECTRUM COLOR]` + 4×(`(256+u8)%256`)；`[SPECTRUM EFFECT]` + `` `枚举名` `` |
| 帧头 | `[FRAME` + 帧号 D3 + `]`（帧前空行） |
| 帧图片 | `[IMAGE]` + `` `路径` `` + imgIdx(u16)；imgIndex=-1 时 `` `\`\`` `` + `0` |
| 帧位置 | `[IMAGE POS]` + `i32 \t i32` |
| 帧项 LOOP/SHADOW/INTERPOLATION | `[LOOP]` 等 + u8 |
| 帧项 COORD | `[COORD]` + u16 |
| 帧项 PRELOAD | `[PRELOAD]` + `1`（固定值） |
| 帧项 IMAGE_RATE | `[IMAGE RATE]` + `f32 \t f32` |
| 帧项 IMAGE_ROTATE | `[IMAGE ROTATE]` + f32 |
| 帧项 RGBA | `[RGBA]` + `(256+u8)%256 ×4`（\t 分隔） |
| 帧项 GRAPHIC_EFFECT | `[GRAPHIC EFFECT]` + `` `枚举名` ``；MONOCHROME 追加 3×`(256+u8)%256`；SPACEDISTORT 追加 2×i16 |
| 帧项 DELAY | `[DELAY]` + i32 |
| 帧项 DAMAGE_TYPE | `[DAMAGE TYPE]` + `` `枚举名` `` |
| 帧项 PLAY_SOUND | `[PLAY SOUND]` + `` `路径` `` |
| 帧项 SET_FLAG | `[SET FLAG]` + i32 |
| 帧项 FLIP_TYPE | `[FLIP TYPE]` + `` `枚举名` `` |
| 帧项 LOOP_START | `[LOOP START]`（无数据） |
| 帧项 LOOP_END | `[LOOP END]` + i32 |
| 帧项 CLIP | `[CLIP]` + 4×i16（\t 分隔） |
| 帧盒 | `[ATTACK BOX]`/`[DAMAGE BOX]` + 6×i32（\t 分隔），帧项之后统一追加 |

枚举名（权威定义）：标签 `LOOP/SHADOW/COORD/IMAGE_RATE/IMAGE_ROTATE/RGBA/
INTERPOLATION/GRAPHIC_EFFECT/DELAY/DAMAGE_TYPE/DAMAGE_BOX/ATTACK_BOX/
PLAY_SOUND/PRELOAD/SPECTRUM/SET_FLAG/FLIP_TYPE/LOOP_START/LOOP_END/CLIP/OPERATION`；
Effect_Item `NONE/DODGE/LINEARDODGE/DARK/XOR/MONOCHROME/SPACEDISTORT`；
DAMAGE_TYPE_Item `NORMAL/SUPERARMOR/UNBREAKABLE`；
FLIP_TYPE_Item `HORIZON=1/VERTICAL=2/ALL=3`。

**已知数据特征（非解析错误）**：`equipment/equipmentdefaultcustomanimation.ani`（23B）
是空占位动画（imgCount=0、imgIndex=-1），位置字段真实写入 `0x0000FFFF`，
按权威读法输出 `[IMAGE POS] 65535 65535`；字节级验证（consumed 23/23）确认无误，
不能当作解析错位。

### 9.2.1 一致性风险点（实现时必须逐条对齐）

| # | 风险点 | 权威行为 | 实现要求 |
|---|---|---|---|
| 1 | 非 ASCII 路径/声音 | 路径/声音按 ASCII 字节读，>0x7F 字节变 `?` | 路径（图片/PLAY_SOUND）按 ASCII 解码，高位字节输出 `?`，不得用 latin1/UTF-8 保留原字节 |
| 2 | 枚举越界 | 未知枚举值输出**数字字符串**（如 `7`） | GRAPHIC_EFFECT / DAMAGE_TYPE / FLIP_TYPE 未知值输出数字本身，不得输出 `?` 或空 |
| 3 | 帧号补零 | 帧号 3 位补零（D3 格式） | 帧号 3 位补零（000、001、...、999） |
| 4 | 浮点格式 | float 用 **7 位有效数字**（G7）格式化：`1.0f`→`1`、`0.1f`→`0.1`、`1.5f`→`1.5` | JS 用 `DataView.getFloat32` 取 float 后按 G7 格式化：`Number(v.toPrecision(7)).toString()`，再忽略 `\r\n` vs `\n` 差异 |
| 5 | RGBA/COLOR 字节 | `(256.0 + byte) % 256.0`（double，输出整数形式） | 同公式，输出整数（0~255） |
| 6 | PRELOAD | 输出 `[PRELOAD]` + **固定 `1`**（不读数据） | 固定输出 1 |
| 7 | LOOP_START | 无数据，仅标签 | 仅输出 `[LOOP START]` |
| 8 | 盒位置 | 盒数据在文件流中位于帧开头，但**输出在帧项之后**统一追加 | 先读盒、后输出（帧项循环后 append） |
| 9 | 明文 ani | `DataLen > 10` 且头 10 字节 == `[FRAME MAX]` 时**原样返回**（无 `#PVF_File` 前缀） | decodeContent 对 `[FRAME` 明文 ani 按原文本展示，不附加头 |
| 10 | 空文件 | `DataLen <= 0` 输出空串 | 同 |
| 11 | 全局项未知 tag | 返回失败（decryptionText=null）→ hex 回退 | 同：整体失败回退 hex |

### 9.3 #PVF_File 明文规则（适用于所有类型解码）

- pvfUtility 导出的明文文本（ani / 脚本 / 其它）**可能以 `#PVF_File` 开头，
  也可能没有该前缀**（如明文 ani 直接以 `[FRAME MAX]` 开头）。
- **解码**：解码路径统一拦截明文前缀并返回明文——`decodeContent` 在一切分发
  （stringtable / ani / token / lst / 普通文本）之前检测 `#PVF_File`；
  明文 ani 的 `[FRAME MAX]` 由 ani 层（`_twDecodeAni`）另检。
  命中即不解析、直接按区域编码解码为文本原样展示（无 `//` 注释前缀）。
  该规则在 ani、token、lst、普通文本所有解码路径之前生效，不区分文件类型。
- **编码**：`encodeContent` 对以 `#PVF_File` 开头的文本不做 token 化，
  直接按区域编码字节原样写回（导出=源文件格式）。

### 9.3.1 明文注释渲染规则（2026-08 修正）

明文文本（`#PVF_File` 头、`//` 注释行）在编辑器中的渲染颜色统一为
**注释绿 `#6a9955`**（与 `.hljs-comment` 一致，带斜体），适用两条渲染路径：

| 渲染路径 | 修正前 | 修正后 |
|---|---|---|
| hljs pvf 语言高亮（普通明文 / 脚本） | 注释规则仅匹配行内 `#`（`begin:"#", end:"$"`）；`//` 行被 title 规则抢占（亮蓝 #9cdcfe） | 注释规则新增**行首 `//`**（`begin:/\/\//, end:"$"`，置于 contains 首位，优先于 title），`#` 与 `//` 均命中 `.hljs-comment` |
| key>text 三色渲染（.str / stringtable.bin / strlst） | `//` 开头行用 `hljs-pvf-bin-text`（灰 #9a9a9a）；`#PVF_File` 行落默认灰 | `#` 开头行与 `//` 开头行改用 `hljs-comment`（#6a9955） |

- 实现：`pvfHighlight.js` 的 comment 规则 + `PvfEditor.vue` 的 `_renderKeyValueLine`。
- 测试脚本断言见 §12.3 表格（`test/verify-authoritative-scan.mjs` 新增 hljs token 断言段）。

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

## 12. ANI / strlst 解析修复记录（2026-08）

### 12.1 问题

- `.ani` 二进制文件只输出帧数 + hex dump（"未解析"）——旧实现把头部误读为
  `u16 帧数 | u16 标记 | i32 路径长`，且无帧数据解析。
- 明文 strlst（如 `event/event.kor.str`）因非 ASCII 字节多、可打印率 < 70% 被误判
  为 `[二进制文件 N 字节]`。
- **输出格式不符**：首次修复的 `_twDecodeAni` 采用自定义格式（`[ani] 帧数:`、
  `帧000: 图=... 位置=(...)`），与 pvfUtility 明文导出格式不一致，无法直接
  对照/导入；必须改为 §9.2 的权威明文格式（`#PVF_File` 开头 + `[FRAME MAX]` +
  `[FRAME000]` 逐行标签）。

### 12.2 解决

- `_twDecodeAni` 重写为 §9 权威二进制布局解析 + **§9.2 权威明文输出**：
  `#PVF_File` 头、全局项（LOOP/SHADOW/COORD/OPERATION/SPECTRUM）、`[FRAME MAX]`、
  每帧 `[FRAME000]`/`[IMAGE]`/`[IMAGE POS]`/帧项/盒（盒在帧项后统一追加），
  标签名用空格分隔显示名（如 `[IMAGE RATE]`/`[GRAPHIC EFFECT]`，非枚举名
  `IMAGE_RATE`），枚举值（GRAPHIC EFFECT/DAMAGE TYPE/FLIP TYPE）用枚举名、
  越界输出数字字符串；路径/声音按 ASCII 读（>0x7F→`?`）；
  RGBA/SPECTRUM COLOR 用 `(256+b)%256`；IMAGE RATE/ROTATE 按 7 位有效数字
  （G7）格式化；解析失败回退 hex；帧数=0 合法。
- `_twDecodeBinaryText` 增加 strlst 明文识别（§8.6），韩文 strlst 按文本展示。
- `#PVF_File` 前缀统一按 §9.3 规则处理（解码按注释文本、编码按源文件）。

**已知数据特征（非解析错误）**：`equipment/equipmentdefaultcustomanimation.ani`（23B）
是空占位动画（imgCount=0、imgIndex=-1），其位置字段真实写入 `0x0000FFFF`，
按权威读法输出 `[IMAGE POS] 65535 65535`（与 pvfUtility 同读法结果一致）；
字节级验证（consumed 23/23）确认无误，不能当作解析错位。

### 12.3 测试脚本（唯一）

同一修复项目只保留一个修复脚本，避免重复：

| 脚本 | 验证内容 |
|---|---|
| `test/verify-authoritative-scan.mjs` | 全量 114943 个 .ani 独立解析：**ok 114922 / partial 1（`nametag5.ani` 3B 尾部不足）/ fail 0 / empty 20**；独立解析器输出与真实实现输出**逐行完全一致（不一致 0）**（#PVF_File 头、`[FRAME MAX]`、`[IMAGE POS]`、`[IMAGE RATE]` G7 浮点、`[ATTACK BOX]` 盒等标签齐全）；hex 回退 0、frameCount=0 空动画 23；全量 .str 无二进制误判（0）；关键文件 `equipmentdefaultcustomanimation.ani`（预期 `[IMAGE POS] 65535 65535`）/ `stone0.ani` / `badeffect2.ani` / `event.kor.str` 输出核对；`badeffect2.ani` 权威头 16 行断言 PASS（12 帧 / 12 IMAGE POS / 12 DELAY 80）；#PVF_File 明文 ani 展示验证；**注释渲染断言（§9.3.1）：`#PVF_File` / `// 注释` / 行首缩进 `//` 均产出 `hljs-comment` token PASS**；**损坏 strlst 断言（§8.7）：`event.kor.str` 检测命中、无伪中文（`嚙篁課締瘠` 等 Big5 错读字符零出现）、key/ASCII 保留、损坏处 `�` 标记 PASS** |

运行方式：`node test/verify-authoritative-scan.mjs`（默认加载
`C:/Users/Administrator/Desktop/PVF/70TW/Script.pvf` 固定基线；其它版本以参数传入）。

### 12.4 注释颜色与损坏 strlst 修复记录（2026-08）

**注释颜色（§9.3.1）**：
- 问题：`//` 注释在 hljs pvf 高亮下被 title 规则抢占（亮蓝），key>text 渲染路径下用灰 #9a9a9a，均非注释绿 #6a9955；`#PVF_File` 头在 key>text 路径落默认灰。
- 解决：`pvfHighlight.js` 注释规则新增行首 `//`（`begin:/\/\//, end:"$"`，置于 title 前）；`PvfEditor.vue _renderKeyValueLine` 对 `#` 开头行与 `//` 开头行改用 `hljs-comment` 类。

**损坏 strlst（§8.7）**：
- 问题：`event/event.kor.str` 制作时损坏（韩文 EUC-KR 被 UTF-8 解码器净化：非法字节→U+FFFD、合法 2 字节序列与 ASCII 保留），按 Big5 解码错位产生 `嚙篁嚙課度無…` 伪中文；注释行 `// ???????` 的 `?` 为字面 0x3F。
- 验证：字节级确认 18021 个 `EF BF BD` / 残留组 6240B / ASCII 39649B；`etc/etc.kor.str` 同名 key 为中文版（内容不同，不可替换）；残留组按 Big5 与 EUC-KR 均无可读语义，原文不可恢复。
- 解决：`_twIsCorruptedStrlst`（4KB 采样 `EF BF BD` ≥ 8）检测损坏；`_twDecodeCorruptedStrlst` 按真实存储格式净化（ASCII 保留、损坏处 `�`），不再产生伪中文。
- 验证：损坏 strlst 断言 4/4 PASS；全量 114922 ok / fail 0 / 不一致 0（基线一致）；正常 strlst（etc/character/passiveobject .kor.str）保持 Big5 中文解码不变。