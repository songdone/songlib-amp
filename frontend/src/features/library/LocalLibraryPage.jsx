import { BookOpenText, Check, ChevronRight, CircleAlert, FileAudio, FolderTree, Image, Play, RefreshCw, RotateCcw, Search, Tags, WandSparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Empty } from "../../components/Empty";
import { PageLoader } from "../../components/PageLoader";
import { SectionHead } from "../../components/SectionHead";
import { StatCard } from "../../components/StatCard";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../lib/api";
import { fmt, timeAgo } from "../../lib/format";
import { TagEditor } from "./TagEditor";

export function LocalLibraryPage({ runJob, play, notify, navigate }) {
  const [tab, setTab] = useState("files"),
    [data, setData] = useState({ items: [], total: 0, stats: {} }),
    [search, setSearch] = useState(
      () => localStorage.getItem("songlib-global-search") || "",
    ),
    [missing, setMissing] = useState(""),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState([]),
    [previews, setPreviews] = useState([]),
    [editing, setEditing] = useState(null),
    [operations, setOperations] = useState([]),
    [error, setError] = useState("");
  const [categories, setCategories] = useState({ summary: [], groups: {} });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [activeFilter, setActiveFilter] = useState(null);
  useEffect(() => {
    if (search) localStorage.removeItem("songlib-global-search");
  }, []);
  const load = async () => {
    setLoading(true);
    try {
      setData(
        await api(
          `/api/local/files?limit=${pageSize}&offset=${(page - 1) * pageSize}&search=${encodeURIComponent(search)}&missing=${missing}`,
        ),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    const timer = setTimeout(load, 180);
    return () => clearTimeout(timer);
  }, [search, missing, page, pageSize]);
  const toggle = (id) =>
    setSelected((value) =>
      value.includes(id) ? value.filter((item) => item !== id) : [...value, id],
    );
  const preview = async () => {
    if (!selected.length) return;
    try {
      const result = await api("/api/local/organize/preview", {
        method: "POST",
        body: JSON.stringify({ fileIds: selected }),
      });
      setPreviews(result.items);
      setTab("preview");
    } catch (err) {
      setError(err.message);
    }
  };
  const apply = async () => {
    if (!previews.length) return;
    if (
      !confirm(
        `确认按预览结果整理 ${previews.length} 个文件？\n\n执行前请确认目标路径无误，操作会写入回滚记录。`,
      )
    )
      return;
    try {
      await api("/api/local/organize/apply", {
        method: "POST",
        body: JSON.stringify({ previews }),
      });
      notify("整理任务已加入队列");
      navigate("tasks");
    } catch (err) {
      setError(err.message);
    }
  };
  // 标签写入逻辑已移到 TagEditor —— 它需要知道哪些字段被改过，
  // 才能在批量模式下只写改动过的字段。原先用 FormData 一把捞，
  // 会把所有字段（包括没动的）都当成改动写回去。
  const switchTab = async (value) => {
    setTab(value);
    if (value === "history")
      try {
        setOperations(await api("/api/local/operations"));
      } catch (err) {
        setError(err.message);
      }
    if (value === "categories")
      try {
        setCategories(await api("/api/local/categories"));
      } catch (err) {
        setError(err.message);
      }
  };
  const applyCategory = (item, type, label) => {
    setMissing(item.missing || "");
    setSearch(item.search || item.name || "");
    setPage(1);
    setActiveFilter({
      type: label || type,
      name: item.name,
      missing: item.missing || "",
    });
    setTab("files");
  };
  const clearFilter = () => {
    setSearch("");
    setMissing("");
    setActiveFilter(null);
    setPage(1);
  };
  const rollback = async (item) => {
    if (!confirm("确认回滚这次操作？音屿会检查路径冲突后再执行。")) return;
    try {
      await api(`/api/local/operations/${item.id}/rollback`, {
        method: "POST",
      });
      setOperations(await api("/api/local/operations"));
      notify("操作已安全回滚");
    } catch (err) {
      setError(err.message);
    }
  };
  const stats = data.stats || {};
  return (
    <div className="page local-page">
      <section className="local-hero panel">
        <div>
          <span className="eyebrow">
            <FolderTree />
            NAS MUSIC LIBRARY
          </span>
          <h1>让每一首歌都有清晰的位置。</h1>
          <p>浏览曲库，校对标签和目录，需要时可安全撤销。</p>
        </div>
        <div>
          <button className="secondary" onClick={() => runJob("plex_sync")}>
            <RefreshCw />
            同步 Plex 对照
          </button>
          <button className="primary" onClick={() => runJob("local_scan")}>
            <FolderTree />
            扫描本地曲库
          </button>
        </div>
      </section>
      <div className="local-stats">
        <StatCard icon={FileAudio} label="本地音频" value={stats.total} />
        <StatCard
          icon={Image}
          label="缺封面"
          value={stats.missing_cover}
          tone="violet"
        />
        <StatCard
          icon={BookOpenText}
          label="缺歌词"
          value={stats.missing_lyrics}
          tone="blue"
        />
        <StatCard
          icon={CircleAlert}
          label="目录待整理"
          value={stats.bad_path}
          tone="amber"
        />
      </div>
      <div className="local-tabs">
        {[
          ["files", "文件浏览"],
          ["categories", "分类浏览"],
          ["missing", "缺失信息"],
          ["preview", "入库预览"],
          ["history", "操作历史"],
        ].map(([id, label]) => (
          <button
            className={tab === id ? "active" : ""}
            onClick={() => switchTab(id)}
            key={id}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <div className="inline-error">
          <CircleAlert />
          {error}
        </div>
      )}
      {tab === "files" && (
        <section className="panel local-workspace">
          {activeFilter && (
            <div className="library-context">
              <span>分类浏览</span>
              <ChevronRight />
              <span>{activeFilter.type}</span>
              <ChevronRight />
              <strong>{activeFilter.name}</strong>
              <button onClick={clearFilter}>
                {activeFilter.type}={activeFilter.name}
                <X />
              </button>
            </div>
          )}
          <div className="local-toolbar">
            <div className="search-field">
              <Search />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                  setActiveFilter(null);
                }}
                placeholder="搜索文件、歌曲、歌手或专辑…"
              />
            </div>
            <span>{data.total} 个真实文件</span>
            {/* 选中多首时可以一次改标签。批量模式下只写你动过的字段，
                没动的保持各自原值 —— 详见 TagEditor。 */}
            <Button
              size="sm"
              icon={Tags}
              disabled={!selected.length}
              onClick={() =>
                setEditing(data.items.filter((item) => selected.includes(item.id)))
              }
            >
              批量改标签{selected.length ? `（${selected.length}）` : ""}
            </Button>
            <Button
              size="sm"
              icon={WandSparkles}
              disabled={!selected.length}
              onClick={preview}
            >
              整理预览{selected.length ? `（${selected.length}）` : ""}
            </Button>
          </div>
          {loading ? (
            <PageLoader />
          ) : (
            <div className="local-table">
              <div className="local-row local-head">
                <span></span>
                <span>歌曲 / 文件</span>
                <span>歌手</span>
                <span>专辑</span>
                <span>状态</span>
                <span>操作</span>
              </div>
              {data.items.map((item) => (
                <div className="local-row" key={item.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(item.id)}
                    onChange={() => toggle(item.id)}
                  />
                  <div className="local-title">
                    <strong>{item.title || item.filename}</strong>
                    <small>{item.path}</small>
                  </div>
                  <span>{item.artist || "未知歌手"}</span>
                  <span>{item.album || "未知专辑"}</span>
                  <div className="file-flags">
                    <i className={item.has_cover ? "ok" : ""}>封面</i>
                    <i className={item.has_lrc ? "ok" : ""}>歌词</i>
                    <i className={item.plex_matched ? "ok" : ""}>Plex</i>
                  </div>
                  <div className="row-actions">
                    <button title="播放" onClick={() => play(item)}>
                      <Play />
                    </button>
                    <button title="编辑标签" onClick={() => setEditing(item)}>
                      <Tags />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!loading && data.total > pageSize && (
            <div className="pagination">
              <button
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                上一页
              </button>
              <span>
                第 {page} / {Math.ceil(data.total / pageSize)} 页
              </span>
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
              >
                <option value="30">每页 30 首</option>
                <option value="50">每页 50 首</option>
                <option value="100">每页 100 首</option>
              </select>
              <button
                disabled={page >= Math.ceil(data.total / pageSize)}
                onClick={() => setPage((value) => value + 1)}
              >
                下一页
              </button>
            </div>
          )}
        </section>
      )}
      {tab === "missing" && (
        <section className="panel missing-workspace">
          <SectionHead
            title="缺失信息扫描"
            note="筛选真实文件，不修改 Plex 条目"
          />
          <div className="missing-filters">
            {[
              ["cover", "缺封面", stats.missing_cover],
              ["lyrics", "缺歌词", stats.missing_lyrics],
              ["artist", "缺歌手", stats.missing_artist],
              ["album", "缺专辑", stats.missing_album],
              ["path", "目录不规范", stats.bad_path],
              ["plex", "Plex 未识别", stats.plex_unmatched],
            ].map(([id, label, count]) => (
              <button
                className={missing === id ? "active" : ""}
                onClick={() => {
                  setMissing(id);
                  setActiveFilter({
                    type: "缺失信息",
                    name: label,
                    missing: id,
                  });
                  setPage(1);
                  setTab("files");
                }}
                key={id}
              >
                <b>{count || 0}</b>
                <span>{label}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {tab === "categories" && (
        <section className="panel category-workspace">
          <SectionHead
            title="曲库分类"
            note="选择分类后可继续筛选、播放或编辑，返回时保留分类上下文。"
          />
          <div className="category-summary">
            {(categories.summary || []).map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  if (item.id === "tracks") clearFilter();
                  else setActiveFilter(null);
                  setTab(item.id === "tracks" ? "files" : "categories");
                }}
              >
                <strong>{fmt(item.count)}</strong>
                <span>{item.label}</span>
                <small>{item.note}</small>
              </button>
            ))}
          </div>
          <div className="category-groups">
            {[
              ["genre", "流派 / 风格"],
              ["artist", "艺人"],
              ["album", "专辑"],
              ["folder", "顶层文件夹"],
              ["format", "文件格式"],
              ["quality", "音质规格"],
              ["year", "年份"],
              ["scene", "场景精选"],
              ["missing", "待修复"],
            ].map(([key, title]) => (
              <div className="category-group" key={key}>
                <h3>{title}</h3>
                <div>
                  {(categories.groups?.[key] || []).map((item) => (
                    <button
                      key={item.id || item.name}
                      onClick={() => applyCategory(item, key, title)}
                    >
                      <span>{item.name}</span>
                      <b>{fmt(item.count)}</b>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {tab === "preview" && (
        <section className="panel preview-workspace">
          <SectionHead
            title="整理预览"
            note="确认前不会移动任何文件"
            action={
              previews.length ? (
                <button className="primary" onClick={apply}>
                  <Check />
                  确认执行
                </button>
              ) : null
            }
          />
          {previews.length ? (
            <div className="preview-list">
              {previews.map((item) => (
                <div key={item.fileId}>
                  <div>
                    <small>原路径</small>
                    <code>{item.sourcePath}</code>
                  </div>
                  <ChevronRight />
                  <div>
                    <small>新路径</small>
                    <code>{item.targetPath}</code>
                  </div>
                  <i className={item.conflict ? "danger" : "safe"}>
                    {item.conflict ? "存在冲突" : "安全"}
                  </i>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              icon={WandSparkles}
              title="暂无整理预览"
              text="在文件浏览中勾选歌曲，再点击“整理预览”。"
            />
          )}
        </section>
      )}
      {tab === "history" && (
        <section className="panel operation-workspace">
          <SectionHead
            title="操作历史"
            note="标签写入、移动和下载入库均有回滚数据"
          />
          <div className="operation-list">
            {operations.length ? (
              operations.map((item) => (
                <div key={item.id}>
                  <span>{item.action}</span>
                  <code>{item.target_id || "—"}</code>
                  <i>{item.rollbackable ? "可回滚" : "仅记录"}</i>
                  <time>{timeAgo(item.created_at)}</time>
                  {item.rollbackable ? (
                    <button onClick={() => rollback(item)}>
                      <RotateCcw />
                      回滚
                    </button>
                  ) : null}
                </div>
              ))
            ) : (
              <Empty
                icon={RotateCcw}
                title="暂无修改记录"
                text="完成标签写入、文件整理或入库后，记录会显示在这里。"
              />
            )}
          </div>
        </section>
      )}
      {/*
        标签编辑器。editing 可以是单个文件，也可以是一批（批量编辑）。
        用原生 <dialog>（见 components/ui/Modal），焦点不会跑到背后的列表上。
        dismissible=false：里面可能有未写入的改动，点遮罩不应该直接丢掉。
      */}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="编辑音频标签"
        description="改动会直接写入音频文件，原值记录在操作历史里，可以回滚"
        size="xl"
        dismissible={false}
      >
        {editing && (
          <TagEditor
            files={Array.isArray(editing) ? editing : [editing]}
            onClose={() => setEditing(null)}
            onSaved={(count) => {
              setEditing(null);
              notify(
                count > 1 ? `${count} 首的标签已写入` : "标签已写入音频文件",
              );
              load();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
