import { Clock3, Heart, ListMusic, Play, Plus, Trash2, UserRound } from "lucide-react";
import { fmt, timeAgo } from "../../lib/format";
import { trackIdentity } from "../../lib/media";
import { usePlayerCore } from "../player/PlayerProvider";

export function MePage({ navigate }) {
  const player = usePlayerCore();
  const favorites = Object.values(player.favorites || {}).sort((a, b) =>
    String(b.likedAt || "").localeCompare(String(a.likedAt || "")),
  );
  const history = player.history || [];
  const events = player.playEvents || history;
  const playlists = player.playlists || {};
  const newPlaylist = () => {
    const name = prompt("新建歌单名称");
    if (name) player.createPlaylist(name);
  };
  const totalMinutes = Math.round(
    events.reduce((sum, item) => sum + Number(item.duration || 0), 0) / 60,
  );
  const artistCounts = events.reduce((map, item) => {
    const key = item.artist || "未知歌手";
    map[key] = (map[key] || 0) + 1;
    return map;
  }, {});
  const topArtists = Object.entries(artistCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const recentDays = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - offset));
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    return {
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      count: events.filter((item) => {
        const value = new Date(item.playedAt).getTime();
        return value >= date.getTime() && value < next.getTime();
      }).length,
    };
  });
  const maxDay = Math.max(1, ...recentDays.map((item) => item.count));
  return (
    <div className="page me-page refined-me-page">
      <section className="page-intro">
        <span className="eyebrow">
          <UserRound />
          我的
        </span>
        <h1>我的音乐</h1>
        <p>你喜欢过的、听过的，和自己攒的歌单。</p>
      </section>
      <div className="me-dashboard">
        <section className="me-listening-surface">
          <header className="me-section-head">
            <div>
              <span>只算本机</span>
              <h2>最近都在听什么</h2>
            </div>
            <small>播放记录不出这台机器</small>
          </header>
          <div className="me-metric-strip">
            {[
              [Play, "播放", events.length, "次"],
              [Clock3, "时长", totalMinutes, "分钟"],
              [Heart, "收藏", favorites.length, "首"],
            ].map(([Icon, label, value, unit]) => (
              <div className="me-metric" key={label}>
                <span><Icon /></span>
                <div>
                  <small>{label}</small>
                  <strong>{fmt(value)} <em>{unit}</em></strong>
                </div>
              </div>
            ))}
          </div>
          <div className="me-insights">
            <div className="me-weekly">
              <h3>近 7 天</h3>
              <div className="listening-bars">
                {recentDays.map((item) => (
                  <span key={item.label}>
                    <i
                      style={{
                        height: `${Math.max(4, (item.count / maxDay) * 100)}%`,
                      }}
                    />
                    <b>{item.count}</b>
                    <small>{item.label}</small>
                  </span>
                ))}
              </div>
            </div>
            <div className="me-artists">
              <h3>常听音乐人</h3>
              {topArtists.length ? (
                <ol>
                  {topArtists.map(([name, count], index) => (
                    <li key={name}>
                      <b>{String(index + 1).padStart(2, "0")}</b>
                      <span>{name}</span>
                      <em>{count} 次</em>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>多听几首，这里就会排出你的常听歌手。</p>
              )}
            </div>
          </div>
        </section>
        <section className="me-collection-surface">
          <header className="me-section-head">
            <div>
              <span>收藏</span>
              <h2>我喜欢</h2>
            </div>
            <small>{favorites.length} 首</small>
          </header>
          {favorites.length ? (
            <div className="favorite-list me-track-list">
              {favorites.slice(0, 8).map((item) => (
                <button
                  key={trackIdentity(item)}
                  onClick={() => player.play(item)}
                >
                  <Heart />
                  <div>
                    <strong>{item.title}</strong>
                    <span>
                      {item.artist || "未知歌手"} · {item.album || "未知专辑"}
                    </span>
                  </div>
                  <Play />
                </button>
              ))}
            </div>
          ) : (
            <div className="me-empty-inline">
              <span><Heart /></span>
              <div>
                <strong>还没有收藏</strong>
                <p>听到喜欢的点一下爱心，就收在这儿。</p>
              </div>
            </div>
          )}
        </section>
      </div>
      <div className="me-lower-grid">
        <section className="me-list-surface">
          <header className="me-section-head">
            <div>
              <span>继续聆听</span>
              <h2>最近播放</h2>
            </div>
            <small>{history.length} 条</small>
          </header>
          {history.length ? (
            <div className="favorite-list me-track-list">
              {history.slice(0, 10).map((item) => (
                <button
                  key={`${trackIdentity(item)}-${item.playedAt}`}
                  onClick={() => player.play(item)}
                >
                  <Clock3 />
                  <div>
                    <strong>{item.title}</strong>
                    <span>
                      {item.artist || "未知歌手"} · {timeAgo(item.playedAt)}
                    </span>
                  </div>
                  <Play />
                </button>
              ))}
            </div>
          ) : (
            <div className="me-empty-inline">
              <span><Play /></span>
              <div>
                <strong>暂无播放记录</strong>
                <p>放过的歌会留在这里，方便接着听。</p>
              </div>
            </div>
          )}
        </section>
        <section className="me-list-surface">
          <header className="me-section-head">
            <div>
              <span>我的收藏夹</span>
              <h2>歌单</h2>
            </div>
            <button className="secondary small" onClick={newPlaylist}>
              <Plus />
              新建歌单
            </button>
          </header>
          {Object.keys(playlists).length ? (
            <div className="playlist-library me-playlist-list">
              {Object.entries(playlists).map(([name, tracks]) => (
                <article key={name}>
                  <button
                    onClick={() =>
                      tracks[0] && player.play(tracks[0], tracks.slice(1))
                    }
                  >
                    <ListMusic />
                    <div>
                      <strong>{name}</strong>
                      <span>{tracks.length} 首歌曲</span>
                    </div>
                    <Play />
                  </button>
                  <button
                    className="icon-button danger"
                    onClick={() =>
                      confirm(`删掉歌单「${name}」？歌本身还在曲库里，不会被删。`) &&
                      player.deletePlaylist(name)
                    }
                    aria-label={`删除歌单 ${name}`}
                  >
                    <Trash2 />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="me-empty-inline">
              <span><ListMusic /></span>
              <div>
                <strong>还没有歌单</strong>
                <p>想反复听的歌，攒成一张歌单。</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
