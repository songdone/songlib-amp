# SongLib Amp｜音屿

> 让散落的音乐，回到自己的岛屿。

SongLib Amp 是一个本地优先、面向 NAS 的音乐管理与播放平台。它把音乐目录、Plex、元数据、歌词、歌单、后台任务和个人推荐放进一个清晰的工作流，同时让完整听歌历史留在自己的设备上。

## 能做什么

- 扫描真实音乐目录，查看格式、码率、采样率、位深、缺失资源和重复项。
- 连接 Plex，同步资料库与歌单，预览后刷新媒体与补齐素材。
- 从可插拔提供方搜索元数据、封面和歌词；候选结果经过名称、艺人、专辑、时长和版本校验。
- 管理用户有权使用的下载来源，经过预检、暂存、确认和隔离后再入库。
- 创建歌单，导入或导出 M3U/M3U8，保持顺序并生成未匹配报告。
- 连续播放、播放队列、歌词、随机/循环、键盘操作与响应式移动体验。
- 根据收藏、完成、跳过和重复播放形成本地画像，给出可解释推荐，并保留库外探索能力。
- 通过持久后台任务完成扫描、下载、刮削、补图和补歌词；服务重启后可继续、重试或人工恢复。

SongLib Amp 不内置第三方私钥，不绕过 DRM，也不附带受版权保护的音频。请只接入你信任且有权使用的服务和内容。

## 快速部署

要求：Docker 24+、Docker Compose 2.20+，推荐至少 2 GB 可用内存。

```bash
cp .env.example .env
chmod 600 .env
```

编辑 `.env`：

1. 用 `openssl rand -hex 32` 生成 `SESSION_SECRET`。
2. 设置 `MUSIC_DIR`、`SONGLIB_DATA_DIR` 和 `SONGLIB_DOWNLOADS_DIR`。
3. 选择未被占用的 `APP_PORT`。
4. 如果通过 HTTPS 反向代理访问，设置 `COOKIE_SECURE=true` 和准确的 `TRUSTED_ORIGINS`。

然后启动：

```bash
docker compose up -d --build
```

打开 `http://NAS地址:APP_PORT`。新实例不会创建默认弱密码，首次访问会引导创建主人账号。

## 服务与数据

Compose 使用独立桥接网络和两个最小权限服务：

- `web`：界面和 API。
- `worker`：扫描、下载、刮削和整理任务。

持久数据：

- `/data/manager.db`：账号、配置、任务、歌单、画像与审计记录。
- `/data/sources/`：用户主动导入的来源适配脚本。
- `/data/backups/`：SQLite 在线备份。
- `/music/_incoming/`：待确认内容。
- `/music/.trash/`：可恢复隔离区。
- `/downloads/`：独立下载暂存区。

令牌和私密配置只应存在于 NAS 上权限为 `600` 的 `.env` 或受保护数据目录中。

## 文档

- [架构说明](docs/ARCHITECTURE.md)
- [部署与首次安装](docs/DEPLOYMENT.md)
- [升级、备份、恢复与故障排查](docs/OPERATIONS.md)
- [安全边界](docs/SECURITY.md)
- [从 0.8 升级](docs/MIGRATION-0.8.md)
- [开发与质量门禁](DEVELOPMENT.md)
- [变更记录](CHANGELOG.md)

## 开发

后端：

```bash
python -m pip install -r backend/requirements.txt
PYTHONPATH=backend python -m unittest discover -s backend/tests -v
```

前端：

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm test
pnpm run build
```

所有改动通过 Pull Request 合入。默认分支受到 CI 的后端测试、前端生产构建、Compose 校验、镜像构建和敏感信息扫描保护。
