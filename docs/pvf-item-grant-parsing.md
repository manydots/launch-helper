# PVF 物品发放解析规则（源自 86JPGMTool，已同步 A21 版权威 GM 工具）

> 来源项目：`JP/86JPGMTool`（C# GM 工具，DfoGmTool + GmPvfLib）。
> **权威源升级**：A21 版 GM 工具 `JP/S4A21GmTool`
> （C# DfoGmTool + ServerCore，发放界面 `wwwroot/js/give.js`）。本文 §1-§13 提炼自旧版
> 86JPGMTool，语义仍适用；与 A21 版的差异及同步记录见 §14，launch-helper 以 §14 为准。
> 本文提炼其中「物品发放」链路对 PVF（Script.pvf）的解析规则，供 launch-helper 的物品编码查看 / 发放校验参考。
> launch-helper 已有 PVF 二进制格式解析（见 `src/utils/pvfCodec.js`、`pvfTool.js`），本文聚焦其**上层脚本内容的语义解析**，二者互补。

## 1. 总体流程

物品发放前的 PVF 解析分两层：

1. **归档层**（`PvfLib/PvfArchive.cs`）：解密/解压 Script.pvf，按文件路径读取明文脚本内容。对应本项目的 `pvfCodec.js`。
2. **脚本语义层**（`ScriptParser` + 各 `*File` 模型 + `PvfIndexService`）：把明文脚本解析成标签树，再提取物品发放所需的元数据（名称、品质、类型、期限、可强化/增幅性等）。

索引构建流程（`PvfIndexService.Build`）：

```
PvfArchive.Open(pvfPath)
  ├─ BuildJobNames / BuildRegionNames / ... （职业、区域等小表）
  ├─ 读 etc/amplifyitem.etc → 增幅装备最低登记（[equip level const]，默认 55）
  ├─ BuildKind(equipment/equipment.lst, "equipment")   ← 装备
  ├─ BuildKind(stackable/stackable.lst, "stackable")   ← 堆叠物
  └─ 索引建完即释放归档，常驻内存只有名字/品质/期限字典
```

## 2. .lst 清单解析

物品 ID → 脚本文件的映射来自两个清单文件：

- `equipment/equipment.lst` → 装备
- `stackable/stackable.lst` → 堆叠物（消耗品/材料/任务品/徽章等）

**格式**：整份文件是一串 `数字 \`反引号路径\`` 对：

```
1 `sword/sword_01.etc` 2 `sword/sword_02.etc` ...
```

**解析规则**（`LstFile.Parse` / `PvfIndexService.LstPattern`）：

