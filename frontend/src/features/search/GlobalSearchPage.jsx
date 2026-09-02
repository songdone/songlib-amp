import { Album, CircleAlert, Download, Heart, ListMusic, LoaderCircle, Music2, Play, Search, Tags } from "lucide-react";
import { useEffect, useState } from "react";
import { Empty } from "../../components/Empty";
import { PageLoader } from "../../components/PageLoader";
import { SectionHead } from "../../components/SectionHead";
import { api } from "../../lib/api";
import { usePlayerCore } from "../player/PlayerProvider";

export function GlobalSearchPage({ play, navigate, isAdmin }) {
  const player = usePlayerCore();
  const [query, setQuery] = useState(
      () => localStorage.getItem("songlib-global-search") || "",
    ),
    [loading, setLoading] = useState(false),
    [groups, setGroups] = useState({
      tracks: [],
      artists: [],
      albums: [],
      pending: [],
    }),
    [error, setError] = useState("");
  const search = async (event) => {
    event?.preventDefault?.();
    const text = query.trim();
    if (!text) return;
    localStorage.setItem("songlib-global-search", text);
    setLoading(true);
    setError("");
    try {
      const [tracks, artists, albums, pending] = await Promise.all([
        api(
          `/api/catalog/unified?limit=40&q=${encodeURIComponent(text)}`,
        ).catch(() => ({ items: [] })),
        api(
          `/api/library/artists?pageSize=12&search=${encodeURIComponent(text)}`,
        ).catch(() => ({ items: [] })),
        api(
          `/api/library/albums?pageSize=12&search=${encodeURIComponent(text)}`,
        ).catch(() => ({ items: [] })),
        isAdmin
          ? api("/api/downloads/pending").catch(() => ({ items: [] }))
          : Promise.resolve({ items: [] }),
      ]);
      setGroups({
        tracks: tracks.items || [],
        artists: artists.items || [],
        albums: albums.items || [],
        pending: (pending.items || []).filter((item) =>
          JSON.stringify(item).includes(text),
        ),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (query) search();
  }, []);
  const groupTotal = Object.values(groups).reduce(
    (sum, items) => sum + (items?.length || 0),
    0,
  );
  const TrackActions = ({ item }) => (
    <div className="search-row-actions">
      <button title="播放" onClick={() => play(item)}>
        <Play />
      </button>
      <button title="下一首" onClick={() => player.addToQueue(item)}>
        <ListMusic />
      </button>
      <button title="收藏" onClick={() => player.toggleFavorite(item)}>
        <Heart />
      </button>
      {isAdmin && (
        <button
          title="编辑/定位"
          onClick={() =>
            navigate(
              item.sourceTypes?.includes("local_file") ? "local" : "library",
            )
          }
        >
          <Tags />
        </button>
      )}
    </div>
  );
  return (
    <div className="page global-search-page">
      <section className="page-intro">
        <h1>全局搜索</h1>
        <p>同一首歌只出现一次。本地文件和 Plex 里的版本都归在它下面，可以随时换。</p>
      </section>
      <form className="catalog-search" onSubmit={search}>
        <div className="big-search">
          <Search />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索歌曲、艺术家、专辑、文件名…"
          />
          <button className="primary" disabled={loading}>
            {loading ? <LoaderCircle className="spin" /> : "搜索"}
          </button>
        </div>
      </form>
      {error && (
        <div className="inline-error">
          <CircleAlert />
          {error}
        </div>
      )}
      {loading ? (
        <PageLoader />
      ) : (
        <div className="search-groups">
          {!groupTotal && query ? (
            <Empty
              icon={Search}
              title="没有找到匹配内容"
              text="换个词试试。刚加进来的歌可能还没扫到，可以去「文件与标签」重扫一遍。"
            />
          ) : null}
          <section className="panel">
            <SectionHead
              title="单曲"
              note={`${groups.tracks.length} 首`}
            />
            {groups.tracks.map((item) => (
              <div className="search-result-row" key={item.id}>
                <Music2 />
                <div>
                  <strong>{item.title}</strong>
                  <span>
                    {item.artist || "未知歌手"} · {item.album || "未知专辑"}
                    <em className={`match-badge ${item.matchStatus}`}>
                      {item.sourceSummary}
                    </em>
                  </span>
                </div>
                <TrackActions item={item} />
              </div>
            ))}
          </section>
          <section className="panel">
            <SectionHead
              title="艺人 / 专辑"
              note={`${groups.artists.length} 位歌手 · ${groups.albums.length} 张专辑`}
            />
            <div className="search-card-grid">
              {[
                ...groups.artists.map((item) => ({ ...item, type: "artists" })),
                ...groups.albums.map((item) => ({ ...item, type: "albums" })),
              ].map((item) => (
                <button
                  key={`${item.type}-${item.ratingKey}`}
                  onClick={() => {
                    navigate("library");
                    localStorage.setItem("songlib-global-search", item.title);
                  }}
                >
                  <div>
                    {item.thumbUrl ? (
                      <img src={item.thumbUrl} alt="" />
                    ) : (
                      <Album />
                    )}
                  </div>
                  <strong>{item.title}</strong>
                  <span>{item.type === "artists" ? "艺人" : "专辑"}</span>
                </button>
              ))}
            </div>
          </section>
          {isAdmin && (
            <section className="panel">
              <SectionHead
                title="待修复 / 待入库"
                note={`${groups.pending.length} 首可以下载`}
              />
              {groups.pending.map((item) => (
                <div className="search-result-row" key={item.jobId}>
                  <Download />
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.downloadPath || "待确认路径"}</span>
                  </div>
                  <button
                    className="secondary small"
                    onClick={() => navigate("download")}
                  >
                    去处理
                  </button>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
