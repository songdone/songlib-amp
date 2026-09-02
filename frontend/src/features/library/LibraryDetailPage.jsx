import { ArrowLeft, ChevronDown, CircleAlert, Disc3, Play, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Empty } from "../../components/Empty";
import { MediaCard } from "../../components/MediaCard";
import { PageLoader } from "../../components/PageLoader";
import { SectionHead } from "../../components/SectionHead";
import { TrackTable } from "../../components/TrackTable";
import { api } from "../../lib/api";
import { durationLabel } from "../../lib/format";

export function LibraryDetailPage({ type, data, back, play, openDetail }) {
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const detailKey =
    data?.artist?.ratingKey || data?.album?.ratingKey || "";
  useEffect(() => setSummaryExpanded(false), [detailKey]);
  if (!data) return <PageLoader />;
  if (data.error)
    return (
      <div className="page library-detail-page">
        <button className="detail-back" onClick={back}>
          <ArrowLeft />
          返回音乐库
        </button>
        <Empty icon={CircleAlert} title="资料暂时不可用" text={data.error} />
      </div>
    );
  const isArtist = type === "artists";
  const subject = isArtist ? data.artist : data.album;
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
  return (
    <div
      className={`page library-detail-page ${
        isArtist ? "artist-profile-page" : "album-profile-page"
      }`}
    >
      <button className="detail-back" onClick={back}>
        <ArrowLeft />
        返回{isArtist ? "歌手" : "专辑"}
      </button>
      <section
        className={`library-detail-hero ${
          isArtist ? "artist-detail-hero" : "album-detail-hero"
        }`}
      >
        <div className="library-detail-content">
          <div className="library-detail-cover">
            {subject?.thumbUrl ? (
              <img src={subject.thumbUrl} alt="" />
            ) : isArtist ? (
              <UserRound />
            ) : (
              <Disc3 />
            )}
          </div>
          <div className="library-detail-copy">
            <span>{isArtist ? "艺人" : "专辑"}</span>
            <h1>{subject?.title || "未命名"}</h1>
            <p className="library-detail-meta">
              {isArtist
                ? [
                    ...(subject?.tags?.genre || []).slice(0, 3),
                    `${data.albumCount || albums.length} 张专辑`,
                    `${data.trackCount || tracks.length} 首歌曲`,
                  ].join(" · ")
                : [
                    subject?.parentTitle || data.artist?.title,
                    subject?.year,
                    `${data.trackCount || tracks.length} 首歌曲`,
                    durationLabel(data.duration),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </p>
            <div className="library-detail-actions">
              <button className="primary" onClick={playAll} disabled={!tracks.length}>
                <Play fill="currentColor" />
                播放
              </button>
              {!isArtist && data.artist?.ratingKey && (
                <button
                  className="secondary"
                  onClick={() => openDetail?.("artists", data.artist)}
                >
                  <UserRound />
                  查看艺人
                </button>
              )}
            </div>
            {subject?.summary && (
              <div className="library-detail-biography">
                <p
                  className={`library-detail-summary ${
                    summaryExpanded ? "expanded" : ""
                  }`}
                >
                  {subject.summary}
                </p>
                {subject.summary.length > 120 && (
                  <button
                    className="summary-toggle"
                    onClick={() => setSummaryExpanded((value) => !value)}
                    aria-expanded={summaryExpanded}
                  >
                    {summaryExpanded ? "收起介绍" : "查看全部"}
                    <ChevronDown
                      className={summaryExpanded ? "rotate-180" : ""}
                    />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
      <SectionHead
        title={isArtist ? "热门曲目" : "曲目"}
        note={
          isArtist
            ? "根据 Plex 播放数据排列"
            : `${data.trackCount || tracks.length} 首 · ${durationLabel(data.duration)}`
        }
      />
      <TrackTable items={tracks} play={play} />
      {isArtist && (
        <>
          <SectionHead title={`${data.albumCount || albums.length} 张专辑`} />
          <div className="media-grid detail-album-grid">
            {albums.map((item) => (
              <MediaCard
                item={item}
                type="albums"
                key={item.ratingKey}
                openDetail={openDetail}
                playFirst={playAlbum}
                showTracks={(album) => openDetail?.("albums", album)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
