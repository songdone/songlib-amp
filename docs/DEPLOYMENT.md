# 部署与首次安装

## 1. 部署前检查

- 确认 NAS 架构为 amd64 或 arm64。
- 确认 Docker 与 Compose 可用。
- 为应用选择独立目录、未占用端口和专用数据目录。
- 记录音乐目录和可选 Plex 配置目录的宿主机路径。
- 不要复用另一套 SongLib Amp 的数据卷、容器名或网络名。

## 2. 准备目录与配置

```bash
cp .env.example .env
chmod 600 .env
mkdir -p volumes/data volumes/downloads volumes/music volumes/library volumes/plex-config
```

生成会话密钥：

```bash
openssl rand -hex 32
```

把结果写入 `.env` 的 `SESSION_SECRET`，不要贴到 Issue、聊天记录或普通日志。`MUSIC_DIR` 是音屿自己的可写入库目录；已有媒体库可通过 `READ_ONLY_LIBRARY_DIR` 只读挂载到 `/music/library`，避免修改其他音乐服务正在管理的文件。Plex 未启用时可保留默认只读空目录。

默认容器用户是 `10001:10001`。绑定目录需要允许该 UID 写入数据、下载和音乐暂存目录。正式音乐目录如需完全只读，可单独部署仅浏览实例；扫描和整理功能需要写权限。

## 3. 启动

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

访问 `/api/health/ready` 应返回 `ready`。Plex 未配置时显示 `not_configured`，不会阻止首装。

## 4. 首次安装向导

1. 创建主人账号，密码至少 12 个字符。
2. 检查音乐根目录。
3. 可选连接 Plex 并测试连接。
4. 先执行扫描预览，再确认后续整理或刮削任务。
5. 新部署默认不允许私有下载 URL，也不会启用任何导入来源。

## 5. HTTPS

如果通过反向代理暴露：

- 设 `COOKIE_SECURE=true`。
- `TRUSTED_ORIGINS` 只填写实际 HTTPS 入口。
- `FORWARDED_ALLOW_IPS` 只信任反向代理地址。
- 不直接把 Docker 端口暴露到公网。
- 在代理层配置 TLS、访问控制与请求体上限。

## 多架构

镜像使用官方 Python 和 Node 多架构基础镜像，可为 linux/amd64 与 linux/arm64 构建。跨架构发布时可使用：

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t your-registry/songlib-amp:1.0.0-rc.1 --push .
```
