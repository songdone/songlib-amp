import { CircleAlert, Download, ListMusic, LoaderCircle, LocateFixed, Play, Radio, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Empty } from "../../components/Empty";
import { PageLoader } from "../../components/PageLoader";
import { SectionHead } from "../../components/SectionHead";
import { api } from "../../lib/api";
import { fmt } from "../../lib/format";

function DiscoverPage({ play, navigate, isAdmin = true }) {
  const [feed, setFeed] = useState({ categories: [], playlists: [] }),
    [category, setCategory] = useState("热门"),
    [detail, setDetail] = useState(null),
    [detailPage, setDetailPage] = useState(1);
  const [loading, setLoading] = useState(true),
    [detailLoading, setDetailLoading] = useState(false),
    [error, setError] = useState(""),
    [queueing, setQueueing] = useState(false);
  const loadFeed = async (name) => {
    setLoading(true);
    setError("");
    try {
      const data = await api(
        `/api/discovery/playlists?category=${encodeURIComponent(name || "热门")}`,
      );
      setFeed(data);
      setCategory(data.selectedCategory || name || "热门");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    loadFeed("热门");
  }, []);
  const openPlaylist = async (item) => {
    setDetailLoading(true);
    setError("");
    setDetailPage(1);
    try {
      setDetail(await api(`/api/discovery/playlists/${item.id}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setDetailLoading(false);
    }
  };
  const playMatched = (track) => track?.localTrack && play(track.localTrack);
  const locateMatched = async (track) => {
    const resources = track?.localTrack?.resources || [];
    const local = resources.find((item) => item.type === "local_file");
    if (local?.path) {
      await navigator.clipboard?.writeText(local.path);
      return;
    }
    const plexResource = resources.find((item) => item.type === "plex_item");
    if (plexResource?.id) {
      const info = await api(`/api/plex/items/${plexResource.id}/playback`);
      if (info.openPlexUrl) window.open(info.openPlexUrl, "_blank");
    }
  };
  const queueMissing = async () => {
    const tracks = (detail?.tracks || []).filter((item) => item.canDownload);
    if (!tracks.length || !detail.downloadSource) return;
    setQueueing(true);
    setError("");
    try {
      const result = await api("/api/discovery/download-missing", {
        method: "POST",
        body: JSON.stringify({
          sourceId: detail.downloadSource.id,
          quality: "320k",
          tracks,
        }),
      });
      if (result.created) {
        navigate?.("tasks");
      } else setError(result.errors?.[0]?.error || "没有可加入的下载候选");
    } catch (err) {
      setError(err.message);
    } finally {
      setQueueing(false);
    }
  };
  const categories = feed.categories || [],
    playlists = feed.playlists || [];
  const detailPageSize = 50;
  const detailTracks = detail?.tracks || [];
  const detailPages = Math.max(
    1,
    Math.ceil(detailTracks.length / detailPageSize),
  );
  const visibleDetailTracks = detailTracks.slice(
    (detailPage - 1) * detailPageSize,
    detailPage * detailPageSize,
  );
  return (
    <div className="page discover-page">
      <section className="page-intro">
        <h1>发现</h1>
        <p>翻翻别人的歌单。库里已经有的歌可以直接点开播放，没有的会标出来。</p>
      </section>
      {error && (
        <div className="inline-error">
          <CircleAlert />
          {error}
        </div>
      )}
      <div className="discover-layout">
        <section className="panel discover-panel playlist-taxonomy">
          <SectionHead
            title="歌单分类"
            note={
              feed.source === "netease-hottags"
                ? "网易云音乐公开分类"
                : "平台暂时不可用"
            }
          />
          <div className="playlist-tags">
            {categories.map((item) => (
              <button
                className={category === item.name ? "active" : ""}
                key={item.id}
                onClick={() => {
                  setDetail(null);
                  setDetailPage(1);
                  loadFeed(item.name);
                }}
              >
                <span>{item.name}</span>
                {item.count ? <b>{fmt(item.count)}</b> : null}
              </button>
            ))}
          </div>
        </section>
        <section className="panel discover-panel">
          <SectionHead
            title={`${category}歌单`}
            note="选择歌单后查看本地匹配结果"
          />
          {loading ? (
            <PageLoader />
          ) : playlists.length ? (
            <div className="playlist-card-grid">
              {playlists.map((item) => (
                <button key={item.id} onClick={() => openPlaylist(item)}>
                  <div>
                    {item.coverUrl ? (
                      <img src={item.coverUrl} alt="" />
                    ) : (
                      <ListMusic />
                    )}
                  </div>
                  <strong>{item.title}</strong>
                  <span>
                    {item.creator} · {fmt(item.trackCount)} 首
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <Empty
              icon={Radio}
              title="暂时没有读到歌单"
              text="稍后刷新分类；本地曲库和播放器不受影响。"
            />
          )}
        </section>
        {(detailLoading || detail) && (
          <section className="panel discover-panel playlist-detail">
            <SectionHead
              title={detail?.playlist?.title || "正在读取歌单"}
              note={
                detail
                  ? `${detail.summary.matched} 首已匹配 · ${detail.summary.downloadable} 首可下载 · ${detail.summary.unavailable} 首无法识别`
                  : ""
              }
              action={
                detail && isAdmin && detail.summary.downloadable ? (
                  <button
                    className="primary small"
                    disabled={queueing}
                    onClick={queueMissing}
                  >
                    {queueing ? (
                      <LoaderCircle className="spin" />
                    ) : (
                      <Download />
                    )}
                    批量加入下载
                  </button>
                ) : null
              }
            />
            {detailLoading ? (
              <PageLoader />
            ) : (
              <div className="playlist-match-table">
                {visibleDetailTracks.map((item, index) => (
                  <div key={`${item.platformTrackId}-${index}`}>
                    <span>
                      {String(
                        (detailPage - 1) * detailPageSize + index + 1,
                      ).padStart(2, "0")}
                    </span>
                    <div>
                      <strong>{item.title}</strong>
                      <small>
                        {item.artist || "未知歌手"} · {item.album || "未知专辑"}
                      </small>
                    </div>
                    <i className={item.matchStatus}>
                      {item.matchStatus === "matched"
                        ? `已匹配 · ${item.localTrack?.sourceSummary || "本地"}`
                        : item.canDownload
                          ? "可下载"
                          : "无法识别"}
                    </i>
                    {item.matchStatus === "matched" ? (
                      <div className="inline-task-actions">
                        <button onClick={() => playMatched(item)}><Play />播放</button>
                        <button onClick={() => locateMatched(item)}><LocateFixed />{item.localTrack?.sourceTypes?.includes("local_file") ? "复制路径" : "打开 Plex"}</button>
                      </div>
                    ) : item.canDownload && isAdmin ? (
                      <button
                        onClick={() => {
                          localStorage.setItem(
                            "songlib-download-query",
                            `${item.title} ${item.artist}`,
                          );
                          navigate?.("download");
                        }}
                      >
                        <Download />
                        下载
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                ))}
              </div>
            )}
            {!detailLoading && detailTracks.length > detailPageSize && (
              <div className="pagination">
                <button
                  className="secondary small"
                  disabled={detailPage <= 1}
                  onClick={() => setDetailPage((value) => value - 1)}
                >
                  上一页
                </button>
                <span>
                  第 {detailPage} / {detailPages} 页 · 共 {detailTracks.length}{" "}
                  首
                </span>
                <button
                  className="secondary small"
                  disabled={detailPage >= detailPages}
                  onClick={() => setDetailPage((value) => value + 1)}
                >
                  下一页
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
