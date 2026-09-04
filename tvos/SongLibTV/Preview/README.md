# 调视觉用的素材

`PreviewHarness.swift` 需要两个文件才能离线渲染歌词页：

- `preview-lyrics.json` —— Plex 的结构化歌词（`Accept: application/json`）
- `preview-cover.jpg` —— 对应的专辑封面

**这两个文件不在仓库里。** 它们是从真实音乐库导出来的，封面和歌词都有版权，
而这个仓库是公开的。

## 为什么非要用真实素材

拿假数据调出来的版式一放上真东西就散架。这套素材专门挑了一首把两个最容易
做错的地方都覆盖到的歌：

- 开头四行是制作名单，时间戳在 0/1/2/3 秒 —— 照时间轴渲染就是开头四秒
  字幕连闪四下
- 10.09s→33.36s 是一条空文本行，那是 Plex 表达间奏的方式 —— 照字面渲染
  是一大片空白挂 23 秒

## 怎么重新导

在能访问 Plex 服务器的机器上（`RATING_KEY` 换成任意一首带歌词的曲目）：

```sh
export PLEX_URL='http://你的服务器:32400'
export PLEX_TOKEN='...'          # 不要写进任何文件
RATING_KEY=144010

# 找到歌词流的 key
curl -s "$PLEX_URL/library/metadata/$RATING_KEY?includeLyrics=1" \
  -H "Accept: application/json" -H "X-Plex-Token: $PLEX_TOKEN" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin)["MediaContainer"]["Metadata"][0]; \
    print([s["key"] for m in d["Media"] for p in m["Part"] for s in p.get("Stream",[]) if s.get("streamType")==4][0])'

# 用上一步的 key 取歌词，存成 preview-lyrics.json
curl -s "$PLEX_URL<上一步的 key>" \
  -H "Accept: application/json" -H "X-Plex-Token: $PLEX_TOKEN" > preview-lyrics.json

# 封面（曲目层常常没有 thumb，要回退到 parentThumb / grandparentThumb）
curl -s "$PLEX_URL<thumb 路径>" -H "X-Plex-Token: $PLEX_TOKEN" > preview-cover.jpg
```

Token 走**请求头**，不要放进 URL 的查询串 —— 任何一次报错都会把带 token 的
完整 URL 打进日志里。这个坑已经踩过一次。

## 怎么用

```sh
xcrun simctl launch --console <设备> cn.playsong.songlib.tv -preview -previewAt 45
```

`-previewAt` 指定从第几秒开始看：`5` 看制作名单、`20` 看间奏、`45` 看正常滚动。
