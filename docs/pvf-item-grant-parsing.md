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

判定规则：去掉反引号、小写后取首个 `[...]` 标签；`[material]` 需再判断类型串是否以 `4` 结尾来区分特殊材料。另有硬编码特殊材料 ID 白名单：3033-3037、3262。守护珠归段（A21 `StackSegment`）不要求首标签精确匹配——`[flag gem]` / `[guardian gem]` / `[guild gem]` 开头或类型串含 `guardian gem`、`守护珠` 子串均归入；槽位区间（`GetSlotRange`）则要求首标签精确为 `[flag gem]`。

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
> `GetSlotRange`。launch-helper 的物品编码查看（`src/components/ItemCodeView.vue`）
> 与解析层（`src/utils/pvfTool.js`）按本节与其对齐。

### 14.1 与旧版（§1-§13）的差异及同步内容

1. **堆叠物分段新增「守护珠」（六段 → 七段）**：A21 `STACK_SEGMENTS` 为 `['消耗品', '材料', '任务品', '副职业材料', '徽章', '守护珠', '特殊材料']`（守护珠位于徽章与特殊材料之间；give.js 内"六段"注释为旧文案，实际七段）。归段判定（`PvfIndexService.Items.StackSegment`）：类型串以 `[flag gem]`、`[guardian gem]`、`[guild gem]` 开头，或含 `guardian gem` / `守护珠` 子串（大小写不敏感）→ 守护珠。
2. **装备分组新增 `[flag]`（公会勋章）**：A21 `EQUIP_GROUPS` 装备组 tags 在 `name tag` 之后追加 `'flag'`；服务端槽位语义为装备且 `IsFlagEquipmentType()` → 槽位 0-48（`GetSlotRange`）。网关侧对应 kind=12 公会勋章经主背包投递、领取后由服务端路由到公会列表（见 `gateway.proto` MailAttachment 注释）。
3. **类型标签中文映射新增**（`TAG_LABELS`）：`flag`=公会勋章；`flag gem` / `guardian gem` / `guild gem`=守护珠。
4. **launch-helper 同步改动**：
   - `src/utils/pvfTool.js` `stackSegment()` 增加守护珠分支（判定顺序与 A21 一致：material → quest → material expert job → avatar emblem → 守护珠 → 默认消耗品）；
   - `src/components/ItemCodeView.vue` `STACK_SEGMENTS` 增加「守护珠」、`EQUIP_GROUPS` 装备组增加 `flag`、`TAG_LABELS` 补充上述四个翻译。
5. **不变项**：品级体系 `RARITY_LABELS`、品质细分 `SPECIAL_LABELS`、期限过滤 `EXPIRATION_OPTIONS` 与 A21 版一致，无需调整。
6. **发放物品来源口径收敛（移除 creature.lst，2026-08-24）**：
   - **问题现象**：launch-helper 物品编码查看器将 `creature/creature.lst` 全量纳入物品来源并整体归入宠物分组；A21 权威 GM 工具仅索引 `equipment/equipment.lst` 与 `stackable/stackable.lst` 两清单（`PvfIndexService.cs` `Build` 仅两处 `BuildKind` 调用，无 creature 来源），其「宠物」分组全部来自 equipment 类型首标签 `[creature]` / `[artifact red]` / `[artifact blue]` / `[artifact green]`。86JPL 基线对账：launch-helper 宠物组较权威工具多出的条目，数量恰为 creature.lst 条目数 486，差额全部来自 creature.lst 来源。
   - **定性**：口径不一致（非解析错误）。creature.lst 条目指向 `.cre` 宠物召唤物定义（如 `Petit_Tiger/Petit_Tiger.cre`），非可发放物品；86JPL 上其 486 行中 144 行引用不可解析、228 行 lst 附名为空，仅 342 行可匹配到文件。
   - **解决**：`src/components/ItemCodeView.vue` `LST_TYPES` 移除 creature 项；`resolveCategoryPath()` 移除 `it.type === "Creature"` 特判；同步清理 `labelNameMap` 的 `Creature` 映射、`.ivc-type.type-Creature`样式及界面描述文案。`EQUIP_GROUPS` 宠物组四标签与 `TAG_LABELS` 对应翻译保留（equipment 中宠物类装备仍归宠物组，此即权威口径）。
   - **已知残余口径差（登记备查，不作改动）**：A21 构建索引时丢弃名称为空或解析失败的条目（`BuildKind` 内 `Name` 为空即跳过）；launch-helper 为保留查看能力对 lst 全量展示，故消耗品等其他分组的计数仍可能大于权威工具。宠物分组不受影响（86JPL 上 equipment 四宠物标签条目在权威索引中全部有效，计数一致）。
