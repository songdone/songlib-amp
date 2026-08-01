# 安全边界

## 默认保护

- 首次安装创建主人账号，不提供默认弱密码。
- PBKDF2-SHA256、随机盐和 600,000 次迭代存储密码。
- HttpOnly、SameSite 会话 Cookie；HTTPS 部署可强制 Secure。
- 所有已登录写请求需要双提交 CSRF Token。
- 登录和首装接口按来源地址限速。
- 可选可信 Host 与 Origin 白名单。
- CSP、禁止 iframe、MIME 嗅探保护和最小浏览器权限。
- 容器移除 Linux capabilities、禁止提权、只读根文件系统并使用非 root 用户。
- 下载 URL 和重定向执行 DNS/SSRF 校验；私网 URL 默认拒绝。
- 路径验证拒绝目录穿越，变更进入预览、隔离或回收流程。
- 审计记录自动遮盖 password、secret、token、cookie 和 API key 字段。

## 角色

- `owner`：实例所有者，账号、安全和全部管理能力。
- `admin`：完整管理能力。
- `library_admin`：曲库、任务和素材管理，不管理账号。
- `listener`：浏览、播放、个人歌单和个人画像。

所有者与管理员至少保留一个启用账号。停用或删除最后一个管理账号会被拒绝。

## 密钥

真实 `.env` 必须只存在于 NAS，建议权限 `600`。仓库只包含占位模板。提供方凭据不写入前端，不在 API 中回显；数据库连接表保存 `secret_ref` 而不是明文 Secret。

如果怀疑泄漏：

1. 立即轮换对应 Token 或密码。
2. 轮换 `SESSION_SECRET` 使所有会话失效。
3. 检查审计记录和代理访问日志。
4. 在隔离环境验证备份后再恢复服务。

## 公网暴露

不建议直接暴露应用端口。应使用 HTTPS 反向代理、强认证、来源限制和 NAS 防火墙。SongLib Amp 不替代网络层零信任或 VPN。

安全问题请通过仓库的私密安全报告渠道提交，不要在公开 Issue 中附带 Token、路径或日志原文。
