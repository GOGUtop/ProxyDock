# ProxyDock Plus 更新日志

## v2.1.0（2026-11-15）

- 新增 Catbox 图片自动代理：只允许 `files.catbox.moe`、`litter.catbox.moe` 下的 PNG/JPEG/GIF/WebP/AVIF/BMP 文件。
- 新增图片代理开启/关闭、图片下载测试、重新签发并重试聊天图片。
- 新增浏览器动态 `<img>`、`srcset`、普通图片超链接及行内 `background-image` 重写，并支持关闭时恢复原地址。
- 新增临时 HMAC 图片链接、DNS/域名限制、文件头校验、12 MiB 单张上限、并行上限、10 分钟内存缓存。
- 保留 v2.0.1 的 Node.js DNS 订阅下载修复和 v2.0 的 Mihomo 订阅/节点功能。

验证：Node 22 语法检查、旧版回归模拟测试、图片签名/安全/缓存/DOM 转换模拟测试通过。尚未在目标服务器完成真实 Catbox 下载和机场节点联网测试。