7. **发放界面拆分为独立路由页 + 全类型发放支持核对（2026-08-26）**：
   - **迁移**：物品发放自 `src/components/GameLauncher.vue` 内嵌表单（`mode === 'items'`）整体拆分为独立路由页 `src/components/SendItemView.vue`（路由 `/SendItem`，name `SendItem`，注册于 `src/router/index.js`）。登录卡片的「物品发放」链接改为路由跳转（网关未启用时维持原提示行为）；网关在线校验、角色查询、清空邮件、附件编辑与投递逻辑随迁，`GameLauncher.vue` 移除全部 items 相关状态、方法与样式。
   - **全类型支持核对结论**（权威：gateway 项目 `internal/gmtool/gm/gm.go` 的 `validateItemSpec` / `expandItems` 与 `internal/gmtool/itemcore/itemcore.go` 的 `IsStackableKind`；kind 枚举对齐 `ServerCore/Game/Inventory/Models/ItemCore.cs`）：前端 `validKinds()` 允许集与网关逐项一致——主背包（item_type 0|2）配 kind=1 装备 / 2 消耗品 / 3 材料 / 9 时装徽章 / 10 副职业材料 / 12 公会勋章 / 13 守护珠，时装（item_type=1）配 kind=8，宠物（item_type 3|7）配 kind=5/6/7；即 **kind 取值 1-14 中除 4（任务品，2026-08-27 起开放，见第 9 条）、11（特殊材料，账号仓库物品）、14（史诗碎片，账号图鉴通道）外全部支持发放**，0 非法，选项中不出现非法取值。
   - **count 规则对齐**：堆叠类（2/3/7/9/10/13）无单条 count 上限——移除原 `STACKABLE_COUNT_LIMIT = 10000` 常量、输入框 `max` 与提交侧单条上限拦截；非堆叠类（1/5/6/8/12）数量恒为 1 保持不变；解除原「单次最多 10 个附件」的前端限制，同 item_id 数量合并与拆分（每附件 ≤2000、每封 ≤10 附件自动拆多封）由网关完成。
   - **顺带修正**：新建附件的 `amplify_type` 初值由空串改为 `0`（proto int32 字段不应收到字符串初值）。
   - **验证**：`npx vite build` 通过（SendItemView 独立 chunk 正常产出）；`npx prettier --write` 通过；`GameLauncher.vue` 无 items 残留引用（grep 核对）。
8. **发放界面 Element Plus 化重设计 + 管理密钥缓存（2026-08-26）**：
   - **控件替换**：`src/components/SendItemView.vue` 表单控件整体替换为 Element Plus（`ElInput` / `ElSelect` / `ElOption` / `ElInputNumber` / `ElButton`，组件内按需引入，沿用 ItemCodeView 的 unplugin-element-plus 样式模式）；物品 ID、数量、强化等级、限时天数用 `ElInputNumber`（数量无单条上限口径不变）。
   - **风格重设计**：登录卡片复刻风改为管理台分区布局——页头（标题 + 网关状态徽标）、「收件目标」面板、「邮件附件」面板（计数徽标、空态引导、附件卡片自适应网格；强化/红字字段仅装备类 kind=1/12 渲染、限时天数仅限时时装/宠物本体渲染）、底部操作栏（附件数与预计投递封数统计 + 发放按钮）；封数预估按网关 `expandItems` / `splitMails` 默认参数计算（堆叠类每附件 ≤2000、每封 ≤10 附件）。业务校验（kind 允许集、非堆叠 count=1、种类与背包匹配）不变。
   - **公共样式提取**：EP 深色适配自 ItemCodeView 提取至 `src/styles/element-plus-dark.css`（main.js 全局引入）：主色/圆角/文字变量对齐应用主题、输入类组件深色变量 + wrapper 直写背景双保险、input-number 步进控件配色、下拉弹层面板主题（新通用类 `.ep-popper-dark`；存量 `.ivc-select-popper` / `.ivc-cascader-popper` 选择器在公共文件中原样保留，ItemCodeView 无需改模板）。尺寸/布局仍属各页面 scoped 样式。`el-button` 同步对齐应用既有 `.btn` 按钮体系：primary 实心用 accent 渐变底 + 投影（对齐 `.btn-primary`）、default/plain 用透明底 1px 描边（对齐 `.btn-outline-*`，hover/active 均显式覆盖 EP 默认浅色底避免按下闪白）、danger plain 保留红字红框透明底（呼应移除按钮 hover 红调浅底）、link/text 中性灰字 hover accent（对齐 auth-links），统一圆角 10px（small 8px）与按压缩放反馈。
   - **auth_key 缓存**：game store 新增 `adminAuthKey` 字段并纳入 persist（localStorage）；`SendItemView` 进入时自动填充缓存密钥，角色查询 / 物品发放 / 清空邮件任一管理接口校验成功后即保存当前输入值，密钥标签旁提供「已记忆」标记与一键清除；`GameLauncher.vue` 重置密码使用同一管理密钥，同步接入缓存填充与成功保存。
   - **验证**：`npx vite build` 通过；`npx prettier --write` 通过。
