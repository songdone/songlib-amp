/**
 * 搜索。
 *
 * 重构掉的：
 * - 三个结果分区无条件渲染。搜不到东西时，"没有找到匹配内容"的空状态
 *   下面还跟着三个写着"0 首""0 位歌手 · 0 张专辑"的空面板 —— 一整屏
 *   的空壳。现在哪一类有结果才出哪一类。
 * - 行内四个图标按钮只有 title 没有 aria-label。title 在触屏上根本
 *   不显示，读屏器的支持也不一致。改用 IconButton（它强制要求 label）。
 * - 页面自己的 <h1>（顶栏已经有一个）。
 * - 每首歌一个 <Music2 /> 占位图标，换成真实封面。
 */

import {
  CircleAlert,
  Download,
  Heart,
  ListMusic,
  Play,
  Search,
  Tags,
  WifiOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button, IconButton } from "../../components/ui/Button";
import { Cover } from "../../components/ui/Cover";
import { Field, Notice } from "../../components/ui/Field";
import {
  EmptyState,
  ListGroup,
  ListRow,
  Page,
  Section,
  SectionHeader,
} from "../../components/ui/Layout";
import { MediaCard, MediaGrid } from "../../components/ui/MediaCard";
import { PageLoader } from "../../components/PageLoader";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { coverUrlFor } from "../../lib/media";
import { indexStatus, remember, searchOffline } from "../../lib/offlineIndex";
import { usePlayerCore } from "../player/PlayerProvider";

const EMPTY = { tracks: [], artists: [], albums: [], pending: [] };

/** 离线结果里要标出这条是歌、是歌手还是专辑 —— 三种混在一个列表里。 */
const OFFLINE_KIND_LABELS = {
  track: "单曲",
  artist: "歌手",
  album: "专辑",
  file: "本地文件",
};

