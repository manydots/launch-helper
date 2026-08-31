# LaunchHelper

通过浏览器自定义协议（`LaunchHelper:`）启动 Windows 游戏，可选集成网关认证。

[LaunchHelper 演示地址](https://manydots.github.io/launch-helper/)

## 功能特性

### 游戏启动

- 自定义协议启动 Windows 游戏，无需手动执行命令；注册表一键生成 / 卸载，非 Windows 环境自动提示
- 账号、密码、游戏路径、管理密钥本地持久化（localStorage）
- 网关启用时登录鉴权返回 `launch_args` 自动填入启动参数，服务状态实时探测（在线 / 离线 / 检测中）

### Stackable 物品编码

- 打开 `.pvf` 自动定位解析 `stackable/stackable.lst` 与 `equipment/equipment.lst`，虚拟滚动表格展示物品 ID / 类型徽标 / 名称 / 品质 / 使用等级 / 引用路径
- 物品名称经字符串表映射为中文，品质（普通 ~ 传说七档）依客户端串表着色
- 多维筛选：类型 / 分类级联（装备 · 宠物 · 装扮侧栏分组，堆叠物背包七段）、品质细分（传承 / 领主神器 / 魔法封印）、期限、使用等级区间；单框搜索按物品 ID（精确）/ 名称 / 引用路径实时过滤
- JP / JPAG（`0x55 XOR`）/ CN、US（protected_nkpi）/ TW 四种包头格式打开时自动识别；TW 走独立解析层，名称读自 `stringtable.bin`

### PVF 编辑

- 解密解析 `Script.pvf`：文件树浏览 / 搜索（增量缓存），脚本语法高亮、标签折叠与悬停提示，UTF-8 / GBK / Big5 / EUC-KR 多编码切换，二进制 hex 查看
- 脚本可直接编辑，保存前语法校验阻断错误；文件支持重命名 / 删除 / 导入替换 / 导出原始字节，`Ctrl+S` 暂存、「导出 PVF」重新加密打包下载
- 超大文件先只读预览前 2,000 行，一键进入虚拟滚动全量视图；内容搜索大小写不敏感，未命中时将 `name_数字` 经字符串表映射为中文再匹配，逐条跳转并高亮
- TW 独立解析层：无魔数密钥流协议，`stringtable.bin` 串表编辑回写还原字节，`n_string.lst` 引用关联展示文本，`key>text` 三色渲染，`.ani` 动画与 UTF-16LE `.lua` 源码解析

### NPK 预览

- 打开客户端 `ImagePacks2` 的 `.NPK` 归档，解密条目名并虚拟滚动浏览全部条目
- 点击条目预览 IMG 帧：自动解码为 PNG（ARGB1555 / ARGB4444 / ARGB8888，zlib 解压），多帧条目可切换帧号，显示帧尺寸与像素格式
- 加解密算法顶栏下拉选择（当前为 JP，XOR 名称解密），切换后自动重新解析，便于扩展其它客户端类型

### 注册账号

- 网关注册（`CMD_REGISTER`）：账号 3-20 位字母数字，密码 6-32 位并二次确认
- 注册成功账号自动回填登录表；网关未启用时提示前往官网办理

### 修改密码

- 网关修改密码（`CMD_CHANGE_PASSWORD`）：需验证旧密码，新密码 6-32 位、不得与旧密码相同并二次确认

### 重置密码

- 管理接口强制重置（`CMD_ACCOUNT_RESET`）：无需旧密码，凭账号 + 管理密钥直接设定新密码
- 管理密钥成功使用一次后缓存到本地，进入相关页面自动填充，可一键清除

### 物品发放

- 系统邮件投递（`CMD_SEND_ITEMS`）：主背包 / 时装 / 宠物三类附件，支持装备、消耗品、材料、时装、宠物系、时装徽章、副职业材料、公会勋章、守护珠
- 按账号查询角色下拉选择收件人（`CMD_GET_ROLES`），支持一键清空角色邮箱（`CMD_CLEAR_MAILBOX`）
- 数量与拆分：不可堆叠物品数量恒为 1，堆叠类由网关按单附件 2,000、单封 10 件自动拆分为多封；时限天数档位换算 `expire_time`
- 修改离线角色（`CMD_UPDATE_ROLE`）：改名 / 设定等级 / 调整转职觉醒分支，觉醒档位带参考等级门槛防误操作

## 使用方式

### 启动游戏

1. 首次使用填写游戏 exe 完整路径与启动参数，点击「生成注册表」并运行下载的 `.reg` 文件，注册 `LaunchHelper:` 协议；「卸载注册表」可移除该协议
2. 点击「登录并启动」，通过自定义协议拉起游戏；网关启用时登录成功后返回的 `launch_args` 自动填入启动参数

> 游戏路径、账号等首次输入后自动保存到本地，下次打开无需重新填写。

### PVF 编辑

1. 启动页右上角「PVF 编辑」进入，打开 `.pvf` 文件（如 `Script.pvf`）自动解密解析并生成文件树
2. 文件树浏览 / 搜索，脚本文件支持语法高亮、代码折叠与直接编辑，右键文件可重命名 / 删除 / 导入替换 / 导出原始字节
3. `Ctrl+S` 暂存当前文件修改，「导出 PVF」重新打包下载；离开编辑器时若有未保存修改会提示确认

> 打开时自动探测四种 PVF 包头格式——JP / JPAG（`0x55 XOR`）/ CN·US（protected_nkpi）/ TW，无需手动选择。

### 物品编码

1. 启动页右上角入口进入，打开 `.pvf` 后自动解析 Stackable / Equipment 两张物品清单
2. 顶部搜索框与筛选条件定位物品，包头格式在页首自动识别标注

### NPK 预览

1. 启动页右上角「NPK 预览」进入，选择 `.NPK` 文件（如 `sprite_common_etc.NPK`）自动解密条目名
2. 左侧条目列表虚拟滚动浏览全部条目，搜索框按路径过滤
3. 点击条目右侧预览 IMG 首帧，多帧条目可切换帧号；帧尺寸与像素格式显示在顶部

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

## 部署

| 命令 | 模式 | 网关 | 用途 |
|---|---|---|---|
| `yarn dev` | development | 桥接 `127.0.0.1:8000` | 本地开发 |
| `yarn build` | production | 直连 `VITE_GATEWAY_PATH` | 配合网关部署 |
| `yarn workflow` | workflow | 关闭认证 | GitHub Pages |

- **本地开发**：dev server 通过 `vite-plugin-gateway-bridge.js` 把 `/gateway` 的 WebSocket 以 4 字节大端长度前缀帧桥接到 TCP `127.0.0.1:8000`，需本机运行网关；`VITE_PLATFORM_CHECK=false` 便于非 Windows 调试界面。
- **配合网关部署**：产物在 `dist/`，前端直连 `ws(s)://<域名>/gateway`，部署侧需保证该路径可达（网关原生 WebSocket 或独立 WS↔TCP 桥接服务）。
- **GitHub Pages**：关闭网关认证，推送到 `main` 后 Actions 自动构建部署；Pages 来源选 GitHub Actions，访问 `https://<用户名>.github.io/launch-helper/`。

## 技术实现

### 自定义协议启动

浏览器跳转 `LaunchHelper:<参数>`（不带 `//`，避免 Windows URL 规范化在路径插入多余 `/`）触发协议，Windows 执行注册表项 `HKEY_CLASSES_ROOT\LaunchHelper\shell\open\command` 的命令，剥离协议前缀并以正确的工作目录启动游戏 exe。注册表命令经 PowerShell 隐藏窗口启动：

```powershell
powershell -NoProfile -WindowStyle Hidden -Command "$u='%1';$p=$u.Substring($u.IndexOf(':')+1);Start-Process -FilePath '游戏.exe' -ArgumentList $p -WorkingDirectory '游戏目录'"
```

- `-WorkingDirectory` 设为游戏所在目录，确保游戏能找到自身资源文件
- 参数经 `-ArgumentList` 作数据传递，规避 `&` `%` `^` 等 cmd 元字符的注入风险

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
| `CMD_ACCOUNT_INFO` | 5 | 查询账号信息（各代币 / 方块数量、注册与最近登录） |
| `CMD_ACCOUNT_RESET` | 6 | 管理接口：无需旧密码强制重置密码 |
| `CMD_SEND_ITEMS` | 7 | 管理接口：系统邮件投递物品 / 装备 / 时装 / 宠物 |
| `CMD_GET_ROLES` | 8 | 管理接口：查询账号角色二维数据（树） |
| `CMD_CLEAR_MAILBOX` | 9 | 管理接口：清空角色邮箱（软删除打标，不要求先领附件） |
| `CMD_UPDATE_ROLE` | 10 | 管理接口：修改离线角色基础数据（改名 / 设等级 / 转职觉醒） |

每个请求携带递增 `sequence`，响应按 `sequence` 匹配回调；单请求超时 15s。

**开发桥接**：`vite-plugin-gateway-bridge.js` 仅在 dev server 运行，将 `VITE_GATEWAY_PATH`（默认 `/gateway`）的 WebSocket 数据以 4 字节大端长度前缀帧转发到 TCP 目标，使浏览器能直连仅支持 TCP 的后端网关。

### 物品发放规则

通过 `CMD_SEND_ITEMS`（管理接口，需管理密钥）以系统邮件投递物品，每个附件为一条 `MailAttachment`。规则与游戏服务端（GMTool / 网关）最终行为保持一致：

| 背包类型 | `item_type` | 允许的 `kind` | 领取落库 |
|---|---|---|---|
| 主背包 | 0 或 2 | 1 装备 / 2 消耗品 / 3 材料 / 4 任务品 / 9 时装徽章 / 10 副职业材料 / 12 公会勋章 / 13 守护珠 | 主背包 |
| 时装 | 1 | 8 时装 | 时装列表 |
| 宠物 | 3 或 7 | 5 宠物本体 / 6 宠物装备 / 7 宠物消耗品 | 宠物列表 |

- `kind` 必须与物品 ID 的实际类型一致（按 PVF 元数据判定：路径含 `/avatar/`→时装、装备 `[creature]`→宠物本体、`artifact`→宠物装备、堆叠 `[creature]`/`[feed]`→宠物消耗品），网关按 `kind` 直接编码 BLOB，不一致返回 `code=1014` 或落入错误背包。
- 拒收种类：11 特殊材料、14 史诗碎片（账号级通道不能作邮件附件）。
- 数量：不可堆叠物品恒为 1；堆叠物单附件上限 `STACKABLE_COUNT_LIMIT`，服务端超 2000 自动按 2000 拆分，10 条附件/封自动拆多封（标题正文相同）。
- 限时天数 0=永久；>0 前端换算 `expire_time = now + 天数×86400` 编入 BLOB，仅对装备 / 时装 / 宠物有意义（前端仅对时装与宠物本体开放输入）。
- 邮件标题可留空，收件箱回退显示正文；发件人固定显示 "GM"。可选幂等键保证整单重试不重复投递。

### 服务状态探测与持久化

- 网关启用时启动页每 `VITE_HEALTH_INTERVAL` 秒轮询一次 `CMD_HEALTH`：成功且 `status=ok` 显示绿色「服务在线」，否则红色「离线」，请求中灰色「检测中」。
- Pinia + `pinia-plugin-persistedstate` 将游戏路径、账号、密码、网关状态、管理密钥持久化到 localStorage（key：`launch-helper:game`）。

### PVF 编辑器

纯前端解析 PVF 归档格式（移植自 C# PvfLib），无需后端：读文件头、分块表、文件表按 key 解密还原数据，编辑后重新加密打包导出。实现要点：

- **解析性能**：字符串表 offset→value 缓存 + 文本解码器复用，文件表数百万次 `resolveString` 全 O(1) 查表；标签按 token 流偏移定向扫描、按 chunk 批量解压；文件树增量缓存，删除 / 重命名外零重建，50 万文件大档案秒级加载
- **语法高亮**：highlight.js 自定义 PVF 语言，块标签代码折叠、标签悬停提示；脚本保存前经 `pvfValidator.js` 校验，错误阻断
- **底层库分层**：`pvfTool.js` 的 `PvfArchive` 覆盖 JP / JPAG / CN·US 格式，繁体 TW 无魔数双密钥流协议由 `pvfToolTw.js` 的 `TwPvfArchive` 独立实现（表头 key 流首 4 字节 `0x81A79011`，文件树与数据区独立加密，Big5 解码无修改保存字节一致）；加解密、压缩与二进制读写进一步下沉到 `pvfCodec.js`
- **TW 内容渲染**：`.str` / `.bin` 统一 `key>text` 三色渲染（`//` 注释整行灰），`n_string.lst` 引用关联展示文本，点击引用路径小写不敏感命中跳转；`.ani` 解析帧与图像路径，UTF-16LE `.lua` 自动检测解码

### 物品编码查看

独立于编辑器的只读工具，复用 `PvfArchive` / `TwPvfArchive` 解析能力：

- **自动定位**：打开 `Script.pvf` 后忽略大小写检索 `stackable/stackable.lst` 与 `equipment/equipment.lst`
- **名称与品质**：逐行解析编码 / 引用路径，`name_数字` 经字符串表映射为中文（TW 从 `stringtable.bin` 读 Big5）；品质细分（传承 / 领主神器 / 魔法封印）与期限分类从 token 流定向提取
- **筛选维度**：装备 / 宠物 / 装扮侧栏分组与堆叠物背包七段级联过滤（对齐权威 GM 工具分组），加品质、期限、等级区间与单框搜索；虚拟滚动表格仅渲染可视区域

### NPK 素材预览

纯前端只读解析客户端 `ImagePacks2` 的 NPK 归档（`src/utils/npkTool.js`，移植自权威 GM 工具 ImagePack 模块，零第三方依赖）：

- **加解密注册表**：`NPK_FORMATS` 以 `{ id, label, magic, parse }` 组织，当前实现 JP（魔数 `NeoplePack_Bill`、条目名 256 字节 XOR——前缀 `puchikon@neople dungeon and fighter ` + 循环填充 `DNF`）；扩展其它客户端类型时在注册表追加即可，界面顶栏下拉自动跟随
- **IMG 帧解码**：version 2，像素格式 ARGB1555 / ARGB4444 / ARGB8888，zlib 压缩（浏览器原生 `DecompressionStream`）；链接帧（0x11）静态预览跳过，带偏移画布的帧按 alpha 混合 Blit
- **PNG 编码**：手写 IHDR / IDAT / IEND + CRC32，解码帧直接输出 PNG 供 `<img>` 预览

## 项目结构

```
src/
├── App.vue                       # 根组件，全局样式、平台检测
├── main.js                       # 应用入口，注册 Pinia 持久化插件
├── router/index.js               # 路由配置（hash 模式）
├── components/
│   ├── GameLauncher.vue          # 启动器主界面（登录注册改密、协议启动、状态探测）
│   ├── PvfEditor.vue             # PVF 编辑器（解析、编辑、重打包，TW 渲染、虚拟滚动）
│   ├── ItemCodeView.vue          # 物品编码查看页（双清单、多维筛选、虚拟滚动）
│   ├── NpkViewer.vue             # NPK 素材预览页（条目列表、IMG 帧解码预览）
│   ├── SendItemView.vue          # 物品发放页（查角色、发邮件、改角色、清邮箱）
│   ├── MaterialTextField.vue     # Material 风格输入框
│   └── ModalHost.vue             # 全局弹窗挂载点
├── hooks/useModal.js             # 弹窗调用（alertModal / confirmModal / openModal）
├── stores/game.js                # 游戏状态（路径、账号、密码、管理密钥、注册表生成）
├── styles/element-plus-dark.css  # Element Plus 弹层深色主题
└── utils/
    ├── gateway.js                # WebSocket + Protobuf 网关客户端
    ├── gateway.proto             # Protobuf 协议定义
    ├── pvfCodec.js               # PVF 底层加解密、压缩、二进制读写
    ├── pvfTool.js                # PVF 归档库 JP/JPAG/CN·US（解析、编辑、重打包）
    ├── pvfToolTw.js              # 繁体 TW 独立解析层（stringtable.bin / strlst / .ani）
    ├── jobGrowNames.js           # 职业转职觉醒枚举常量（86JPL 快照固化）
    ├── pvfHighlight.js           # PVF 语法高亮语言定义（highlight.js）
    ├── pvfTags.js                # PVF 标签元数据与提示
    ├── pvfValidator.js           # PVF 脚本语法校验
    ├── encoding.js               # 文本编解码（UTF-8 / GBK / Big5 / EUC-KR）
    ├── gbkEncoder.js             # GBK 编码映射生成
    ├── big5Encoder.js            # Big5 文本编码（TW 解码支持）
    ├── npkTool.js                # NPK 归档只读解析（加解密注册表、IMG 帧解码、PNG 编码）
    └── registry.js               # 注册表与 PowerShell 命令生成
vite-plugin-gateway-bridge.js     # dev server WS↔TCP 桥接插件
```

## 浏览器支持

推荐 Chromium 内核浏览器（Chrome、Edge、Brave 等），旧版浏览器由 @vitejs/plugin-legacy 自动注入 polyfill。
