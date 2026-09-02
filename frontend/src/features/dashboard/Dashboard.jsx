/**
 * 首页。
 *
 * 重构要点：
 *
 * 1. hero 原本是一套纯 CSS 画的拟物黑胶唱盘（唱片、纹路、唱臂、转轴），
 *    占掉四成宽度和 470px 高度，"继续播放"被压到首屏外。
 *    现在让真实专辑封面本身作为视觉主体 —— 成熟音乐应用都是这么做的，
 *    封面是内容，画一个假唱盘是装饰。
 *
 * 2. "播放设备与电视 / 控制播放、查看歌词、投到电视"原先是常驻一整行。
 *    那是一句功能清单，不是状态。现在只在真的有设备在放歌时出现，
 *    没有会话就不占地方 —— 侧栏本来就有"正在播放"入口。
 *
 * 3. 文案改成对用户说话：不写"随时从自己的 NAS 继续播放"这类介绍语，
 *    也不把数据库统计当卖点摆在标题旁边。
 */

import { CircleAlert, ListMusic, Music2, Play, Plus, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Cover } from "../../components/ui/Cover";
import { MediaCard, MediaGrid } from "../../components/ui/MediaCard";
import {
  EmptyState,
  ListGroup,
  ListRow,
  Page,
  PageHeader,
  Section,
  SectionHeader,
} from "../../components/ui/Layout";
import { PageLoader } from "../../components/PageLoader";
import { api } from "../../lib/api";
import { recommendationPlaybackInput } from "../../lib/contracts";
import { fmt, timeAgo } from "../../lib/format";
import { coverUrlFor } from "../../lib/media";
import { usePlexSessions } from "../now-playing/usePlexSessions";
import { usePlayerCore } from "../player/PlayerProvider";

/** 按当地时间打招呼。夜里两点还在听歌的人不该被说"早上好"。 */
const greetingFor = (hour) => {
  if (hour < 5) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
};

