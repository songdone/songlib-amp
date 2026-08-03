# SongLib Amp｜音屿

> 让散落的音乐，回到自己的岛屿。

SongLib Amp 是一个本地优先、面向 NAS 的音乐管理与播放平台。它把音乐目录、Plex、元数据、歌词、歌单、后台任务和个人推荐放进一个清晰的工作流，同时让完整听歌历史留在自己的设备上。

## 能做什么

- 扫描真实音乐目录，查看格式、码率、采样率、位深、缺失资源和重复项。
- 连接 Plex，同步资料库与歌单，预览后刷新媒体与补齐素材。
- 从可插拔提供方搜索元数据、封面和歌词；候选结果经过名称、艺人、专辑、时长和版本校验。
- 管理用户有权使用的下载来源；识别接口后即可排队，歌曲在后台执行时解析并下载，完成后经过暂存、确认和隔离再入库。
- 创建歌单，导入或导出 M3U/M3U8；也可从 QQ 音乐、网易云音乐公开分享链接预览并迁移到 Plex 或已配置的飞牛音乐。
- 在歌单页汇总当前 Plex 与飞牛音乐中的真实歌单；Plex 歌单兼容毫秒时长并按原顺序整单加入播放队列、自动续播，连接失败时分别给出可恢复提示。
- 将独立下载目录中的音频按标签和路径预览后规范入库，保留冲突、失败与回滚记录。
- 导入的授权音乐源识别到音乐接口后立即启用并出现在“下载与入库”；搜索与下载不再受预先测试结果限制，真实错误会落在对应任务中并可重试。
- 连续播放、播放队列、随机/循环、键盘操作与响应式移动体验；歌词支持大小写不同的 LRC/TXT、常见中文编码和音频内嵌标签，缺少随附歌词时再按歌曲、艺人和时长重新核验并获取。
- 深色高透玻璃界面会从 Plex 中按曲目数排序的歌手背景取最多 80 张组成随机轮播池；进入歌手详情后锁定当前歌手背景且不重复铺入内容卡片，移动端 PWA 使用单行五项主导航。
- 根据收藏、完成、跳过和重复播放形成本地画像，给出可解释推荐，并保留库外探索能力。
- 通过持久后台任务完成扫描、下载、刮削、补图和补歌词；服务重启后可继续、重试或人工恢复。

SongLib Amp 不内置第三方私钥，不绕过 DRM，也不附带受版权保护的音频。请只接入你信任且有权使用的服务和内容。

## 快速部署

要求：Docker 24+、Docker Compose 2.20+，推荐至少 2 GB 可用内存。[Docker Hub 镜像](https://hub.docker.com/r/666uos/songlib-amp/tags)的 `latest` 与固定版本标签同时提供 `linux/amd64`、`linux/arm64`，NAS 不需要编译源码。

```bash
mkdir -p songlib-amp/{data,downloads,music}
cd songlib-amp
```

将下面内容保存为 `docker-compose.yml`。音乐库与下载暂存是两个独立挂载，不能指向同一目录：

```yaml
services:
  songlib:
    image: 666uos/songlib-amp:latest
    container_name: songlib-amp
    restart: unless-stopped
    user: "1000:1000"
    environment:
      - TZ=Asia/Shanghai
      - APP_ENV=production
      - WORKER_MODE=embedded
    ports:
      - "32782:8080"
    volumes:
      # 程序数据和配置
      - ./data:/data
      # 下载暂存目录，必须与音乐库分开
      - ./downloads:/downloads
      # 正式音乐库
      - ./music:/music
      # 可选：如需从 Preferences.xml 读取 Plex Token，取消下一行注释。
      # - ./plex-config:/plex-config:ro
    security_opt:
      - no-new-privileges:true
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/health/ready',timeout=3)"]
      interval: 30s
      timeout: 5s
      start_period: 25s
      retries: 3
```

飞牛 NAS 只需把上面三条挂载的左侧改成自己的绝对路径，例如：

```yaml
volumes:
  - /vol1/1000/Docker/songlib-amp/data:/data
  - /vol1/1000/Docker/songlib-amp/downloads:/downloads
  - /vol1/1000/Music:/music
```

然后启动：

```bash
docker compose pull
docker compose up -d
docker compose ps
```

`user: "1000:1000"` 要改成拥有这些目录的 NAS 普通账号数字 ID，可用 `id -u` 与 `id -g` 查看。容器仍以非 root 身份运行，同时能够写入数据、下载暂存和正式曲库挂载。

打开 `http://NAS地址:32782`。不需要预先创建 `.env`：程序会把随机会话密钥保存在 `/data`，首次访问会引导创建主人账号；Plex、飞牛音乐、目录与播放器偏好都在网页设置中完成。

浏览器原生 PWA 安装要求 HTTPS。普通 HTTP 局域网地址仍可完整使用网页功能，但安装提示会明确展示 HTTPS 要求；需要桌面或主屏幕安装时，请先通过 NAS 反向代理配置可信 HTTPS，再用 HTTPS 地址访问。

### 飞牛应用中心安装包

仓库同时提供飞牛 fnOS 原生 `.fpk` 应用包工程。安装后由飞牛应用中心管理容器，不需要手写 Compose；系统会自动创建相互独立的 `songlib-amp/music` 与 `songlib-amp/downloads` 共享目录，首次安装只需确认访问端口。

- [飞牛应用中心发布与安装说明](docs/FNOS-APP-STORE.md)
- [应用包构建说明](packaging/fnos/README.md)
- 应用包源码：`packaging/fnos/songlib-amp`

升级时先备份 `data` 目录，再执行：

```bash
docker compose pull
docker compose up -d
```

`latest` 适合直接获取当前发布版；需要严格锁定或回滚时，把 Compose 的 `image` 改为 `666uos/songlib-amp:1.0.0-rc.6` 等固定标签，再次执行相同命令。仓库内的 [`docker-compose.yml`](docker-compose.yml) 与上面模板一致；只有参与开发时才使用 `docker-compose.build.yml` 在本机编译。

默认模板已经包含非 root 用户和 `no-new-privileges`，Compose 会自动创建项目隔离网络。需要只读根文件系统和全部 Linux capability 裁剪时，再叠加可选文件：

```bash
docker compose -f docker-compose.yml -f docker-compose.hardened.yml up -d
```

## 服务与数据

默认 Compose 只有一个 `songlib` 服务，界面、API 与持久任务队列共用一个容器，后台 Worker 以独立执行线程运行。这样保留任务重试和断点续跑能力，同时让普通 NAS 部署保持简洁。Compose 会自动创建项目隔离网络。

持久数据：

- `/data/manager.db`：账号、配置、任务、歌单、画像与审计记录。
- `/data/sources/`：用户主动导入的来源适配脚本。
- `/data/backups/`：SQLite 在线备份。
- `/downloads/_incoming/`：在线下载的临时文件。
- `/music/.trash/`：可恢复隔离区。
- `/downloads/`：独立下载暂存区与手工整理入口，不能与 `/music/` 指向同一目录。

令牌和私密配置应通过设置页面写入 NAS 的受保护数据目录，不得提交仓库、写入前端或普通日志；`.env.example` 仅供需要环境变量覆盖的高级部署参考。

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
