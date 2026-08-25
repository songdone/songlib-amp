# 原生 AirPlay 歌词投屏

## 当前实现状态

本功能提供一个最小可验证原型：iPhone、iPad 或 macOS Safari 在检测到公开的 WebKit 播放目标 API 后，用带 `x-webkit-airplay="allow"` 的 `HTMLVideoElement` 调用 `webkitShowPlaybackTargetPicker()`。设备列表完全由苹果系统显示；SongLib Amp 不填写 Apple TV IP、不扫描局域网，也不模拟或逆向 AirPlay。

播放器页和全屏歌词页都有“投到电视”入口。Windows/Android PWA 仍显示相同控制，便于跨平台 UI 一致，但会明确说明该设备不能原生发起 AirPlay。iOS/iPadOS 主屏幕 Web App 的独立窗口行为仍标记为待真实 iOS/tvOS 26 设备验证，不能仅凭 Safari 浏览器结果推断。

参考的公开接口与流规范：

- [WebKit `webkitShowPlaybackTargetPicker()`](https://developer.apple.com/documentation/webkitjs/htmlmediaelement/1631913-webkitshowplaybacktargetpicker)
- [HLS Authoring Specification for Apple Devices](https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices)

## 架构与代码审计结论

现有播放器使用一个全局 `<audio>`，本地与 Plex 音频通过同源、受登录保护的后端端点播放；歌词优先读取同名 LRC/文本或媒体内嵌歌词，再回退到现有歌词匹配逻辑。原型没有改动原音乐流，也没有让 Apple TV 持有 SongLib 登录 Cookie。

投屏链路如下：

1. 支持的 Safari 为当前账号预建一个轻量会话，但尚不启动编码器。
2. 用户点击“投到电视”，Safari 在同一用户手势内启动隐藏视频并打开苹果原生选择器。
3. Apple TV 请求带 256 位随机访问令牌的固定 `master.m3u8` URL；此时后端才启动一个持续的 FFmpeg 编码器。
4. 后端以 1 秒 fMP4 HLS 分片维护短实时窗口。会话 URL、主播放列表 URL和媒体播放列表 URL 在整个投屏期间不变。
5. 浏览器每秒上报曲目、播放状态和当前媒体时间。切歌只替换渲染状态，不替换视频 URL、不重启编码器。
6. 普通 LRC 按整行高亮；增强 LRC 中真实的 `<mm:ss.xx>` 字/词时间按字词高亮。无真实字时间时不会伪造逐字效果。

TV 画面延续现有视觉语言：封面取平均色、模糊封面背景、琥珀/紫色氛围层、大字号歌词、标题/歌手/专辑、音质标签和播放进度。默认输出为 1920×1080/30 FPS；渲染器默认生成 5 FPS 的内容帧，FFmpeg 以 30 FPS 输出，减少 NAS 上不必要的 Python 绘制负担。

### 音频模式审计

当前 MVP 是 `dual-clock-video-only`：AirPlay HLS 只有歌词视频轨，原 `<audio>` 继续在 Safari 设备上播放。这样能先验证原生选择器、固定会话流、切歌不中断和歌词画面，但存在以下明确限制：

- 音频时钟和歌词视频时钟不是同一个媒体时钟，不能保证样本级同步。
- iOS/macOS 在切换输出路由、锁屏、后台或网络抖动时可能改变音频行为，必须在真机验证。
- 后端以浏览器音频的 `currentTime` 为权威观测值：小于硬同步阈值的误差按增益和最大步长温和修正，大误差直接重锚；`AIRPLAY_LYRIC_ADVANCE_MS` 只影响歌词命中，不篡改进度条时钟。
- 下一阶段应把音频和歌词视频复用到同一个 HLS presentation timeline，并处理切歌时音频解码、无缝拼接、格式归一和响度；完成前不能把当前模式描述成严格音画同步。

## 分阶段计划

- 阶段 1（已完成）：公开 WebKit API 能力检测、原生选择器入口、固定授权会话 URL、平台降级说明。
- 阶段 2（已完成原型）：持续 FFmpeg、1 秒 fMP4 HLS、普通/增强 LRC、封面/元数据/进度动态渲染、温和漂移修正。
- 阶段 3（已完成自动验证）：固定 URL 与切歌不启动新编码器的单测、歌词解析和时钟测试、前端能力检测测试、完整回归构建，并以真实 FFmpeg 生成 fMP4 HLS 做切歌 PID/URL 稳定性烟雾测试。
- 阶段 4（待真实设备）：Safari/PWA、Apple TV 可达性、证书信任、10/30 分钟漂移、连续切歌和断网恢复验收。
- 阶段 5（后续）：音频与视频复用同一媒体时钟；在真实设备确认基础 HLS 稳定后再评估带 partial segments 的完整 LL-HLS，不在当前版本虚假标称 LL-HLS。

## 配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AIRPLAY_CAST_ENABLED` | `true` | 服务端总开关。 |
| `AIRPLAY_PUBLIC_BASE_URL` | 空 | Apple TV 可达的站点 origin；空值使用当前请求 origin。不能包含路径。 |
| `AIRPLAY_ENCODER` | `auto` | `auto`、`qsv` 或 `software`；QSV 初始化失败会自动降级软件编码。 |
| `AIRPLAY_WIDTH` / `AIRPLAY_HEIGHT` | `1920` / `1080` | 必须为 16:9；4K 使用 `3840` / `2160`。 |
| `AIRPLAY_FPS` | `30` | 支持 24–30，推荐保持 30。 |
| `AIRPLAY_RENDER_FPS` | `5` | Python 动态画面生成频率，逐字歌词可提高到 10，代价是更多 CPU/管道流量。 |
| `AIRPLAY_SEGMENT_SECONDS` | `1` | 1–3 秒；稳定低延迟建议 1。 |
| `AIRPLAY_VIDEO_BITRATE` | 自动 | 1080p 默认 `5M`，4K 默认 `14M`。 |
| `AIRPLAY_LYRIC_ADVANCE_MS` | `250` | 歌词显示提前量，可设为负数。 |
| `AIRPLAY_DRIFT_GAIN` | `0.35` | 每次时钟观测使用的温和修正比例。 |
| `AIRPLAY_DRIFT_STEP_MS` | `250` | 单次温和修正的最大步长。 |
| `AIRPLAY_HARD_SYNC_MS` | `2000` | 超过该误差时直接重新锚定。 |
| `AIRPLAY_SESSION_TTL_SECONDS` | `14400` | 固定会话令牌最长空闲时间。 |
| `AIRPLAY_STREAM_IDLE_SECONDS` | `90` | Apple TV 不再读取播放列表/分片后关闭编码器。 |
| `AIRPLAY_FONT_PATH` | 空 | 可选 CJK 字体路径；镜像已包含 Noto Sans CJK。 |
| `FFMPEG_BINARY` | `ffmpeg` | FFmpeg 可执行文件。 |

4K 软件编码对 NAS CPU 和网络要求明显更高。先用 1080p/QSV 完成稳定性验收，再将分辨率改为 `3840×2160`，并用有线 Apple TV 或稳定的 5/6 GHz Wi‑Fi 验证。不要只提高分辨率而忽略反代吞吐和 `/data` 分片写入延迟。

## Intel QSV

镜像内置 FFmpeg；amd64 构建同时安装 Intel media VA 驱动。`auto` 只有在容器内存在 `/dev/dri` 且 FFmpeg 声明 `h264_qsv` 时才尝试 QSV。初始化阶段失败会在同一会话 URL 下清理未发布分片并回退 `libx264`。

Compose 默认不获取宿主设备权限。确认 NAS 的 `/dev/dri/renderD128` 存在后，取消 `docker-compose.yml` 中 `devices` 与 `group_add` 注释，把 `RENDER_GID` / `VIDEO_GID` 改成宿主对应组的数字 GID，并确保容器运行 UID 有访问权限。可用下列只读检查确认：

```bash
ls -l /dev/dri
docker compose exec songlib ffmpeg -hide_banner -encoders | grep h264_qsv
```

不要为方便而把容器改成 privileged。飞牛应用包当前保留软件编码降级；设备映射应在明确了解机型与包权限模型后由管理员配置。

## HTTPS、反向代理与网络

Safari 页面应使用受信任 HTTPS。Apple TV 必须能解析 `AIRPLAY_PUBLIC_BASE_URL` 的主机名、连接其端口并信任完整证书链。局域网 IP 自签证书即使在手机上被临时接受，也可能不被 Apple TV 接受；优先使用受信任域名证书和局域网 DNS。Safari 与 Apple TV 应在同一可互访网段，访客 Wi‑Fi、客户端隔离、跨 VLAN ACL 和仅对手机可用的 VPN 地址都会导致选择成功后黑屏。

反代必须保留 `Host` 和 `X-Forwarded-Proto`。若配置了 `AIRPLAY_PUBLIC_BASE_URL`，它应与用户访问的 HTTPS origin 一致，并把它的主机名加入启用中的 `TRUSTED_HOSTS`；若必须跨 origin，需把页面 origin 加入 `TRUSTED_ORIGINS`，并确认 CSP 的 `media-src` 已包含投屏 origin。流端点以 bearer URL 返回无需 Cookie 的跨域 CORS/CORP 响应，但控制端点仍只接受登录会话和 CSRF 令牌。

Nginx 示例：

```nginx
location /api/airplay/stream/ {
    proxy_pass http://songlib:8080;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_cache off;
    proxy_read_timeout 30s;
    add_header X-Accel-Buffering no always;
}

location / {
    proxy_pass http://songlib:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

不要让 CDN 缓存实时 `.m3u8`。分片本身只有数秒有效窗口；过度缓存、长代理缓冲或把应用 origin 重写成 Apple TV 不可达的容器地址都会破坏低延迟播放。

## 会话权限与日志

- 创建、更新、查询和停止会话都要求具有 `listen` 权限的登录用户，并受 CSRF 保护。
- Apple TV 读取流时没有 SongLib Cookie，使用 URL 中的 256 位随机 bearer token；一个账号同时复用一个活动会话。
- 令牌只保存在进程内存，服务重启、用户停止会话或超时后失效。对应输出目录会删除。
- 当前会话管理器是进程内状态，必须保持镜像默认的单个 Uvicorn worker；不要直接把 `--workers` 调大。后续若改为多副本，需要先把会话路由与状态迁移到共享协调层。
- 不要把完整流 URL 复制到聊天、监控或工单。反向代理访问日志应对 `/api/airplay/stream/` 路径脱敏或禁用路径采集。
- 该 URL 只授权读取合成歌词视频，不直接暴露原始音频、音乐文件、歌词文件路径或 Plex 凭据。

## 验证

无需 Apple 设备的自动门禁：

```bash
PYTHONPATH=backend python -m unittest discover -s backend/tests -v
cd frontend && npm test && npm run build
docker compose --env-file .env.example config --quiet
docker build -t songlib-amp:airplay-test .
```

真机验收是唯一需要用户点击/授权的步骤：

1. 在 iPhone/iPad/macOS Safari 通过最终 HTTPS 地址打开播放器，确认“投到电视”调用系统设备选择器；页面不得显示自行生成的设备列表。
2. 选择同网段 Apple TV，确认 1080p 歌词画面出现，封面、标题、歌手、专辑、音质和进度正确。
3. 连续切换至少 20 首歌，观察 Safari 的 `webkitCurrentPlaybackTargetIsWireless` 保持为真，视频 `src` 和主播放列表 URL 不变，Apple TV 不返回选择界面。
4. 分别用普通 LRC 和带真实字时间的增强 LRC 验证整行/逐字高亮；调整 `AIRPLAY_LYRIC_ADVANCE_MS` 后复测。
5. 连续播放 10 分钟与 30 分钟，记录音频相对歌词的误差和 `clockErrorMs`；测试暂停、拖动、锁屏、恢复和 Wi‑Fi 短暂抖动。
6. 分别在 Safari 标签页与已安装主屏幕 Web App 中验证。后者在真实 iOS/tvOS 26 完成前保持“待验证”。
7. 断开 AirPlay 后确认约 90 秒内编码器停止；旧分片和会话超时后不可读取。

当前工作站没有系统级 FFmpeg/Docker，也没有 Apple TV；已使用隔离测试环境中的真实 FFmpeg 生成播放列表与分片，并确认编码中切歌的进程 PID、会话 URL 均不变。容器构建、QSV 与苹果设备项目仍必须在上述目标环境继续验收。