export function GlobalSearchPage({ play, navigate, isAdmin }) {
  const player = usePlayerCore();
  const [query, setQuery] = useState(
    () => localStorage.getItem("songlib-global-search") || "",
  );
  const [submitted, setSubmitted] = useState("");
  const [groups, setGroups] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  /* 离线结果单独存。混进 groups 会让"这是缓存的、可能不是最新的"
     这件事说不清楚 —— 用户会以为搜到的就是曲库现在的样子。 */
  const [offline, setOffline] = useState(null);

  /* NAS 连不上时退到本地索引。
     判据是"请求失败"，不是 navigator.onLine —— 手机连着 WiFi 但
     NAS 关机的情况下 onLine 仍然是 true，那才是这个场景的常态。 */
  const fallbackToOffline = async (text) => {
    const [items, status] = await Promise.all([
      searchOffline(text, 60),
      indexStatus(),
    ]);
    setOffline({ items, ...status });
    setGroups(EMPTY);
    setSubmitted(text);
  };

  const runSearch = async (event) => {
    event?.preventDefault?.();
    const text = query.trim();
    if (!text) return;
    localStorage.setItem("songlib-global-search", text);
    setLoading(true);
    setError("");
    setOffline(null);
    try {
      /*
       * 每一路单独兜住失败，这样一个接口挂了不影响其他几路 ——
       * 但**必须记下它失败了**。
       *
       * 原来写的是 `.catch(() => ({ items: [] }))`，把失败变成了
       * "搜到 0 条"。于是 NAS 整个连不上的时候，Promise.all 照样成功，
       * 外面那个 catch 永远进不去，页面显示"没找到跟 xx 有关的内容"，
       * 离线索引这条路根本走不到。断线和没搜到必须能分开。
       */
      const soft = (promise) =>
        promise.then(
          (value) => ({ ...value, failed: false }),
          () => ({ items: [], failed: true }),
        );
      const [tracks, artists, albums, pending] = await Promise.all([
        soft(api(`/api/catalog/unified?limit=40&q=${encodeURIComponent(text)}`)),
        soft(
          api(`/api/library/artists?pageSize=12&search=${encodeURIComponent(text)}`),
        ),
        soft(
          api(`/api/library/albums?pageSize=12&search=${encodeURIComponent(text)}`),
        ),
        isAdmin
          ? soft(api("/api/downloads/pending"))
          : Promise.resolve({ items: [], failed: false }),
      ]);

      // 三路主查询全挂 = 连不上 NAS。待入库那一路不算 ——
      // 非管理员本来就不查它。
      if (tracks.failed && artists.failed && albums.failed) {
        await fallbackToOffline(text);
        return;
      }

      setGroups({
        tracks: tracks.items || [],
        artists: artists.items || [],
        albums: albums.items || [],
        // 待入库接口没有搜索参数，只能拿全量在前端过一遍。
        pending: (pending.items || []).filter((item) =>
          JSON.stringify(item).includes(text),
        ),
      });
      setSubmitted(text);
      // 搜到的东西顺手存进离线索引。这是唯一不需要额外请求就能
      // 让索引变全的时机 —— 用户搜过什么，通常就是他之后还会找的。
      remember("track", tracks.items || []);
      remember("artist", artists.items || []);
      remember("album", albums.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (query) runSearch();
  }, []);

  const total =
    groups.tracks.length +
    groups.artists.length +
    groups.albums.length +
    groups.pending.length;

  const openInLibrary = (title) => {
    localStorage.setItem("songlib-global-search", title);
    navigate("library");
  };

  return (
    <Page className="search-page">
      <p className="search-page__lead">
        同一首歌只出现一次。本地文件和 Plex 里的版本都归在它下面，可以随时换。
      </p>

      <form className="search-page__form" onSubmit={runSearch}>
        <Field
          label="搜索"
          hideLabel
          leading={Search}
          autoFocus
          placeholder="歌名、歌手、专辑，或者文件名"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          loading={loading}
          disabled={!query.trim()}
        >
          搜索
        </Button>
      </form>

      {error && (
        <Notice tone="danger" icon={CircleAlert}>
          {error}
        </Notice>
      )}

      {loading ? (
        <PageLoader />
      ) : offline ? (
        <>
          <Notice tone="warning" icon={WifiOff}>
            连不上 NAS，下面是本机存的曲库索引
            {offline.updatedAt ? `（${timeAgo(offline.updatedAt)}存下的）` : ""}。
            这里只能翻和搜，放不了歌 —— 音频要从 NAS 取。
          </Notice>
          {offline.items.length ? (
            <Section>
              <SectionHeader
                title="本机索引里找到的"
                note={`${offline.items.length} 条 · 索引里一共 ${offline.count} 条`}
              />
              <ListGroup>
                {offline.items.map((item) => (
                  <ListRow
                    key={item.key}
                    leading={
                      <Cover
                        src={item.coverUrl}
                        title={item.title}
                        size="40px"
                        shape={item.kind === "artist" ? "round" : "square"}
                      />
                    }
                    title={item.title}
                    subtitle={item.subtitle || OFFLINE_KIND_LABELS[item.kind]}
                    trailing={OFFLINE_KIND_LABELS[item.kind]}
                    chevron={false}
                  />
                ))}
              </ListGroup>
            </Section>
          ) : (
            <EmptyState
              icon={WifiOff}
              title="本机索引里没有"
              text={
                offline.count
                  ? `索引里有 ${offline.count} 条，但没有跟「${submitted}」对得上的。等 NAS 回来再搜一次。`
                  : "暂无离线索引；浏览过的内容会自动缓存"
              }
            />
          )}
        </>
      ) : !submitted ? (
        <EmptyState
          icon={Search}
          title="搜索"
          text="搜曲库里的歌、歌手、专辑，以及待入库的下载"
        />
      ) : !total ? (
        <EmptyState
          icon={Search}
          title={`没找到跟「${submitted}」有关的内容`}
          text="换个关键词。新加的歌可能还没扫到"
        />
      ) : (
        <>
          {/* 每一类都只在有结果时出现 —— 空面板不该占地方。 */}
          {groups.tracks.length > 0 && (
            <Section>
              <SectionHeader title="单曲" note={`${groups.tracks.length} 首`} />
              <ListGroup>
                {groups.tracks.map((item) => (
                  <ListRow
                    key={item.id}
                    leading={
                      <Cover
                        src={coverUrlFor(item)}
                        title={item.title}
                        size="40px"
                        shape="square"
                      />
                    }
                    title={item.title}
                    subtitle={[item.artist || "未知歌手", item.album]
                      .filter(Boolean)
                      .join(" · ")}
                    chevron={false}
                    trailing={
                      <span className="search-page__row-actions">
                        {item.sourceSummary && (
                          <Badge
                            tone={
                              item.matchStatus === "matched" ? "success" : "neutral"
                            }
                          >
                            {item.sourceSummary}
                          </Badge>
                        )}
                        <IconButton
                          icon={Play}
                          size="sm"
                          label={`播放 ${item.title}`}
                          onClick={() => play(item)}
                        />
                        <IconButton
                          icon={ListMusic}
                          size="sm"
                          label={`把 ${item.title} 排到下一首`}
                          onClick={() => player.addToQueue(item)}
                        />
                        <IconButton
                          icon={Heart}
                          size="sm"
                          label={`收藏 ${item.title}`}
                          onClick={() => player.toggleFavorite(item)}
                        />
                        {isAdmin && (
                          <IconButton
                            icon={Tags}
                            size="sm"
                            label={`去改 ${item.title} 的标签`}
                            onClick={() =>
                              navigate(
                                item.sourceTypes?.includes("local_file")
                                  ? "local"
                                  : "library",
                              )
                            }
                          />
                        )}
                      </span>
                    }
                  />
                ))}
              </ListGroup>
            </Section>
          )}

          {(groups.artists.length > 0 || groups.albums.length > 0) && (
            <Section>
              <SectionHeader
                title="歌手与专辑"
                note={[
                  groups.artists.length && `${groups.artists.length} 位歌手`,
                  groups.albums.length && `${groups.albums.length} 张专辑`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
              <MediaGrid min={150}>
                {[
                  ...groups.artists.map((item) => ({ ...item, kind: "artist" })),
                  ...groups.albums.map((item) => ({ ...item, kind: "album" })),
                ].map((item) => (
                  <MediaCard
                    key={`${item.kind}-${item.ratingKey}`}
                    kind={item.kind}
                    title={item.title}
                    subtitle={item.kind === "artist" ? "歌手" : "专辑"}
                    coverUrl={item.thumbUrl}
                    onOpen={() => openInLibrary(item.title)}
                  />
                ))}
              </MediaGrid>
            </Section>
          )}

          {isAdmin && groups.pending.length > 0 && (
            <Section>
              <SectionHeader
                title="待入库"
                note={`${groups.pending.length} 首`}
              />
              <ListGroup>
                {groups.pending.map((item) => (
                  <ListRow
                    key={item.jobId}
                    leading={
                      <span className="search-page__pending-icon">
                        <Download />
                      </span>
                    }
                    title={item.title}
                    subtitle={item.downloadPath || "路径还没确定"}
                    onClick={() => navigate("download")}
                  />
                ))}
              </ListGroup>
            </Section>
          )}
        </>
      )}
    </Page>
  );
}
