import { Album, BookOpenText, Check, ChevronRight, CircleAlert, FolderTree, Gauge, LoaderCircle, ScrollText, ShieldCheck, Tags, UsersRound, Zap } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api";

const scrapeTabs = [
  {
    id: "plex",
    kind: "scrape_plex_metadata",
    icon: UsersRound,
    tone: "amber",
    title: "Plex 元数据补全",
    desc: "补齐歌手海报、背景、中文简介与专辑封面，并触发 Plex 扫描。",
    chips: ["歌手海报", "歌手背景", "中文简介", "专辑封面"],
  },
  {
    id: "tags",
    kind: "fill_local_tags",
    icon: Tags,
    tone: "blue",
    title: "本地标签补全",
    desc: "扫描标题、歌手、专辑、年份、音轨号与流派，为后续整理提供依据。",
    chips: ["标题", "歌手", "专辑", "年份", "音轨号", "流派"],
  },
  {
    id: "assets",
    kind: "fill_assets",
    icon: BookOpenText,
    tone: "violet",
    title: "封面与歌词",
    desc: "补齐 cover.jpg、内嵌封面、同名 .lrc 与 UTF-8 歌词文件。",
    chips: ["cover.jpg", "内嵌封面", "同名 LRC", "UTF-8"],
  },
  {
    id: "rename",
    kind: "local_organize",
    icon: FolderTree,
    tone: "green",
    title: "重命名与目录整理",
    desc: "按 Plex 规则生成目标路径，先预览冲突，再批量移动目录。",
    chips: ["路径预览", "冲突检测", "Unknown 修复", "回滚"],
  },
  {
    id: "tasks",
    kind: "tasks",
    icon: ScrollText,
    tone: "pink",
    title: "任务记录",
    desc: "查看刮削、扫描、整理的进度、计数、错误和日志。",
    chips: ["进度", "成功/失败/跳过", "错误日志", "取消/重试"],
  },
];

