/**
 * 封面与歌词。
 *
 * 重构前的问题（两条，都是结构性的）：
 *
 * 1. 归类重叠。这一页原先挂了五个"工具"：
 *      Plex 元数据补全 / 本地标签补全 / 封面与歌词 / 重命名与目录整理 / 任务记录
 *    其中"本地标签补全"写的是标题、歌手、专辑、年份、音轨号、风格 ——
 *    和主导航"文件与标签"里的标签编辑器是同一件事；
 *    "重命名与目录整理"调的是 /api/local/organize/preview + /apply ——
 *    和"文件与标签"的整理预览是同一个接口。
 *    "任务记录"更离谱：它是个假标签页，点了直接跳到主导航的"任务"页。
 *
 *    现在边界清楚了：
 *      文件与标签 = 作用于音频文件本身（标签、目录、重命名）
 *      封面与歌词 = 作用于配套资料（封面、歌词、歌手照片与简介）
 *
 * 2. 没有真正的界面。四个工具共用一组下拉框加一个"生成差异预览"按钮，
 *    而 mock 对预览接口只回 {ok:true}，所以开发时永远看不到内容 ——
 *    整页看起来就是"一个批量按钮"。
 *
 *    现在是三步的工作流：选范围 → 看清会改什么（逐条新旧对比、来源、
 *    置信度、冲突）→ 勾掉不想改的 → 应用。
 *    补齐资料是会覆盖文件和 Plex 数据的操作，必须让人看清再点。
 */

import {
  ArrowRight,
  CircleAlert,
  Image as ImageIcon,
  LoaderCircle,
  ScrollText,
  Search,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button, ButtonGroup } from "../../components/ui/Button";
import { Cover } from "../../components/ui/Cover";
import { Field, Notice } from "../../components/ui/Field";
import {
  EmptyState,
  Page,
  Section,
  SectionHeader,
} from "../../components/ui/Layout";
import { StatGrid, StatTile } from "../../components/ui/StatTile";
import { api } from "../../lib/api";

/**
 * 两类补齐任务。区别不是"用哪个模块"，而是**改到哪里去** ——
 * 一个写进 Plex 的资料库，一个写成音乐目录里的文件。
 * 用户需要先明白这个区别，才知道该选哪个。
 */
const JOBS = [
  {
    id: "plex",
    kind: "scrape_plex_metadata",
    icon: UsersRound,
    title: "歌手资料与专辑封面",
    where: "写入 Plex 资料库",
    desc: "歌手海报、背景图、中文简介，以及 Plex 里缺封面的专辑。改完会触发一次 Plex 扫描。",
  },
  {
    id: "assets",
    kind: "fill_assets",
    icon: ScrollText,
    title: "封面与歌词文件",
    where: "写入音乐目录",
    desc: "在音频文件旁边补 cover.jpg、写入内嵌封面、生成同名 .lrc 歌词（UTF-8）。",
  },
];

/** 范围。缩小范围是为了让预览条目少到能真的看完。 */
const SCOPES = [
  { id: "missing", label: "只补缺失的" },
  { id: "all", label: "全部" },
  { id: "specific_artist", label: "指定歌手", needsValue: "输入歌手名" },
  { id: "specific_album", label: "指定专辑", needsValue: "输入专辑名" },
  { id: "folder", label: "指定目录", needsValue: "/music/歌手/专辑" },
];

/** 遇到已有内容时怎么办。 */
const MODES = [
  { id: "missing", label: "只补空的", note: "已有内容一律不动" },
  { id: "incremental", label: "补空 + 补更好的", note: "只在候选明显更好时替换" },
  { id: "refresh", label: "全部重取", note: "已有内容也会被替换" },
];

/** 预览条目的筛选视图。 */
const VIEWS = [
  { id: "all", label: "全部" },
  { id: "create", label: "新增" },
  { id: "replace", label: "替换" },
  { id: "conflict", label: "有冲突" },
];

/** newValue 是图片地址还是文字？图片要显示缩略图，文字显示片段。 */
const isImageValue = (value) =>
  typeof value === "string" && /^(https?:|\/)/.test(value) && !value.includes(" ");

