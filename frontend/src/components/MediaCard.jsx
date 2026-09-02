import { Disc3, Image, ListMusic, Play, UserRound } from "lucide-react";

export function MediaCard({
  item,
  type,
  showTracks,
  playFirst,
  openDetail,
  previewBackdrop,
}) {
  const isArtist = type === "artists";
  const isAlbum = type === "albums";
  const canBackdrop = isArtist && item.artUrl;
  return (
    <article
      className="media-card"
      role="button"
      tabIndex={0}
      onClick={() => openDetail?.(type, item)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openDetail?.(type, item);
        }
      }}
    >
      <div className="media-art">
        {item.thumbUrl ? (
          <img src={item.thumbUrl} alt="" loading="lazy" />
        ) : (
          <div className="art-placeholder">
            {isArtist ? <UserRound /> : <Disc3 />}
          </div>
        )}
        <div className="media-overlay media-actions">
          <button
            onClick={(event) => {
              event.stopPropagation();
              playFirst?.(item);
            }}
            title={isArtist ? "播放这个歌手的曲目" : "播放这张专辑"}
          >
            <Play fill="currentColor" />
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              showTracks?.(item);
            }}
            title={isArtist ? "查看歌手曲目" : "查看专辑曲目"}
          >
            <ListMusic />
          </button>
          {canBackdrop && (
            <button
              onClick={(event) => {
                event.stopPropagation();
                previewBackdrop?.({
                  imageUrl: item.artUrl,
                  coverUrl: item.thumbUrl || item.artUrl,
                  title: item.title,
                  subtitle: "手动选择的歌手背景",
                });
              }}
              title="用作当前背景"
            >
              <Image />
            </button>
          )}
        </div>
        {!item.hasCover && <span className="missing-badge">缺封面</span>}
        {item.hasBackground && <span className="background-badge">有背景</span>}
      </div>
      <h4>{item.title || "未命名"}</h4>
      <p>
        {isArtist
          ? `${(item.tags?.genre || []).slice(0, 2).join(" · ") || "音乐人"}`
          : item.parentTitle || item.year || "未知歌手"}
      </p>
      <div className="chips media-health-chips">
        <span>{item.synced ? "已同步" : "待同步"}</span>
        {isArtist && <span>{item.hasChineseBio ? "中文简介完整" : "缺中文简介"}</span>}
        {isArtist && <span>{item.hasBackground ? "背景完整" : "缺背景"}</span>}
      </div>
    </article>
  );
}
