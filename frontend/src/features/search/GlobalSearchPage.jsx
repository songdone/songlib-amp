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
import { coverUrlFor } from "../../lib/media";
import { usePlayerCore } from "../player/PlayerProvider";

const EMPTY = { tracks: [], artists: [], albums: [], pending: [] };

export function GlobalSearchPage({ play, navigate, isAdmin }) {
  const player = usePlayerCore();
  const [query, setQuery] = useState(
    () => localStorage.getItem("songlib-global-search") || "",
  );
  const [submitted, setSubmitted] = useState("");
  const [groups, setGroups] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const runSearch = async (event) => {
    event?.preventDefault?.();
    const text = query.trim();
    if (!text) return;
    localStorage.setItem("songlib-global-search", text);
    setLoading(true);
    setError("");
    try {
      const [tracks, artists, albums, pending] = await Promise.all([
        api(`/api/catalog/unified?limit=40&q=${encodeURIComponent(text)}`).catch(
          () => ({ items: [] }),
        ),
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
        // 待入库接口没有搜索参数，只能拿全量在前端过一遍。
        pending: (pending.items || []).filter((item) =>
          JSON.stringify(item).includes(text),
        ),
      });
      setSubmitted(text);
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
      ) : !submitted ? (
        <EmptyState
          icon={Search}
          title="想听什么"
          text="曲库里的歌、歌手、专辑，还有下载了没入库的，都能在这里找到。"
        />
      ) : !total ? (
        <EmptyState
          icon={Search}
          title={`没找到跟「${submitted}」有关的内容`}
          text="换个词试试。刚加进来的歌可能还没扫到，可以去「文件与标签」重扫一遍。"
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
                title="下好了还没入库"
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