export function ScrapeCenter({ navigate }) {
  const [jobId, setJobId] = useState("plex");
  const [scope, setScope] = useState("missing");
  const [scopeValue, setScopeValue] = useState("");
  const [mode, setMode] = useState("missing");

  const [plan, setPlan] = useState(null);
  const [excluded, setExcluded] = useState(() => new Set());
  const [view, setView] = useState("all");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const job = JOBS.find((item) => item.id === jobId) || JOBS[0];
  const activeScope = SCOPES.find((item) => item.id === scope) || SCOPES[0];

  const resetPlan = () => {
    setPlan(null);
    setExcluded(new Set());
    setView("all");
  };

  const generate = async () => {
    if (activeScope.needsValue && !scopeValue.trim()) {
      setError(`请先填写${activeScope.label}`);
      return;
    }
    setBusy("preview");
    setError("");
    try {
      const result = await api("/api/scrape/preview", {
        method: "POST",
        body: JSON.stringify({
          kind: job.kind,
          scope,
          scopeValue: scopeValue.trim(),
          mode,
          limit: 150,
        }),
      });
      setPlan(result);
      setExcluded(new Set());
      setView("all");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const items = plan?.items || [];

  /** 会真正被写入的条目：动作不是 skip，且没被勾掉。 */
  const applying = useMemo(
    () => items.filter((item) => item.action !== "skip" && !excluded.has(item.id)),
    [items, excluded],
  );

  const visible = useMemo(() => {
    if (view === "conflict") return items.filter((item) => item.conflict);
    if (view === "all") return items;
    return items.filter((item) => item.action === view);
  }, [items, view]);

  const toggle = (id) =>
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = async () => {
    if (!plan || !applying.length) return;
    setBusy("apply");
    setError("");
    try {
      await api("/api/scrape/apply", {
        method: "POST",
        body: JSON.stringify({
          planId: plan.id,
          excludeIds: [...excluded],
        }),
      });
      navigate?.("tasks");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  return (
    <Page className="scrape">
      <p className="scrape__lead">
        找出缺封面、缺歌词、缺歌手照片和简介的条目，把它们补上。
        每一条都会先给你看现在是什么、要换成什么，你确认了才写入。
      </p>

      {/* --- 第一步：补什么，改到哪里 --- */}
      <Section>
        <SectionHeader title="补什么" note="两者写入的位置不同，先选清楚" />
        <div className="scrape__jobs">
          {JOBS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={jobId === item.id}
              className={`scrape__job${jobId === item.id ? " scrape__job--on" : ""}`}
              onClick={() => {
                setJobId(item.id);
                resetPlan();
              }}
            >
              <span className="scrape__job-icon">
                <item.icon />
              </span>
              <span className="scrape__job-text">
                <span className="scrape__job-head">
                  <strong>{item.title}</strong>
                  <Badge tone={jobId === item.id ? "accent" : "neutral"}>
                    {item.where}
                  </Badge>
                </span>
                <small>{item.desc}</small>
              </span>
            </button>
          ))}
        </div>
      </Section>

      {/* --- 第二步：范围与覆盖策略 --- */}
      <Section>
        <SectionHeader
          title="改哪些"
          note="范围越小，下一步的清单越能真的看完"
        />
        <div className="scrape__scope">
          <div className="scrape__chips" role="group" aria-label="范围">
            {SCOPES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={scope === item.id}
                className={`scrape__chip${scope === item.id ? " scrape__chip--on" : ""}`}
                onClick={() => {
                  setScope(item.id);
                  setScopeValue("");
                  resetPlan();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          {activeScope.needsValue && (
            <Field
              label={activeScope.label}
              leading={Search}
              placeholder={activeScope.needsValue}
              value={scopeValue}
              onChange={(event) => {
                setScopeValue(event.target.value);
                resetPlan();
              }}
            />
          )}

          <div className="scrape__modes" role="group" aria-label="遇到已有内容时">
            {MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={mode === item.id}
                className={`scrape__mode${mode === item.id ? " scrape__mode--on" : ""}`}
                onClick={() => {
                  setMode(item.id);
                  resetPlan();
                }}
              >
                <strong>{item.label}</strong>
                <small>{item.note}</small>
              </button>
            ))}
          </div>

          <Button
            variant="primary"
            icon={busy === "preview" ? undefined : Search}
            loading={busy === "preview"}
            onClick={generate}
          >
            看看会改什么
          </Button>
        </div>
      </Section>

      {error && (
        <Notice tone="danger" icon={CircleAlert}>
          {error}
        </Notice>
      )}

      {/* --- 第三步：逐条核对 --- */}
      {plan && (
        <Section>
          <SectionHeader
            title="会改这些"
            note={`生成于 ${new Date(plan.createdAt).toLocaleString("zh-CN")} · 还没有执行`}
          />

          <StatGrid>
            <StatTile tone="success" value={plan.summary.create} label="项要新增" />
            <StatTile tone="warning" value={plan.summary.replace} label="项会被替换" />
            <StatTile value={plan.summary.skip} label="项自动跳过" />
            <StatTile
              tone={plan.summary.conflicts ? "danger" : "neutral"}
              value={plan.summary.conflicts}
              label="项有冲突"
              detail={plan.summary.conflicts ? "建议逐条看过再应用" : "没有冲突"}
            />
          </StatGrid>

          <div className="scrape__views" role="group" aria-label="筛选">
            {VIEWS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={view === item.id}
                className={`scrape__chip${view === item.id ? " scrape__chip--on" : ""}`}
                onClick={() => setView(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {visible.length ? (
            <ul className="scrape__list">
              {visible.map((item) => {
                const skipped = item.action === "skip";
                const off = excluded.has(item.id);
                return (
                  <li
                    key={item.id}
                    className={`scrape__row${off || skipped ? " scrape__row--off" : ""}`}
                  >
                    {/* 跳过的条目不给勾选框 —— 它本来就不会被写入，
                        给个能勾的框只会让人以为可以强制执行。 */}
                    {skipped ? (
                      <span className="scrape__row-skip" aria-hidden="true" />
                    ) : (
                      <input
                        type="checkbox"
                        checked={!off}
                        onChange={() => toggle(item.id)}
                        aria-label={`应用「${item.target}」的${item.field}`}
                      />
                    )}

                    <span className="scrape__row-main">
                      <span className="scrape__row-head">
                        <strong>{item.target}</strong>
                        <Badge>{item.field}</Badge>
                        {item.conflict && <Badge tone="danger">冲突</Badge>}
                        {skipped && <Badge tone="warning">已跳过</Badge>}
                      </span>

                      {skipped ? (
                        <small className="scrape__row-note">{item.skipReason}</small>
                      ) : (
                        <span className="scrape__diff">
                          <span className="scrape__diff-old">{item.oldValue}</span>
                          <ArrowRight aria-hidden="true" />
                          {isImageValue(item.newValue) ? (
                            <Cover
                              src={item.newValue}
                              title={item.target}
                              size="40px"
                              shape="square"
                            />
                          ) : (
                            <span className="scrape__diff-new">{item.newValue}</span>
                          )}
                        </span>
                      )}
                    </span>

                    <span className="scrape__row-meta">
                      <small>{item.candidateSource}</small>
                      <small>匹配度 {Math.round(item.confidence * 100)}%</small>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={ImageIcon}
              title="这个筛选下没有条目"
              text="换一个筛选看看，或者把范围放宽再生成一次。"
            />
          )}

          {/* --- 确认条 --- */}
          <div className="scrape__confirm">
            <div className="scrape__confirm-text">
              {applying.length ? (
                <>
                  <strong>将写入 {applying.length} 项</strong>
                  <span>
                    {excluded.size > 0 && `已勾掉 ${excluded.size} 项，`}
                    {plan.summary.skip > 0 && `${plan.summary.skip} 项自动跳过，`}
                    执行记录和回滚数据会留在任务里
                  </span>
                </>
              ) : (
                <span>没有要写入的条目</span>
              )}
            </div>
            <ButtonGroup align="end">
              <Button onClick={resetPlan}>重新选择</Button>
              <Button
                variant="primary"
                icon={busy === "apply" ? undefined : ShieldCheck}
                loading={busy === "apply"}
                disabled={!applying.length}
                onClick={apply}
              >
                应用这 {applying.length} 项
              </Button>
            </ButtonGroup>
          </div>
        </Section>
      )}

      {!plan && !busy && (
        <EmptyState
          icon={LoaderCircle}
          title="还没有生成清单"
          text="选好上面的范围，点「看看会改什么」。生成清单不会修改任何东西。"
        />
      )}
    </Page>
  );
}
