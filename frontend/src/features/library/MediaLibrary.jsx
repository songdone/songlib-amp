/**
 * 音乐库。
 *
 * 歌手 / 专辑 / 单曲三个视图共用一条工具条。
 * 卡片和网格已经是设计系统的（MediaCard / MediaGrid），
 * 这次把工具条、"继续载入"和空状态也换过来。
 *
 * 补上的一个缺口：搜不到东西时原来是一片空白网格 ——
 * 没有任何说明，看起来像加载失败。现在有空状态和清掉搜索的入口。
 */

import { Plus, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { EmptyState, Page } from "../../components/ui/Layout";
import { MediaCard, MediaGrid } from "../../components/ui/MediaCard";
import { ChipGroup } from "../../components/ui/Plan";
import { PageLoader } from "../../components/PageLoader";
import { TrackTable } from "../../components/TrackTable";
import { api } from "../../lib/api";
import { remember } from "../../lib/offlineIndex";
import { fmt } from "../../lib/format";
import { LibraryDetailPage } from "./LibraryDetailPage";

const TABS = [
  { id: "artists", label: "歌手" },
  { id: "albums", label: "专辑" },
  { id: "tracks", label: "单曲" },
];

const TAB_NAME = { artists: "歌手", albums: "专辑", tracks: "单曲" };

/* 路由的 tab 名是复数（artists/albums/tracks），
   离线索引里用单数的 kind。映射放在这里，不在两边各写一遍。 */
const OFFLINE_KINDS = { artists: "artist", albums: "album", tracks: "track" };

export function MediaLibrary({
  initialTab = "artists",
  initialDetail = null,
  play,
  previewBackdrop,
  onDetailBackdrop,
  onTabChange,
  onDetailChange,
}) {
  const [tab, setTab] = useState(initialTab);
  const [detail, setDetail] = useState(initialDetail);
  const [detailData, setDetailData] = useState(null);
  const [search, setSearch] = useState(
    () => localStorage.getItem("songlib-global-search") || "",
  );
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const libraryRequestRef = useRef(0);
  useEffect(() => {
    if (search) localStorage.removeItem("songlib-global-search");
  }, []);
  useEffect(() => {
    if (initialTab !== tab) setTab(initialTab);
  }, [initialTab]);
  useEffect(() => {
    setDetail(initialDetail);
  }, [initialDetail?.type, initialDetail?.ratingKey]);
  const load = async (requestId) => {
    setLoading(true);
    setLoadingMore(false);
    try {
      const first = await api(
        `/api/library/${tab}?page=1&pageSize=200&search=${encodeURIComponent(search)}`,
      );
      if (requestId !== libraryRequestRef.current) return;
      setData(first);
      setLoading(false);
      /* 顺手存进离线索引。浏览曲库是索引变全的主要来源 ——
         用户翻过一遍歌手和专辑，断连时就能查到大部分内容。
         remember 自己吞掉失败，存不下不影响在线使用。 */
      remember(OFFLINE_KINDS[tab], first.items || []);
      if (tab === "tracks" || first.items.length >= first.total) {
        return;
      }
      const pages = Math.ceil(first.total / first.pageSize);
      setLoadingMore(true);
      for (let page = 2; page <= pages; page += 4) {
        const batch = await Promise.all(
          Array.from(
            { length: Math.min(4, pages - page + 1) },
            (_, offset) =>
              api(
                `/api/library/${tab}?page=${page + offset}&pageSize=200&search=${encodeURIComponent(search)}`,
              ),
          ),
        );
        if (requestId !== libraryRequestRef.current) return;
        const items = batch.flatMap((result) => result.items || []);
        setData((value) => ({ ...first, items: [...value.items, ...items] }));
        remember(OFFLINE_KINDS[tab], items);
      }
    } finally {
      if (requestId === libraryRequestRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };
  useEffect(() => {
    const requestId = ++libraryRequestRef.current;
    const timer = setTimeout(() => load(requestId), 180);
    return () => {
      clearTimeout(timer);
      if (libraryRequestRef.current === requestId)
        libraryRequestRef.current += 1;
    };
  }, [tab, search]);
  useEffect(() => {
    if (!detail?.ratingKey) {
      setDetailData(null);
      return;
    }
    let cancelled = false;
    setDetailData(null);
    api(
      `/api/library/${detail.type}/${encodeURIComponent(detail.ratingKey)}`,
    )
      .then((result) => {
        if (!cancelled) setDetailData(result);
      })
      .catch(() => {
        if (!cancelled) setDetailData({ error: "这项读不出来，过会儿再试。" });
      });
    return () => {
      cancelled = true;
    };
  }, [detail?.type, detail?.ratingKey]);
  useEffect(() => {
    if (!detail) {
      onDetailBackdrop?.(null);
      return;
    }
    if (!detailData || detailData.error) return;
    const artist = detailData.artist;
    const subject =
      detail.type === "artists" ? detailData.artist : detailData.album;
    // 拿不到歌手背景就不铺图，交给 .ambient 环境光晕。
    const imageUrl = artist?.backgroundUrl || "";
    onDetailBackdrop?.({
      imageUrl,
      coverUrl: subject?.thumbUrl || artist?.thumbUrl || "",
      title: subject?.title || artist?.title || "",
      subtitle:
        detail.type === "artists" ? "当前歌手背景" : "当前专辑背景",
    });
  }, [
    detail?.type,
    detail?.ratingKey,
    detailData,
    onDetailBackdrop,
  ]);
  useEffect(
    () => () => {
      onDetailBackdrop?.(null);
    },
    [onDetailBackdrop],
  );
  const openDetail = (type, item) => {
    const next = { type, ratingKey: item.ratingKey };
    setDetail(next);
    onDetailChange?.(next);
  };
  const closeDetail = () => {
    setDetail(null);
    setDetailData(null);
    onDetailChange?.(null, tab);
  };
  const loadMore = async () => {
    if (loadingMore || data.items.length >= data.total) return;
    setLoadingMore(true);
    try {
      const page = Math.floor(data.items.length / 200) + 1;
      const next = await api(
        `/api/library/${tab}?page=${page}&pageSize=200&search=${encodeURIComponent(search)}`,
      );
      setData((value) => ({
        ...next,
        items: [...value.items, ...(next.items || [])],
      }));
    } finally {
      setLoadingMore(false);
    }
  };
  const showTracks = (item) => {
    setTab("tracks");
    setSearch(item.title || "");
    onTabChange?.("tracks");
  };
  const playFirst = async (item) => {
    const type = item.type === "artist" ? "artists" : "albums";
    const result = await api(
      `/api/library/${type}/${encodeURIComponent(item.ratingKey)}`,
    );
    const items = result.popularTracks || result.tracks || [];
    if (items[0])
      play?.(
        { ...items[0], source: "plex_item" },
        items.slice(1).map((track) => ({ ...track, source: "plex_item" })),
      );
  };
  if (detail) {
    return (
      <LibraryDetailPage
        type={detail.type}
        data={detailData}
        back={closeDetail}
        play={play}
        openDetail={openDetail}
      />
    );
  }
  const tabName = TAB_NAME[tab] || "内容";

  return (
    <Page className="library">
      <div className="library-toolbar">
        <ChipGroup
          label="浏览方式"
          options={TABS}
          value={tab}
          onChange={(id) => {
            setTab(id);
            setDetail(null);
            onTabChange?.(id);
          }}
        />

        <Field
          label={`搜索${tabName}`}
          hideLabel
          leading={Search}
          placeholder={`搜索${tabName}…`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <span className="library-toolbar__count">
          {data.items.length >= data.total
            ? `${fmt(data.total)} 项`
            : `${fmt(data.items.length)} / ${fmt(data.total)} 项`}
        </span>
      </div>

      {loading ? (
        <PageLoader />
      ) : !data.items.length ? (
        <EmptyState
          icon={Search}
          title={search ? `没有找到匹配的${tabName}` : `曲库里还没有${tabName}`}
          text={
            search
              ? "换个关键词试试。刚加进来的歌可能还没扫到。"
              : "连上 Plex 或指定 NAS 上的音乐目录，扫描完成后这里就会有内容。"
          }
          action={
            search ? (
              <Button icon={X} onClick={() => setSearch("")}>
                清掉搜索
              </Button>
            ) : null
          }
        />
      ) : tab === "tracks" ? (
        <TrackTable items={data.items} play={play} />
      ) : (
        <MediaGrid min={168}>
          {data.items.map((item) => (
            <MediaCard
              key={item.ratingKey}
              kind={tab === "artists" ? "artist" : "album"}
              title={item.title}
              subtitle={
                tab === "artists"
                  ? (item.tags?.genre || []).slice(0, 2).join(" · ") || "音乐人"
                  : [item.parentTitle, item.year].filter(Boolean).join(" · ")
              }
              coverUrl={item.thumbUrl}
              onOpen={() => openDetail(tab, item)}
              onPlay={() => playFirst(item)}
              playLabel={
                tab === "artists"
                  ? `播放 ${item.title} 的曲目`
                  : `播放专辑 ${item.title}`
              }
            />
          ))}
        </MediaGrid>
      )}

      {!loading && data.items.length > 0 && data.items.length < data.total && (
        <div className="library-more">
          <Button
            icon={Plus}
            loading={loadingMore}
            onClick={loadMore}
          >
            {loadingMore
              ? `正在载入剩余 ${fmt(data.total - data.items.length)} 项`
              : `继续载入剩余 ${fmt(data.total - data.items.length)} 项`}
          </Button>
        </div>
      )}
    </Page>
  );
}