export function ScrapeCenter({ jobs, navigate, settings }) {
  const activeKinds = new Set(
    jobs
      .filter((j) => ["queued", "running"].includes(j.status))
      .map((j) => j.kind),
  );
  const [tab, setTab] = useState("plex"),
    [mode, setMode] = useState(settings?.scrapeRules?.defaultMode || "missing"),
    [scope, setScope] = useState("missing"),
    [scopeValue, setScopeValue] = useState("");
  const [plan, setPlan] = useState(null),
    [planPage, setPlanPage] = useState(1),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const action = scrapeTabs.find((item) => item.id === tab) || scrapeTabs[0];
  const generatePlan = async () => {
    setBusy("preview");
    setError("");
    try {
      setPlan(
        await api("/api/scrape/preview", {
          method: "POST",
          body: JSON.stringify({ kind: action.kind, scope, scopeValue, mode, limit: 150 }),
        }),
      );
      setPlanPage(1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };
  const planPageSize = 50;
  const planItems = plan?.items || [];
  const planPages = Math.max(1, Math.ceil(planItems.length / planPageSize));
  const visiblePlanItems = planItems.slice(
    (planPage - 1) * planPageSize,
    planPage * planPageSize,
  );
  const applyPlan = async () => {
    if (!plan) {
      generatePlan();
      return;
    }
    if (
      !confirm(
        `确认应用“${action.title}”？\n\n范围：${scope}\n模式：${mode}\n执行后会进入任务中心，可在日志/回滚记录中追踪。`,
      )
    )
      return;
    setBusy("apply");
    setError("");
    try {
      await api("/api/scrape/apply", {
        method: "POST",
        body: JSON.stringify({ planId: plan.id }),
      });
      navigate?.("tasks");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="page scrape-page">
      <section className="page-intro">
        <p>找出缺封面、缺歌词、缺歌手照片和简介的条目，把它们补上。每一处都会先给你看现在是什么、要换成什么，你确认了才写入。</p>
      </section>
      <div className="scrape-tabs">
        {scrapeTabs.map((item) => (
          <button
            className={tab === item.id ? "active" : ""}
            onClick={() => {
              if (item.id === "tasks") {
                navigate?.("tasks");
                return;
              }
              setTab(item.id);
              setPlan(null);
              setPlanPage(1);
            }}
            key={item.id}
          >
            <item.icon />
            {item.title}
          </button>
        ))}
      </div>
      <section className="panel scrape-workbench">
        <div className="scrape-main">
          <div className={`action-icon ${action.tone}`}>
            <action.icon />
          </div>
          <div>
            <h3>{action.title}</h3>
            <p>{action.desc}</p>
            <div className="chips">
              {action.chips.map((chip) => (
                <span key={chip}>{chip}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="scrape-options">
          <label>
            范围
            <select
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
                setPlan(null);
                setPlanPage(1);
              }}
            >
              <option value="all">全部</option>
              <option value="missing">缺失项</option>
              <option value="specific_artist">指定歌手</option>
              <option value="specific_album">指定专辑</option>
              <option value="folder">指定文件夹</option>
              <option value="missing_cover">仅缺失封面</option>
              <option value="missing_lyrics">仅缺失歌词</option>
              <option value="missing_background">仅缺失背景图</option>
              <option value="missing_bio">仅缺失中文简介</option>
              <option value="unknown">Unknown Artist / Album</option>
            </select>
          </label>
          {["specific_artist", "specific_album", "folder"].includes(scope) && (
            <label>
              {scope === "folder" ? "目录" : "名称"}
              <input
                value={scopeValue}
                onChange={(e) => {
                  setScopeValue(e.target.value);
                  setPlan(null);
                }}
                placeholder={scope === "folder" ? "/music/歌手/专辑" : "输入准确名称"}
              />
            </label>
          )}
          <label>
            模式
            <select
              value={mode}
              onChange={(e) => {
                setMode(e.target.value);
                setPlan(null);
                setPlanPage(1);
              }}
            >
              <option value="missing">只补缺失</option>
              <option value="incremental">增量更新</option>
              <option value="refresh">全量刷新</option>
              <option value="force">强制覆盖</option>
            </select>
          </label>
        </div>
        {error && (
          <div className="inline-error">
            <CircleAlert />
            {error}
          </div>
        )}
        <div className="preview-list scrape-preview">
          {plan ? (
            <>
              <div>
                <div>
                  <small>预览生成时间</small>
                  <code>
                    {new Date(plan.createdAt).toLocaleString("zh-CN")}
                  </code>
                </div>
                <ChevronRight />
                <div>
                  <small>策略</small>
                  <code>
                    {plan.scope} · {plan.mode}
                  </code>
                </div>
                <i className="safe">未执行</i>
              </div>
              <div className="scrape-summary">
                <span>新增 {plan.summary.create}</span>
                <span>替换 {plan.summary.replace}</span>
                <span>跳过 {plan.summary.skip}</span>
                <span>冲突 {plan.summary.conflicts}</span>
              </div>
              <div className="scrape-diff-head">
                <span>对象 / 字段</span>
                <span>旧值</span>
                <span>候选新值</span>
                <span>来源 / 置信度</span>
                <span>结果</span>
              </div>
              {visiblePlanItems.map((item) => (
                <div className="scrape-diff-row" key={item.id}>
                  <div>
                    <strong>{item.target}</strong>
                    <small>{item.field}</small>
                  </div>
                  <code>{item.oldValue}</code>
                  <code>{item.newValue}</code>
                  <div>
                    <strong>{item.candidateSource}</strong>
                    <small>{Math.round(item.confidence * 100)}% 置信度</small>
                  </div>
                  <i
                    className={
                      item.conflict || item.action === "skip"
                        ? "danger"
                        : "safe"
                    }
                  >
                    {item.skipReason ||
                      (item.conflict
                        ? "存在冲突"
                        : item.action === "replace"
                          ? "将替换"
                          : "将新增")}
                  </i>
                </div>
              ))}
              {planItems.length > planPageSize && (
                <div className="pagination scrape-pagination">
                  <button
                    className="secondary small"
                    disabled={planPage <= 1}
                    onClick={() => setPlanPage((value) => value - 1)}
                  >
                    上一页
                  </button>
                  <span>
                    第 {planPage} / {planPages} 页 · 共 {planItems.length} 项
                  </span>
                  <button
                    className="secondary small"
                    disabled={planPage >= planPages}
                    onClick={() => setPlanPage((value) => value + 1)}
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          ) : (
            <div>
              <div>
                <small>预览状态</small>
                <code>尚未生成</code>
              </div>
              <ChevronRight />
              <div>
                <small>下一步</small>
                <code>先点击生成差异预览</code>
              </div>
              <i>不会执行</i>
            </div>
          )}
        </div>
        <div className="scrape-actions">
          <button
            className="secondary"
            disabled={activeKinds.has(action.kind) || !!busy}
            onClick={generatePlan}
          >
            {busy === "preview" ? <LoaderCircle className="spin" /> : <Gauge />}
            生成差异预览
          </button>
          <button
            className="primary"
            disabled={
              activeKinds.has(action.kind) ||
              !plan ||
              !!busy ||
              plan.summary.create + plan.summary.replace === 0
            }
            onClick={applyPlan}
          >
            {activeKinds.has(action.kind) || busy === "apply" ? (
              <LoaderCircle className="spin" />
            ) : (
              <Check />
            )}
            应用修改
          </button>
        </div>
      </section>
      <section className="safe-note">
        <ShieldCheck />
        <div>
          <strong>安全写入策略</strong>
          <p>无法精确匹配的条目会自动跳过；完成后可在任务中心查看结果。</p>
        </div>
      </section>
    </div>
  );
}
