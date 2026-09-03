/**
 * 歌手 / 专辑详情。
 *
 * 重构掉的：
 * - 页面自己的 <h1>。顶栏已经有一个了。
 * - 封面用 <img> + 图标兜底各写一遍；现在统一用 Cover（缺图会出首字占位）。
 * - 引入的是旧的 components/MediaCard，接口和设计系统那个不一样
 *   （item/type/openDetail/playFirst 对 title/coverUrl/onOpen/onPlay），
 *   两套同名组件并存迟早会拿错。这里改用 components/ui/MediaCard。
 * - 歌手简介的展开收起：原来靠 .expanded 类切换 -webkit-line-clamp，
 *   但按钮的显示条件是 summary.length > 120 —— 字数和实际行数没有关系，
 *   中文 120 字在宽屏上可能只占两行，按钮出现了却没东西可展开。
 *   现在用 line-clamp 是否真的截断来判断（见 useClamped）。
 */

import { ArrowLeft, ChevronDown, CircleAlert, Play, UserRound } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, ButtonGroup } from "../../components/ui/Button";
import { Cover } from "../../components/ui/Cover";
import { EmptyState, Page, Section, SectionHeader } from "../../components/ui/Layout";
import { MediaCard, MediaGrid } from "../../components/ui/MediaCard";
import { PageLoader } from "../../components/PageLoader";
import { TrackTable } from "../../components/TrackTable";
import { api } from "../../lib/api";
import { durationLabel } from "../../lib/format";

/**
 * 元素是否真的被 line-clamp 截断了。
 *
 * scrollHeight 比 clientHeight 大就说明有内容被藏起来了 ——
 * 这是唯一可靠的判据。用字数猜行数在中英混排和不同视口下都不准。
 */
function useClamped(text) {
  const ref = useRef(null);
  const [clamped, setClamped] = useState(false);

  const measure = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    setClamped(node.scrollHeight - node.clientHeight > 1);
  }, []);

  // 布局阶段量一次，避免"按钮先不在、下一帧突然冒出来"的跳动。
  useLayoutEffect(measure, [text, measure]);

  // 视口变化会改变行数，所以要跟着重量。
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return undefined;
    const node = ref.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure]);

  return { ref, clamped };
}

export function LibraryDetailPage({ type, data, back, play, openDetail }) {
  const [expanded, setExpanded] = useState(false);
  const isArtist = type === "artists";
  const subject = isArtist ? data?.artist : data?.album;
  const summaryClamp = useClamped(subject?.summary);

  const detailKey = data?.artist?.ratingKey || data?.album?.ratingKey || "";
  useEffect(() => setExpanded(false), [detailKey]);

  if (!data) return <PageLoader />;

  if (data.error) {
    return (
      <Page className="library-detail">
        <Button icon={ArrowLeft} onClick={back}>
          返回音乐库
        </Button>
        <EmptyState icon={CircleAlert} title="这项读不出来" text={data.error} />
      </Page>
    );
  }

  const tracks = isArtist ? data.popularTracks || [] : data.tracks || [];
  const albums = isArtist ? data.albums || [] : [];

  const playAll = () => {
    if (!tracks.length) return;
    play?.(
      { ...tracks[0], source: "plex_item" },
      tracks.slice(1).map((item) => ({ ...item, source: "plex_item" })),
    );
  };

  const playAlbum = async (album) => {
    const result = await api(
      `/api/library/albums/${encodeURIComponent(album.ratingKey)}`,
    );
    const items = result.tracks || [];
    if (!items.length) return;
    play?.(
      { ...items[0], source: "plex_item" },
      items.slice(1).map((item) => ({ ...item, source: "plex_item" })),
    );
  };

  const metaText = isArtist
    ? [
        ...(subject?.tags?.genre || []).slice(0, 3),
        `${data.albumCount || albums.length} 张专辑`,
        `${data.trackCount || tracks.length} 首`,
      ]
        .filter(Boolean)
        .join(" · ")
    : [
        subject?.parentTitle || data.artist?.title,
        subject?.year,
        `${data.trackCount || tracks.length} 首`,
        durationLabel(data.duration),
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <Page className="library-detail">
      <div className="library-detail__back">
        <Button icon={ArrowLeft} onClick={back}>
          返回音乐库
        </Button>
      </div>

      <div className="library-detail__hero">
        {/* 歌手用圆形、专辑用方形 —— 听众已有的心理预期，不要混用。 */}
        <div className="library-detail__cover glow-ring">
          <Cover
            src={subject?.thumbUrl}
            title={subject?.title}
            shape={isArtist ? "round" : "square"}
          />
        </div>

        <div className="library-detail__copy">
          <p className="library-detail__kind">{isArtist ? "歌手" : "专辑"}</p>
          <h2 className="library-detail__title">{subject?.title || "未命名"}</h2>
          <p className="library-detail__meta">{metaText}</p>

          <ButtonGroup>
            <Button
              variant="primary"
              size="lg"
              icon={Play}
              disabled={!tracks.length}
              onClick={playAll}
            >
              {isArtist ? "播放热门曲目" : "播放这张专辑"}
            </Button>
            {!isArtist && data.artist?.ratingKey && (
              <Button
                size="lg"
                icon={UserRound}
                onClick={() => openDetail?.("artists", data.artist)}
              >
                去看这位歌手
              </Button>
            )}
          </ButtonGroup>

          {subject?.summary && (
            <div className="library-detail__bio">
              <p
                ref={summaryClamp.ref}
                className="library-detail__summary"
                data-expanded={expanded || undefined}
              >
                {subject.summary}
              </p>
              {/* 按钮只在真的有内容被截断时出现。 */}
              {(summaryClamp.clamped || expanded) && (
                <button
                  type="button"
                  className="library-detail__toggle"
                  aria-expanded={expanded}
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? "收起" : "全文"}
                  <ChevronDown aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <Section reveal>
        <SectionHeader
          title={isArtist ? "热门曲目" : "曲目"}
          note={
            isArtist
              ? "按 Plex 统计的播放次数排"
              : durationLabel(data.duration) || undefined
          }
        />
        {tracks.length ? (
          <TrackTable items={tracks} play={play} />
        ) : (
          <EmptyState
            icon={Play}
            title="这里还没有曲目"
            text="Plex 可能还没扫到，或这张专辑是空的"
          />
        )}
      </Section>

      {isArtist && albums.length > 0 && (
        <Section reveal>
          <SectionHeader title={`${data.albumCount || albums.length} 张专辑`} />
          <MediaGrid min={160}>
            {albums.map((item) => (
              <MediaCard
                key={item.ratingKey}
                kind="album"
                title={item.title}
                subtitle={item.year}
                coverUrl={item.thumbUrl}
                onOpen={() => openDetail?.("albums", item)}
                onPlay={() => playAlbum(item)}
                playLabel={`播放专辑 ${item.title}`}
              />
            ))}
          </MediaGrid>
        </Section>
      )}
    </Page>
  );
}
