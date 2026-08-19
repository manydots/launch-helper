# LaunchHelper

通过浏览器自定义协议（`LaunchHelper:`）启动 Windows 游戏，可选集成网关认证。

[LaunchHelper 演示地址](https://manydots.github.io/launch-helper/)

## 功能特性

- 自定义协议启动 Windows 游戏，无需手动执行命令
- 账号、密码、游戏路径、启动参数本地持久化（localStorage），刷新不丢失
- 网关认证（注册 / 登录 / 修改密码），WebSocket + Protobuf 二进制协议
- 服务状态实时探测：网关启用时登录框左上角圆点显示在线 / 离线 / 检测中
- Material 风格输入框，聚焦时支持一键清空
- 打字机动效副标题、毛玻璃卡片界面
- 注册表一键生成 / 卸载，非 Windows 环境自动提示
- 内置 PVF 文件解析与编辑器：解密解析 `Script.pvf`，支持文件树浏览、脚本语法高亮、多编码切换、编辑 / 重命名 / 删除 / 导入 / 导出、重新打包
- 大文件全量浏览：数万行文件虚拟滚动查看，支持内容搜索（含 name 映射中文命中）与逐条跳转
- 物品编码查看：解析 `Script.pvf` 中的 `stackable/stackable.lst`、`equipment/equipment.lst`、`creature/creature.lst`，映射展示物品 ID / 类型 / 名称 / 品质 / 使用等级 / 引用路径，支持 JP / JPAG（0x55 XOR）/ CN、US（protected_nkpi）三种格式
- 兼容旧版浏览器（@vitejs/plugin-legacy 自动注入 polyfill）

## 使用方式

### GitHub Pages 演示

1. 填写游戏 exe 完整路径（如 `D:\Games\Game.exe`）
2. 填写启动参数（如 `99?127.0.0.1?7001?...`）
3. 点击「生成注册表」，下载 `register-LaunchHelper.reg` 并双击运行
4. 点击「登录并启动」，浏览器启动游戏

> 账号、路径、参数在首次输入后会自动保存到本地，下次打开无需重新填写。

### 网关启用

1. 填写账号、密码（首次需先「注册账号」）
2. 网关验证身份后返回 `launch_args`，自动填入启动参数
3. 确认游戏路径后点击「登录并启动」

### 卸载协议

点击「卸载注册表」，下载 `uninstall-LaunchHelper.reg` 并运行即可移除自定义协议。

### PVF 文件编辑

1. 在游戏启动页点击右上角「PVF 编辑」入口进入编辑器
2. 打开 `.pvf` 文件（如 `Script.pvf`），自动解密解析并生成文件树
3. 左侧文件树浏览 / 搜索，点击文件查看内容
4. 脚本文件支持语法高亮、代码折叠、标签悬停提示，可直接编辑
5. 超大文件（默认超过 50 万字符）只读预览前 2,000 行，点「加载全部内容」进入虚拟滚动全量视图，可搜索并逐条跳转命中行
6. 右键文件可重命名、删除、导出原始字节、导入外部文件替换
7. `Ctrl+S` 暂存当前文件修改，点击「导出 PVF」重新打包下载

> 支持修改 / 删除 / 重命名后重新打包，离开编辑器时若有未保存修改会提示确认。
>
> **关于格式**：工具自动识别三种 PVF 包头格式——JP（原版）、JPAG（Guard，`0x55 XOR`）、CN / US（新版 `protected_nkpi`，UTF-16 seed 密钥流，字符串池使用 `StRa`/`StRw` 大写密钥），打开时自动探测，无需手动选择。

### 查看物品编码

1. 在游戏启动页点击右上角「查看物品编码」入口进入
2. 打开 `.pvf` 文件（如 `Script.pvf`），自动定位并解析 `stackable/stackable.lst`、`equipment/equipment.lst`、`creature/creature.lst`
3. 表格展示物品 ID、类型徽标、物品名称（经字符串表映射）、品质与使用等级、引用路径，大列表虚拟滚动渲染
4. 顶部搜索框可按物品 ID / 类型 / 物品名称 / 引用路径过滤
5. 品质色依客户端串表着色（普通 ~ 传说），支持 JP / JPAG（0x55 XOR）/ CN、US（protected_nkpi）三种 PVF 包头格式，打开时自动识别并标注

## 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `VITE_GATEWAY_ENABLED` | 是否启用网关认证与服务状态探测 | `false` |
| `VITE_GATEWAY_TARGET` | 开发代理网关主机地址（仅 dev server 生效） | `""` |
| `VITE_GATEWAY_PORT` | 开发代理网关端口（仅 dev server 生效） | `8000` |
| `VITE_GATEWAY_PATH` | WebSocket 代理路径（需以 `/` 开头） | `/gateway` |
| `VITE_PLATFORM_CHECK` | 是否校验 Windows 平台 | `true` |
| `VITE_HEALTH_INTERVAL` | 服务状态轮询间隔（秒） | `5` |

环境变量通过 `.env.*` 文件按 Vite 模式加载，`process.env` 优先级高于文件值。

## 部署场景

### 一、本地开发

```sh
yarn install
yarn dev
```

- Vite 模式 `development`，加载 `.env` + `.env.development`
- `VITE_GATEWAY_ENABLED=true`，`VITE_GATEWAY_TARGET=127.0.0.1`，`VITE_GATEWAY_PORT=8000`，`VITE_GATEWAY_PATH=/gateway`
- `vite-plugin-gateway-bridge.js` 在 dev server 挂载 `VITE_GATEWAY_PATH`（默认 `/gateway`），将浏览器 WebSocket 桥接到后端 TCP `127.0.0.1:8000`（4 字节大端长度前缀帧）
- 需要后端网关监听 `127.0.0.1:8000`
- `VITE_PLATFORM_CHECK=false`，便于在非 Windows 环境调试界面

### 二、配合网关部署

```sh
yarn build
```

- Vite 模式 `production`，加载 `.env` + `.env.production`
- `VITE_GATEWAY_ENABLED=true`，前端直连 `ws(s)://<部署域名>${VITE_GATEWAY_PATH}`
- 产物在 `dist/`，需自行部署到服务器
- 部署侧需确保 `VITE_GATEWAY_PATH`（默认 `/gateway`）可达：由网关原生 WebSocket 或独立桥接服务（同 dev bridge 的 WS↔TCP 转发）提供

### 三、GitHub Pages（仅演示）

```sh
yarn workflow
```

- Vite 模式 `workflow`，加载 `.env` + `.env.workflow`
- `VITE_GATEWAY_ENABLED=false`，无认证，登录直接走 `LaunchHelper:` 协议本地启动
- 服务状态圆点不显示、不轮询
- GitHub Actions 自动执行 `yarn workflow` 构建并部署到 Pages（`.github/workflows/deploy.yml`）
- `base` 在 CI 环境自动设为 `/launch-helper/`（检测 `GITHUB_ACTIONS`）

#### 启用步骤

1. 将代码推送到 `main` 分支
2. 进入仓库 **Settings → Pages**，Source 选择 **GitHub Actions**
3. Workflow 自动构建部署，访问 `https://<用户名>.github.io/launch-helper/`

## 技术实现

### 自定义协议启动流程

1. 浏览器通过 `window.location.href = "LaunchHelper:启动参数"` 触发协议
2. Windows 查找注册表中 `HKEY_CLASSES_ROOT\LaunchHelper\shell\open\command` 的命令
3. 执行 cmd 命令，从 URL 中剥离协议前缀，以正确的**工作目录**启动游戏 exe

### 注册表命令

生成的注册表命令使用 PowerShell 启动游戏：

```powershell
powershell -NoProfile -WindowStyle Hidden -Command "$u='%1';$p=$u.Substring($u.IndexOf(':')+1);Start-Process -FilePath '游戏.exe' -ArgumentList $p -WorkingDirectory '游戏目录'"
```

- `-NoProfile` 跳过用户配置，确保干净的执行环境
- `-WindowStyle Hidden` 避免闪现 PowerShell 窗口
- `$u.Substring($u.IndexOf(':')+1)` 按第一个 `:` 剥离协议前缀，精确无误
- `Start-Process -WorkingDirectory` 设置工作目录为游戏所在目录，确保游戏能找到自身资源文件
- `Start-Process -ArgumentList` 将参数作为数据传递给目标进程，规避 `&` `%` `^` 等 cmd 元字符的注入风险

### 协议 URL 格式

使用 `LaunchHelper:参数`（不带 `//`），避免 Windows 对 URL 规范化时在路径中插入多余的 `/`。

### 网关协议

前端通过 WebSocket 连接 `ws(s)://<host>${VITE_GATEWAY_PATH}`（默认 `/gateway`），使用 Protobuf 二进制帧通信：

```
Request  { command, timestamp, auth_key, body, sequence }
Response { success, code, message, body, sequence }
```

| 命令 | 值 | 说明 |
|---|---|---|
| `CMD_HEALTH` | 1 | 健康检查，返回 `HealthResponse { status, service, channel_port, game_port }` |
| `CMD_REGISTER` | 2 | 注册账号 |
| `CMD_LOGIN` | 3 | 登录，返回 `launch_args` |
| `CMD_CHANGE_PASSWORD` | 4 | 修改密码 |
| `CMD_ACCOUNT_RESET` | 6 | 管理接口：强制重置密码 |
| `CMD_SEND_ITEMS` | 7 | 管理接口：系统邮件投递物品 / 装备 / 时装 / 宠物 |
| `CMD_GET_ROLES` | 8 | 管理接口：查询账号角色二维数据 |

每个请求携带递增 `sequence`，响应按 `sequence` 匹配回调；单请求超时 15s。

**开发桥接**：`vite-plugin-gateway-bridge.js` 仅在 dev server 运行，将 `VITE_GATEWAY_PATH`（默认 `/gateway`）的 WebSocket 数据以 4 字节大端长度前缀帧转发到 TCP 目标，使浏览器能直连仅支持 TCP 的后端网关。

### 物品发放规则

通过 `CMD_SEND_ITEMS`（管理接口，需管理密钥）以系统邮件投递物品，每个附件为一条 `MailAttachment`。以下规则与游戏服务端（GMTool / 网关）的最终行为保持一致：

**背包类型（`item_type`）与物品种类（`kind`）**

| 背包类型 | `item_type` | 允许的 `kind` | 领取落库列表 |
|---|---|---|---|
| 主背包 | 0 | 1 装备 / 2 消耗品 / 3 材料 | 主背包（Main=0） |
| 时装 | 1 | 8 时装 | 时装列表（Avatar=1） |
| 宠物 | 3 | 5 宠物本体 / 6 宠物装备 / 7 宠物消耗品 | 宠物列表（Pet=7） |

- 服务端映射：`item_type` 0→主背包、1→时装、3|7→宠物，其余取值非法（返回 `code=1014`）。
- **`kind` 必须与物品 ID 的实际类型一致**：网关按 `kind` 直接编码 82B `item_core`（无 PVF 兜底解析），服务端领取时按 82B 的 kind 字节决定落库列表（8→时装列表、5/6/7→宠物列表），不一致会被网关拒绝（`code=1014`）或落入错误背包。物品 ID 的实际类型按 PVF 元数据判定：路径含 `/avatar/`→时装、装备类型 `[creature]`→宠物本体、`artifact`→宠物装备、堆叠 `[creature]`/`[feed]`→宠物消耗品。

**数量（`count`）**

- 装备 / 时装 / 宠物本体 / 宠物装备为不可堆叠物品，数量强制为 1（服务端 `NormalizeInsertCount` 对不可堆叠物品恒返回 1）。
- 堆叠物品（消耗品 / 材料 / 宠物消耗品等）单个附件数量上限统一为固定参数 `STACKABLE_COUNT_LIMIT`。

**限时天数（`expire_days` → `expire_time`）**

- 0=永久（默认）。
- >0 时前端换算为 Unix 秒：`expire_time = now + 天数 × 86400`。
- 服务端写入 `item_core.ExpireTime`，领取时转为时装 / 宠物 detail 的到期时间；仅对限时装备 / 时装 / 宠物有意义。

**宠物序列号（`pet_serial_or_handle`）**

- 系统邮件发放恒为 0：服务端领取时会将宠物 UID 清零并重新分配，该字段仅作存档展示，不参与实际发放。

**幂等键（`idempotency_key`）**

- 可选：非空时相同键的重试不重复投递（多封时网关按 `键#序号` 派生独立键，整单可安全重试）。

**校验**

- 前端在发放前校验：附件不能为空、每个附件需填写物品 ID 并选择种类；不可堆叠物品（装备 / 时装 / 宠物本体 / 宠物装备）数量必须为 1，堆叠物品单附件数量 ≤ `STACKABLE_COUNT_LIMIT`。
- 网关强制校验：`kind` 必填（1-11，`0` 非法）、`item_type` 取值必须为 0/1/3/7 且与 `kind` 匹配，违例均返回 `code=1014`。
- 服务端按 10 条附件/封上限自动拆分多封邮件，装备附件的强化 / 增幅 / 锻造属性仅对 `kind=1` 生效。

### 服务状态探测

网关启用时，`GameLauncher.vue` 挂载后每 `VITE_HEALTH_INTERVAL` 秒发送一次 `CMD_HEALTH`：

- `data.success && data.status === "ok"` → 绿色「服务在线」（脉冲动画）
- 否则 → 红色「服务离线」
- 请求进行中 → 灰色「检测中」（闪烁）

组件卸载时清除定时器。

### 数据持久化

使用 Pinia + `pinia-plugin-persistedstate`，将以下状态写入 `localStorage`（key：`launch-helper:game`）：

- `gamePath` 游戏路径
- `launchParam` 启动参数
- `account` 账号
- `password` 密码

### PVF 文件编辑器（TODO）

纯前端解析 PVF 归档格式（移植自 C# PvfLib），支持解密、解码、编辑、重新打包，无需后端。

- **解析**：读取 PVF 文件头、分块表、文件表，按 key 解密还原原始数据
- **文件树**：层级树 + 搜索过滤 + 虚拟滚动，支持展开 / 折叠
- **语法高亮**：highlight.js 自定义 PVF 语言，块标签 `[tag]...[/tag]` 代码折叠、标签悬停提示
- **多编码**：UTF-8 / GBK / Big5 / EUC-KR，自动检测归档编码，可手动切换
- **十六进制视图**：二进制文件以 hex 查看
- **语法校验**：脚本文件保存前校验，错误阻断保存
- **大文件全量浏览**：超过 50 万字符的文件进入只读分支，虚拟滚动（固定行高 + 缓冲行）渲染数万行不掉帧，行号固定列、横向滚动跟随
- **内容搜索**：全量视图内置搜索，大小写不敏感匹配原始行；未命中时通过字符串表将 `name_数字` 映射为中文名称后再匹配（如搜「金锭」命中 `name_97`），支持上 / 下一个跳转、行内 `<mark>` 高亮
- **重新打包**：暂存修改 / 删除 / 重命名后重新加密压缩，导出新 PVF 文件
- **解析性能**：字符串表 offset→value 缓存 + 文本解码器复用，文件表数百万次 `resolveString` 全 O(1) 查表（百万次约 4ms）；标签按 token 流偏移定向扫描、按 chunk 批量解压（每 chunk 仅解压一次）；文件树增量缓存，删除 / 重命名外零重建，50 万文件大档案秒级加载

### 物品编码查看

独立于编辑器的只读工具，复用 `PvfArchive` 解析能力：

- **自动定位**：打开 `Script.pvf` 后自动检索 `stackable/stackable.lst`、`equipment/equipment.lst`、`creature/creature.lst`（忽略大小写），对应「物品 / 装备 / 宠物」三类
- **名称映射**：逐行解析编码 / 引用路径，配合字符串表将 `name_数字` 映射为中文物品名
- **品质与使用等级**：按 `[rarity]` / `[minimum level]` 标签从 token 流定向提取，品质色依客户端串表着色（普通 ~ 传说）
- **虚拟滚动表格**：物品 ID / 类型 / 名称 / 品质 / 使用等级 / 引用路径六列，数万行仅渲染可视区域
- **搜索过滤**：单输入框按 ID / 类型 / 名称 / 路径实时过滤，带清除按钮
- **格式识别**：顶部徽章区分「JPAG」（`0x55 XOR` 头）与「JP」，以及「PROTECTED」（新版 `protected_nkpi`，CN / US）

## 项目结构

```
src/
├── App.vue                       # 根组件，全局样式、平台检测
├── main.js                       # 应用入口，注册 Pinia 持久化插件
├── router/index.js               # 路由配置
├── env.d.ts                      # Vite 环境变量类型声明
├── components/
│   ├── GameLauncher.vue          # 启动器主界面（登录、配置、注册表、状态探测）
│   ├── PvfEditor.vue             # PVF 文件编辑器（解析、编辑、重打包）
│   ├── ItemCodeViewer.vue        # 物品编码查看页（stackable/equipment/creature.lst、品质/等级、虚拟滚动、搜索）
│   ├── MaterialTextField.vue     # Material 风格输入框
│   └── ModalHost.vue             # 全局弹窗挂载点
├── hooks/
│   └── useModal.js               # 弹窗调用 hook（alertModal / openModal）
├── stores/
│   └── game.js                   # 游戏状态（路径、参数、账号、密码、注册表生成）
└── utils/
    ├── gateway.js                # WebSocket + Protobuf 网关客户端
    ├── gateway.proto             # Protobuf 协议定义
    ├── pvfTool.js                # PVF 归档库（解析、解密、编辑、重打包）
    ├── pvfHighlight.js           # PVF 语法高亮语言定义（highlight.js）
    ├── pvfTags.js                # PVF 标签元数据与提示
    ├── pvfValidator.js           # PVF 脚本语法校验
    ├── encoding.js               # 文本编解码（UTF-8 / GBK / Big5 / EUC-KR）
    └── registry.js               # 注册表与 PowerShell 命令生成
vite-plugin-gateway-bridge.js     # dev server WS↔TCP 桥接插件
```

## 构建命令

| 命令 | 模式 | 网关 | 用途 |
|---|---|---|---|
| `yarn dev` | development | 桥接 `127.0.0.1:8000` | 本地开发 |
| `yarn build` | production | 直连 `VITE_GATEWAY_PATH` | 配合网关部署 |
| `yarn workflow` | workflow | 关闭 | GitHub Pages 部署 |

## 浏览器支持

推荐使用 Chromium 内核浏览器（Chrome、Edge、Brave 等）。
