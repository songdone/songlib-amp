# SongLib Amp 信息架构与统一播放中心

## 一级导航

SongLib Amp 的一级导航只保留五个稳定目的地：

1. 首页：继续播放、最近播放、推荐和常用入口。
2. 音乐库：歌手、专辑、单曲与搜索。
3. 正在播放：SongLib 本机播放、Plex 活跃会话、远程控制、歌词、队列和 AirPlay 歌词投屏。
4. 歌单：SongLib、Plex 与飞牛音乐歌单。
5. 设置：连接、曲库管理、入库、资料补全、任务、外观、账号、备份和日志。

原有 `/discover`、`/me` 和 `/manage/*` URL 继续可用，避免书签和浏览器历史失效；它们不再与核心音乐任务争夺一级导航。推荐和播放历史从首页进入，管理功能从“设置 → 管理工具”进入。

## 统一播放源

“正在播放”页面不再假设所有音乐都由网页 `<audio>` 播放。它把来源规范为两类：

- `local`：SongLib Amp 浏览器播放器。页面直接控制 `<audio>`、本地队列、音量、收藏和音质。
- `plex:<session-id>`：Plex Server `/status/sessions` 返回的活动音乐会话。页面显示设备、歌曲、状态和进度，并按 `/clients` 公布的 Companion 能力决定是否允许控制。

首次进入时的选择顺序：正在播放的 SongLib 本机会话、正在播放的 Plex 会话、已暂停的 SongLib 曲目、任意 Plex 音乐会话、空的本机播放器。用户选择会保存在当前浏览器。

切换到外部 Plex 会话时，SongLib 本机音频会暂停，避免双重出声。切回本机只是切换控制上下文，不擅自停止家中其他设备。

## Plex 跟随与控制

后端读取：

- `GET /status/sessions`：当前音乐、播放器状态、`viewOffset` 和 `duration`。
- `GET /clients`：可直接访问的 Companion 播放器、地址和 `protocolCapabilities`。

SongLib 只向 Plex 自己登记且位于本地/私有网络的目标发送 Companion 控制请求。支持播放、暂停、停止、上一首、下一首、跳转进度和音量。客户端未出现在 `/clients`、未公布 `playback` 能力或不在可直接访问的私有网络时，界面显示“仅跟随”。

新版 Plex 客户端可能仍出现在 `/status/sessions`，但不再出现在 `/clients`。此时歌曲和进度继续可见，控制按钮不会伪装成可用。

远程进度以 Plex 的 `viewOffset` 为基准，在两秒轮询之间用浏览器时钟推进；后端歌词视频时钟仍执行温和漂移修正。网络延迟、播放器暂停上报延迟和 Plex 客户端实现差异意味着它不是采样级同步。

## AirPlay 歌词模式

“歌词与投屏”入口永远可见：

- 没有歌曲时禁用并解释缺失条件。
- Apple Safari 支持原生 API 时打开系统设备选择器。
- Windows/Android/不支持的浏览器保留控制界面，但明确提示无法原生发起 AirPlay。

跟随 Plexamp 时，Plexamp 继续输出音频，SongLib 向 Apple TV 投送歌词视频。这仍是双时钟模式。若 Plexamp 音频本身正在从同一 Apple 设备 AirPlay，Safari 再发起视频 AirPlay 的路由行为必须在目标 iOS/tvOS 版本上实测，不能承诺系统会合并两个独立会话。

## 交互状态原则

- 核心功能不因空状态而从界面消失。
- 禁用控件必须在同一屏说明原因。
- 所有网络请求区分初次加载、后台刷新、可重试错误和降级状态。
- 远程控制只在能力可验证时启用。
- 手机端不压缩桌面界面，而是使用五项底部导航、紧凑歌曲头和分段详情面板。
- 动效遵循 `prefers-reduced-motion`，主要触摸目标不小于 42px。
