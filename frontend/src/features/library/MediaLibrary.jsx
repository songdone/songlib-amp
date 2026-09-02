import { LoaderCircle, Plus, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MediaCard, MediaGrid } from "../../components/ui/MediaCard";
import { PageLoader } from "../../components/PageLoader";
import { TrackTable } from "../../components/TrackTable";
import { api } from "../../lib/api";
import { fmt } from "../../lib/format";
import { LibraryDetailPage } from "./LibraryDetailPage";

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
        if (!cancelled) setDetailData({ error: "无法读取这项资料，请稍后重试。" });
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
  return (
    <div className="page library-page">
      <div className="library-toolbar">
        <div className="segmented">
          {[
            ["artists", "歌手"],
            ["albums", "专辑"],
            ["tracks", "单曲"],
          ].map(([id, label]) => (
            <button
              className={tab === id ? "active" : ""}
              onClick={() => {
                setTab(id);
                setDetail(null);
                onTabChange?.(id);
              }}
              key={id}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="search-field">
          <Search />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`搜索${tab === "artists" ? "歌手" : tab === "albums" ? "专辑" : "单曲"}…`}
          />
        </div>
        <span className="result-count">
          {fmt(data.items.length)} / {fmt(data.total)} 项
        </span>
      </div>
      {loading ? (
        <PageLoader />
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
      {!loading && data.items.length < data.total && (
        <div className="library-load-more">
          <button className="secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? <LoaderCircle className="spin" /> : <Plus />}
            {loadingMore
              ? `正在载入剩余 ${fmt(data.total - data.items.length)} 项`
              : `继续载入剩余 ${fmt(data.total - data.items.length)} 项`}
          </button>
        </div>
      )}
    </div>
  );
}
