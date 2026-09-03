/**
 * 歌单。
 *
 * 三件事：自己攒的歌单、从平台整张搬过来、和 Plex / 飞牛音乐里已有的歌单。
 *
 * 重构掉的：
 * - 页面自己的 <h1>（顶栏已经有一个）。
 * - window.confirm 删歌单。
 * - 迁移目标那三个方块、服务歌单那两列、歌单列表、曲目行，
 *   四处各写一套面板样式；现在统一用 ListRow / ChipGroup / Section。
 * - "上移/下移"两个按钮原来共用 ChevronDown + rotate-180 类。
 *   现在直接用 ChevronUp —— 靠 CSS 转图标，禁用态和焦点环都会跟着转。
 */

import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Download,
  FileUp,
  Link2,
  ListMusic,
  Music2,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Server,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button, ButtonGroup, IconButton } from "../../components/ui/Button";
import { Cover } from "../../components/ui/Cover";
import { Field, Notice } from "../../components/ui/Field";
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
import { api } from "../../lib/api";
import { playlistPlaybackInput, playlistTrackPayload, servicePlaylistPlaybackItems } from "../../lib/contracts";

/** 迁移目标。available 由后端按连接状态给。 */
const MIGRATION_TARGETS = [
  { id: "songlib", label: "音屿歌单", icon: Music2 },
  { id: "plex", label: "Plex", icon: Server },
  { id: "fnos", label: "飞牛音乐", icon: Radio },
];

/**
 * 整句写在表里，不用 `还没连上 ${label}` 拼。
 * 拼出来在中文标签前会多一个空格（"还没连上 飞牛音乐"），
 * 而拉丁名前那个空格又是对的 —— 拼接没法同时照顾两种。
 */
const SERVICES = [
  {
    id: "plex",
    label: "Plex",
    icon: Server,
    notConnected: "还没连上 Plex",
    connectedEmpty: "Plex 已连接，里面还没有歌单",
  },
  {
    id: "fnos",
    label: "飞牛音乐",
    icon: Radio,
    notConnected: "还没连上飞牛音乐",
    connectedEmpty: "飞牛音乐已连接，里面还没有歌单",
  },
];

const QUALITIES = [
  { id: "flac", label: "优先无损" },
  { id: "320k", label: "高品质 320K" },
  { id: "128k", label: "标准 128K" },
];

