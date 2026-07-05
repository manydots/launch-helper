# LaunchHelper

通过浏览器自定义协议（`LaunchHelper:`）一键启动 Windows 游戏。

## 使用方式

### 首次使用

1. 填写游戏 exe 完整路径（如 `D:\Games\Game.exe`）
2. 填写启动参数（如 `99?127.0.0.1?7001?...`）
3. 点击「生成注册表」，下载 `register-LaunchHelper.reg` 并双击运行
4. 点击「登录并启动」，浏览器拉起游戏

### 卸载协议

点击「卸载注册表」，下载 `uninstall-LaunchHelper.reg` 并运行即可移除自定义协议。

## 技术实现

### 自定义协议启动流程

1. 浏览器通过 `window.location.href = "LaunchHelper:启动参数"` 触发协议
2. Windows 查找注册表中 `HKEY_CLASSES_ROOT\LaunchHelper\shell\open\command` 的命令
3. 执行 cmd 命令，从 URL 中剥离协议前缀，以正确的**工作目录**启动游戏 exe

### 注册表命令

生成的注册表命令使用 `cmd` 延迟变量替换，等价于原 bat 启动方式：

```bat
cmd /v:on /c set "url=%1" & set "p=!url:LaunchHelper:=!" & start "" /d "游戏目录" "游戏.exe" !p!
```

- `/v:on` 启用延迟变量扩展
- `set "p=!url:LaunchHelper:=!"` 大小写不敏感地剥离协议前缀（Windows 会将 scheme 小写化）
- `start /d` 设置工作目录为游戏所在目录，确保游戏能找到自身资源文件

### 协议 URL 格式

使用 `LaunchHelper:参数`（不带 `//`），避免 Windows 对 URL 规范化时在路径中插入多余的 `/`。

## 项目结构

```
src/
├── App.vue                       # 根组件，平台检测
├── main.js                       # 应用入口，注册 Pinia 持久化插件
├── components/
│   ├── GameLauncher.vue          # 启动器主界面
│   └── MaterialTextField.vue     # Material 风格输入框
└── stores/
    └── game.js                   # 游戏状态管理（路径、参数、注册表生成）
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
