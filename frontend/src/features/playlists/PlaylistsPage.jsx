import { ArrowDownToLine, Check, ChevronDown, CircleAlert, Download, FileUp, Link2, ListMusic, LoaderCircle, Music2, Play, Plus, Radio, RefreshCw, Search, Server, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Empty } from "../../components/Empty";
import { api } from "../../lib/api";
import { playlistPlaybackInput, playlistTrackPayload, servicePlaylistPlaybackItems } from "../../lib/contracts";

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
    if (!selected || !window.confirm(`删掉歌单「${selected.name}」？歌本身还在曲库里，不会被删。`)) return;
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
  return (
    <div className="page playlists-page">
      <section className="page-intro playlist-intro">
        <div>
          <span className="eyebrow"><ListMusic />我的歌单</span>
          <h1>把喜欢的歌带回来</h1>
          <p>从零建一张，导入 M3U，或者把平台上的歌单整张搬过来。</p>
        </div>
        <div className="playlist-actions">
          <button className="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
            <FileUp />导入 M3U
          </button>
          <input ref={fileRef} hidden type="file" accept=".m3u,.m3u8,audio/x-mpegurl" onChange={importFile} />
          {selected && (
            <a className="secondary button-link" href={`/api/playlists/${selected.id}/export.m3u`}>
              <Download />导出
            </a>
          )}
        </div>
      </section>
      <section className="playlist-migration panel">
        <div className="migration-heading">
          <span><Link2 /></span>
          <div>
            <strong>从分享链接迁移</strong>
            <small>QQ 音乐、网易云的公开歌单都能读</small>
          </div>
        </div>
        <form onSubmit={previewMigration}>
          <input
            type="url"
            value={shareUrl}
            onChange={(event) => setShareUrl(event.target.value)}
            placeholder="粘贴歌单分享链接"
          />
          <button className="primary" disabled={!shareUrl.trim() || migrationBusy === "preview"}>
            {migrationBusy === "preview" ? <LoaderCircle className="spin" /> : <Search />}
            读取歌单
          </button>
        </form>
        <p className="migration-privacy">只读歌单里有哪些歌，不需要你的平台账号密码。</p>
      </section>
      {migration && (
        <section className="migration-preview panel">
          <header>
            <div className="migration-cover">
              {migration.coverUrl ? <img src={migration.coverUrl} alt="" /> : <ListMusic />}
            </div>
            <div>
              <span>{migration.platformLabel}</span>
              <h2>{migration.name}</h2>
              <p>
                {migration.summary.total} 首 · {migration.summary.matched} 首已匹配 ·{" "}
                {migration.summary.missing} 首待补全
              </p>
            </div>
            <button className="icon-button" onClick={() => setMigration(null)} aria-label="关闭迁移预览"><X /></button>
          </header>
          <div className="migration-targets">
            {[
              ["songlib", "音屿歌单", Music2],
              ["plex", "Plex", Server],
              ["fnos", "飞牛音乐", Radio],
            ].map(([id, label, Icon]) => {
              const available = migration.targets?.[id]?.available !== false;
              const selectedTarget = migrationTargets.includes(id);
              return (
                <button
                  key={id}
                  className={selectedTarget ? "active" : ""}
                  disabled={!available}
                  onClick={() => toggleMigrationTarget(id)}
                >
                  <Icon />
                  <span><strong>{label}</strong><small>{available ? (selectedTarget ? "已选择" : "可迁移") : "需要先配置连接"}</small></span>
                  <i>{selectedTarget ? <Check /> : <Plus />}</i>
                </button>
              );
            })}
          </div>
          {migration.summary.missing > 0 && (
            <div className="migration-download-option">
              <label>
                <input
                  type="checkbox"
                  checked={downloadMissing}
                  disabled={!migration.downloadSources?.length}
                  onChange={(event) => setDownloadMissing(event.target.checked)}
                />
                <span><strong>补全缺失歌曲</strong><small>只认标题、主唱和时长都对得上的版本，避免下错</small></span>
              </label>
              {downloadMissing && (
                <div>
                  <select value={migrationSource} onChange={(event) => setMigrationSource(event.target.value)}>
                    {(migration.downloadSources || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  <select value={migrationQuality} onChange={(event) => setMigrationQuality(event.target.value)}>
                    <option value="flac">优先无损</option>
                    <option value="320k">高品质 320K</option>
                    <option value="128k">标准 128K</option>
                  </select>
                </div>
              )}
            </div>
          )}
          <div className="migration-track-preview">
            {(migration.tracks || []).slice(0, 12).map((item, index) => (
              <div key={`${item.externalRef}-${index}`} className={item.matchStatus === "matched" ? "matched" : "missing"}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{item.title}</strong><small>{item.artist || "未知艺人"} · {item.album || "未知专辑"}</small></div>
                <em>{item.matchStatus === "matched" ? "已匹配" : "待补全"}</em>
              </div>
            ))}
            {migration.summary.total > 12 && <p>另有 {migration.summary.total - 12} 首，将按原顺序处理</p>}
          </div>
          <footer>
            <span>先看清单，确认了才动。哪几首没对上也会列出来。</span>
            <button className="primary" disabled={migrationBusy === "execute" || !migrationTargets.length || (downloadMissing && !migrationSource)} onClick={executeMigration}>
              {migrationBusy === "execute" ? <LoaderCircle className="spin" /> : <ArrowDownToLine />}
              开始迁移
            </button>
          </footer>
        </section>
      )}
      {error && <div className="form-error"><CircleAlert />{error}</div>}
      <section className="connected-playlists panel">
        <header>
          <div>
            <span>已连接的音乐服务</span>
            <h2>服务歌单</h2>
            <p>Plex 和飞牛音乐里已有的歌单，都在这儿。</p>
          </div>
          <button
            className="secondary small"
            onClick={loadServices}
            disabled={serviceBusy}
          >
            <RefreshCw className={serviceBusy ? "spin" : ""} />
            刷新
          </button>
        </header>
        <div className="service-playlist-grid">
          {[
            ["plex", "Plex", Server],
            ["fnos", "飞牛音乐", Radio],
          ].map(([id, label, Icon]) => {
            const service = servicePlaylists[id] || {};
            return (
              <article className="service-playlist-column" key={id}>
                <header>
                  <span><Icon /></span>
                  <div>
                    <strong>{label}</strong>
                    <small>
                      {service.configured
                        ? `${service.items?.length || 0} 个歌单`
                        : "尚未连接"}
                    </small>
                  </div>
                </header>
                {service.error ? (
                  <div className="service-playlist-message error">
                    <CircleAlert />
                    <span>{service.error}</span>
                  </div>
                ) : !service.configured ? (
                  <div className="service-playlist-message">
                    <Link2 />
                    <span>去设置里连上，歌单会自己出现。</span>
                  </div>
                ) : service.items?.length ? (
                  <div className="service-playlist-list">
                    {service.items.map((item, index) => (
                      <button
                        type="button"
                        key={`${id}-${item.id}`}
                        className={id !== "plex" ? "sync-only" : ""}
                        disabled={
                          id !== "plex" ||
                          servicePlaying === `${id}:${item.id}`
                        }
                        onClick={() => playServicePlaylist(id, item)}
                        aria-label={
                          id === "plex"
                            ? `播放歌单 ${item.name}`
                            : `查看飞牛音乐歌单 ${item.name} 的播放能力`
                        }
                      >
                        <span className={`playlist-tile tone-${index % 4}`}>
                          {item.coverUrl ? (
                            <img src={item.coverUrl} alt="" />
                          ) : (
                            <ListMusic />
                          )}
                        </span>
                        <div>
                          <strong>{item.name}</strong>
                          <small>{item.itemCount || 0} 首歌曲</small>
                        </div>
                        <em>
                          {servicePlaying === `${id}:${item.id}` ? (
                            <LoaderCircle className="spin" />
                          ) : id === "plex" ? (
                            <Play fill="currentColor" />
                          ) : (
                            label
                          )}
                        </em>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="service-playlist-message">
                    <ListMusic />
                    <span>连上了，但那边还没有歌单。</span>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
      <div className="playlist-workspace">
        <aside className="panel playlist-list">
          <form onSubmit={create}>
            <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="新歌单名称" />
            <button className="primary icon-button" disabled={busy || !newName.trim()} aria-label="创建歌单"><Plus /></button>
          </form>
          {items.length ? items.map((item) => (
            <button
              key={item.id}
              className={selected?.id === item.id ? "active" : ""}
              onClick={() => load(item.id).catch((err) => setError(err.message))}
            >
              <span><ListMusic /><strong>{item.name}</strong></span>
              <small>{item.itemCount} 首</small>
            </button>
          )) : <Empty icon={ListMusic} title="还没有歌单" text="创建一个空歌单，或导入 M3U/M3U8 文件。" />}
        </aside>
        <section className="panel playlist-detail">
          {!selected ? (
            <Empty icon={ListMusic} title="选择一个歌单" text="左边挑一张，里面的歌会列在这儿。" />
          ) : (
            <>
              <header>
                <div>
                  <span>本地歌单</span>
                  <h2>{selected.name}</h2>
                  <p>{selected.description || `${selected.itemCount} 首歌曲`}</p>
                </div>
                <div>
                  <button className="secondary" onClick={() => syncSelected("plex")} disabled={busy || !selected.items.length}>
                    <Server />同步 Plex
                  </button>
                  <button className="secondary" onClick={() => syncSelected("fnos")} disabled={busy || !selected.items.length}>
                    <Radio />同步飞牛音乐
                  </button>
                  <button className="primary" onClick={playAll} disabled={!selected.items.some(playable)}>
                    <Play />播放全部
                  </button>
                  <button className="icon-button danger" onClick={remove} aria-label="删除歌单"><Trash2 /></button>
                </div>
              </header>
              <div className="playlist-tracks">
                {selected.items.length ? selected.items.map((item, index) => (
                  <article key={item.id} className={!playable(item) ? "unmatched" : ""}>
                    <button
                      className="track-play"
                      disabled={!playable(item)}
                      onClick={() => playable(item) && playSelectedFrom(index)}
                      aria-label={playable(item) ? `播放 ${item.title}` : `${item.title} 尚未匹配`}
                    >
                      {item.file_id ? <Play /> : <CircleAlert />}
                    </button>
                    <span className="track-position">{index + 1}</span>
                    <div><strong>{item.title || "未命名歌曲"}</strong><small>{item.artist || "未知艺人"} · {item.album || "未知专辑"}</small></div>
                    <em>{playable(item) ? "可播放" : "待匹配"}</em>
                    <div className="track-order">
                      <button className="icon-button" onClick={() => move(index, -1)} disabled={busy || index === 0} aria-label="上移"><ChevronDown className="rotate-180" /></button>
                      <button className="icon-button" onClick={() => move(index, 1)} disabled={busy || index === selected.items.length - 1} aria-label="下移"><ChevronDown /></button>
                    </div>
                  </article>
                )) : <Empty icon={Music2} title="空歌单" text="导入一个 M3U，或者放歌的时候顺手加进来。" />}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
