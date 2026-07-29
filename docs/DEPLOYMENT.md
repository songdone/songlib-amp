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

`SONGLIB_DOWNLOADS_DIR` 与 `MUSIC_DIR` 必须指向不同目录或数据集。容器内下载文件只出现在 `/downloads`，正式曲库只出现在 `/music`。

在 `.env` 中把 `PUID`、`PGID` 设置为拥有这些挂载目录的 NAS 普通账号数字 ID（运行 `id -u`、`id -g` 查看）。这样容器保持非 root 运行，又不会因绑定目录权限导致数据库或音乐文件无法写入。

如需把歌单写入飞牛音乐，可在“设置 → Plex 连接 → 飞牛音乐”中使用飞牛音乐账号连接；密码只用于换取服务会话，不会保存。也可以在 NAS 的 `.env` 中预置专用令牌：

```dotenv
FNOS_MUSIC_URL=http://nas-address:5666
FNOS_MUSIC_TOKEN=replace-with-dedicated-token
```

不要从浏览器会话中提取令牌。建议为歌单同步创建权限最小的专用账号或令牌。界面生成的派生令牌保存在 `/data/secrets/fnos-music.json`，目录与文件权限分别收紧为 `700` 和 `600`。

生成会话密钥：

```bash
openssl rand -hex 32
```

把结果写入 `.env` 的 `SESSION_SECRET`，不要贴到 Issue、聊天记录或普通日志。`MUSIC_DIR` 是音屿自己的可写入库目录；已有媒体库可通过 `READ_ONLY_LIBRARY_DIR` 只读挂载到 `/music/library`，避免修改其他音乐服务正在管理的文件。Plex 未启用时可保留默认只读空目录。

Compose 默认使用 `.env` 中的 `PUID:PGID`（示例为 `1000:1000`）运行容器。绑定目录需要由这个 NAS 普通账号拥有或允许其写入。镜像内置用户 `10001:10001` 只在没有 Compose 用户映射时使用。正式音乐目录如需完全只读，可单独部署仅浏览实例；扫描和整理功能需要写权限。

## 3. 启动

```bash
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps
```

默认 `docker-compose.yml` 只有一个 `songlib` 服务；Web、API 与后台任务队列在同一容器中运行，Compose 自动建立项目隔离网络。普通 NAS 不需要阅读锚点、共享配置或手工网络定义。如需进一步启用只读根文件系统和 capability 裁剪：

```bash
docker compose -f docker-compose.yml -f docker-compose.hardened.yml up -d
```

访问 `/api/health/ready` 应返回 `ready`。Plex 未配置时显示 `not_configured`，不会阻止首装。

## 4. 首次安装向导

1. 创建主人账号，密码至少 12 个字符。
2. 检查音乐根目录。
3. 可选连接 Plex 并测试连接。
4. 先执行扫描预览，再确认后续整理或刮削任务。
5. 新部署默认不允许私有下载 URL；用户导入且通过格式识别的授权音乐源会立即启用，首次下载时自动校验真实解析地址。

## 5. HTTPS

如果通过反向代理暴露：

- 设 `COOKIE_SECURE=true`。
- `TRUSTED_ORIGINS` 只填写实际 HTTPS 入口。
- `FORWARDED_ALLOW_IPS` 只信任反向代理地址。
- 不直接把 Docker 端口暴露到公网。
- 在代理层配置 TLS、访问控制与请求体上限。

## 多架构

Docker Hub 固定标签同时发布 `linux/amd64` 与 `linux/arm64`。NAS 只需执行 `docker compose pull`，不需要本地编译。维护者跨架构发布时使用：

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t 666uos/songlib-amp:1.0.0-rc.4 --push .
```
