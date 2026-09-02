/**
 * 下载入库。
 *
 * 重构掉的：
 * - 四个裸 <select> 加一个开关挤在一条"source-strip"里，谁也没有标签。
 *   用户得靠猜每个下拉框是干什么的。现在每个都有可见的标签。
 * - "下载到哪里"原来是两个按钮的自制开关，也没说清两者的区别；
 *   现在是带说明的两张卡（下到这台设备 vs 下到 NAS 再入库）。
 * - 待入库每行五个状态徽章（阶段 / 标签 / 封面 / 歌词 / 冲突）。
 *   五个徽章一行，等于没有重点。现在只在"缺什么"和"有冲突"时才出徽章，
 *   齐全的那些不占地方 —— 用户要找的是有问题的那几首。
 * - confirm() 批量确认。入库会让 Plex 重扫、删除会挪回收区，
 *   代价要写在弹窗里而不是一行 confirm。
 * - 平台代码和时长各处手写，改用 lib/sources 和 lib/format。
 */

import {
  ArrowDownToLine,
  Check,
  ChevronRight,
  CircleAlert,
  Download,
  Play,
  RefreshCw,
  Search,
  Server,
  Settings,
  Trash2,
  Wifi,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button, ButtonGroup, IconButton } from "../../components/ui/Button";
import { Cover } from "../../components/ui/Cover";
import { Field, Notice } from "../../components/ui/Field";
import { PathText } from "../../components/ui/PathText";
import {
  EmptyState,
  ListGroup,
  ListRow,
  Page,
  Section,
  SectionHeader,
} from "../../components/ui/Layout";
import { Modal } from "../../components/ui/Modal";
import { MediaCard, MediaGrid } from "../../components/ui/MediaCard";
import { PageLoader } from "../../components/PageLoader";
import { api } from "../../lib/api";
import { formatTime } from "../../lib/format";
import { mergeCatalogResults, platformLabel, sourceCatalogReady } from "../../lib/sources";
import { DownloadInboxPanel } from "./DownloadInboxPanel";

/** 下到哪里去。两者的区别是"进不进曲库"，必须先说清。 */
const TARGETS = [
  {
    id: "nas",
    label: "下到 NAS",
    icon: Server,
    note: "先落在暂存区，你核对过再放进曲库",
  },
  {
    id: "device",
    label: "下到这台设备",
    icon: Download,
    note: "直接存进浏览器的下载目录，不进曲库",
  },
];

const PLATFORMS = [
  { id: "tx", label: "QQ 音乐" },
  { id: "wy", label: "网易云" },
  { id: "all", label: "全部音源" },
];

const SEARCH_TYPES = [
  { id: "song", label: "按歌曲列" },
  { id: "album", label: "按专辑归组" },
  { id: "artist", label: "按歌手归组" },
];