9. **任务物品（kind=4）发放开放（2026-08-27）**：
   - **网关同步**：gateway `internal/gmtool/gm/gm.go` `validateItemSpec` 主背包（item_type 0|2）允许集加入 `KindQuest`（错误信息同步为 `kind=1/2/3/4/9/10/12/13`）；任务品属堆叠类（`IsStackableKind` 含 4），大 count 沿用 2000/附件自动拆分；proto `MailAttachment` 注释与 `gateway.pb.go` 同步更新（注册奖励 `register_bonus` 配置校验保持原允许集不变，未含任务品）。
   - **前端同步**：`src/components/SendItemView.vue` `validKinds()` 主背包允许集加入 4、`kindName()` 补「任务品」映射、顶部种类注释更新；任务品按堆叠物处理（数量输入可用、封数预估按 2000/附件拆分），与网关语义逐项一致。
   - **验证**：`npx vite build` 通过；网关侧 `go test ./test/...` 全绿（含 `TestSendItemsNewKinds` 任务品投递与拆分断言、`TestSendItemsInvalid` 任务品跨类拒收用例）。

### 14.2 测试脚本

| 脚本 | 验证内容 | 运行方式 |
|---|---|---|
| `test/item-grant-category-sync.mjs` | ① 函数级断言：`stackSegment` 七段规则（含守护珠三种标签开头与两种子串命中）；`firstTypeTag` 对 `flag` / `flag gem` / `guild gem` 的提取。② 源码口径断言：`ItemCodeView.vue` 的 `LST_TYPES` 不含 creature 来源、`resolveCategoryPath()` 无 `Creature` 特判、宠物组四标签保留。③ 可选全量统计：传入 PVF 路径时统计 stackable 各分段计数、守护珠段样例、equipment 中 `flag` 标签计数及宠物四标签（`creature` / `artifact red` / `artifact blue` / `artifact green`）计数与合计，另输出 creature.lst 行数仅作参考（不入来源） | `node test/item-grant-category-sync.mjs [PVF路径]`；不传路径仅跑断言 |

### 14.3 验证结果

- 函数级断言：16 项全部 PASS（2026-08-24，Node 本机运行，改码前守护珠 5 项按预期 FAIL，改码后全绿）。
- 源码口径断言（§14.1 第 6 条）：3 项。2026-08-24 改码前 `LST_TYPES 不含 creature/creature.lst 来源`、`resolveCategoryPath 无 Creature 特判` 两项按预期 FAIL；`ItemCodeView.vue` 收敛后与函数级断言合计 19 项全部 PASS（六个基线运行均含）。
- 全量运行（2026-08-24，基线 `PVF/<版本>/Script.pvf`，运行 `node test/item-grant-category-sync.mjs <pvf路径>`）：六个基线全部通过；守护珠与公会勋章标签仅在实装该系统的版本（86JPL / 90CN / 90US）检出。

- 结果判读：
  - 守护珠段样例（86JPL/90CN）：90000「微弱之光守护珠 (物理防御力)」等 90000 系列；90US 名称缺失回退显示引用路径 `flaggem/90000.stk`。flag 装备样例：100380017「古老的勋章」（90US 为 Old Insignia）等，归段/归组语义均正确。
  - 70TW / 86JP / 86JPAG 未检出守护珠与公会勋章属**真实数据特征（非解析错误）**：该三份为早期版本档案，公会勋章/守护珠系统尚未实装。
  - 特殊材料多数版本未检出属各档案真实数据特征（无 `[material] ... 4` 结尾条目）；服务端 ID 白名单 3033-3037、3262 仅用于入格判定，不在发放分类归段内。
- 宠物分组口径对账（§14.1 第 6 条，2026-08-24）：收敛后宠物分组采用 A21 权威发放口径（equipment 四首标签，creature.lst 不入来源）。六基线运行中，宠物分组计数与 A21 权威 GM 工具发放界面显示一致；收敛前 launch-helper 多出的宠物组条目全部来自 creature.lst 来源（见 §14.1 第 6 条）。宠物装备样例（86JPL）：63000「佛拉斯」、63006「宠物蛋 (佛拉斯)」等，均为 equipment.lst 中 `[creature]` 标签装备。
