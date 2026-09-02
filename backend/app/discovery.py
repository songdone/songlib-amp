"""平台歌单发现。

原先只有网易云是真抓的，QQ 音乐和酷狗只是一串写死的分类名加一个跳转到
平台官网的链接 —— 用户点进"发现"页看到的是四个外链，不是歌单。

现在每个平台是一个 Provider，负责三件事：
  categories()  平台自己的分类/标签
  playlists()   某个分类下的热门歌单
  detail()      一张歌单的曲目

三个约定，改这个文件时不要破例：

1. **一个平台挂了不能拖垮整页。** 每个 provider 的调用都在自己的
   try 里，失败只是这个平台没有内容，其余平台照常出。超时给得很短
   （连接 5s / 读 10s）—— 这些都是第三方接口，等它比没有它更糟。

2. **返回结构与平台无关。** 上层（路由和前端）不该知道网易云叫
   coverImgUrl、QQ 叫 albummid。归一化都在各 provider 内部做完。

3. **抓不到就诚实说抓不到。** 不要用写死的分类名冒充抓取结果 ——
   那正是这一页原来的问题。酷狗的接口要签名，没有可靠的公开入口，
   所以它只作为"去平台网站看"的外链出现，并且在结构上就标明
   `browse_only`，前端据此换一套呈现，不会伪装成歌单卡片。
"""

from __future__ import annotations

import json
import re
from urllib.parse import quote

import httpx

# 连接和读取分开给：连不上要快速失败，连上了给它一点时间返回。
TIMEOUT = httpx.Timeout(10, connect=5)

_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 SongLib-Amp"


def _clean(text: str | None, limit: int = 180) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()[:limit]


# ----------------------------------------------------------------------
# 网易云音乐
# ----------------------------------------------------------------------


class NeteaseProvider:
    id = "netease"
    name = "网易云音乐"
    browse_only = False
    site_url = "https://music.163.com/#/discover/playlist"
    default_category = "热门"

    def _get(self, path: str, params: dict | None = None):
        headers = {
            "User-Agent": _UA,
            "Referer": "https://music.163.com/",
            "Accept": "application/json,text/plain,*/*",
        }
        with httpx.Client(timeout=TIMEOUT, follow_redirects=True) as client:
            response = client.get(
                "https://music.163.com" + path, params=params or {}, headers=headers
            )
            response.raise_for_status()
            return response.json()

    def categories(self) -> list[dict]:
        data = self._get("/api/playlist/hottags")
        result = []
        for index, item in enumerate(data.get("tags") or []):
            name = item.get("name")
            if not name:
                continue
            result.append({
                "id": f"netease-{item.get('id') or index}",
                # 网易云的分类就是中文标签名本身，直接作为查询值。
                "value": name,
                "name": name,
                "count": int(item.get("usedCount") or item.get("count") or 0),
                "url": f"https://music.163.com/#/discover/playlist/?cat={quote(name)}",
            })
        return result

    def _summary(self, item: dict) -> dict:
        creator = item.get("creator") or {}
        return {
            "id": str(item.get("id") or ""),
            "platform": self.id,
            "platformName": self.name,
            "title": item.get("name") or "未命名歌单",
            "description": _clean(item.get("description")),
            "coverUrl": item.get("coverImgUrl") or item.get("picUrl") or "",
            "trackCount": int(item.get("trackCount") or 0),
            "playCount": int(item.get("playCount") or 0),
            "creator": creator.get("nickname") or self.name,
            "sourceUrl": f"https://music.163.com/#/playlist?id={item.get('id')}",
        }

    def playlists(self, category: str, limit: int = 18) -> list[dict]:
        data = self._get(
            "/api/playlist/list",
            {
                "cat": category or self.default_category,
                "order": "hot",
                "offset": 0,
                "total": "true",
                "limit": limit,
            },
        )
        return [self._summary(item) for item in (data.get("playlists") or [])]

    def detail(self, playlist_id: str) -> tuple[dict, list[dict]]:
        if not playlist_id.isdigit():
            raise ValueError("网易云歌单编号必须是数字")
        data = self._get(
            "/api/v6/playlist/detail", {"id": playlist_id, "n": 1000, "s": 0}
        )
        playlist = data.get("playlist") or {}
        songs = list(playlist.get("tracks") or [])
        # trackIds 是全量，tracks 只带前若干首；缺的按 100 一批补齐。
        known = {str(item.get("id")) for item in songs if item.get("id")}
        missing = [
            str(item.get("id"))
            for item in (playlist.get("trackIds") or [])
            if item.get("id") and str(item.get("id")) not in known
        ][:300]
        for start in range(0, len(missing), 100):
            ids = missing[start:start + 100]
            extra = self._get(
                "/api/song/detail", {"ids": json.dumps(ids, ensure_ascii=False)}
            ).get("songs") or []
            songs.extend(extra)

        tracks = []
        for item in songs[:300]:
            artists = item.get("ar") or item.get("artists") or []
            album = item.get("al") or item.get("album") or {}
            tracks.append({
                "platform": "wy",
                "platformTrackId": str(item.get("id") or ""),
                "title": item.get("name") or "",
                "artist": " / ".join(
                    filter(None, [artist.get("name") for artist in artists])
                ),
                "album": album.get("name") or "",
                "duration": round(int(item.get("dt") or item.get("duration") or 0) / 1000),
                "coverUrl": album.get("picUrl") or "",
            })
        return self._summary(playlist), tracks


