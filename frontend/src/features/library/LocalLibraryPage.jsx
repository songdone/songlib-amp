/**
 * 文件与标签。
 *
 * 这一页管的是**音频文件本身**：写在文件里的标签、文件名、所在目录。
 * 配套资料（封面、歌词、歌手照片与简介）在"封面与歌词"页 ——
 * 边界是"改已有的文件"还是"从外部取内容回来补"。
 * 这句话也写在页面开头，因为这两页的归属曾经是混的。
 *
 * 重构掉的三个问题：
 *
 * 1. "本地标签补全"和"重命名与目录整理"原先在"封面与歌词"页，
 *    各是一个批量按钮，点下去就跑，看不到会改什么。
 *    它们改的是文件，本来就该在这一页；现在各有一套
 *    预览 → 逐条核对 → 勾掉不要的 → 执行 的界面。
 *
 * 2. 五个平铺标签页（文件浏览 / 分类浏览 / 缺失信息 / 入库预览 / 操作历史）
 *    里有两个不是"页"：缺失信息只是一组筛选按钮，点了跳回文件浏览；
 *    入库预览是文件浏览的下一步，自己不能独立开始。
 *    现在四个工作区，每个都能独立开始、独立完成。
 *
 * 3. confirm() 原生弹窗。它没有样式、说不清代价，在深色界面里尤其突兀。
 *    改用 Modal，把"会发生什么"写在里面。
 */

import {
  CircleAlert,
  FileAudio,
  FolderTree,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Tags,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button, ButtonGroup, IconButton } from "../../components/ui/Button";
import { Field, Notice } from "../../components/ui/Field";
import {
  EmptyState,
  Page,
  Section,
  SectionHeader,
} from "../../components/ui/Layout";
import { Modal } from "../../components/ui/Modal";
import {
  ChangeList,
  ChangeRow,
  ChipGroup,
  ConfirmBar,
} from "../../components/ui/Plan";
import { StatGrid, StatTile } from "../../components/ui/StatTile";
import { PageLoader } from "../../components/PageLoader";
import { api } from "../../lib/api";
import { fmt, timeAgo } from "../../lib/format";
import { ChangeHistory } from "./ChangeHistory";
import { LibraryCheckup } from "./LibraryCheckup";
import { TagEditor } from "./TagEditor";

/**
 * 五个工作区。每一个都能独立开始，不依赖先去别处点一下。
 *
 * 「体检」排第一是有意的：它是唯一一个不需要你事先知道自己有什么问题
 * 的入口。其余四个都要求你已经知道要干什么。
 */
const WORKSPACES = [
  { id: "checkup", label: "体检" },
  { id: "browse", label: "浏览与筛选" },
  { id: "tags", label: "补标签" },
  { id: "organize", label: "整理目录" },
  { id: "history", label: "改动历史" },
];

/** 文件浏览的快捷筛选。数字来自 /api/local/files 的 stats。 */
const MISSING_FILTERS = [
  { id: "", label: "全部", statKey: "total" },
  { id: "cover", label: "缺封面", statKey: "missing_cover" },
  { id: "lyrics", label: "缺歌词", statKey: "missing_lyrics" },
  { id: "artist", label: "缺歌手", statKey: "missing_artist" },
  { id: "album", label: "缺专辑", statKey: "missing_album" },
  { id: "path", label: "目录不规范", statKey: "bad_path" },
  { id: "plex", label: "Plex 未识别", statKey: "plex_unmatched" },
];

/** 标签字段的中文名。界面上不出现 albumArtist 这种内部字段名。 */
const FIELD_LABELS = {
  title: "标题",
  artist: "歌手",
  album: "专辑",
  albumArtist: "专辑歌手",
};

/** 补标签的范围。 */
const TAG_SCOPES = [
  { id: "selected", label: "已勾选的文件" },
  { id: "filtered", label: "当前筛选结果" },
];

/** 只显示路径的末两级 —— 完整绝对路径在列表里读起来全是噪音。 */
const shortPath = (path) => {
  const parts = String(path || "").split("/").filter(Boolean);
  return parts.slice(-2).join("/") || path || "";
};

