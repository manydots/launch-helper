# 网关管理协议对接：角色数据修改（CMD_UPDATE_ROLE）

## 1. 目的与范围

管理前端（`src/components/SendItemView.vue`）新增「修改角色」能力，对接网关 `CMD_UPDATE_ROLE (10)`：
修改角色名 / 设定等级 / 转职觉醒档位。本文档定义协议字段、optional 置位语义、前端前置关系校验规则与验证方式；同时作为 `src/utils/gateway.proto` 运行时副本的同步记录。

| 角色 | 文件 | 说明 |
|------|------|------|
| 协议真源 | `../../gateway/proto/gateway.proto`（相对本项目仓库根，位于同级网关仓库） | 命令枚举、消息定义唯一真源 |
| 运行时副本 | `src/utils/gateway.proto` | 由真源手动同步，新增 `CMD_UPDATE_ROLE = 10` 与 `UpdateRoleRequest` / `UpdateRoleResponse` |
| 类型登记 | `src/utils/gateway.js` | 新增类型绑定、CMD 映射四处表项、`client.updateRole()` 方法与 `api.updateRole` 导出 |

> 该命令为管理接口：走通用 admin 授权管线（`auth_key` 必填），仅 TCP/WebSocket；请求需携带与其它管理命令相同的密钥缓存交互。
> 仅适用于**离线角色**：在线角色的游戏服务端内存态会覆盖本次直改；重新选角进入后生效。

## 2. 协议字段

### 2.1 UpdateRoleRequest

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `m_id` | string | 是 | 目标账号 |
| `character_id` | int32 | 是 | 目标角色 ID（> 0，存活且属于该账号） |
| `name` | string, proto3 optional | 否 | 改名：GBK 编码后 2-18 字节，仅中文/英文/数字，全库唯一（含已删除角色） |
| `level` | int32, proto3 optional | 否 | 设等级：1-86；累计经验按网关内置阈值快照联动写入 |
| `grow_first` | int32, proto3 optional | 否 | 转职分支 0-5；必须与 `grow_second` 成对提供 |
| `grow_second` | int32, optional | 否 | 觉醒档位 0-2；`grow_first=0` 时只能为 0 |

### 2.2 optional 置位语义（对接要点）

`UpdateRoleRequest` 的业务字段均为 **proto3 explicit presence**：序列化时只有显式赋值的字段才上线缆，
网关侧以指针判空识别——**未置位字段不落库、不触发任何表联动**。因此：

- protobuf.js（8.7.2）下构造 payload 时，未启用修改组的字段必须**完全不出现**在对象字面量中
  （不得传 `null` / `0` / `""` 占位），否则会被误置位提交给网关。
- 全部业务字段均未提供时网关返回 `code=1019`；前端在任何提交前先行拦截。

### 2.3 UpdateRoleResponse

| 字段 | 说明 |
|------|------|
| `account_id` / `character_id` / `character_name` | 定位回显；`character_name` 为修改后的名字（UTF-8 文本） |
| `name_updated` / `level_updated` / `grow_type_updated` | 本次是否实际变更（值相同视为未改动，不触发技能清空） |
| `skills_reset` | 是否清空了已学技能（改等级或转职/觉醒实际变更时为 true） |
| `level` / `exp` / `grow_type` | 落库后当前值；`grow_type = (second << 4) \| first` |

### 2.4 错误码

`1007` 账号不存在；`1010` auth_key 无效；`1013` 角色无效；
`1015` 角色名非法；`1016` 角色名已被使用；`1017` 等级超出 1-86；
`1018` 转职/觉醒取值非法；`1019` 未提供任何修改字段。

## 3. 前端前置关系规则（展示层约定）

权威端（网关/游戏服务端）只强制**取值范围与组合关系**；以下第 3.3 条的等级门槛为前端展示层约定，
用于预防误操作产生低等级高觉醒的非预期形态（服务端不会拦截），常量集中定义便于调整。

### 3.1 协议强约束（硬校验，与网关守卫一致）

1. 改名：GBK 字节数 2-18、字符白名单中文/英文/数字（UTF-16 码位白名单同权威工具）。
2. 等级：整数 1-86（当前版本等级上限，超限网关返回 `code=1017`）。
3. 转职/觉醒必须成对提供：两个下拉同时启用或同时关闭。
4. 组合范围：`grow_first ∈ [0,5]`、`grow_second ∈ [0,2]`；`grow_first = 0` 时 `grow_second` 只能为 `0`
   （未转职不可觉醒），界面直接禁用觉醒选择。

### 3.2 参考等级（基准值）