- 正则：`(\d+)\s+`([^`]+)``
- ID 为十进制 int；路径为相对 lst 所在目录的相对路径（反斜杠需归一为 `/`）。
- 重复 ID 时**第一条优先**（构建 id 索引时 `if (!_idIndex.ContainsKey)`）。
- lst 中的相对路径拼接规则：`rootFolder = lstPath 去掉最后一段`，`fullPath = rootFolder + "/" + relative`。

## 3. 脚本标签树解析（ScriptParser）

每个物品脚本是一个 `[tag] ... [/tag]` 嵗套结构，解析规则（`PvfLib/ScriptParser.cs`）：

- **按行解析**，先 Trim。空行与 `#` 开头的行为注释，跳过。
- **整行 `[xxx]`** 是开标签；`[/xxx]` 是闭标签。标签比较**大小写敏感、全串相等**。
- **配对规则**：
  - `FindEndTag`：从开标签下一行起，用深度计数找 `[/tag]`。遇到同名开标签 depth++，同名闭标签 depth--，depth==0 即命中。找不到 → 走"无闭标签"分支。
  - 无闭标签时（`FindDataNodeEnd`），数据延续到**下一个 `[` 开头的非注释行**为止（即"连续数据段"）。这是 PVF 脚本常见的"只有开标签、数据跟在后面直到下个标签"写法。
- 非标签行是该节点的 DataItem（按行记录 Start/End 偏移，O(1) 取原文）。
- **取值约定**：字符串值用反引号包裹 `` `xxx` ``，`StripBacktick` 去壳；数值取第一个空白分隔 token（`ParseInt`），解析失败返回 -1。

## 4. 装备脚本字段（EquipmentFile）

发放界面用到的字段（`[tag]` → 属性）：

| PVF 标签 | 属性 | 用途 |
|---|---|---|
| `[name]` | Name | 物品名（为空的条目直接丢弃不进索引） |
| `[rarity]` | Rarity | 品质 0-6（前端按品质着色；-1 不着色） |
| `[minimum level]` | MinimumLevel | 使用/穿戴等级下限 |
| `[equipment type]` | EquipmentType | 类型串，如 `` `[weapon]` ``、`` `[coat]` `` |
| `[item category]` | ItemCategory | 品质细分（见 §6） |
| `[impossible contents]` | ImpossibleContentItems | 禁用能力清单（"upgrade"/"amplify upgrade"） |
| `[weight]` `[price]` `[value]` `[add price]` | 经济/负重 | 购买/出售价计算（见 §8） |
| `[durability]` | Durability | 仅武器/防具有效 |
| `[need material]` | NeedMaterial | 兑换材料 `itemId count` |

### 4.1 装备类型与可强化/可增幅判定

`[equipment type]` 归一化（取 `[...]` 内文本、小写）后映射为枚举（`EquipmentTypeInfo`）：

- **武器**：`[weapon]`
- **防具**：`[coat] [shoulder] [pants] [shoes] [waist]`
- **首饰**：`[amulet] [wrist] [ring]`
- **特殊装备**：`[support] [magic stone]`
- 其他：各部位 avatar、`[title name]`、`[creature]`（宠物）、`[artifact red/blue/green]`（宠物装备）、`[name tag]`、`[charm]`、`[support weapon]` 等；A21 版新增 `[flag]`（公会勋章，见 §14.1）

**可强化/增幅能力判定**（`EquipmentGrantPolicy.Evaluate`）：

```
isUpgradeTarget = 武器 | 防具 | 首饰 | 特殊装备
CanReinforce        = isUpgradeTarget 且 impossible contents 不含 "upgrade"
CanHaveAmplifyState = isUpgradeTarget 且 rarity >= 2 且 minimumLevel >= 增幅等级门槛
CanAmplifyLevel     = CanHaveAmplifyState 且 impossible contents 不含 "amplify upgrade"
IsWeapon            = 类型为 [weapon]
```

增幅等级门槛来自 `etc/amplifyitem.etc` 的 `[equip level const]`（默认 55）。

**耐久度规则**：只有武器（`[weapon] [support weapon] [charm]`）和防具五件有耐久，其余装备（首饰/魔法石/称号/装扮/宠物等）耐久置 0。

## 5. 堆叠物脚本字段（StackableItemFile）

| PVF 标签 | 属性 | 用途 |
|---|---|---|
| `[name]` `[rarity]` `[minimum level]` | 同装备 | 名称/品质/等级 |
| `[stackable type]` | StackableType | 背包入格分类依据（见 §7） |
| `[stack limit]` | StackLimit | 叠加上限 |
| `[usable period]` | UsablePeriod | 相对期限（天） |
| `[expiration date]` | ExpirationDate | 绝对期限 |
| `[daily delete item]` | — | 每日删除标记（仅堆叠物有） |
| `[trade limit max]` | TradeLimit | 交易次数上限 |
| `[impossible contents]` | ImpossibleContentItems | 禁用能力 |
| `[avatar emblem target type]` | 徽章孔位 | `[A/B/C/D/S/M socket]` → 位掩码 0x01/02/04/08/10/EF |
| `[monster card id]` `[enchant index]` `[target item id]` | 附魔校验 | 宝珠附魔目标白名单 |
| `[need material]` | 兑换材料 | `itemId count` |

## 6. 品质细分（Special）

在发放界面用于区分同品质下的特殊类别（`EquipSpecial`，均经实物验证）：

| 判定 | Special 值 | 含义 |
|---|---|---|
| `[item category] legacy` | `legacy` | 传承（例：10104 传承:智慧女神的纱棉长袍） |
| `[item category] boss drop` | `boss` | 领主神器（例：100300063 凝视者之眸） |
| 含 `[random option]` 标签 | `sealed` | 魔法封印（"(魔法封印)"前缀是客户端运行时加的） |

另有 `[item category] clear avatar` → 克隆装扮（配合 `[clear avatar] 1` 判定）。

## 7. 堆叠物背包分段（Segment）

与背包槽位区间同语义（`ItemMetadataResolver.GetSlotRange` / `StackSegment`）：

| `[stackable type]` 首标签 | 分段 | 主背包槽位区间 |
|---|---|---|
| （无/其他） | 消耗品 | 65-120 |
| `[material]` | 材料 | 121-176 |
| `[material]`×…`4` 结尾（`[material] ... 4`） | 特殊材料 | 345-359 |
| `[quest]` | 任务品 | 177-232 |
| `[material expert job]` | 副职业材料 | 233-288 |
| `[avatar emblem]` | 徽章 | 289-344 |
| `[flag gem]` / `[guardian gem]` / `[guild gem]` 开头，或类型串含 `guardian gem` / `守护珠` 子串（A21 新增，见 §14.1） | 守护珠 | 49-97（仅首标签精确为 `flag gem`） |
| 装备（非堆叠物） | 装备 | 9-64；A21 中 `[flag]` 公会勋章装备为 0-48（见 §14.1） |

判定规则：去掉反引号、小写后取首个 `[...]` 标签；`[material]` 需再判断类型串是否以 `4` 结尾来区分特殊材料。另有硬编码特殊材料 ID 白名单：3033-3037、3262。守护珠归段（A21 `StackSegment`）不要求首标签精确匹配——`[flag gem]`/`[guardian gem]`/`[guild gem]` 开头或类型串含 `guardian gem`、`守护珠` 子串均归入；槽位区间（`GetSlotRange`）则要求首标签精确为 `[flag gem]`。

主背包其他保留段：0-2 货币（金币/复活币/胜点）、3-8 快捷栏、354-359 账号晶块。

## 8. 价格解析规则

- **`[value]` 是 NPC 回收价**，不是购买价。购买价只来自 `[price]`，可被带符号的 `[add price]` 修正：`buyGold = price + addPrice`（仅当同时定义了有效 `[need material]` 时才走修正路径；否则普通 NPC 定价取 `price`，缺失时回退 `value`）。
- 装备出售价 = `value * pricetable.tbl 中装备比率 / 1000`（pricetable.tbl 闭标签后跟三个整数：装备/非堆叠/堆叠比率，默认 200/150/30）。
- 堆叠物出售价 = `value / 5`，无 value 时 `price / 5`。

## 9. 期限解析规则（发放模板期限）

装备与堆叠物共用同一套期限语义（`StackableExpirationPolicyResolver` / `PvfExpirationMetadata`）：

- **`[usable period] N`**：相对期限，N 天（发放时 `now + N*86400`）。
- **`[expiration date]`**：绝对期限，三种合法写法：
  1. 字符串日期 `"yyyy-MM-dd HH:mm:ss"` 或 `"yyyy-MM-dd"`，按**服务器本地时区 UTC+8** 转 Unix 秒；
  2. `0` → 无期限；
  3. 纯数字：≥ 1,000,000,000 视为 Unix 秒；否则按 `yyyyMMdd` 解析为日期再转（同样按 UTC+8）。
- **解析失败保护**：任何字段格式非法（非负整数解析失败、日期不合法）→ 整条标记 `invalid`（HasInvalidExpirationDefinition），发放界面按"定义异常"提示而不是静默发错。
- **`[daily delete item]`**：每日删除标记，不进 policy 模型，直接读原始标签。
- 堆叠物读取用严格读取器（`StackablePvfValueReader`）：对应标签必须**恰好出现一次、无子节点、只有一个数据项**，否则视为定义异常。

发放时还叠加一层"实例期限"来源：时装（AvatarDetails.ExpireDate）、宠物（CreatureDetails.ExpireDate）、租赁道具（rentalExpireTimes 补充期限表）。

## 10. 发放校验链（GiveItem）

发放一个物品前的完整校验（`GmService.Inventory.GiveItem`）：

1. `itemTemplateId > 0`、`count > 0`。
2. **PVF 存在性**：`PvfIndex.ResolveItemName(id)` 解析不到名字且索引就绪 → 拒绝（"装备/堆叠表都没有"），防止客户端收到未知 ID 异常。
3. 区分装备 / 堆叠物（`ResolveItemKind`）。只有装备可带强化/增幅/锻造/净化选项。
4. 装备选项校验（`TryResolveEquipmentMailConfiguration`）：
   - 强化/增幅等级 0-31；锻造等级 0-8 且仅武器可锻造；
   - `state=normal`：不可设增幅属性；`CanReinforce=false` 时强化等级必须为 0；
   - `state=unpurified`（带异界气息）：需 `CanHaveAmplifyState`，且强化/增幅必须全 0，AmplifyType 置 0x80（未净化标记）；
   - `state=purified/amplified`：需 `CanHaveAmplifyState`，增幅属性限体力/精神/力量/智力，初始增幅值由 PVF（amplifyitem.etc 按品质）计算，算不出则拒绝；
   - 品级模式 `top`（品级种子取最优）/ `random`。
5. 特殊货币旁路：晶块 → 账号字段；复活币 → 主背包 1 号虚拟槽。
6. 默认走**系统邮件**发放（附件上限 10；自定义装备属性只能走邮件）；`direct=true` 直写背包仅用于离线角色维护。

## 11. 附魔/宝珠目标校验（PVF 交叉引用）

`TryValidateEnchantByBeadTarget` 展示了 PVF 文件间的交叉引用解析：

- 宝珠（stackable）通过 `[monster card id]` 或 `[enchant index]` 指向附魔卡；
- `[target item id]` 非空时是白名单，只有列表内装备可附魔；
- 附魔卡的 `[string data]`：第一个是图片资源，**后续项是允许附魔的 equipment type**；
- 附魔卡的 `[enchant table]`（子块 `[enchant index]` 列表）约束可附魔的宝珠升级次数。

## 12. 杂项解析细节（易踩坑）

- 标签匹配**大小写敏感**（`FindEndTag` 全串相等比较），但模型层取值时用 `ToLowerInvariant` 归一。
- `ScriptParser` 的旧版嵌套块边界可能让**最后一个未闭合的标量子节点没有 DataItem**——`EquipmentLevelEmancipateCondition` 用"从块原文中按 `^\[tag\]\s*\n\s*(-?\d+)` 兜底重解析"兼容（ParseTaggedInt）。
- 数值列表解析（`ParseInts`）直接用正则 `-?\d+` 扫描全文，忽略非数字 token。
- `[random option]` 存在即视为魔法封印装备，客户端名前缀是运行时加的，PVF 名里没有。
- 物品 kind 判定还包括：路径含 `/avatar/` 或 `/at_avatar/` → 时装；`[creature]`/`[feed]` 开头的 stackable → 宠物消耗品。

## 13. 源码位置索引

| 主题 | 文件（86JPGMTool） |
|---|---|
| 标签树解析 | `PvfLib/ScriptParser.cs` |
| 装备模型 | `PvfLib/Models/EquipmentFile.cs` |
| 堆叠物模型 | `PvfLib/Models/StackableItemFile.cs` |
| lst 清单 | `PvfLib/Models/LstFile.cs` |
| 增幅配置 | `PvfLib/Models/AmplifyItemFile.cs` |
| 物品索引 | `Services/PvfIndexService.cs`、`PvfIndexService.Items.cs` |
| 期限策略 | `ServerCore/Game/Inventory/StackableExpirationPolicyResolver.cs`、`StackablePvfValueReader.cs` |
| 元数据/槽位 | `ServerCore/Game/Inventory/ItemMetadataResolver.cs` |
| 装备类型/强化策略 | `ServerCore/Game/ItemUpgrade/EquipmentType.cs`、`Services/EquipmentGrantOptions.cs` |
| 发放入口 | `Services/GmService.Inventory.cs` |

## 14. A21 版权威 GM 工具同步记录（2026-08）

> 权威源：`JP/S4A21GmTool`。发放界面分类枚举位于
> `wwwroot/js/give.js`；堆叠物归段逻辑位于 `Services/PvfIndexService.Items.cs` 的
> `StackSegment`；槽位区间位于 `ServerCore/Game/Inventory/ItemMetadataResolver.cs` 的
> `GetSlotRange`。launch-helper 的物品编码查看（`src/components/ItemCodeViewer.vue`）
> 与解析层（`src/utils/pvfTool.js`）按本节与其对齐。

### 14.1 与旧版（§1-§13）的差异及同步内容

1. **堆叠物分段新增「守护珠」（六段 → 七段）**：A21 `STACK_SEGMENTS` 为
   `['消耗品', '材料', '任务品', '副职业材料', '徽章', '守护珠', '特殊材料']`
   （守护珠位于徽章与特殊材料之间；give.js 内"六段"注释为旧文案，实际七段）。
   归段判定（`PvfIndexService.Items.StackSegment`）：类型串以 `[flag gem]`、
   `[guardian gem]`、`[guild gem]` 开头，或含 `guardian gem` / `守护珠` 子串
   （大小写不敏感）→ 守护珠。
2. **装备分组新增 `[flag]`（公会勋章）**：A21 `EQUIP_GROUPS` 装备组 tags 在
   `name tag` 之后追加 `'flag'`；服务端槽位语义为装备且 `IsFlagEquipmentType()`
   → 槽位 0-48（`GetSlotRange`）。网关侧对应 kind=12 公会勋章经主背包投递、
   领取后由服务端路由到公会列表（见 `gateway.proto` MailAttachment 注释）。
3. **类型标签中文映射新增**（`TAG_LABELS`）：`flag`=公会勋章；
   `flag gem` / `guardian gem` / `guild gem`=守护珠。
4. **launch-helper 同步改动**：
   - `src/utils/pvfTool.js` `stackSegment()` 增加守护珠分支（判定顺序与 A21 一致：
     material → quest → material expert job → avatar emblem → 守护珠 → 默认消耗品）；
   - `src/components/ItemCodeViewer.vue` `STACK_SEGMENTS` 增加「守护珠」、
     `EQUIP_GROUPS` 装备组增加 `flag`、`TAG_LABELS` 补充上述四个翻译。
5. **不变项**：品级体系 `RARITY_LABELS`、品质细分 `SPECIAL_LABELS`、期限过滤
   `EXPIRATION_OPTIONS` 与 A21 版一致，无需调整。

### 14.2 测试脚本

| 脚本 | 验证内容 | 运行方式 |
|---|---|---|
| `test/item-grant-category-sync.mjs` | ① 函数级断言：`stackSegment` 七段规则（含守护珠三种标签开头与两种子串命中）；`firstTypeTag` 对 `flag` / `flag gem` / `guild gem` 的提取。② 可选全量统计：传入 PVF 路径时统计 stackable 各分段计数、守护珠段样例、equipment 中 `flag` 标签计数 | `node test/item-grant-category-sync.mjs [PVF路径]`；不传路径仅跑断言 |

### 14.3 验证结果

- 函数级断言：16 项全部 PASS（2026-08-24，Node 本机运行，改码前守护珠 5 项按预期 FAIL，改码后全绿）。
- 全量统计（2026-08-24，基线 `PVF/<版本>/Script.pvf`，
  运行 `node test/item-grant-category-sync.mjs <pvf路径>`）：

| 基线 | stackable 总数 | 消耗品 | 材料 | 特殊材料 | 任务品 | 副职业材料 | 徽章 | 守护珠 | equipment 总数 | flag 公会勋章 |
|---|---|---|---|---|---|---|---|---|---|---|
| 70TW | 5720 | 4764 | 249 | 8 | 509 | 190 | 0 | **0** | 27254 | **0** |
| 86JP | 34542 | 25430 | 1136 | 0 | 1210 | 5598 | 1168 | **0** | 101868 | **0** |
| 86JPAG | 34583 | 25471 | 1136 | 0 | 1210 | 5598 | 1168 | **0** | 102774 | **0** |
| 86JPL | 42272 | 31698 | 2085 | 0 | 1268 | 5940 | 1229 | **52** | 118479 | **47** |
| 90CN | 54790 | 42611 | 2890 | 0 | 1468 | 6238 | 1531 | **52** | 140862 | **47** |
| 90US | 45861 | 35247 | 2219 | 0 | 1169 | 5688 | 1486 | **52** | 138768 | **47** |

- 结果判读：
  - 守护珠段样例（86JPL/90CN）：90000「微弱之光守护珠 (物理防御力)」等 90000 系列；
    90US 名称缺失回退显示引用路径 `flaggem/90000.stk`。flag 装备样例：
    100380017「古老的勋章」（90US 为 Old Insignia）等，归段/归组语义均正确。
  - 70TW / 86JP / 86JPAG 守护珠与公会勋章为 0 属**真实数据特征（非解析错误）**：
    该三份为早期版本档案，公会勋章/守护珠系统尚未实装。
  - 特殊材料大多为 0 属各档案真实数据特征（无 `[material] ... 4` 结尾条目；
    70TW 有 8 条）；服务端 ID 白名单 3033-3037、3262 仅用于入格判定，
    不在发放分类归段内。
