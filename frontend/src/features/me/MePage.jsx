/**
 * 我的。
 *
 * 三块内容：最近在听什么（本机统计）、我喜欢、最近播放和自己攒的歌单。
 *
 * 重构掉的：
 * - prompt() 建歌单、confirm() 删歌单。原生弹窗在深色界面里格外突兀，
 *   而且 prompt 没法做校验（空名字、重名都拦不住）。
 * - 页面自己的 <h1>。顶栏已经有一个了，两个 h1 读屏器会报出两个页面标题。
 * - 收藏和历史两处各写一遍列表行；现在都用 ListRow。
 */

import { Clock3, Heart, ListMusic, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, ButtonGroup, IconButton } from "../../components/ui/Button";
import { Cover } from "../../components/ui/Cover";
import { Field } from "../../components/ui/Field";
import {
  EmptyState,
  ListGroup,
  ListRow,
  Page,
  PageHeader,
  Section,
  SectionHeader,
} from "../../components/ui/Layout";
import { Modal } from "../../components/ui/Modal";
import { StatGrid, StatTile } from "../../components/ui/StatTile";
import { fmt, timeAgo } from "../../lib/format";
import { coverUrlFor, trackIdentity } from "../../lib/media";
import { usePlayerCore } from "../player/PlayerProvider";

/** 近 7 天，从 6 天前排到今天。 */
const lastSevenDays = (events) => {
  const days = Array.from({ length: 7 }, (_, offset) => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (6 - offset));
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return {
      label: `${start.getMonth() + 1}/${start.getDate()}`,
      count: events.filter((item) => {
        const at = new Date(item.playedAt).getTime();
        return at >= start.getTime() && at < end.getTime();
      }).length,
    };
  });
  // 最高那天定为满格。全是 0 的时候不能除以 0，兜底成 1。
  return { days, max: Math.max(1, ...days.map((item) => item.count)) };
};