判定等级门槛时的参考等级 `refLevel` 取：

```
refLevel = 启用了等级修改 ? 目标等级输入值 : 所选角色当前 level（GET_ROLES 回填）
```

### 3.3 觉醒等级门槛（AWAKEN_MIN_LEVEL）

| 觉醒档位 | 档位含义 | 最低参考等级 |
|:--:|----------|:--:|
| 0 | 未觉醒 | —（不受限） |
| 1 | 一次觉醒 | 48 |
| 2 | 二次觉醒 | 75 |

满足关系表达式：`grow_second === 0 || refLevel >= AWAKEN_MIN_LEVEL[grow_second]`。
不满足时提交被拦截，提示文案引导管理员将目标等级一并设至门槛之上（例如设定二觉而目标等级 50 时，
提示需把等级改为 ≥75 后一并提交）。该常量如与运营口径不符，仅需调整本文件所述常量与 UI 文案。

## 4. UI 行为设计（SendItemView.vue）

1. 「修改角色」面板复用页面既有账号 / 密钥 / 收件角色选择上下文；未查询角色时面板呈空态提示。
2. 三个修改组各带独立启用开关，默认全部关闭；全未启用时提交按钮禁用（避免 1019 往返）。
   - **改名**：文本框，留白即视为放弃本次改名（开关仍开但内容为空同样按组内校验失败提示）。
   - **设等级**：数字输入 1-86。
   - **转职/觉醒**：转职分支下拉（0-5）/ 觉醒档位下拉（0-2）；选「未转职」时觉醒锁定为「未觉醒」并禁用。
3. 面板顶部显示所选角色当前值（当前名 / 等级 / 职业 / grow_type 解码），便于对照。
4. 提交前 confirm 弹窗汇总待变更项，并固定提示：仅离线角色生效、实际发生等级或转职/觉醒变更会清空已学技能（下次选角自动重建）。
5. 成功后自动重查角色列表刷新下拉标签（新名字 / 新等级即时可见），并以 alert 展示各项 `*_updated` 标志与最终值。

## 5. 验证脚本

| 事项 | 内容 |
|------|------|
| 脚本位置 | `test/update-role-proto.mjs` |
| 运行方式 | `node test/update-role-proto.mjs`（依赖仅 protobufjs，经 createRequire 加载） |
| 验证内容 | ① 运行时副本 .proto 可被 protobufjs 解析且含 `CMD_UPDATE_ROLE = 10`；② `optional` 字段解析出显式 presence（proto3_optional 标记）；③ 编码线缆验证：仅赋值字段上线（未启用组不出现在字节流）、零值显式置位照常编码（field tag 存在）；④ `gateway.js` 五处登记静态断言（CMD 表 / REQUEST_TYPES / RESPONSE_TYPES / CMD_NAMES / client+api 方法导出）。 |

> 受 vite 特有导入（`?raw`）限制，测试脚本无法直接 import `gateway.js` 模块本体；
> 以「proto 动态编解码验证 + gateway.js 源静态断言」双轨覆盖，与既有 `test/*.mjs` 直接加载 utils 的方式并存。

## 6. 实施与验证记录

- 2026-08-27：按 §4 顺序实施——① 本文档先行；② 验证脚本就位并确认红灯（运行时副本缺新消息即失败）；
  ③ 改码：同步 `src/utils/gateway.proto`、登记 `src/utils/gateway.js`、
  `src/components/SendItemView.vue` 新增修改角色面板。最终 `node test/update-role-proto.mjs`
  **24 PASS / 0 FAIL**；`npx vite build` 构建通过；既有回归 `test/pvf-jp-mojibake-verify.mjs`
  与 `test/item-grant-category-sync.mjs` 均 19 PASS / 0 FAIL，无破坏。
- 前置关系落地对照：协议强约束（成对提供/范围/未转职不可觉醒）与网关守卫一致；
  觉醒参考等级门槛 48/75 为展示层约定（§3.3），提交前 confirm 弹窗固定提示离线约束与技能清空影响。
- 2026-08-27 样式缺陷修复：转职/觉醒下拉默认禁用态露出 EP 浅色底（`.el-select__wrapper.is-disabled`
  走 `--el-fill-color-light`，全局暗色主题此前仅覆盖普通/hover/focus 三态与 el-input-number 禁用），
  于 `src/styles/element-plus-dark.css` 补禁用态深底覆盖；同修 `ElCheckbox` 未注册导致的
  启用开关渲染失效（import + components 登记）。`test/update-role-proto.mjs` 复验 24 PASS / 0 FAIL，构建通过。