const QUALITIES = [
  { id: "128k", label: "标准 128K" },
  { id: "320k", label: "高品质 320K" },
  { id: "flac", label: "无损 FLAC" },
  { id: "flac24bit", label: "Hi-Res" },
];

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
  const [deciding, setDeciding] = useState("");
  const togglePending = (id) =>
    setSelectedPending((value) =>
      value.includes(id) ? value.filter((item) => item !== id) : [...value, id],
    );
  /** 这次批量操作影响哪些。没勾就是全部。 */
  const pendingScope = () =>
    selectedPending.length ? selectedPending : pending.map((item) => item.jobId);

  const decide = async () => {
    const action = deciding;
    setDeciding("");
    if (!action) return;
    const ids = pendingScope();
    if (!ids.length) return;
    await api(
      `/api/downloads/${action === "confirm" ? "batch-confirm" : "batch-cancel"}`,
      { method: "POST", body: JSON.stringify({ jobIds: ids }) },
    );
    setSelectedPending([]);
    await loadPending();
    notify?.(action === "confirm" ? "批量入库任务已创建" : "已移入回收站");
  };
  /**
   * 待入库这一首缺什么。齐全的不返回徽章 ——
   * 五个"已准备"徽章排一行等于没有重点，用户要找的是有问题的那几首。
   */
  const pendingIssues = (item) => {
    const issues = [];
    if (item.tagStatus && !item.tagStatus.includes("已准备"))
      issues.push({ label: item.tagStatus, tone: "warning" });
    if (item.coverStatus && !item.coverStatus.includes("已准备"))
      issues.push({ label: item.coverStatus, tone: "warning" });
    if (item.lyricStatus && !item.lyricStatus.includes("已准备"))
      issues.push({ label: item.lyricStatus, tone: "warning" });
    if (item.conflict) issues.push({ label: "目标位置有冲突", tone: "danger" });
    return issues;
  };

  const activeTarget = TARGETS.find((item) => item.id === target) || TARGETS[0];
  const scopeCount = selectedPending.length || pending.length;

  if (!ready.length)
    return (
      <Page className="download">
        <EmptyState
          icon={Wifi}
          title="还没有可用的音乐源"
          text="音屿不自带音源。先去「音乐源」导入一个你有权使用的，回来就能搜歌了。"
          action={
            <Button variant="primary" icon={Wifi} onClick={() => navigate("sources")}>
              去添加音乐源
            </Button>
          }
        />
        <DownloadInboxPanel notify={notify} navigate={navigate} />
      </Page>
    );

  return (
    <Page className="download">
      {/* --- 下到哪里 --- */}
      <Section>
        <SectionHeader
          title="下到哪里"
          note={`${ready.length} 个音源已启用`}
          actions={
            <Button size="sm" icon={Settings} onClick={() => navigate("sources")}>
              管理音源
            </Button>
          }
        />
        <div className="ui-chips ui-chips--cards" role="group" aria-label="下到哪里">
          {TARGETS.map(({ id, label, icon: Icon, note }) => (
            <button
              key={id}
              type="button"
              aria-pressed={target === id}
              className={`ui-chip${target === id ? " ui-chip--on" : ""}`}
              onClick={() => setTarget(id)}
            >
              <strong>
                <Icon aria-hidden="true" />
                {label}
              </strong>
              <small>{note}</small>
            </button>
          ))}
        </div>
      </Section>

      {/* --- 搜什么 --- */}
      <Section>
        <SectionHeader title="搜什么" />
        <div className="download__options">
          <label>
            <span>用哪个音源</span>
            <select
              className="ui-select"
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
            >
              {ready.map((source) => (
                <option value={source.id} key={source.id}>
                  {source.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>搜哪个平台</span>
            <select
              className="ui-select"
              value={platform}
              onChange={(event) => setPlatform(event.target.value)}
            >
              {PLATFORMS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>结果怎么排</span>
            <select
              className="ui-select"
              value={searchType}
              onChange={(event) => setSearchType(event.target.value)}
            >
              {SEARCH_TYPES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>下什么音质</span>
            <select
              className="ui-select"
              value={quality}
              onChange={(event) => setQuality(event.target.value)}
            >
              {QUALITIES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <form className="download__search" onSubmit={submit}>
          <Field
            label="搜索"
            hideLabel
            leading={Search}
            placeholder="歌名、专辑名，或者歌手"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button
            type="submit"
            variant="primary"
            loading={loading}
            disabled={!selected || !query.trim()}
          >
            搜索
          </Button>
        </form>
      </Section>

      {error && (
        <Notice tone="danger" icon={CircleAlert}>
          {error}
        </Notice>
      )}

      {/* --- 搜索结果 --- */}
      <Section>
        <SectionHeader
          title="搜到了什么"
          note={
            results.length
              ? `${results.length} 首候选 · 会${activeTarget.label}`
              : undefined
          }
        />
        {loading ? (
          <PageLoader />
        ) : !results.length ? (
          <EmptyState
            icon={Search}
            title="还没搜过"
            text="搜到的歌可以先试听，再决定下不下。"
          />
        ) : ["album", "artist"].includes(searchType) ? (
          <MediaGrid min={200}>
            {(searchType === "album" ? albumGroups : artistGroups).map((group) => (
              <MediaCard
                key={
                  searchType === "album"
                    ? `${group.album}-${group.artist}`
                    : group.artist
                }
                kind={searchType === "album" ? "album" : "artist"}
                title={searchType === "album" ? group.album : group.artist}
                subtitle={[
                  searchType === "album" ? group.artist : null,
                  `${group.tracks.length} 首`,
                  platformLabel(platform === "all" ? "" : platform),
                ]
                  .filter(Boolean)
                  .join(" · ")}
                coverUrl={group.coverUrl}
                onOpen={() => {
                  // 点开就是"把这一组摊成歌曲列表"，不是进详情页。
                  setResults(group.tracks);
                  setSearchType("song");
                }}
                onPlay={() => downloadMany(group.tracks)}
                playLabel={`把这 ${group.tracks.length} 首都下下来`}
              />
            ))}
          </MediaGrid>
        ) : (
          <ListGroup>
            {results.map((item) => {
              const key = `${item.platform}-${item.trackId || item.id}`;
              return (
                <ListRow
                  key={key}
                  leading={
                    <Cover
                      src={item.coverUrl}
                      title={item.title}
                      size="40px"
                      shape="square"
                    />
                  }
                  title={item.title}
                  subtitle={[item.artist, item.album || "单曲"]
                    .filter(Boolean)
                    .join(" · ")}
                  chevron={false}
                  trailing={
                    <span className="download__row-actions">
                      <small>{formatTime(item.duration)}</small>
                      {item.qualities.slice(-2).map((q) => (
                        <Badge key={q}>{q}</Badge>
                      ))}
                      <IconButton
                        icon={Play}
                        size="sm"
                        label={`试听 ${item.title}`}
                        onClick={() =>
                          playPreview?.({
                            ...item,
                            source: "source_preview",
                            sourceId,
                            quality,
                            item,
                          })
                        }
                      />
                      <IconButton
                        icon={Download}
                        size="sm"
                        variant="primary"
                        loading={downloadBusy === key}
                        disabled={Boolean(downloadBusy) && downloadBusy !== key}
                        label={
                          target === "device"
                            ? `把 ${item.title} 下到这台设备`
                            : `把 ${item.title} 下到 NAS`
                        }
                        onClick={() => downloadOne(item)}
                      />
                    </span>
                  }
                />
              );
            })}
          </ListGroup>
        )}
      </Section>

      {/* --- 待入库 --- */}
      <Section reveal>
        <SectionHeader
          title="下好了，等你确认"
          note={
            pending.length
              ? `${pending.length} 首在暂存区${selectedPending.length ? `，已勾 ${selectedPending.length} 首` : ""}`
              : undefined
          }
          actions={
            <ButtonGroup>
              <Button size="sm" icon={RefreshCw} onClick={loadPending}>
                刷新
              </Button>
              <Button
                size="sm"
                icon={Trash2}
                variant="danger"
                disabled={!pending.length}
                onClick={() => setDeciding("cancel")}
              >
                不要了
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={Check}
                disabled={!pending.length}
                onClick={() => setDeciding("confirm")}
              >
                放进曲库
              </Button>
            </ButtonGroup>
          }
        />
        {pending.length ? (
          <div className="download-pending">
            {pending.map((item) => {
              const issues = pendingIssues(item);
              return (
                <div className="download-pending__row" key={item.jobId}>
                  <input
                    type="checkbox"
                    checked={selectedPending.includes(item.jobId)}
                    onChange={() => togglePending(item.jobId)}
                    aria-label={`勾选 ${item.title}`}
                  />
                  <div className="download-pending__text">
                    <strong>{item.title}</strong>
                    <small>
                      {[item.artist, item.album, item.source || "音乐源", item.quality]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </div>
                  <div className="download-pending__paths">
                    <PathText path={item.currentPath || item.downloadPath} />
                    <ChevronRight aria-hidden="true" />
                    <PathText path={item.proposedPath || item.targetPath} />
                  </div>
                  <div className="download-pending__flags">
                    {issues.length ? (
                      issues.map((issue) => (
                        <Badge key={issue.label} tone={issue.tone}>
                          {issue.label}
                        </Badge>
                      ))
                    ) : (
                      <Badge tone="success">都齐了</Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={Download}
            title="暂存区是空的"
            text="下好的歌会先停在这里，核对完再一起放进曲库。"
          />
        )}
      </Section>

      <DownloadInboxPanel notify={notify} navigate={navigate} />

      {/* 入库会让 Plex 重扫、删除会挪回收区，代价要写清。 */}
      <Modal
        open={Boolean(deciding)}
        onClose={() => setDeciding("")}
        title={
          deciding === "confirm"
            ? `把这 ${scopeCount} 首放进曲库？`
            : `不要这 ${scopeCount} 首了？`
        }
        description={
          selectedPending.length ? "只处理你勾上的那些" : "暂存区里的全部"
        }
        actions={
          <ButtonGroup align="end">
            <Button onClick={() => setDeciding("")}>先不动</Button>
            <Button
              variant={deciding === "confirm" ? "primary" : "danger"}
              icon={deciding === "confirm" ? ArrowDownToLine : Trash2}
              onClick={decide}
            >
              {deciding === "confirm" ? "放进曲库" : "移到回收区"}
            </Button>
          </ButtonGroup>
        }
      >
        <p>
          {deciding === "confirm"
            ? "文件会从暂存区挪进音乐目录，然后让 Plex 重扫一遍。原位置记下来了，之后能退回去。"
            : "文件会挪到下载回收区，不是直接删掉 —— 反悔了还能找回来。"}
        </p>
      </Modal>
    </Page>
  );
}
