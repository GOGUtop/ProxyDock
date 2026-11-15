# GitHub 更新到 ProxyDock Plus v2.0.0（保留原仓库）

目标仓库：`https://github.com/GOGUtop/ProxyDock`

1. 先备份服务器 `plugins/ProxyDock/state.json` 和 `auth-token.txt`，不要上传它们到 GitHub。
2. 将本包**解压**，进入解压后的仓库目录，选择里面全部文件（包含新的 `core-manager.cjs`），通过 GitHub 的 **Add file → Upload files** 上传到原仓库的**根目录**，覆盖同名旧文件（或使用 Git 工具提交）。
3. 检查 GitHub 的根目录有 `manifest.json`、`index.js`、`style.css`、`index.cjs`、`core-manager.cjs`、`package.json`。确保没有 `auth-token.txt`、`state.json`、`runtime/`、机场订阅或其他私钥。
4. 在宝塔里停止酒馆，终端运行：

```bash
cd /home/www/SillyTavern2
node plugins.js update
```

5. 在 SillyTavern 的扩展管理中检查/更新 GitHub 安装的 ProxyDock 前端扩展。
6. 重启 SillyTavern，浏览器强制刷新（Ctrl+F5）。启动日志应该显示 `Initializing plugin from .../plugins/ProxyDock/index.cjs`。
7. 如果看到 `Cannot find module 'yaml'`，说明酒馆的 Node_modules 不完整，需在酒馆根目录按官方方式恢复依赖，而不是把 YAML 源码手动复制进仓库。
8. 依照 README 在服务器安装官方 Mihomo 核心，输入酒馆的管理员令牌，测试导入订阅、核心启动、节点延迟、酒馆出口 IP。

**提醒：** GitHub 更新的是插件代码，**不会替你安装 Mihomo 核心，也不会替你配置机场订阅**。你的旧版 `state.json`、`auth-token.txt` 保留在服务器本地，不应放到公开 GitHub。
