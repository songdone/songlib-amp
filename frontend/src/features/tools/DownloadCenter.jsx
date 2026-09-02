import { Album, ArrowDownToLine, Check, ChevronRight, CircleAlert, Download, LoaderCircle, Music2, Play, RefreshCw, Search, Server, Settings, Trash2, Wifi } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Empty } from "../../components/Empty";
import { PageLoader } from "../../components/PageLoader";
import { SectionHead } from "../../components/SectionHead";
import { api } from "../../lib/api";
import { mergeCatalogResults, sourceCatalogReady } from "../../lib/sources";
import { DownloadInboxPanel } from "./DownloadInboxPanel";

export function DownloadCenter({
  sources,
  refreshSources,
  createDownload,
  navigate,
  playPreview,
  notify,
}) {
  const ready = sources.filter(sourceCatalogReady);
  const [query, setQuery] = useState(
      () => localStorage.getItem("songlib-download-query") || "",
    ),
    [platform, setPlatform] = useState("tx"),
    [searchType, setSearchType] = useState("song"),
    [results, setResults] = useState([]),
    [loading, setLoading] = useState(false),
    [sourceId, setSourceId] = useState(""),
    [quality, setQuality] = useState("320k"),
    [error, setError] = useState("");
  const [target, setTarget] = useState("nas");
  const [downloadBusy, setDownloadBusy] = useState("");
  const [pending, setPending] = useState([]),
    [selectedPending, setSelectedPending] = useState([]);
  useEffect(() => {
    if (!ready.some((source) => source.id === sourceId))
      setSourceId(ready[0]?.id || "");
  }, [sources, sourceId]);
  const selected = ready.find((source) => source.id === sourceId);
  const loadPending = async () => {
    try {
      const data = await api("/api/downloads/pending");
      setPending(data.items || []);
    } catch {}
  };
  useEffect(() => {
    loadPending();
    localStorage.removeItem("songlib-download-query");
  }, []);
  useEffect(() => {
    const refresh = () => refreshSources?.().catch(() => {});
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshSources]);
  const submit = async (event) => {
    event.preventDefault();
    if (!query.trim() || !sourceId) return;
    setLoading(true);
    setError("");
    try {
      const declaredPlatforms = (selected?.supportedPlatforms || []).filter(
        (value) => value === "tx" || value === "wy",
      );
      const targets = platform === "all"
        ? declaredPlatforms.length
          ? declaredPlatforms
          : ["tx", "wy"]
        : [platform];
      const responses = await Promise.allSettled(
        targets.map((targetPlatform) =>
          api(`/api/sources/${sourceId}/test-search`, {
            method: "POST",
            body: JSON.stringify({ keyword: query, platform: targetPlatform }),
          }),
        ),
      );
      const successful = responses
        .filter((result) => result.status === "fulfilled")
        .flatMap((result) => result.value.results || []);
      if (!successful.length) {
        throw responses.find((result) => result.status === "rejected")?.reason || new Error("没有搜索结果");
      }
      setResults(mergeCatalogResults(successful));
      await refreshSources?.();
    } catch (err) {
      setError(`搜索失败：${err.message}`);
    } finally {
      setLoading(false);
    }
  };
  const albumGroups = useMemo(
    () =>
      Object.values(
        results.reduce((map, item) => {
          const key = `${item.album || "单曲"}-${item.artist}`;
          map[key] ||= {
            album: item.album || "单曲",
            artist: item.artist,
            coverUrl: item.coverUrl,
            tracks: [],
          };
          map[key].tracks.push(item);
          return map;
        }, {}),
      ),
    [results],
  );
  const artistGroups = useMemo(
    () =>
      Object.values(
        results.reduce((map, item) => {
          const key = item.artist || "未知歌手";
          map[key] ||= {
            artist: key,
            coverUrl: item.coverUrl,
            tracks: [],
          };
          map[key].tracks.push(item);
          return map;
        }, {}),
      ),
    [results],
  );
  const deviceDownload = async (item) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.title = `下载 ${item.title || "歌曲"}`;
    document.body.appendChild(frame);
    try {
      const data = await api("/api/downloads/device-token", {
        method: "POST",
        body: JSON.stringify({ item, sourceId, quality }),
      });
      frame.src = data.downloadUrl;
      window.setTimeout(() => frame.remove(), 120000);
      notify?.(
        `《${item.title}》已开始下载到当前设备${data.qualityFallback ? `（自动使用 ${data.quality}）` : ""}`,
      );
    } catch (downloadError) {
      frame.remove();
      throw downloadError;
    }
  };
  const downloadOne = async (item) => {
    const busyKey = `${item.platform}-${item.trackId || item.id}`;
    setDownloadBusy(busyKey);
    setError("");
    try {
      if (target === "device") {
        await deviceDownload(item);
        return;
      }
      await createDownload(item, sourceId, quality);
      await loadPending();
    } catch (downloadError) {
      setError(`下载失败：${downloadError.message}`);
      notify?.(`《${item.title}》下载失败：${downloadError.message}`);
    } finally {
      setDownloadBusy("");
    }
  };
  const downloadMany = async (items) => {
    setDownloadBusy("batch");
    setError("");
    try {
      if (target === "device") {
        for (const item of items) await deviceDownload(item);
        notify?.(`已向当前设备发起 ${items.length} 个下载`);
        return;
      }
      for (const item of items) await createDownload(item, sourceId, quality);
      await loadPending();
      notify?.(`已加入 ${items.length} 首歌曲到待入库流程`);
    } catch (downloadError) {
      setError(`批量下载中断：${downloadError.message}`);
    } finally {
      setDownloadBusy("");
    }
  };
  const togglePending = (id) =>
    setSelectedPending((value) =>
      value.includes(id) ? value.filter((item) => item !== id) : [...value, id],
    );
  const decide = async (action) => {
    const ids = selectedPending.length
      ? selectedPending
      : pending.map((item) => item.jobId);
    if (!ids.length) return;
    const verb = action === "confirm" ? "确认入库" : "删除下载文件";
    if (
      !confirm(
        `${verb} ${ids.length} 首待入库歌曲？\n\n音屿会创建任务并写入操作记录，确认入库后会触发 Plex 扫描；删除会移入下载回收区。`,
      )
    )
      return;
    await api(
      `/api/downloads/${action === "confirm" ? "batch-confirm" : "batch-cancel"}`,
      { method: "POST", body: JSON.stringify({ jobIds: ids }) },
    );
    setSelectedPending([]);
    await loadPending();
    notify?.(action === "confirm" ? "批量入库任务已创建" : "已移入回收站");
  };
  if (!ready.length)
    return (
      <div className="page download-page">
        <section className="download-hero">
          <div>
            <h1>下载入库</h1>
            <p>搜歌、下载，确认无误后再放进正式曲库。</p>
          </div>
        </section>
        <section className="panel download-empty">
          <Empty
            icon={Wifi}
            title="还没有可用的音乐源"
            text="导入一个你有权使用的音乐源，识别到接口后就能在这里搜歌了。"
          />
          <button className="primary" onClick={() => navigate("sources")}>
            <Wifi />
            去添加音乐源
          </button>
        </section>
        <DownloadInboxPanel notify={notify} navigate={navigate} />
      </div>
    );
  return (
    <div className="page download-page">
      <section className="download-hero">
        <div>
          <h1>下载入库</h1>
          <p>
            {target === "device"
              ? "下载到这台设备：文件直接存进浏览器的下载目录，不进曲库。适合临时听一下。"
              : "下载到 NAS：文件先落在暂存区，你核对过歌曲信息和存放位置，再放进正式曲库。"}
          </p>
        </div>
        <div className="hero-actions">
          <button className="secondary" onClick={loadPending}>
            <RefreshCw />
            刷新待入库
          </button>
          <button className="secondary" onClick={() => navigate("sources")}>
            <Settings />
            管理音乐源
          </button>
        </div>
      </section>
      <section className="source-strip download-controls">
        <div className="source-summary">
          <div className="status-orb">
            <Wifi />
          </div>
          <div>
            <strong>{ready.length} 个已启用来源</strong>
            <span>
              {selected?.resolveOk
                ? "最近一次地址解析成功"
                : "接口已授权，下载时实时解析"}
            </span>
          </div>
        </div>
        <div className="target-toggle">
          <button
            className={target === "nas" ? "active" : ""}
            onClick={() => setTarget("nas")}
          >
            <Server />
            NAS 入库
          </button>
          <button
            className={target === "device" ? "active" : ""}
            onClick={() => setTarget("device")}
          >
            <Download />
            当前设备
          </button>
        </div>
        <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          {ready.map((source) => (
            <option value={source.id} key={source.id}>
              {source.displayName}
            </option>
          ))}
        </select>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value="tx">QQ 音乐</option>
          <option value="wy">网易云</option>
          <option value="all">全源</option>
        </select>
        <select
          value={searchType}
          onChange={(e) => setSearchType(e.target.value)}
        >
          <option value="song">歌曲列表</option>
          <option value="album">按专辑分组</option>
          <option value="artist">按歌手分组</option>
        </select>
        <select value={quality} onChange={(e) => setQuality(e.target.value)}>
          <option value="128k">标准 128K</option>
          <option value="320k">高品质 320K</option>
          <option value="flac">无损 FLAC</option>
          <option value="flac24bit">Hi-Res</option>
        </select>
      </section>
      <form className="catalog-search" onSubmit={submit}>
        <div className="big-search">
          <Search />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索歌曲、专辑名或歌手"
          />
          <button className="primary" disabled={loading || !selected}>
            {loading ? <LoaderCircle className="spin" /> : "搜索"}
          </button>
        </div>
      </form>
      {error && (
        <div className="inline-error">
          <CircleAlert />
          {error}
        </div>
      )}
      <section className="search-results panel">
        <SectionHead
          title={
            searchType === "album"
              ? "专辑结果"
              : searchType === "artist"
                ? "歌手结果"
                : "歌曲结果"
          }
          note={
            results.length
              ? `找到 ${results.length} 首候选歌曲 · 当前目标：${target === "device" ? "当前设备" : "NAS 待入库"}`
              : "可解析的歌曲可加入下载队列"
          }
        />
        {loading ? (
          <PageLoader />
        ) : results.length ? (
          ["album", "artist"].includes(searchType) ? (
            <div className="album-results">
              {(searchType === "album" ? albumGroups : artistGroups).map((group) => (
                <article
                  className="album-result"
                  key={searchType === "album" ? `${group.album}-${group.artist}` : group.artist}
                >
                  <div className="result-cover big">
                    {group.coverUrl ? <img src={group.coverUrl} /> : <Album />}
                  </div>
                  <div>
                    <strong>{searchType === "album" ? group.album : group.artist}</strong>
                    <span>
                      {searchType === "album" ? `${group.artist} · ` : ""}
                      {group.tracks.length} 首 ·{" "}
                      {platform === "tx"
                        ? "QQ 音乐"
                        : platform === "wy"
                          ? "网易云"
                          : "全源"}
                    </span>
                    <div className="quality-dots">
                      <i>{quality}</i>
                      <i>
                        {target === "device" ? "浏览器下载" : "本地匹配待检查"}
                      </i>
                    </div>
                  </div>
                  <div className="album-actions">
                    <button
                      className="secondary small"
                      onClick={() => {
                        setResults(group.tracks);
                        setSearchType("song");
                      }}
                    >
                      查看歌曲
                    </button>
                    <button
                      className="primary small"
                      onClick={() => downloadMany(group.tracks)}
                    >
                      <Download />
                      {target === "device"
                        ? "下载到设备"
                        : searchType === "album"
                          ? "下载整张专辑"
                          : "下载歌手结果"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="result-list">
              {results.map((item) => (
                <div
                  className="result-row"
                  key={`${item.platform}-${item.trackId}`}
                >
                  <div className="result-cover">
                    {item.coverUrl ? <img src={item.coverUrl} /> : <Music2 />}
                  </div>
                  <div className="result-main">
                    <strong>{item.title}</strong>
                    <span>
                      {item.artist} · {item.album || "单曲"}
                    </span>
                  </div>
                  <span className="duration">
                    {Math.floor(item.duration / 60)}:
                    {String(item.duration % 60).padStart(2, "0")}
                  </span>
                  <div className="quality-dots">
                    {item.qualities.slice(-2).map((q) => (
                      <i key={q}>{q}</i>
                    ))}
                  </div>
                  <div className="row-actions wide">
                    <button
                      title="试听"
                      onClick={() =>
                        playPreview?.({
                          ...item,
                          source: "source_preview",
                          sourceId,
                          quality,
                          item,
                        })
                      }
                    >
                      <Play />
                    </button>
                    <button
                      title={
                        target === "device"
                          ? "下载到当前设备"
                          : "下载并加入待入库"
                      }
                      disabled={
                        !!downloadBusy &&
                        downloadBusy !== `${item.platform}-${item.trackId || item.id}`
                      }
                      className="download-action-button"
                      onClick={() => downloadOne(item)}
                    >
                      {downloadBusy === `${item.platform}-${item.trackId || item.id}` ? (
                        <LoaderCircle className="spin" />
                      ) : (
                        <Download />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <Empty
            icon={Search}
            title="搜索歌曲、专辑或歌手"
            text="结果会展示歌手、专辑、时长与可选音质。"
          />
        )}
      </section>
      <section className="panel pending-ingest">
        <SectionHead
          title="待入库"
          note={`${pending.length} 首歌曲已下载到临时区，尚未进入正式曲库`}
          action={
            <div className="pending-actions">
              <button
                className="secondary small"
                disabled={!pending.length}
                onClick={() => decide("cancel")}
              >
                <Trash2 />
                批量删除下载文件
              </button>
              <button
                className="primary small"
                disabled={!pending.length}
                onClick={() => decide("confirm")}
              >
                <Check />
                批量确认入库
              </button>
            </div>
          }
        />
        {pending.length ? (
          <div className="pending-table">
            <div className="pending-row pending-head">
              <span></span>
              <span>歌曲</span>
              <span>来源 / 音质</span>
              <span>当前位置 / 入库位置</span>
              <span>状态</span>
            </div>
            {pending.map((item) => (
              <div className="pending-row" key={item.jobId}>
                <input
                  type="checkbox"
                  checked={selectedPending.includes(item.jobId)}
                  onChange={() => togglePending(item.jobId)}
                />
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    {item.artist} · {item.album}
                  </small>
                </div>
                <span>
                  {item.source || "音乐源"} · {item.quality}
                </span>
                <div className="pending-paths">
                  <code>{item.currentPath || item.downloadPath}</code>
                  <ChevronRight />
                  <code>{item.proposedPath || item.targetPath}</code>
                </div>
                <div className="file-flags">
                  <i className="pending-stage">
                    {item.stageLabel || "临时区 · 待确认"}
                  </i>
                  <i className={item.tagStatus === "标签已准备" ? "ok" : ""}>
                    {item.tagStatus}
                  </i>
                  <i className={item.coverStatus === "封面已准备" ? "ok" : ""}>
                    {item.coverStatus}
                  </i>
                  <i className={item.lyricStatus === "歌词已准备" ? "ok" : ""}>
                    {item.lyricStatus}
                  </i>
                  <i className={!item.conflict ? "ok" : ""}>
                    {item.conflict ? "冲突" : "无冲突"}
                  </i>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty
            icon={Download}
            title="暂无待入库歌曲"
            text="下载完成后，歌曲会在这里等待批量确认入库。"
          />
        )}
      </section>
    </div>
  );
}