# ----------------------------------------------------------------------
# QQ 音乐
# ----------------------------------------------------------------------


class QQProvider:
    id = "qq"
    name = "QQ 音乐"
    browse_only = False
    site_url = "https://y.qq.com/n/ryqq/category"
    # 10000000 是"全部"，作为默认分类。
    default_category = "10000000"

    _headers = {"User-Agent": _UA, "Referer": "https://y.qq.com/"}

    def _get(self, url: str, params: dict):
        with httpx.Client(timeout=TIMEOUT, follow_redirects=True) as client:
            response = client.get(url, params=params, headers=self._headers)
            response.raise_for_status()
            return response.json()

    def categories(self) -> list[dict]:
        data = self._get(
            "https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_tag_conf.fcg",
            {"format": "json", "inCharset": "utf8", "outCharset": "utf-8", "platform": "yqq"},
        )
        result = []
        for group in (data.get("data") or {}).get("categories") or []:
            group_name = group.get("categoryGroupName") or ""
            for item in group.get("items") or []:
                category_id = item.get("categoryId")
                name = item.get("categoryName")
                if not category_id or not name:
                    continue
                result.append({
                    "id": f"qq-{category_id}",
                    "value": str(category_id),
                    "name": name,
                    # QQ 的分类接口不给歌单数量，所以这里是 0；
                    # 前端只在 count>0 时才显示数字。
                    "count": 0,
                    "group": group_name,
                    "url": "https://y.qq.com/n/ryqq/category",
                })
        return result

    def _cover(self, album_mid: str | None, fallback: str = "") -> str:
        if album_mid:
            return f"https://y.qq.com/music/photo_new/T002R300x300M000{album_mid}.jpg"
        return fallback

    def _summary(self, item: dict) -> dict:
        creator = item.get("creator") or {}
        diss_id = str(item.get("dissid") or item.get("disstid") or "")
        return {
            "id": diss_id,
            "platform": self.id,
            "platformName": self.name,
            "title": item.get("dissname") or item.get("title") or "未命名歌单",
            "description": _clean(item.get("introduction") or item.get("desc")),
            "coverUrl": item.get("imgurl") or item.get("logo") or "",
            "trackCount": int(item.get("songnum") or item.get("song_cnt") or 0),
            "playCount": int(item.get("listennum") or item.get("visitnum") or 0),
            "creator": creator.get("name") or creator.get("nick") or self.name,
            "sourceUrl": f"https://y.qq.com/n/ryqq/playlist/{diss_id}",
        }

    def playlists(self, category: str, limit: int = 18) -> list[dict]:
        category_id = category or self.default_category
        if not str(category_id).isdigit():
            category_id = self.default_category
        data = self._get(
            "https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg",
            {
                "format": "json",
                "inCharset": "utf8",
                "outCharset": "utf-8",
                "platform": "yqq.json",
                "picmid": 1,
                "categoryId": category_id,
                # 5 = 按收听量排序，也就是"热门"。
                "sortId": 5,
                "sin": 0,
                "ein": max(0, limit - 1),
            },
        )
        return [self._summary(item) for item in ((data.get("data") or {}).get("list") or [])]

    #: QQ 的 song_num 上限是 30，传更大的值它照样只给 30 首，所以必须分页。
    _PAGE = 30
    #: 最多取多少首。和网易云那边保持一致 —— 再多前端也列不完，
    #: 而且每页一个外部请求，翻十页已经要好几秒。
    _MAX_TRACKS = 300

    def _detail_page(self, playlist_id: str, offset: int) -> dict:
        payload = {
            "comm": {
                "g_tk": 5381, "uin": 0, "format": "json",
                "inCharset": "utf-8", "outCharset": "utf-8",
                "notice": 0, "platform": "h5", "needNewCode": 1,
            },
            "req": {
                "module": "music.srfDissInfo.aiDissInfo",
                "method": "uniform_get_Dissinfo",
                "param": {
                    "disstid": int(playlist_id),
                    "userinfo": 1,
                    "tag": 1,
                    "song_begin": offset,
                    "song_num": self._PAGE,
                    "onlysonglist": 0,
                },
            },
        }
        data = self._get(
            "https://u.y.qq.com/cgi-bin/musicu.fcg",
            {"data": json.dumps(payload, ensure_ascii=False)},
        )
        block = data.get("req") or {}
        if block.get("code") not in (0, None):
            raise ValueError(f"QQ 音乐拒绝了这次请求（code {block.get('code')}）")
        return block.get("data") or {}

    def detail(self, playlist_id: str) -> tuple[dict, list[dict]]:
        if not str(playlist_id).isdigit():
            raise ValueError("QQ 音乐歌单编号必须是数字")

        first = self._detail_page(playlist_id, 0)
        info = first.get("dirinfo") or {}
        total = int(first.get("total_song_num") or 0)
        songs = list(first.get("songlist") or [])

        # 一页一个外部请求，所以三个条件里任意一个满足就停：
        # 拿够了 total、到了上限、或者这一页没返回新歌（防止死循环）。
        while len(songs) < min(total, self._MAX_TRACKS):
            page = self._detail_page(playlist_id, len(songs))
            batch = page.get("songlist") or []
            if not batch:
                break
            songs.extend(batch)

        tracks = []
        for item in songs[: self._MAX_TRACKS]:
            album = item.get("album") or {}
            singers = item.get("singer") or []
            tracks.append({
                "platform": "tx",
                "platformTrackId": item.get("mid") or str(item.get("id") or ""),
                "title": item.get("name") or item.get("title") or "",
                "artist": " / ".join(filter(None, [s.get("name") for s in singers])),
                "album": album.get("name") or "",
                "duration": int(item.get("interval") or 0),
                "coverUrl": self._cover(album.get("mid")),
            })

        body = first
        creator = info.get("creator") or {}
        summary = {
            "id": str(playlist_id),
            "platform": self.id,
            "platformName": self.name,
            "title": info.get("title") or "未命名歌单",
            "description": _clean(info.get("desc")),
            "coverUrl": info.get("picurl") or info.get("logo") or "",
            "trackCount": int(body.get("total_song_num") or len(tracks)),
            "playCount": int(info.get("listennum") or 0),
            "creator": creator.get("nick") or creator.get("name") or self.name,
            "sourceUrl": f"https://y.qq.com/n/ryqq/playlist/{playlist_id}",
        }
        return summary, tracks