/** 操作历史里的动作名。数据库存的是英文枚举，不能直接摆到界面上。 */
const ACTION_LABELS = {
  tag_write: "写入标签",
  organize_move: "移动文件",
  download_ingest: "下载入库",
  download_inbox_ingest: "收件箱入库",
};

export function LocalLibraryPage({ runJob, play, notify, navigate }) {
  const [workspace, setWorkspace] = useState("checkup");

  // --- 文件浏览 ---
  const [data, setData] = useState({ items: [], total: 0, stats: {} });
  const [search, setSearch] = useState(
    () => localStorage.getItem("songlib-global-search") || "",
  );
  const [missing, setMissing] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // --- 补标签 ---
  /*
   * 范围默认跟着"有没有勾东西"走。
   *
   * 原来死写 "selected"：刚切到这个工作区时一个文件都没勾，
   * 于是页面上唯一的主按钮点下去只会报错"先勾选文件"。
   * 一个默认状态下必然失败的主操作不该存在。
   */
  const [tagScope, setTagScope] = useState("filtered");
  const [tagPlan, setTagPlan] = useState(null);
  const [tagExcluded, setTagExcluded] = useState(() => new Set());

  // --- 整理目录 ---
  const [organizePlan, setOrganizePlan] = useState(null);
  const [organizeExcluded, setOrganizeExcluded] = useState(() => new Set());
  const [confirmOrganize, setConfirmOrganize] = useState(false);
  const [organizeView, setOrganizeView] = useState("todo");

  // --- 改动历史 ---
  const [history, setHistory] = useState({ groups: [], total: 0 });

  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [queued, setQueued] = useState("");

  useEffect(() => {
    if (search) localStorage.removeItem("songlib-global-search");
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      setData(
        await api(
          `/api/local/files?limit=${pageSize}&offset=${(page - 1) * pageSize}` +
            `&search=${encodeURIComponent(search)}&missing=${missing}`,
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

  /* 勾了文件就把范围切到"已勾选"，全部取消再切回"当前筛选结果"。
     这样两个胶囊里永远是那个当下有意义的被选中。 */
  useEffect(() => {
    setTagScope(selected.length ? "selected" : "filtered");
  }, [selected.length > 0]);

  useEffect(() => {
    if (workspace !== "history") return;
    api("/api/local/operations")
      .then(setHistory)
      .catch((err) => setError(err.message));
  }, [workspace]);

  const stats = data.stats || {};
  const toggleFile = (id) =>
    setSelected((value) =>
      value.includes(id) ? value.filter((item) => item !== id) : [...value, id],
    );

  const allOnPageSelected =
    data.items.length > 0 && data.items.every((item) => selected.includes(item.id));

  const toggleAllOnPage = () =>
    setSelected((value) => {
      const ids = data.items.map((item) => item.id);
      return allOnPageSelected
        ? value.filter((id) => !ids.includes(id))
        : [...new Set([...value, ...ids])];
    });

  /** 两个工作区共用：拿到这次要处理哪些文件。 */
  const scopeFileIds = (scope) =>
    scope === "filtered" ? data.items.map((item) => item.id) : selected;

  // ------------------------------------------------------------------
  // 补标签
  // ------------------------------------------------------------------

  const previewTags = async () => {
    const fileIds = scopeFileIds(tagScope);
    if (!fileIds.length) {
      setError(
        tagScope === "selected"
          ? "先在「浏览与筛选」里勾选文件"
          : "当前筛选结果是空的",
      );
      return;
    }
    setBusy("tag-preview");
    setError("");
    setQueued("");
    try {
      const result = await api("/api/local/tags/preview", {
        method: "POST",
        body: JSON.stringify({ fileIds }),
      });
      setTagPlan(result);
      setTagExcluded(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const tagRows = (tagPlan?.items || []).filter((item) => item.fields.length);
  // 有冲突的单独一组。它们不进 tagRows，所以不会被算进"会写入"的数字里。
  const tagConflicts = (tagPlan?.items || []).filter(
    (item) => (item.conflicts || []).length,
  );
  const tagApplying = tagRows.filter((item) => !tagExcluded.has(item.fileId));
  const tagFieldCount = tagApplying.reduce(
    (sum, item) => sum + item.fields.length,
    0,
  );

  const applyTags = async () => {
    if (!tagApplying.length) return;
    setBusy("tag-apply");
    setError("");
    try {
      await api("/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          kind: "fill_local_tags",
          payload: {
            items: tagApplying.map((item) => ({ entityId: item.fileId })),
          },
        }),
      });
      setQueued(
        `${tagApplying.length} 个文件的 ${tagFieldCount} 个字段已排进队列`,
      );
      setTagPlan(null);
      setTagExcluded(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  // ------------------------------------------------------------------
  // 整理目录
  // ------------------------------------------------------------------

  const previewOrganize = async () => {
    if (!selected.length) {
      setError("先在「浏览与筛选」里勾选文件");
      return;
    }
    setBusy("organize-preview");
    setError("");
    setQueued("");
    try {
      const result = await api("/api/local/organize/preview", {
        method: "POST",
        body: JSON.stringify({ fileIds: selected }),
      });
      setOrganizePlan(result.items || []);
      setOrganizeView("todo");
      // 有冲突的默认勾掉 —— 目标位置已经有文件，执行会直接失败。
      setOrganizeExcluded(
        new Set(
          (result.items || [])
            .filter((item) => item.conflict)
            .map((item) => item.fileId),
        ),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const organizeRows = organizePlan || [];
  const organizeApplying = organizeRows.filter(
    (item) => !organizeExcluded.has(item.fileId),
  );
  const organizeConflicts = organizeRows.filter((item) => item.conflict).length;
  // 已在正确位置的数量必须从数据本身算，不能用"总数减去要移动的"——
  // 用户勾掉一行，那行并没有变成"位置正确"，但那样算数字会跟着涨。
  const organizeSettled = organizeRows.filter(
    (item) => item.sourcePath === item.targetPath,
  ).length;
  const organizeMoving = organizeApplying.filter(
    (item) => item.sourcePath !== item.targetPath,
  );
  /*
   * 默认只列需要处理的行。
   * 曲库整齐的时候"位置正确"能占九成，把真正要动的那几行挤得到处都是，
   * 用户得自己在一屏灰字里找。要核对全部的人可以切过去。
   */
  const organizeVisible =
    organizeView === "todo"
      ? organizeRows.filter((item) => item.sourcePath !== item.targetPath)
      : organizeRows;

  const applyOrganize = async () => {
    setConfirmOrganize(false);
    if (!organizeApplying.length) return;
    setBusy("organize-apply");
    setError("");
    try {
      await api("/api/local/organize/apply", {
        method: "POST",
        body: JSON.stringify({ previews: organizeApplying }),
      });
      setQueued(`${organizeApplying.length} 个文件的整理已排进队列`);
      setOrganizePlan(null);
      setOrganizeExcluded(new Set());
      setSelected([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  // ------------------------------------------------------------------
  // 回滚
  // ------------------------------------------------------------------

  /* 整批撤销。返回结果交给 ChangeHistory 自己去说明部分失败的情况 ——
     它比这里更清楚当时展示的是哪一次运行。 */
  const rollbackRun = async (ids) => {
    const result = await api("/api/local/operations/rollback", {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
    setHistory(await api("/api/local/operations"));
    return result;
  };

  const toggleIn = (setter) => (id) =>
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Page className="local">
      <p className="local__lead">
        改写在音频文件里的标签，或者按命名规则整理目录。动手之前都会先列清单。
        要补封面和歌词去「封面与歌词」—— 那些是从外面取回来的，不在这一页。
      </p>

      <StatGrid>
        <StatTile icon={FileAudio} value={fmt(stats.total || 0)} label="个音频文件" />
        <StatTile
          tone="warning"
          value={fmt(stats.bad_path || 0)}
          label="个目录不规范"
          detail={stats.bad_path ? "可以在「整理目录」里处理" : "都符合命名规则"}
        />
        <StatTile
          tone="warning"
          value={fmt((stats.missing_artist || 0) + (stats.missing_album || 0))}
          label="个缺歌手或专辑"
          detail={
            (stats.missing_artist || 0) + (stats.missing_album || 0)
              ? "可以在「补标签」里从路径推断"
              : "标签都是全的"
          }
        />
        <StatTile
          value={fmt(stats.plex_unmatched || 0)}
          label="个 Plex 未识别"
          detail="需同步对照"
        />
      </StatGrid>

      <div className="local__actions">
        <Button icon={RefreshCw} onClick={() => runJob("plex_sync")}>
          同步 Plex 对照
        </Button>
        <Button variant="primary" icon={FolderTree} onClick={() => runJob("local_scan")}>
          重新扫描音乐目录
        </Button>
      </div>

      <ChipGroup
        label="工作区"
        options={WORKSPACES}
        value={workspace}
        onChange={(id) => {
          setWorkspace(id);
          setError("");
        }}
      />

      {error && (
        <Notice tone="danger" icon={CircleAlert}>
          {error}
        </Notice>
      )}

      {queued && (
        <Notice tone="success" icon={ShieldCheck}>
          {queued}。
          <Button variant="quiet" onClick={() => navigate("tasks")}>
            去看执行进度
          </Button>
        </Notice>
      )}

      {/* ============ 浏览与筛选 ============ */}
      {workspace === "checkup" && (
        <LibraryCheckup
          navigate={navigate}
          onRescan={() => runJob("local_scan")}
          /* 体检里点"处理"就是切到浏览工作区并把筛选设好 ——
             跳到另一页再让用户自己选筛选条件，等于没帮上忙。 */
          onJumpToFilter={(filter) => {
            setMissing(filter);
            setPage(1);
            setWorkspace("browse");
          }}
        />
      )}

      {workspace === "browse" && (
        <Section>
          <SectionHeader
            title="浏览与筛选"
            note={
              selected.length
                ? `已勾选 ${selected.length} 个`
                : "勾选后可补标签或整理目录"
            }
            actions={
              selected.length ? (
                <ButtonGroup>
                  <Button size="sm" icon={Tags} onClick={() => setEditing(
                    data.items.filter((item) => selected.includes(item.id)),
                  )}>
                    一次改这 {selected.length} 个的标签
                  </Button>
                  <Button size="sm" onClick={() => setSelected([])}>
                    取消勾选
                  </Button>
                </ButtonGroup>
              ) : null
            }
          />

          <Field
            leading={Search}
            placeholder="搜索文件名、歌曲、歌手或专辑…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />

          <ChipGroup
            label="快捷筛选"
            options={MISSING_FILTERS.map((item) => ({
              id: item.id,
              label: `${item.label}${stats[item.statKey] ? ` ${fmt(stats[item.statKey])}` : ""}`,
            }))}
            value={missing}
            onChange={(id) => {
              setMissing(id);
              setPage(1);
            }}
          />

          {loading ? (
            <PageLoader />
          ) : data.items.length ? (
            <>
              <div className="local-files">
                <div className="local-files__head">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleAllOnPage}
                    aria-label="勾选这一页的全部文件"
                  />
                  <span>歌曲与路径</span>
                  <span>歌手 / 专辑</span>
                  <span>已有</span>
                  {/* 操作列不给表头文字，但格子必须在 ——
                      .visually-hidden 是 position:absolute，会脱离网格，
                      表头就比数据行少一格，整张表跟着错位。 */}
                  <span aria-hidden="true" />
                </div>
                {data.items.map((item) => (
                  <div className="local-files__row" key={item.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={() => toggleFile(item.id)}
                      aria-label={`勾选 ${item.title || item.filename}`}
                    />
                    <div className="local-files__title">
                      <strong>{item.title || item.filename}</strong>
                      <small title={item.path}>{shortPath(item.path)}</small>
                    </div>
                    <div className="local-files__meta">
                      <span data-empty={!item.artist || undefined}>
                        {item.artist || "未填歌手"}
                      </span>
                      <small data-empty={!item.album || undefined}>
                        {item.album || "未填专辑"}
                      </small>
                    </div>
                    <div className="local-files__flags">
                      {item.has_cover && <Badge tone="success">封面</Badge>}
                      {item.has_lrc && <Badge tone="success">歌词</Badge>}
                      {item.plex_matched && <Badge>Plex</Badge>}
                    </div>
                    <div className="local-files__row-actions">
                      <IconButton
                        icon={Play}
                        label={`播放 ${item.title || item.filename}`}
                        size="sm"
                        onClick={() => play(item)}
                      />
                      <IconButton
                        icon={Tags}
                        label={`编辑 ${item.title || item.filename} 的标签`}
                        size="sm"
                        onClick={() => setEditing(item)}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {data.total > pageSize && (
                <div className="local-pager">
                  <Button
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                  >
                    上一页
                  </Button>
                  <span>
                    第 {page} / {Math.ceil(data.total / pageSize)} 页 · 共{" "}
                    {fmt(data.total)} 个
                  </span>
                  <select
                    className="ui-select"
                    value={pageSize}
                    aria-label="每页显示数量"
                    onChange={(event) => {
                      setPageSize(Number(event.target.value));
                      setPage(1);
                    }}
                  >
                    <option value="30">每页 30 个</option>
                    <option value="50">每页 50 个</option>
                    <option value="100">每页 100 个</option>
                  </select>
                  <Button
                    size="sm"
                    disabled={page >= Math.ceil(data.total / pageSize)}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    下一页
                  </Button>
                </div>
              )}
            </>
          ) : (
            <EmptyState
              icon={FileAudio}
              title={search || missing ? "这个条件下没有文件" : "还没扫描到文件"}
              text={
                search || missing
                  ? "换个关键词，或把筛选切回「全部」"
                  : "点上方「重新扫描音乐目录」开始"
              }
              action={
                search || missing ? (
                  <Button
                    icon={X}
                    onClick={() => {
                      setSearch("");
                      setMissing("");
                      setPage(1);
                    }}
                  >
                    清掉筛选
                  </Button>
                ) : null
              }
            />
          )}
        </Section>
      )}

      {/* ============ 补标签 ============ */}
      {workspace === "tags" && (
        <Section>
          <SectionHeader
            title="补标签"
            note="按目录结构推断，只填空字段"
          />

          <div className="local__scope">
            <ChipGroup
              label="范围"
              options={TAG_SCOPES.map((item) => ({
                id: item.id,
                label:
                  item.id === "selected"
                    ? `已勾选的 ${selected.length} 个`
                    : `当前筛选结果 ${data.items.length} 个`,
              }))}
              value={tagScope}
              onChange={(id) => {
                setTagScope(id);
                setTagPlan(null);
              }}
            />
            <Button
              variant="primary"
              icon={Search}
              loading={busy === "tag-preview"}
              onClick={previewTags}
            >
              生成清单
            </Button>
          </div>

          {tagPlan && (
            <>
              <StatGrid>
                <StatTile
                  tone="success"
                  value={tagRows.length}
                  label="个文件有空字段可补"
                />
                <StatTile
                  value={tagPlan.total - tagRows.length}
                  label="个文件标签已经全了"
                  detail="不会被改动"
                />
                <StatTile
                  value={tagRows.reduce((sum, item) => sum + item.fields.length, 0)}
                  label="个字段会被写入"
                />
              </StatGrid>

              {tagRows.length ? (
                <ChangeList>
                    {/* 字段名紧贴各自的值。写成徽章一排、值一排的话，
                      三个字段时就要靠位置去对应，读起来是道谜题。 */}
                  {tagRows.map((item) => (
                    <ChangeRow
                      key={item.fileId}
                      target={shortPath(item.path)}
                      badges={[
                        { label: `补 ${item.fields.length} 个字段`, tone: "accent" },
                      ]}
                      /* 逐字段列出"原值 → 新值"。写标签会覆盖原文件，
                         挤成一行的话看不出每个字段原来是什么。 */
                      fields={item.fields.map((field) => ({
                        label: FIELD_LABELS[field.field] || field.field,
                        oldValue: field.oldValue,
                        newValue: field.newValue,
                      }))}
                      checked={!tagExcluded.has(item.fileId)}
                      onToggle={() => toggleIn(setTagExcluded)(item.fileId)}
                      toggleLabel={`给 ${shortPath(item.path)} 写入推断出的标签`}
                    />
                  ))}
                </ChangeList>
              ) : (
                <EmptyState
                  icon={ShieldCheck}
                  title="这些文件不需要补"
                  text="四个字段都已填写。要改已有值，用标签编辑器"
                />
              )}

              {/*
                目录名和标签对不上的那些。
                补全任务只填空字段，永远不会碰这些，所以在这之前用户
                根本不会知道两边不一致 —— 而这恰恰最该由人判断：
                可能标签错了，也可能目录名错了，程序猜不出来。
                所以只展示，不给勾选框，也不放进要写入的计数里。
              */}
              {tagConflicts.length > 0 && (
                <>
                  <SectionHeader
                    title="目录名和标签对不上"
                    note={`${tagConflicts.length} 个文件 · 不会自动改动`}
                  />
                  <Notice tone="warning" icon={CircleAlert}>
                    左边是文件里现在写的，右边是从目录名推断出来的。
                    补标签只填空字段，不会覆盖这些 —— 要改就点右边的「改标签」逐个来，
                    或者反过来去「整理目录」把目录名改成跟标签一致。
                  </Notice>
                  <ChangeList>
                    {tagConflicts.map((item) => (
                      <ChangeRow
                        key={`conflict-${item.fileId}`}
                        target={shortPath(item.path)}
                        badges={[{ label: "对不上", tone: "warning" }]}
                        fields={item.conflicts.map((field) => ({
                          label: FIELD_LABELS[field.field] || field.field,
                          oldValue: field.oldValue,
                          newValue: field.newValue,
                        }))}
                        meta={["不会自动改"]}
                      />
                    ))}
                  </ChangeList>
                </>
              )}

              {tagRows.length > 0 && (
                <ConfirmBar
                  summary={
                    tagApplying.length
                      ? `将给 ${tagApplying.length} 个文件写入 ${tagFieldCount} 个字段`
                      : "没有要写入的文件"
                  }
                  detail={
                    tagApplying.length
                      ? [
                          tagExcluded.size > 0 && `已勾掉 ${tagExcluded.size} 个`,
                          "只填空着的字段，已有的值一律不动",
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : undefined
                  }
                >
                  <ButtonGroup align="end">
                    <Button onClick={() => setTagPlan(null)}>重新选择</Button>
                    <Button
                      variant="primary"
                      icon={ShieldCheck}
                      loading={busy === "tag-apply"}
                      disabled={!tagApplying.length}
                      onClick={applyTags}
                    >
                      写入 {tagApplying.length} 个
                    </Button>
                  </ButtonGroup>
                </ConfirmBar>
              )}
            </>
          )}

          {!tagPlan && (
            <EmptyState
              icon={Tags}
              title="还没有生成清单"
              text="选好范围后生成清单"
            />
          )}
        </Section>
      )}

      {/* ============ 整理目录 ============ */}
      {workspace === "organize" && (
        <Section>
          <SectionHeader
            title="整理目录"
            note="按命名规则计算目标位置"
          />

          <div className="local__scope">
            <p className="local__scope-hint">
              {selected.length
                ? `已勾选 ${selected.length} 个文件`
                : "先在「浏览与筛选」里勾选文件"}
            </p>
            <Button
              variant="primary"
              icon={Search}
              loading={busy === "organize-preview"}
              disabled={!selected.length}
              onClick={previewOrganize}
            >
              算出新路径
            </Button>
          </div>

          {organizePlan && (
            <>
              <StatGrid>
                <StatTile
                  tone="success"
                  value={organizeMoving.length}
                  label="个文件会被移动"
                />
                <StatTile
                  value={organizeSettled}
                  label="个已经在正确位置"
                  detail="不会被动"
                />
                <StatTile
                  tone={organizeConflicts ? "danger" : "neutral"}
                  value={organizeConflicts}
                  label="个目标位置已被占用"
                  detail={
                    organizeConflicts
                      ? "已默认取消勾选，执行会失败"
                      : "没有冲突"
                  }
                />
              </StatGrid>

              {organizeSettled > 0 && (
                <ChipGroup
                  label="显示"
                  options={[
                    {
                      id: "todo",
                      label: `需要处理 ${organizeRows.length - organizeSettled}`,
                    },
                    { id: "all", label: `全部 ${organizeRows.length}` },
                  ]}
                  value={organizeView}
                  onChange={setOrganizeView}
                />
              )}

              <ChangeList>
                {organizeVisible.map((item) => {
                  const unchanged = item.sourcePath === item.targetPath;
                  return (
                    <ChangeRow
                      key={item.fileId}
                      target={item.targetFilename}
                      badges={
                        item.conflict
                          ? [{ label: "目标已存在", tone: "danger" }]
                          : unchanged
                            ? [{ label: "位置正确", tone: "success" }]
                            : []
                      }
                      oldValue={shortPath(item.sourcePath)}
                      newValue={shortPath(item.targetPath)}
                      skipped={unchanged}
                      skipReason="已经在规则算出的位置上，不需要移动"
                      checked={!organizeExcluded.has(item.fileId)}
                      onToggle={() => toggleIn(setOrganizeExcluded)(item.fileId)}
                      toggleLabel={`移动 ${item.targetFilename}`}
                    />
                  );
                })}
              </ChangeList>

              {organizeVisible.length === 0 && (
                <EmptyState
                  icon={ShieldCheck}
                  title="这批文件都在正确位置"
                  text="按当前命名规则，都在正确位置"
                />
              )}

              <ConfirmBar
                summary={
                  organizeMoving.length
                    ? `将移动 ${organizeMoving.length} 个文件`
                    : "没有要移动的文件"
                }
                detail={
                  organizeMoving.length
                    ? "同名的 .lrc 歌词会跟着走；原位置记录下来，之后能恢复"
                    : undefined
                }
              >
                <ButtonGroup align="end">
                  <Button onClick={() => setOrganizePlan(null)}>重新选择</Button>
                  <Button
                    variant="primary"
                    icon={FolderTree}
                    loading={busy === "organize-apply"}
                    disabled={!organizeMoving.length}
                    onClick={() => setConfirmOrganize(true)}
                  >
                    移动 {organizeMoving.length} 个
                  </Button>
                </ButtonGroup>
              </ConfirmBar>
            </>
          )}

          {!organizePlan && (
            <EmptyState
              icon={FolderTree}
              title="还没有算过路径"
              text="命名规则在「设置 → 文件命名」"
            />
          )}
        </Section>
      )}

      {/* ============ 改动历史 ============ */}
      {workspace === "history" && (
        <ChangeHistory
          data={history}
          onReload={rollbackRun}
          notify={notify}
          onError={setError}
        />
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
        description="写入音频文件 · 可在改动历史撤销"
        size="xl"
        dismissible={false}
      >
        {editing && (
          <TagEditor
            files={Array.isArray(editing) ? editing : [editing]}
            onClose={() => setEditing(null)}
            onSaved={(count) => {
              setEditing(null);
              notify(count > 1 ? `${count} 个文件的标签已写入` : "标签已写入");
              load();
            }}
          />
        )}
      </Modal>

      {/* 移动文件是会改变磁盘布局的操作，值得一次明确的确认。
          原来用的是 confirm()，说不清代价也没有样式。 */}
      <Modal
        open={confirmOrganize}
        onClose={() => setConfirmOrganize(false)}
        title={`移动 ${organizeMoving.length} 个文件？`}
        description="文件会按命名规则挪到新目录，同名歌词一起走"
        actions={
          <ButtonGroup align="end">
            <Button onClick={() => setConfirmOrganize(false)}>取消</Button>
            <Button variant="primary" icon={FolderTree} onClick={applyOrganize}>
              开始移动
            </Button>
          </ButtonGroup>
        }
      >
        <p>
          原位置会记进改动历史，之后可以逐条恢复。
          正在被播放器占用的文件可能移动失败，失败的那几个会留在原处。
        </p>
      </Modal>

    </Page>
  );
}
