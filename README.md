# ProxyDock — SillyTavern 酒馆代理管理器

**GitHub 可安装版 · v1.0.0**

ProxyDock 是一个用于 SillyTavern 的代理管理工具，包含**网页端扩展和服务端插件**。它提供 HTTP/SOCKS 代理切换、多个配置保存、代理出口 IP 测试，以及连接本机 Mihomo / Clash External Controller 后切换节点。

> ⚠️ 它不是 Clash Verge 的 VPN/TUN 替代品，不包含代理内核、机场订阅解析或系统全局代理。某些 Node.js `fetch`/Undici、浏览器端请求或独立 Agent 不保证经过此代理。使用前需要运行现成代理服务。

## 为什么要安装两次？

官方「从 Git URL 安装扩展」只会安装**浏览器端 UI 扩展**；ProxyDock 还需要**服务器端插件**来控制酒馆 Node.js 出站请求。好处是：两个部分可以放在**一个 GitHub 仓库**，共用一个 Git URL，分别安装，之后通过 Git 更新。

## 安装（同一个 GitHub 地址）

请把下方 `OWNER` 和 `SillyTavern-ProxyDock` 替换为你自己 GitHub 仓库的真实用户名/仓库名（保留仓库主分支中的文件结构）。

### 1. 安装服务端插件

关闭 SillyTavern，打开终端，进入包含 `server.js`、`plugins.js` 的 SillyTavern 安装根目录，执行：

```bash
node plugins.js install https://github.com/OWNER/SillyTavern-ProxyDock
```

**Windows 提示：** 可在酒馆安装目录的文件管理器地址栏输入 `cmd` 打开命令提示符，然后执行上述命令。

打开酒馆根目录 `config.yaml`，确保有：

```yaml
enableServerPlugins: true
enableServerPluginsAutoUpdate: true
```

不需要另行 `npm install`；代码使用 SillyTavern 已安装的 `express` 与 `proxy-agent`。请确认 Node.js 与 SillyTavern 的版本及依赖兼容。

### 2. 用 GitHub 链接安装网页端扩展

启动 SillyTavern → **扩展 / Extensions → 安装扩展 / Install Extension** → 粘贴同一仓库地址：

```
https://github.com/OWNER/SillyTavern-ProxyDock
```

默认分支 `main`；根据需要选择仅为自己安装或所有用户安装。

因为 `manifest.json`、`index.js`、`style.css` 在**仓库根目录**，酒馆可以识别。重启/刷新酒馆页面后，应出现 `🌐 代理` 按钮。

### 3. 首次使用

服务端插件会自动生成令牌文件：

```
SillyTavern/plugins/SillyTavern-ProxyDock/auth-token.txt
```

`SillyTavern-ProxyDock` 为通常按仓库名创建的插件目录，实际以本机 `plugins/` 下的目录为准。将该文件中的 64 位令牌粘贴进 ProxyDock 页面，点击「连接插件」。

添加代理：例如 Clash Verge 和酒馆服务端在同一主机，且 HTTP 混合端口为 `7890`，可填：

```
http://127.0.0.1:7890
```

点击「测试代理 / 出口 IP」，测试成功后再启用。

> Docker / 远程部署：`127.0.0.1` 指向**SillyTavern 服务器所在机器或容器**，不是访问网页的客户端设备。

## 更新

- **网页扩展**：酒馆「扩展 → 管理扩展 → 更新」检查并安装仓库更新。
- **服务端插件**：启动时根据 `enableServerPluginsAutoUpdate: true` 尝试更新；或在酒馆根目录运行 `node plugins.js update` 后重启。检查日志确认更新结果。
- 修改两个部分后，**建议重启酒馆并强制刷新浏览器**。

## 迁移已手动安装的旧版

如果你安装过早期 ZIP，请在**关闭酒馆并备份本地配置**后移除旧的 `plugins/proxy-dock/` 和 `public/scripts/extensions/third-party/proxy-dock/`，再按上述 GitHub 方式安装；不要让两个服务端实例同时加载同一个 `proxy-dock` 路由 ID。旧版 `state.json` 可视需要复制到新插件目录；令牌也可在本机迁移，**不要上传这些文件到 GitHub**。

## GitHub 仓库结构

```text
SillyTavern-ProxyDock/
├── manifest.json    # 酒馆扩展安装器从根目录识别
├── index.js         # 前端扩展
├── style.css        # 前端样式
├── package.json     # 服务器插件入口定义
├── index.cjs        # 服务器端插件
├── .gitignore       # 忽略令牌/配置
├── README.md
├── GITHUB_上传教程.md
└── tests/
    └── check.cjs
```

## 安全、兼容性和范围

- 服务器插件在 SillyTavern Node.js 进程中运行，**没有沙盒**；仅在信任并审阅源码后启用。
- 管理员令牌位于本地 `auth-token.txt`，代理密码等位于本地 `state.json`；仓库 `.gitignore` 已屏蔽它们，但上传前仍需核查。
- Mihomo 控制器只尝试访问服务端本机 `127.0.0.1`，其密钥不会回传给网页。
- 适用范围是 Node.js `http`/`https` 全局 Agent 和部分遵循代理环境变量的库。不是系统全局 VPN 或强制代理所有聊天请求。
- 代码已经进行基础语法与模拟单元测试，**尚未在你的 SillyTavern 环境完成实机端到端验证**。
- 仓库代码当前未附加开源许可证；如打算公开供他人使用/贡献，建议选定并添加合适的许可证。

参考官方文档：[UI 扩展安装](https://docs.sillytavern.app/extensions/) · [服务端插件](https://docs.sillytavern.app/for-contributors/server-plugins/) · [配置文件](https://docs.sillytavern.app/administration/config-yaml/)
