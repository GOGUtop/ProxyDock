# 把 ProxyDock 上传到 GitHub 并用酒馆的 GitHub URL 安装

## 第一步：新建仓库

1. 登录 https://github.com/new
2. Repository name 输入 `SillyTavern-ProxyDock`。
3. 可选 **Public**（便于通过 HTTPS 克隆；任何人均可查看源码）或 **Private**（需要 SillyTavern 所在机器具有 GitHub 访问权限）。
4. 点击 **Create repository**。如果打算通过网页上传，创建时建议先不添加 README / .gitignore，避免后续重复。

## 第二步：上传文件（网页操作）

1. 把下载的 `SillyTavern-ProxyDock-GitHub-ready.zip` **先解压**，不要只上传 ZIP 本身。
2. 进入新仓库，点击 **Add file → Upload files**。
3. 选中解压出来的**文件及 `tests` 文件夹内容**，上传到仓库根目录，不能再多套一层 `SillyTavern-ProxyDock-GitHub/` 目录。
4. 确认仓库首页能直接看到：`manifest.json`、`index.js`、`style.css`、`index.cjs`、`package.json`、`README.md`。
5. 提交改动（Commit changes）。隐藏的 `.gitignore` 若没有上传成功，可单独用 **Add file → Create new file** 新建 `.gitignore` 并复制其内容。
6. 核对仓库里**绝对没有** `state.json`、`auth-token.txt`、包含订阅/账号/密码的配置文件。

> 上传 ZIP 文件本身，或者把所有文件放进仓库 `public/scripts/...` 子目录，都不能让酒馆的 Git URL 安装器正确识别 `manifest.json`。本次发布版已改为仓库根目录结构。

## 第三步：通过 GitHub 安装酒馆插件

把 `OWNER` 换成你的 GitHub 用户名/组织名；仓库名如不同也一起替换。

1. 关闭酒馆，在 **SillyTavern 根目录** 打开终端，执行：

```bash
node plugins.js install https://github.com/OWNER/SillyTavern-ProxyDock
```

2. 在酒馆安装根目录 `config.yaml` 启用 `enableServerPlugins: true`，重启酒馆。
3. 打开酒馆「扩展 → 安装扩展」，粘贴**同一个** `https://github.com/OWNER/SillyTavern-ProxyDock`，安装网页端扩展。
4. 在服务端 `plugins/` 下相应仓库目录里查找 `auth-token.txt` 并用其登录 ProxyDock，添加代理配置。

## 第四步：以 GitHub 为更新源

- 在 GitHub 仓库上传新版本源码并提交。
- 在酒馆里打开「扩展 → 管理扩展」，更新 ProxyDock 浏览器端。
- 后端在酒馆启动时按配置自动更新，或从酒馆根目录执行 `node plugins.js update`，重启以生效。

## 提醒

- **GitHub 仓库地址是插件安装/更新来源，不是代理节点订阅 URL。**
- 只通过酒馆「安装扩展」安装的结果是**仅前端**；不装后端时会提示服务器插件不可用，这是正常的。
- 如果你之前手动安装了早期 ZIP，请先按 `README.md` 的迁移说明清理重复实例。
