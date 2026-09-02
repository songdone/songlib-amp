import { Airplay, ChevronRight, CircleAlert, Disc3, ListMusic, Music2, Play, Plus, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Empty } from "../../components/Empty";
import { PageLoader } from "../../components/PageLoader";
import { SectionHead } from "../../components/SectionHead";
import { api } from "../../lib/api";
import { recommendationPlaybackInput } from "../../lib/contracts";
import { fmt, timeAgo } from "../../lib/format";
import { coverUrlFor } from "../../lib/media";
import { usePlexSessions } from "../now-playing/usePlexSessions";
import { usePlayerCore } from "../player/PlayerProvider";

export function Dashboard({
  stats,
  jobs,
  loading,
  navigate,
  runJob,
  isAdmin = true,
  plexConfigured = false,
}) {
  const player = usePlayerCore();
  const remote = usePlexSessions({
    pollMs: 8000,
    quietErrors: true,
    enabled: plexConfigured,
  });
  const [home, setHome] = useState({
    artists: [],
    albums: [],
    tracks: [],
    playlists: [],
    recommendations: [],
  });
  const [contentLoading, setContentLoading] = useState(true);
  useEffect(() => {
    Promise.all([
      api("/api/library/artists?pageSize=12").catch(() => ({ items: [] })),
      api("/api/library/albums?pageSize=12").catch(() => ({ items: [] })),
      api("/api/library/tracks?pageSize=12").catch(() => ({ items: [] })),
      api("/api/playlists").catch(() => ({ items: [] })),
      api("/api/recommendations").catch(() => ({ items: [] })),
    ])
      .then(([artists, albums, tracks, playlists, recommendations]) =>
        setHome({
          artists: artists.items || [],
          albums: albums.items || [],
          tracks: tracks.items || [],
          playlists: playlists.items || [],
          recommendations: recommendations.items || [],
        }),
      )
      .finally(() => setContentLoading(false));
  }, []);
  if (loading) return <PageLoader />;
  const hour = new Date().getHours();
  const greeting = hour < 6 ? "夜深了" : hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  const history = (player.history || []).slice(0, 6);
  const continueItems = history.length ? history : home.tracks.slice(0, 6);
  const playItems = (items, index = 0) => {
    const playable = items
      .map((item) => ({
        ...item,
        source: item.source || (item.ratingKey ? "plex_item" : item.source),
      }))
      .filter((item) => item.ratingKey || item.audioUrl || item.path || item.file);
    if (playable[index]) player.play(playable[index], playable.slice(index + 1));
  };
  const openAlbum = async (album) => {
    const result = await api(
      `/api/library/albums/${encodeURIComponent(album.ratingKey)}`,
    );
    playItems(result.tracks || []);
  };
  const heroAlbum = home.albums[0];
  const heroArtist =
    home.artists.find(
      (artist) =>
        artist.ratingKey === heroAlbum?.parentRatingKey ||
        artist.title === heroAlbum?.parentTitle,
    ) || home.artists[0];
  const heroCover = heroArtist?.thumbUrl || heroAlbum?.thumbUrl || "";
  const activeRemoteSessions = remote.sessions.filter((session) => session.playing);
  const openRemoteSession = (session) => {
    localStorage.setItem("songlib-playback-source", `plex:${session.id}`);
    if (player.isPlaying) player.pause();
    navigate("player");
  };
  return (
    <div className="page dashboard-page home-v2">
      {/* 搜索入口只保留顶栏那一个。这里原本还有一个 home-search-shortcut，
          和顶栏搜索框同屏出现，是两次改版叠加留下的重复入口。 */}
      <header className="home-heading">
        <div>
          <span>{greeting}</span>
          <h1>听点喜欢的</h1>
        </div>
      </header>

      <section className="home-focus">
        <div className="home-focus-copy">
          <span className="home-focus-label">最近加入</span>
          <h2>{heroAlbum?.title || "你的私人音乐库"}</h2>
          <p>
            {heroAlbum?.parentTitle || "随时从自己的 NAS 继续播放"}
            <span>
              {fmt(stats?.tracks || home.tracks.length)} 首歌曲 ·{" "}
              {fmt(stats?.albums || home.albums.length)} 张专辑
            </span>
          </p>
          <div className="home-focus-actions">
            <button
              className="primary home-play-button"
              disabled={!heroAlbum && !home.tracks.length}
              onClick={() => (heroAlbum ? openAlbum(heroAlbum) : playItems(home.tracks))}
            >
              <Play fill="currentColor" />
              播放
            </button>
            <button className="secondary" onClick={() => navigate("library")}>
              查看音乐库
            </button>
          </div>
        </div>
        <div className="home-focus-visual" aria-hidden="true">
          <span className="home-focus-shadow" />
          <span className="home-focus-disc">
            <i className="home-focus-grooves" />
            <span className="home-focus-cover">
              {heroCover ? <img src={heroCover} alt="" /> : <Disc3 />}
            </span>
            <b className="home-focus-spindle" />
          </span>
          <span className="home-focus-tonearm">
            <i />
            <b />
          </span>
        </div>
      </section>

      <section className="home-device-center" aria-label="播放设备与电视投屏">
        <button className="home-device-primary" onClick={() => navigate("player")}>
          <span className="home-device-icon"><Airplay /></span>
          <span>
            <small>播放设备与电视</small>
            <strong>控制播放、查看歌词、投到电视</strong>
          </span>
          <ChevronRight />
        </button>
        {activeRemoteSessions.slice(0, 3).map((session) => (
          <button
            className="home-remote-session"
            key={session.id}
            onClick={() => openRemoteSession(session)}
          >
            <span className="home-live-dot" />
            <span>
              <small>{session.deviceName || "Plexamp"} 正在播放</small>
              <strong>{session.title || "未命名歌曲"}</strong>
              <em>{session.artist || "未知歌手"}</em>
            </span>
            <span>{session.controllable ? "可控制" : "仅跟随"}</span>
            <ChevronRight />
          </button>
        ))}
      </section>

      <SectionHead
        title="继续播放"
        action={
          <button className="text-button" onClick={() => navigate("me")}>
            播放记录
            <ChevronRight />
          </button>
        }
      />
      <section className="home-listening-grid">
        {continueItems.length ? (
          continueItems.map((item, index) => (
            <button
              className="continue-card"
              key={`${item.id || item.ratingKey || item.title}-${index}`}
              onClick={() => playItems(continueItems, index)}
            >
              <span className="continue-art">
                {coverUrlFor(item) ? <img src={coverUrlFor(item)} alt="" /> : <Music2 />}
                <i><Play fill="currentColor" /></i>
              </span>
              <span className="continue-copy">
                <strong>{item.title || "未命名歌曲"}</strong>
                <small>{item.artist || item.grandparentTitle || "未知艺人"}</small>
              </span>
              <span className="continue-time">{item.playedAt ? timeAgo(item.playedAt) : "播放"}</span>
            </button>
          ))
        ) : contentLoading ? (
          <PageLoader />
        ) : (
          <Empty icon={Music2} title="还没有播放记录" text="从音乐库挑一首开始吧。" />
        )}
      </section>

      <SectionHead
        title="最近加入"
        action={<button className="text-button" onClick={() => navigate("library")}>查看全部<ChevronRight /></button>}
      />
      <section className="home-album-grid">
        {home.albums.slice(0, 8).map((item) => (
          <button className="home-album-card" key={item.ratingKey} onClick={() => openAlbum(item)}>
            <span>
              {item.thumbUrl ? <img src={item.thumbUrl} alt="" /> : <Disc3 />}
              <i><Play fill="currentColor" /></i>
            </span>
            <strong>{item.title || "未命名专辑"}</strong>
            <small>{item.parentTitle || item.year || "未知艺人"}</small>
          </button>
        ))}
      </section>

      <div className="home-two-column">
        <section>
          <SectionHead
            title="你的歌单"
            action={<button className="text-button" onClick={() => navigate("playlists")}>全部歌单<ChevronRight /></button>}
          />
          <div className="home-playlist-stack">
            {home.playlists.slice(0, 4).map((item, index) => (
              <button key={item.id} onClick={() => navigate("playlists")}>
                <span className={`playlist-tile tone-${index % 4}`}><ListMusic /></span>
                <span><strong>{item.name}</strong><small>{item.itemCount || 0} 首歌曲</small></span>
                <ChevronRight />
              </button>
            ))}
            {!home.playlists.length && !contentLoading && (
              <button onClick={() => navigate("playlists")}>
                <span className="playlist-tile"><Plus /></span>
                <span><strong>创建第一张歌单</strong><small>也可导入 M3U 或平台分享链接</small></span>
                <ChevronRight />
              </button>
            )}
          </div>
        </section>
        <section>
          <SectionHead
            title="为你发现"
            action={<button className="text-button" onClick={() => navigate("discover")}>更多推荐<ChevronRight /></button>}
          />
          <div className="home-discovery-list">
            {home.recommendations.slice(0, 4).map((item, index) => (
              <button
                key={item.id || `${item.title}-${index}`}
                onClick={() => {
                  const target = recommendationPlaybackInput(item);
                  if (target) player.play(target);
                  else navigate("discover");
                }}
              >
                <span className="discovery-number">{String(index + 1).padStart(2, "0")}</span>
                <span><strong>{item.title}</strong><small>{item.artist || "未知艺人"}</small></span>
                <span className="discovery-reason">{(item.reasons || [item.inLibrary ? "曲库精选" : "新发现"])[0]}</span>
              </button>
            ))}
            {!home.recommendations.length && !contentLoading && (
              <button onClick={() => navigate("discover")}>
                <span className="discovery-number"><Sparkles /></span>
                <span><strong>开始形成你的推荐</strong><small>播放、收藏或跳过几首歌曲</small></span>
                <ChevronRight />
              </button>
            )}
          </div>
        </section>
      </div>

      {isAdmin && (stats.failedTasks > 0 || stats.waitingIngest > 0) && (
        <button className="home-admin-notice" onClick={() => navigate("manage")}>
          <CircleAlert />
          <span>
            <strong>有内容需要确认</strong>
            <small>
              {stats.waitingIngest || 0} 个待入库，{stats.failedTasks || 0} 个任务失败
            </small>
          </span>
          <ChevronRight />
        </button>
      )}
    </div>
  );
}
