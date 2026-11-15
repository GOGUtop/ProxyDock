# ProxyDock Plus v2.0.0 — SillyTavern 订阅代理管理器

**目标：** 在 SillyTavern 酒馆网页内完成 Clash/Mihomo **YAML 订阅添加、更新、切换代理组和节点、延迟测试、代理模式切换，以及服务器端 Mihomo 代理核心启停**。本项目不是 Clash Verge Rev 的桌面程序，也没有复制 Clash Verge 的源码、界面或商标。

> 重要：不是一套“复制进酒馆就包含完整 Clash Verge”的程序。ProxyDock Plus 是使用 **已有 Mihomo 可执行程序** 的酒馆管理面板。Mihomo 本身为单独的软件，应从 [MetaCubeX/mihomo 官方 Releases](https://github.com/MetaCubeX/mihomo/releases) 安装。项目没有捆绑、自动下载或重新分发 Mihomo 可执行文件。Mihomo 的许可与本项目独立。

## 功能和限制

| 功能 | 当前状态 |
| --- | --- |
| 从 GitHub 安装酒馆 UI 扩展与服务端插件 | ✅ 同仓库分别安装 |
| Clash/Mihomo YAML 订阅链接导入 | ✅ 仅 `https://` 公网地址 |
| 多订阅保存、刷新、切换、删除 | ✅ 手动刷新 |
| 本机 Mihomo 核心检测、启动、停止 | ✅ 需要预先安装 Mihomo 可执行程序 |
| 代理分组、节点选择、延迟测试 | ✅ 通过 Mihomo External Controller |
| 规则 / 全局 / 直连 | ✅ 核心运行时切换 |
| HTTP/SOCKS 自定义上游代理配置 | ✅ 保留 v1 功能 |
| 让酒馆 Node.js 代理请求 | ✅ http/https global Agent、环境变量等部分网络路径 |
| 自动转换 Base64 节点、VLESS/VMess/SS 链接 | ❌ 不支持，需要服务商提供 Clash YAML 配置 |
| 系统 TUN、桌面托盘、GUI、全局 VPN | ❌ 不支持 |
| 强制代理所有 Node fetch/Undici 与浏览器流量 | ❌ 不保证 |

## 适用环境

- SillyTavern 1.19.0 或兼容版本（使用其自带 `express`、`proxy-agent`、`yaml` 包）
- Node.js 20+（建议使用酒馆对应推荐版本）
- Linux 服务器（例如宝塔面板的 `/home/www/SillyTavern2`）
- 具有合法使用权限的 Clash/Mihomo YAML 配置订阅地址
- `mihomo` 核心可执行文件（需要**用户另外安装**），且必须在和 SillyTavern **同一台服务器/同一容器** 内可用

## 通过同一个 GitHub 仓库安装（你的仓库：GOGUtop/ProxyDock）

已经装过 v1 的用户：**不用删除旧插件目录、也不要删除 `state.json` 或 `auth-token.txt`**。将本 ZIP 解压后的文件内容上传并覆盖 GitHub 仓库根目录；先备份本机 v1 配置，再更新。

前端和后端都安装过 GitHub 版本的情况下：

1. GitHub 仓库 `https://github.com/GOGUtop/ProxyDock` 上传**解压后的各个文件**，不是上传 ZIP 本身。
2. SillyTavern 扩展管理 → 更新 ProxyDock 前端扩展。
3. 关闭酒馆。在酒馆安装根目录运行：

   ```bash
   cd /home/www/SillyTavern2
   node plugins.js update
   ```

   或进入 `plugins/ProxyDock` 执行 `git pull` （前提是通过 git 安装且没有未提交的本地改动）。
4. **重启 SillyTavern**，浏览器强制刷新，打开 `🌐 ProxyDock`。
5. 管理员令牌路径不变：`/home/www/SillyTavern2/plugins/ProxyDock/auth-token.txt`。此令牌非常敏感，不要上传 GitHub，也不要发到聊天。
6. `config.yaml` 中必须有：

   ```yaml
   enableServerPlugins: true
   ```

如尚未安装：酒馆根目录执行 `node plugins.js install https://github.com/GOGUtop/ProxyDock` 安装服务端；然后在酒馆的扩展安装器使用同一个 URL 安装前端扩展。

## 先安装官方 Mihomo 核心（在运行酒馆的 Linux 服务器上）

首先登录宝塔终端，执行：

```bash
uname -m
command -v mihomo || true
mihomo -v
```

如果 `mihomo` 不存在：打开官方地址 [github.com/MetaCubeX/mihomo/releases](https://github.com/MetaCubeX/mihomo/releases)，按服务器 CPU 架构下载对应的 Linux 可执行文件（例如 Linux amd64 对应 `x86_64`，Linux arm64 对应 `aarch64`），**核验官方发布来源及校验信息**，解压后放置到 `/usr/local/bin/mihomo`，赋予可执行权限。因发行版、架构和版本变化，不提供未经验证的固定安装脚本。常见命令：

```bash
sudo install -m 0755 /path/to/已解压的-mihomo /usr/local/bin/mihomo
/usr/local/bin/mihomo -v
```

> 核心不是在 Windows/手机浏览器上运行，而是在**酒馆服务端**运行；`127.0.0.1` 是服务器本机。Docker 酒馆则需要在 Docker 容器中或可访问的服务端环境中配置。

## 酒馆中使用订阅

1. 打开 `🌐 ProxyDock Plus`，输入之前生成的 64 位管理员令牌，点击连接。
2. 在「订阅管理」填写**订阅名称**和 **Clash/Mihomo YAML HTTPS 订阅链接**，点击「导入订阅」。不会在网页显示订阅 URL 里的 token。订阅信息和原始 YAML 只保存在插件的服务器本地 `state.json` 与 `runtime/` 下（Git 忽略这些文件）。
3. 在「内置 Mihomo 核心」把程序路径设为 `mihomo` 或 `/usr/local/bin/mihomo`，点击「检测核心」，然后点击「启动核心」。默认**不会自动把全部酒馆请求改走代理**。
4. 点击「读取节点列表」获取代理分组，选择分组和节点，点击「切换节点」。也可以测试节点延迟。
5. 根据需要选择「规则」「全局」「直连」；注意选择全局模式时通常还需在核心 `GLOBAL` 策略组中选择相应的节点。
6. 需要让酒馆可覆盖的 HTTP/HTTPS 请求通过该核心时，点击「设为酒馆代理并开启」，或在下方代理配置中选择 `内置 Mihomo（ProxyDock）` 并启用；然后点击「测试代理 / 出口 IP」验证。
7. 更换订阅或刷新当前订阅时会**重启正在运行的 Mihomo**，可能中断正在进行的生成任务。请不要在响应生成期间操作。

### 代理是否覆盖所有酒馆流量？

**不保证。** 本版沿用 v1 的 Node.js `http`/`https` global Agent 和代理环境变量机制。直接使用 `fetch`/Undici、自定义 HTTP Agent、WebSocket 的独立实现及浏览器发出的请求可能不受此设置影响。强制所有酒馆请求通过 Mihomo 的更稳健做法是将酒馆配置文件中的 `requestProxy` 配置为运行在同机的 Mihomo 混合端口，并**重启酒馆**（这是独立于插件的酒馆官方机制）：

```yaml
requestProxy:
  enabled: true
  url: http://127.0.0.1:17890
  bypass:
    - localhost
    - 127.0.0.1
```

若插件启动后未自动启动 Mihomo、或端口未监听，启用上面配置可能导致酒馆启动后的外部请求失败，因此**请先在酒馆界面成功启动并测试 Mihomo 再调整**，并注意实际 `fetch` 覆盖范围也应单独验证。

## 默认端口与安全边界

- 内置 Mihomo 混合代理：`127.0.0.1:17890`
- 内置 Mihomo 控制器：`127.0.0.1:19097`，使用由插件随机生成的独立密钥
- 外部已有 Mihomo 控制器（v1 功能）：默认 `127.0.0.1:9097`
- 禁止订阅打开 TUN、局域网监听、额外代理端口、控制器暴露；插件只允许从公网 HTTPS 地址获取订阅，并对 DNS 解析结果做私网地址拦截
- 订阅包含敏感节点和认证信息，存储在 `state.json`、`runtime/`；`.gitignore` 阻止常规 Git 提交，**但仍请上传前人工检查，尤其避免从宝塔把运行目录压缩上传到公开仓库**
- 不建议将运行酒馆的 Node.js 进程设为 root；请开启酒馆 CSRF 防护、身份认证和 HTTPS 反向代理，不要直接向公网暴露 8001 或 Mihomo API
- 代码依赖第三方订阅配置；只导入信任的配置。配置中包含额外规则下载/远程提供者等第三方访问行为，尽管本版尝试锁定敏感监听配置，仍不是隔离沙箱。

## 更新状态与验证说明

本压缩包中的代码已通过 Node.js 基础语法检查、功能模拟测试（认证、订阅 URL 验证、生成受限 Mihomo YAML、旧版代理状态），但**未在真实 Linux 服务器上实际运行 Mihomo**，也未用真实机场订阅验证下载、节点连接或 GPT API 请求。上述测试不是联网兼容性保证。

参考文档：
- [Clash Verge Rev 源码及其 GPL-3.0 许可](https://github.com/clash-verge-rev/clash-verge-rev)
- [Mihomo 核心](https://github.com/MetaCubeX/mihomo)
- [SillyTavern Server Plugins](https://docs.sillytavern.app/for-contributors/server-plugins/)
- [SillyTavern requestProxy 配置](https://docs.sillytavern.app/administration/config-yaml/)
