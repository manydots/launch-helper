# LaunchHelper

通过浏览器自定义协议（`LaunchHelper:`）一键启动 Windows 游戏。

[LaunchHelper 演示地址](https://manydots.github.io/launch-helper/)

## 功能特性

- 自定义协议一键拉起 Windows 游戏，无需手动开 cmd
- 账号、密码、游戏路径、启动参数本地持久化（localStorage），刷新不丢失
- Material 风格输入框，聚焦时支持一键清空
- 打字机动效副标题、毛玻璃卡片界面
- 注册表一键生成 / 卸载，非 Windows 环境自动提示
- 兼容旧版浏览器（@vitejs/plugin-legacy 自动注入 polyfill）

## 使用方式

### 首次使用

1. 填写游戏 exe 完整路径（如 `D:\Games\Game.exe`）
2. 填写启动参数（如 `99?127.0.0.1?7001?...`）
3. 点击「生成注册表」，下载 `register-LaunchHelper.reg` 并双击运行
4. 点击「登录并启动」，浏览器拉起游戏

> 账号、密码、路径、参数在首次输入后会自动保存到本地，下次打开无需重填。

### 卸载协议

点击「卸载注册表」，下载 `uninstall-LaunchHelper.reg` 并运行即可移除自定义协议。

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
- `Start-Process -ArgumentList` 将参数作为数据传递给目标进程，免疫 `&` `%` `^` 等 cmd 元字符的注入风险

### 协议 URL 格式

使用 `LaunchHelper:参数`（不带 `//`），避免 Windows 对 URL 规范化时在路径中插入多余的 `/`。

### 数据持久化

使用 Pinia + `pinia-plugin-persistedstate`，将以下状态写入 `localStorage`（key：`launch-helper:game`）：

- `gamePath` 游戏路径
- `launchParam` 启动参数
- `account` 账号
- `password` 密码

## 项目结构

```
src/
├── App.vue                       # 根组件，全局样式、平台检测、构建时间展示
├── main.js                       # 应用入口，注册 Pinia 持久化插件
├── components/
│   ├── GameLauncher.vue          # 启动器主界面（登录、配置、注册表、打字机动效）
│   ├── MaterialTextField.vue     # Material 风格输入框（浮动标签、清除按钮、密码切换）
│   └── ModalHost.vue             # 全局弹窗挂载点
├── hooks/
│   └── useModal.js               # 弹窗调用 hook（alertModal / openModal）
├── stores/
│   └── game.js                   # 游戏状态（路径、参数、账号、密码、注册表生成与下载）
└── utils/
    └── registry.js               # 注册表与 PowerShell 命令生成工具
```

## 开发

```sh
yarn install
yarn dev
```

## 构建

```sh
yarn build
```

## 部署

项目已配置 GitHub Actions 自动部署到 GitHub Pages（`.github/workflows/deploy.yml`）。

### 启用步骤

1. 将代码推送到 GitHub 仓库的 `main` 分支
2. 进入仓库 **Settings → Pages**，Source 选择 **GitHub Actions**
3. Workflow 会自动构建并部署，完成后访问 `https://<用户名>.github.io/launch-helper/`

> 本地开发时 `base` 为 `/`，CI 环境自动切换为 `/launch-helper/`，无需手动修改。

## 浏览器支持

推荐使用 Chromium 内核浏览器（Chrome、Edge、Brave 等）。