export function PlaylistsPage({
  play,
  notify,
  initialPlaylistId = "",
  onPlaylistChange,
}) {
  const [items, setItems] = useState([]);
  const [servicePlaylists, setServicePlaylists] = useState({
    plex: { configured: false, items: [], error: null },
    fnos: { configured: false, items: [], error: null },
  });
  const [serviceBusy, setServiceBusy] = useState(false);
  const [servicePlaying, setServicePlaying] = useState("");
  const [selected, setSelected] = useState(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [migration, setMigration] = useState(null);
  const [migrationBusy, setMigrationBusy] = useState("");
  const [migrationTargets, setMigrationTargets] = useState(["songlib"]);
  const [downloadMissing, setDownloadMissing] = useState(false);
  const [migrationSource, setMigrationSource] = useState("");
  const [migrationQuality, setMigrationQuality] = useState("320k");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const fileRef = useRef(null);
  const loadServices = async () => {
    setServiceBusy(true);
    try {
      const connected = await api("/api/playlists/services");
      setServicePlaylists(connected);
    } catch (err) {
      setServicePlaylists({
        plex: { configured: false, items: [], error: err.message },
        fnos: { configured: false, items: [], error: err.message },
      });
    } finally {
      setServiceBusy(false);
    }
  };
  const load = async (preferredId, { replace = false } = {}) => {
    const [data] = await Promise.all([
      api("/api/playlists"),
      loadServices(),
    ]);
    setItems(data.items || []);
    const id = preferredId || selected?.id || data.items?.[0]?.id;
    if (id) {
      const detail = await api(`/api/playlists/${id}`);
      setSelected(detail);
      onPlaylistChange?.(id, { replace });
    } else {
      setSelected(null);
      onPlaylistChange?.("", { replace: true });
    }
  };
  useEffect(() => {
    load(initialPlaylistId, { replace: !initialPlaylistId }).catch((err) =>
      setError(err.message),
    );
  }, []);
  const create = async (event) => {
    event.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    setError("");
    try {
      const created = await api("/api/playlists", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), description: "", items: [] }),
      });
      setNewName("");
      await load(created.id);
      notify("歌单已创建");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const importFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/playlists/import/m3u", {
        method: "POST",
        body: JSON.stringify({
          name: file.name.replace(/\.(m3u8?|txt)$/i, ""),
          content: await file.text(),
          pathMappings: [],
        }),
      });
      await load(result.playlist.id);
      notify(`已导入 ${result.matched} 首，${result.unmatched.length} 首需要匹配`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setConfirmRemove(false);
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/api/playlists/${selected.id}`, { method: "DELETE" });
      setSelected(null);
      await load();
      notify("歌单已删除");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const move = async (index, delta) => {
    const next = [...selected.items];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setBusy(true);
    try {
      const updated = await api(`/api/playlists/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          items: next.map(playlistTrackPayload),
        }),
      });
      setSelected(updated);
      await load(updated.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const playable = playlistPlaybackInput;
  const playAll = () => {
    const queue = (selected?.items || []).map(playable).filter(Boolean);
    if (queue.length) play(queue[0], queue.slice(1));
  };
  const playSelectedFrom = (index) => {
    const queue = (selected?.items || [])
      .slice(index)
      .map(playable)
      .filter(Boolean);
    if (queue.length) play(queue[0], queue.slice(1));
  };
  const playServicePlaylist = async (serviceId, item) => {
    if (serviceId !== "plex") {
      setError("飞牛音乐这边只支持同步歌单，还不能直接从这里播");
      return;
    }
    const busyKey = `${serviceId}:${item.id}`;
    setServicePlaying(busyKey);
    setError("");
    try {
      const detail = await api(
        `/api/playlists/services/${serviceId}/${encodeURIComponent(item.id)}`,
      );
      const queue = servicePlaylistPlaybackItems(serviceId, detail.items);
      if (!queue.length) throw new Error("这个歌单里没有可播放曲目");
      await play(queue[0], queue.slice(1));
      notify(`正在播放“${item.name}”，共 ${queue.length} 首`);
    } catch (err) {
      setError(err.message);
    } finally {
      setServicePlaying("");
    }
  };
  const syncSelected = async (target) => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const result = await api(`/api/playlists/${selected.id}/sync`, {
        method: "POST",
        body: JSON.stringify({ targets: [target] }),
      });
      const synced = result[target];
      if (synced?.ok === false) throw new Error(synced.error || "同步失败");
      notify(
        target === "plex"
          ? `已同步到 Plex，共 ${synced?.itemCount || 0} 首`
          : `已同步到飞牛音乐，共 ${synced?.matched || 0} 首`,
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const previewMigration = async (event) => {
    event.preventDefault();
    if (!shareUrl.trim()) return;
    setMigrationBusy("preview");
    setError("");
    try {
      const result = await api("/api/playlists/migrate/preview", {
        method: "POST",
        body: JSON.stringify({ shareUrl: shareUrl.trim() }),
      });
      setMigration(result);
      setMigrationTargets(["songlib"]);
      setDownloadMissing(false);
      setMigrationSource(result.downloadSources?.[0]?.id || "");
    } catch (err) {
      setError(err.message);
    } finally {
      setMigrationBusy("");
    }
  };
  const toggleMigrationTarget = (target) => {
    setMigrationTargets((value) =>
      value.includes(target)
        ? value.filter((item) => item !== target)
        : [...value, target],
    );
  };
  const executeMigration = async () => {
    if (!migrationTargets.length) {
      setError("请至少选择一个迁移目标");
      return;
    }
    setMigrationBusy("execute");
    setError("");
    try {
      const result = await api("/api/playlists/migrate/execute", {
        method: "POST",
        body: JSON.stringify({
          sourceUrl: migration.sourceUrl,
          targets: migrationTargets,
          downloadMissing,
          sourceId: downloadMissing ? migrationSource : null,
          quality: migrationQuality,
        }),
      });
      if (result.songlib?.id) await load(result.songlib.id);
      const details = [
        result.songlib ? `音屿 ${result.songlib.itemCount} 首` : "",
        result.plex?.ratingKey ? `Plex ${result.plex.itemCount} 首` : "",
        result.fnos?.ok ? `飞牛音乐 ${result.fnos.matched} 首` : "",
        result.downloads?.created ? `${result.downloads.created} 首进入下载队列` : "",
      ].filter(Boolean);
      notify(details.length ? `迁移完成：${details.join("，")}` : "迁移任务已处理");
      setMigration(null);
      setShareUrl("");
    } catch (err) {
      setError(err.message);
    } finally {
      setMigrationBusy("");
    }
  };
  const migrationDisabled =
    migrationBusy === "execute" ||
    !migrationTargets.length ||
    (downloadMissing && !migrationSource);

  return (
    <Page className="playlists">
      <PageHeader
        title="歌单"
        lead="新建、导入 M3U，或从平台整张搬运"
        actions={
          <ButtonGroup>
            <Button
              icon={FileUp}
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              导入 M3U
            </Button>
            {selected && (
              <Button
                icon={Download}
                onClick={() => {
                  // 导出走浏览器下载，不用 <a download> —— 接口返回的是
                  // attachment 响应头，直接跳转就会存成文件。
                  window.location.href = `/api/playlists/${selected.id}/export.m3u`;
                }}
              >
                导出这张
              </Button>
            )}
          </ButtonGroup>
        }
      />
      <input
        ref={fileRef}
        hidden
        type="file"
        accept=".m3u,.m3u8,audio/x-mpegurl"
        onChange={importFile}
      />

      {error && (
        <Notice tone="danger" icon={CircleAlert}>
          {error}
        </Notice>
      )}

      {/* --- 从分享链接迁移 --- */}
      <Section>
        <SectionHeader
          title="导入平台歌单"
          note="支持 QQ 音乐、网易云公开歌单"
        />
        <form className="playlists__migrate" onSubmit={previewMigration}>
          <Field
            label="歌单分享链接"
            hideLabel
            leading={Link2}
            type="url"
            placeholder="粘贴歌单分享链接"
            value={shareUrl}
            onChange={(event) => setShareUrl(event.target.value)}
          />
          <Button
            type="submit"
            variant="primary"
            icon={Search}
            loading={migrationBusy === "preview"}
            disabled={!shareUrl.trim()}
          >
            读一读
          </Button>
        </form>

        {migration && (
          <div className="playlists__preview">
            <div className="playlists__preview-head">
              <Cover
                src={migration.coverUrl}
                title={migration.name}
                size="64px"
                shape="rounded"
              />
              <div>
                <p className="playlists__preview-platform">
                  {migration.platformLabel}
                </p>
                <h3>{migration.name}</h3>
                <p className="playlists__preview-meta">
                  {migration.summary.total} 首 · {migration.summary.matched}{" "}
                  首库里已经有 · {migration.summary.missing} 首要补
                </p>
              </div>
              <IconButton
                icon={Trash2}
                label="放弃这次迁移"
                onClick={() => setMigration(null)}
              />
            </div>

            {/* 多选，所以不用 ChipGroup（它是单选）。 */}
            <div
              className="ui-chips ui-chips--cards"
              role="group"
              aria-label="目标歌单"
            >
              {MIGRATION_TARGETS.map(({ id, label, icon: Icon }) => {
                const available = migration.targets?.[id]?.available !== false;
                const on = migrationTargets.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    disabled={!available}
                    className={`ui-chip${on ? " ui-chip--on" : ""}`}
                    onClick={() => toggleMigrationTarget(id)}
                  >
                    <strong>
                      <Icon aria-hidden="true" />
                      {label}
                      {on && <Check aria-hidden="true" />}
                    </strong>
                    <small>{available ? "可以搬" : "得先去设置里连上"}</small>
                  </button>
                );
              })}
            </div>

            {migration.summary.missing > 0 && (
              <div className="playlists__fill">
                <label className="playlists__check">
                  <input
                    type="checkbox"
                    checked={downloadMissing}
                    disabled={!migration.downloadSources?.length}
                    onChange={(event) => setDownloadMissing(event.target.checked)}
                  />
                  <span>
                    <strong>缺的那 {migration.summary.missing} 首也一起下</strong>
                    <small>
                      {migration.downloadSources?.length
                        ? "只认标题、主唱和时长都对得上的版本，避免下错"
                        : "需要先在「音乐源」里启用一个音源"}
                    </small>
                  </span>
                </label>
                {downloadMissing && (
                  <div className="playlists__fill-options">
                    <select
                      className="ui-select"
                      aria-label="音源"
                      value={migrationSource}
                      onChange={(event) => setMigrationSource(event.target.value)}
                    >
                      {(migration.downloadSources || []).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                    <select
                      className="ui-select"
                      aria-label="音质"
                      value={migrationQuality}
                      onChange={(event) => setMigrationQuality(event.target.value)}
                    >
                      {QUALITIES.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            <ListGroup>
              {(migration.tracks || []).slice(0, 12).map((item, index) => (
                <ListRow
                  key={`${item.externalRef}-${index}`}
                  leading={
                    <span className="playlists__num">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  }
                  title={item.title}
                  subtitle={[item.artist || "未知歌手", item.album]
                    .filter(Boolean)
                    .join(" · ")}
                  trailing={
                    item.matchStatus === "matched" ? (
                      <Badge tone="success">库里有</Badge>
                    ) : (
                      <Badge tone="warning">要补</Badge>
                    )
                  }
                />
              ))}
            </ListGroup>
            {migration.summary.total > 12 && (
              <p className="playlists__more">
                另有 {migration.summary.total - 12} 首，会按原顺序一起处理。
              </p>
            )}

            <div className="ui-plan-confirm">
              <div className="ui-plan-confirm__text">
                <strong>
                  {migrationTargets.length
                    ? `搬到 ${migrationTargets.length} 个地方`
                    : "未选择目标歌单"}
                </strong>
                <span>没对上的那几首会单独列出来，不会悄悄丢掉</span>
              </div>
              <Button
                variant="primary"
                icon={ArrowDownToLine}
                loading={migrationBusy === "execute"}
                disabled={migrationDisabled}
                onClick={executeMigration}
              >
                开始搬
              </Button>
            </div>
          </div>
        )}
      </Section>

      {/* --- 服务歌单 --- */}
      <Section reveal>
        <SectionHeader
          title="Plex 和飞牛音乐里的歌单"
          actions={
            <Button
              size="sm"
              icon={RefreshCw}
              loading={serviceBusy}
              onClick={loadServices}
            >
              刷新
            </Button>
          }
        />
        <div className="playlists__services">
          {SERVICES.map(({ id, label, icon: Icon, notConnected, connectedEmpty }) => {
            const service = servicePlaylists[id] || {};
            return (
              <div className="playlists__service" key={id}>
                <div className="playlists__service-head">
                  <span className="playlists__service-icon">
                    <Icon />
                  </span>
                  <strong>{label}</strong>
                  {service.configured ? (
                    <Badge>{service.items?.length || 0} 个</Badge>
                  ) : (
                    <Badge tone="warning">没连</Badge>
                  )}
                </div>

                {service.error ? (
                  <Notice tone="danger" icon={CircleAlert}>
                    {service.error}
                  </Notice>
                ) : !service.configured ? (
                  <EmptyState
                    icon={Link2}
                    title={notConnected}
                    text="在设置里连接后自动出现"
                  />
                ) : service.items?.length ? (
                  <ListGroup>
                    {service.items.map((item) => {
                      const playing = servicePlaying === `${id}:${item.id}`;
                      return (
                        <ListRow
                          key={`${id}-${item.id}`}
                          leading={
                            <Cover
                              src={item.coverUrl}
                              title={item.name}
                              size="40px"
                              shape="rounded"
                            />
                          }
                          title={item.name}
                          subtitle={`${item.itemCount || 0} 首`}
                          chevron={false}
                          trailing={
                            id === "plex" ? (
                              <IconButton
                                icon={Play}
                                size="sm"
                                loading={playing}
                                label={`播放歌单 ${item.name}`}
                                onClick={() => playServicePlaylist(id, item)}
                              />
                            ) : (
                              <Badge>只能同步</Badge>
                            )
                          }
                        />
                      );
                    })}
                  </ListGroup>
                ) : (
                  <EmptyState
                    icon={ListMusic}
                    title="那边还没有歌单"
                    text={connectedEmpty}
                  />
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* --- 我的歌单 + 详情 --- */}
      <div className="playlists__workspace">
        <Section>
          <SectionHeader title="我的歌单" />
          <form className="playlists__create" onSubmit={create}>
            <Field
              label="新歌单名称"
              hideLabel
              placeholder="新歌单名称"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <IconButton
              type="submit"
              icon={Plus}
              variant="primary"
              label="建这张歌单"
              disabled={busy || !newName.trim()}
            />
          </form>
          {items.length ? (
            <ListGroup>
              {items.map((item) => (
                <ListRow
                  key={item.id}
                  leading={
                    <span className="playlists__icon">
                      <ListMusic />
                    </span>
                  }
                  title={item.name}
                  subtitle={`${item.itemCount} 首`}
                  selected={selected?.id === item.id}
                  onClick={() =>
                    load(item.id).catch((err) => setError(err.message))
                  }
                />
              ))}
            </ListGroup>
          ) : (
            <EmptyState
              icon={ListMusic}
              title="还没有歌单"
              text="新建一张，或导入 M3U"
            />
          )}
        </Section>

        <Section>
          {!selected ? (
            <EmptyState
              icon={ListMusic}
              title="左边挑一张"
              text="可调整顺序，或同步到 Plex 和飞牛音乐"
            />
          ) : (
            <>
              <SectionHeader
                title={selected.name}
                note={selected.description || `${selected.itemCount} 首`}
                actions={
                  <ButtonGroup>
                    <Button
                      size="sm"
                      icon={Server}
                      disabled={busy || !selected.items.length}
                      onClick={() => syncSelected("plex")}
                    >
                      同步 Plex
                    </Button>
                    <Button
                      size="sm"
                      icon={Radio}
                      disabled={busy || !selected.items.length}
                      onClick={() => syncSelected("fnos")}
                    >
                      同步飞牛
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={Play}
                      disabled={!selected.items.some(playable)}
                      onClick={playAll}
                    >
                      全部播放
                    </Button>
                    <IconButton
                      icon={Trash2}
                      variant="danger"
                      size="sm"
                      label={`删除歌单 ${selected.name}`}
                      onClick={() => setConfirmRemove(true)}
                    />
                  </ButtonGroup>
                }
              />
              {selected.items.length ? (
                <ListGroup>
                  {selected.items.map((item, index) => (
                    <ListRow
                      key={item.id}
                      leading={
                        <span className="playlists__num">{index + 1}</span>
                      }
                      title={item.title || "未命名歌曲"}
                      subtitle={[item.artist || "未知歌手", item.album]
                        .filter(Boolean)
                        .join(" · ")}
                      chevron={false}
                      trailing={
                        <span className="playlists__row-actions">
                          {!playable(item) && (
                            <Badge tone="warning">没对上曲库</Badge>
                          )}
                          <IconButton
                            icon={Play}
                            size="sm"
                            disabled={!playable(item)}
                            label={
                              playable(item)
                                ? `从 ${item.title} 开始播`
                                : `${item.title} 还没对上曲库里的文件`
                            }
                            onClick={() => playSelectedFrom(index)}
                          />
                          <IconButton
                            icon={ChevronUp}
                            size="sm"
                            label={`把 ${item.title} 往上挪`}
                            disabled={busy || index === 0}
                            onClick={() => move(index, -1)}
                          />
                          <IconButton
                            icon={ChevronDown}
                            size="sm"
                            label={`把 ${item.title} 往下挪`}
                            disabled={busy || index === selected.items.length - 1}
                            onClick={() => move(index, 1)}
                          />
                        </span>
                      }
                    />
                  ))}
                </ListGroup>
              ) : (
                <EmptyState
                  icon={Music2}
                  title="这张还是空的"
                  text="导入 M3U，或播放时加入"
                />
              )}
            </>
          )}
        </Section>
      </div>

      <Modal
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title={`删掉歌单「${selected?.name}」？`}
        size="sm"
        actions={
          <ButtonGroup align="end">
            <Button onClick={() => setConfirmRemove(false)}>留着</Button>
            <Button variant="danger" icon={Trash2} onClick={remove}>
              删掉
            </Button>
          </ButtonGroup>
        }
      >
        <p>歌本身还在曲库里，只是这张单子没了。已经同步到 Plex 的那份不受影响。</p>
      </Modal>
    </Page>
  );
}