# ----------------------------------------------------------------------
# 酷狗音乐（只能跳转）
# ----------------------------------------------------------------------


class KugouProvider:
    """酷狗的歌单接口需要客户端签名，没有稳定的公开入口。

    与其伪造一份写死的"热门分类"让用户以为抓到了，不如明确标成
    browse_only：前端把它渲染成一个"去官网看"的入口，不混在歌单里。
    """

    id = "kugou"
    name = "酷狗音乐"
    browse_only = True
    site_url = "https://www.kugou.com/yy/special/index/1-0-0.html"
    default_category = ""
    unavailable_reason = "酷狗的歌单接口需要客户端签名，暂时只能跳到官网浏览"

    def categories(self) -> list[dict]:
        return []

    def playlists(self, category: str, limit: int = 18) -> list[dict]:
        return []

    def detail(self, playlist_id: str):
        raise ValueError(self.unavailable_reason)


PROVIDERS = {
    provider.id: provider
    for provider in (NeteaseProvider(), QQProvider(), KugouProvider())
}

#: 顺序即前端平台选择器的顺序。能抓的排前面。
PROVIDER_ORDER = ["netease", "qq", "kugou"]


def provider_for(platform: str):
    provider = PROVIDERS.get(platform or "netease")
    if not provider:
        raise ValueError(f"不认识的平台：{platform}")
    return provider


def platform_list() -> list[dict]:
    """给前端的平台清单。不发任何网络请求 —— 这是一份静态能力声明。"""
    result = []
    for platform_id in PROVIDER_ORDER:
        provider = PROVIDERS[platform_id]
        result.append({
            "id": provider.id,
            "name": provider.name,
            "browseOnly": provider.browse_only,
            "siteUrl": provider.site_url,
            "defaultCategory": provider.default_category,
            "note": getattr(provider, "unavailable_reason", ""),
        })
    return result


def browse(platform: str, category: str, limit: int = 18) -> dict:
    """抓一个平台的分类和某分类下的热门歌单。

    分类和歌单分开 try：分类接口挂了不该让歌单也出不来，反之也一样。
    """
    provider = provider_for(platform)
    categories, playlists, errors = [], [], []

    if provider.browse_only:
        return {
            "platform": provider.id,
            "platformName": provider.name,
            "browseOnly": True,
            "siteUrl": provider.site_url,
            "categories": [],
            "playlists": [],
            "selectedCategory": "",
            "errors": [getattr(provider, "unavailable_reason", "")],
        }

    try:
        categories = provider.categories()
    except Exception as exc:
        errors.append(f"读取{provider.name}分类失败：{exc}")

    selected = category or provider.default_category
    # 传进来的分类不属于这个平台时（比如刚切了平台），退回默认分类，
    # 而不是拿一个无效值去请求然后返回空列表。
    if categories and selected not in {item["value"] for item in categories}:
        selected = provider.default_category

    try:
        playlists = provider.playlists(selected, limit=limit)
    except Exception as exc:
        errors.append(f"读取{provider.name}歌单失败：{exc}")

    return {
        "platform": provider.id,
        "platformName": provider.name,
        "browseOnly": False,
        "siteUrl": provider.site_url,
        "categories": categories,
        "playlists": playlists,
        "selectedCategory": selected,
        "errors": errors,
    }