export function Dashboard({
  stats,
  loading,
  navigate,
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
  const heroCover = heroAlbum?.thumbUrl || "";
  const canPlayHero = Boolean(heroAlbum) || home.tracks.length > 0;
  const activeSessions = remote.sessions.filter((session) => session.playing);
  const needsAttention =
    isAdmin && ((stats?.failedTasks || 0) > 0 || (stats?.waitingIngest || 0) > 0);

  const openRemoteSession = (session) => {
    localStorage.setItem("songlib-playback-source", `plex:${session.id}`);
    if (player.isPlaying) player.pause();
    navigate("player");
  };

  return (
    <Page className="home">
      <PageHeader eyebrow={greetingFor(new Date().getHours())} title="听点喜欢的" />

      {/* --- 焦点专辑：封面即视觉 --- */}
      {heroAlbum ? (
        <Section className="home-hero">
          {/* 封面外一圈跟随品牌色的柔光描边，让它从卡片表面浮起来。 */}
          <div className="home-hero__art glow-ring">
            <Cover src={heroCover} title={heroAlbum.title} shape="square" />
          </div>
          <div className="home-hero__copy">
            <p className="home-hero__label">最近加入</p>
            <h2 className="home-hero__title">{heroAlbum.title || "未命名专辑"}</h2>
            <p className="home-hero__meta">
              {[heroAlbum.parentTitle, heroAlbum.year].filter(Boolean).join(" · ")}
            </p>
            <div className="home-hero__actions">
              <Button
                variant="primary"
                size="lg"
                icon={Play}
                disabled={!canPlayHero}
                onClick={() =>
                  heroAlbum ? openAlbum(heroAlbum) : playItems(home.tracks)
                }
              >
                播放这张专辑
              </Button>
              <Button size="lg" onClick={() => navigate("library")}>
                去音乐库
              </Button>
            </div>
          </div>
        </Section>
      ) : (
        !contentLoading && (
          <EmptyState
            icon={Music2}
            title="音乐库还是空的"
            text="连上 Plex 或指定 NAS 上的音乐目录，扫描完成后这里就会有内容。"
            action={
              <Button variant="primary" onClick={() => navigate("settings")}>
                去连接音乐库
              </Button>
            }
          />
        )
      )}

      {/* --- 只在真的有设备在放歌时才出现 --- */}
      {activeSessions.length > 0 && (
        <Section>
          <SectionHeader
            title="其他设备正在放"
            note="点进去可以跟随进度，或直接接管控制"
          />
          <ListGroup>
            {activeSessions.slice(0, 3).map((session) => (
              <ListRow
                key={session.id}
                leading={
                  <Cover
                    src={session.coverUrl}
                    title={session.title}
                    size="40px"
                    shape="square"
                  />
                }
                title={session.title || "未知歌曲"}
                subtitle={`${session.artist || "未知歌手"} · ${session.deviceName || "Plexamp"}`}
                trailing={session.controllable ? "可控制" : "仅跟随"}
                onClick={() => openRemoteSession(session)}
              />
            ))}
          </ListGroup>
        </Section>
      )}

      {/* --- 继续播放 --- */}
      <Section>
        <SectionHeader
          title="继续播放"
          moreLabel="全部记录"
          onMore={() => navigate("me")}
        />
        {continueItems.length ? (
          <ListGroup>
            {continueItems.map((item, index) => (
              <ListRow
                key={`${item.id || item.ratingKey || item.title}-${index}`}
                leading={
                  <Cover
                    src={coverUrlFor(item)}
                    title={item.title}
                    size="40px"
                    shape="square"
                  />
                }
                title={item.title || "未命名歌曲"}
                subtitle={item.artist || item.grandparentTitle || "未知歌手"}
                trailing={item.playedAt ? timeAgo(item.playedAt) : null}
                chevron={false}
                onClick={() => playItems(continueItems, index)}
              />
            ))}
          </ListGroup>
        ) : contentLoading ? (
          <PageLoader />
        ) : (
          <EmptyState
            icon={Music2}
            title="还没有播放记录"
            text="放几首歌之后，这里会留下你听过什么。"
            action={
              <Button variant="primary" onClick={() => navigate("library")}>
                去挑一首
              </Button>
            }
          />
        )}
      </Section>

      {/* --- 最近加入 --- */}
      {home.albums.length > 1 && (
        <Section>
          <SectionHeader title="最近加入" onMore={() => navigate("library")} />
          <MediaGrid min={148}>
            {home.albums.slice(1, 9).map((item) => (
              <MediaCard
                key={item.ratingKey}
                kind="album"
                title={item.title}
                subtitle={item.parentTitle || item.year}
                coverUrl={item.thumbUrl}
                onOpen={() => openAlbum(item)}
                onPlay={() => openAlbum(item)}
                playLabel={`播放专辑 ${item.title}`}
              />
            ))}
          </MediaGrid>
        </Section>
      )}

      {/* --- 歌单与推荐并排 --- */}
      <div className="home-columns">
        <Section>
          <SectionHeader
            title="你的歌单"
            moreLabel="全部歌单"
            onMore={() => navigate("playlists")}
          />
          {home.playlists.length ? (
            <ListGroup>
              {home.playlists.slice(0, 4).map((item) => (
                <ListRow
                  key={item.id}
                  leading={
                    <span className="home-playlist-icon">
                      <ListMusic />
                    </span>
                  }
                  title={item.name}
                  subtitle={`${fmt(item.itemCount || 0)} 首`}
                  onClick={() => navigate("playlists")}
                />
              ))}
            </ListGroup>
          ) : (
            !contentLoading && (
              <EmptyState
                icon={ListMusic}
                title="还没有歌单"
                text="可以从零建一张，也可以导入 M3U 或平台分享链接。"
                action={
                  <Button
                    variant="primary"
                    icon={Plus}
                    onClick={() => navigate("playlists")}
                  >
                    建一张歌单
                  </Button>
                }
              />
            )
          )}
        </Section>

        <Section>
          <SectionHeader
            title="猜你想听"
            note="根据你听过、收藏和跳过的歌得出"
            moreLabel="更多"
            onMore={() => navigate("discover")}
          />
          {home.recommendations.length ? (
            <ListGroup>
              {home.recommendations.slice(0, 4).map((item, index) => (
                <ListRow
                  key={item.id || `${item.title}-${index}`}
                  leading={
                    <Cover
                      src={coverUrlFor(item)}
                      title={item.title}
                      size="40px"
                      shape="square"
                    />
                  }
                  title={item.title}
                  subtitle={item.artist || "未知歌手"}
                  trailing={
                    (item.reasons || [item.inLibrary ? "库里有" : "新发现"])[0]
                  }
                  chevron={false}
                  onClick={() => {
                    const target = recommendationPlaybackInput(item);
                    if (target) player.play(target);
                    else navigate("discover");
                  }}
                />
              ))}
            </ListGroup>
          ) : (
            !contentLoading && (
              <EmptyState
                icon={Sparkles}
                title="推荐还在攒素材"
                text="多听几首、收藏或跳过几次，这里就会开始给结果。"
              />
            )
          )}
        </Section>
      </div>

      {/* --- 需要处理的事，放在最后，不打断听歌 --- */}
      {needsAttention && (
        <ListGroup>
          <ListRow
            leading={
              <span className="home-attention-icon">
                <CircleAlert />
              </span>
            }
            title="有几件事等你处理"
            subtitle={[
              (stats.waitingIngest || 0) > 0 &&
                `${stats.waitingIngest} 首下载完等确认入库`,
              (stats.failedTasks || 0) > 0 && `${stats.failedTasks} 个任务需要重试`,
            ]
              .filter(Boolean)
              .join("，")}
            onClick={() => navigate("manage")}
          />
        </ListGroup>
      )}
    </Page>
  );
}