export function MePage() {
  const player = usePlayerCore();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState(null);

  const favorites = Object.values(player.favorites || {}).sort((a, b) =>
    String(b.likedAt || "").localeCompare(String(a.likedAt || "")),
  );
  const history = player.history || [];
  const events = player.playEvents || history;
  const playlists = player.playlists || {};
  const names = Object.keys(playlists);

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

  const { days, max } = lastSevenDays(events);

  const trimmedName = newName.trim();
  const duplicate = names.includes(trimmedName);

  const createPlaylist = () => {
    if (!trimmedName || duplicate) return;
    player.createPlaylist(trimmedName);
    setNewName("");
    setCreating(false);
  };

  const confirmDelete = () => {
    if (deleting) player.deletePlaylist(deleting);
    setDeleting(null);
  };

  return (
    <Page className="me">
      <PageHeader
        title="你听过的都在这儿"
        lead="喜欢过的、放过的，和自己攒的歌单。这些记录只存在这台机器上。"
      />

      <StatGrid>
        <StatTile icon={Play} value={fmt(events.length)} label="次播放" />
        <StatTile icon={Clock3} value={fmt(totalMinutes)} label="分钟" />
        <StatTile icon={Heart} value={fmt(favorites.length)} label="首收藏" />
      </StatGrid>

      {/* --- 最近在听什么 --- */}
      <Section reveal>
        <SectionHeader title="最近都在听什么" note="近 7 天，只算这台机器" />
        <div className="me-insights">
          <div className="me-week">
            {days.map((item) => (
              <div className="me-week__day" key={item.label}>
                <span className="me-week__count">{item.count}</span>
                <span className="me-week__track">
                  {/* 高度至少留 3px，0 次的那天也要有一条底线，
                      否则那天看起来像是数据没加载出来。 */}
                  <i style={{ height: `${Math.max(3, (item.count / max) * 100)}%` }} />
                </span>
                <span className="me-week__label">{item.label}</span>
              </div>
            ))}
          </div>

          <div className="me-artists">
            <h3>常听歌手</h3>
            {topArtists.length ? (
              <ol>
                {topArtists.map(([name, count]) => (
                  <li key={name}>
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
      </Section>

      <div className="me-columns">
        {/* --- 我喜欢 --- */}
        <Section reveal>
          <SectionHeader
            title="我喜欢"
            note={favorites.length ? `${favorites.length} 首` : undefined}
          />
          {favorites.length ? (
            <ListGroup>
              {favorites.slice(0, 8).map((item) => (
                <ListRow
                  key={trackIdentity(item)}
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
                  onClick={() => player.play(item)}
                />
              ))}
            </ListGroup>
          ) : (
            <EmptyState
              icon={Heart}
              title="还没有收藏"
              text="听到喜欢的点一下爱心，就收在这儿。"
            />
          )}
        </Section>

        {/* --- 最近播放 --- */}
        <Section reveal>
          <SectionHeader
            title="最近播放"
            note={history.length ? `${history.length} 条` : undefined}
          />
          {history.length ? (
            <ListGroup>
              {history.slice(0, 10).map((item) => (
                <ListRow
                  key={`${trackIdentity(item)}-${item.playedAt}`}
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
                  trailing={timeAgo(item.playedAt)}
                  chevron={false}
                  onClick={() => player.play(item)}
                />
              ))}
            </ListGroup>
          ) : (
            <EmptyState
              icon={Play}
              title="还没有播放记录"
              text="放过的歌会留在这里，方便接着听。"
            />
          )}
        </Section>
      </div>

      {/* --- 我的歌单 --- */}
      <Section reveal>
        <SectionHeader
          title="我的歌单"
          note="存在这台设备上，不上传"
          actions={
            <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
              新建
            </Button>
          }
        />
        {names.length ? (
          <ListGroup>
            {/* 一行两个动作，所以行本身不可点 —— 见 ListRow 的说明。 */}
            {names.map((name) => {
              const tracks = playlists[name] || [];
              return (
                <ListRow
                  key={name}
                  leading={
                    <span className="me-playlist-icon">
                      <ListMusic />
                    </span>
                  }
                  title={name}
                  subtitle={`${tracks.length} 首`}
                  trailing={
                    <span className="me-playlist-actions">
                      <IconButton
                        icon={Play}
                        size="sm"
                        label={`播放歌单 ${name}`}
                        disabled={!tracks.length}
                        onClick={() =>
                          player.play(tracks[0], tracks.slice(1))
                        }
                      />
                      <IconButton
                        icon={Trash2}
                        variant="danger"
                        size="sm"
                        label={`删除歌单 ${name}`}
                        onClick={() => setDeleting(name)}
                      />
                    </span>
                  }
                  chevron={false}
                />
              );
            })}
          </ListGroup>
        ) : (
          <EmptyState
            icon={ListMusic}
            title="还没有歌单"
            text="想反复听的歌，攒成一张歌单。"
            action={
              <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
                建一张
              </Button>
            }
          />
        )}
      </Section>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="新建歌单"
        size="sm"
        actions={
          <ButtonGroup align="end">
            <Button onClick={() => setCreating(false)}>取消</Button>
            <Button
              variant="primary"
              disabled={!trimmedName || duplicate}
              onClick={createPlaylist}
            >
              建好
            </Button>
          </ButtonGroup>
        }
      >
        <Field
          label="歌单名"
          placeholder="例如：通勤路上"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && createPlaylist()}
          error={duplicate ? "已经有一张同名的歌单了" : undefined}
        />
      </Modal>

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`删掉歌单「${deleting}」？`}
        size="sm"
        actions={
          <ButtonGroup align="end">
            <Button onClick={() => setDeleting(null)}>留着</Button>
            <Button variant="danger" icon={Trash2} onClick={confirmDelete}>
              删掉
            </Button>
          </ButtonGroup>
        }
      >
        <p>歌本身还在曲库里，只是这张单子没了。</p>
      </Modal>
    </Page>
  );
}
