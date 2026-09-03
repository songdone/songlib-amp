/**
 * 音乐源。
 *
 * 重构掉的：
 * - "导入后"那个四步有序列表。那是文档，不是界面 ——
 *   用户看的时候已经在这一页了，四步里有三步是系统自动做的。
 *   压成区块标题旁边一句话。
 * - 每张源卡片一个六项的 <dl>（检测格式 / 使用权限 / 运行验证 /
 *   支持平台 / 支持音质 / 最近测试）。六行键值对是接口文档的排版。
 *   卡片上只留"可用性、支持范围与上次测试时间"，
 *   剩下的挪进"检查格式"弹窗 —— 想看细节的人本来就会点它。
 * - confirm() 删源、两个自绘的 modal-wrap 弹窗，都换成 Modal。
 * - 图标按钮只有 title 没有 aria-label。
 * - 时长在这里手算 mm:ss，改用 lib/format 的 formatTime。
 */

import {
  CircleAlert,
  Code2,
  FileUp,
  Gauge,
  Link2,
  Music2,
  Plus,
  Power,
  ScrollText,
  Search,
  ShieldCheck,
  TestTube2,
  Trash2,
  Wifi,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button, ButtonGroup, IconButton } from "../../components/ui/Button";
import { Cover } from "../../components/ui/Cover";
import { Field, Notice } from "../../components/ui/Field";
import {
  EmptyState,
  ListGroup,
  ListRow,
  Page,
  Section,
  SectionHeader,
} from "../../components/ui/Layout";
import { Modal } from "../../components/ui/Modal";
import { ChipGroup } from "../../components/ui/Plan";
import { api } from "../../lib/api";
import { formatTime, timeAgo } from "../../lib/format";
import { platformLabel, sourceTypeLabel } from "../../lib/sources";

/** 源状态 → 中文名 + 徽章色。数据库存的是英文枚举。 */
const SOURCE_STATES = {
  unverified: ["还没验证", "neutral"],
  imported: ["已导入", "warning"],
  search_ok: ["搜索可用", "info"],
  inspect_ok: ["可以用", "success"],
  partial: ["可以用", "success"],
  degraded: ["能用但不稳", "warning"],
  resolve_ok: ["解析可用", "success"],
  unavailable: ["用不了", "danger"],
  disabled: ["已停用", "neutral"],
};

const IMPORT_MODES = [
  { id: "url", label: "在线 URL", icon: Link2 },
  { id: "file", label: "本地文件", icon: FileUp },
  { id: "code", label: "粘贴源码", icon: Code2 },
];

const QUALITIES = [
  { id: "128k", label: "128K" },
  { id: "320k", label: "320K" },
  { id: "flac", label: "FLAC" },
  { id: "flac24bit", label: "Hi-Res" },
];

export function SourceManager({ sources, refreshSources, notify }) {
  const [mode, setMode] = useState("url"),
    [name, setName] = useState(""),
    [url, setUrl] = useState(""),
    [code, setCode] = useState(""),
    [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    // 给个默认值，"试搜一首"点开就能用，不必先去想搜什么。
    [keyword, setKeyword] = useState("海阔天空"),
    [quality, setQuality] = useState("320k");
  const [removing, setRemoving] = useState(null);
  const [testing, setTesting] = useState(""),
    [testData, setTestData] = useState(null),
    [logs, setLogs] = useState(null),
    [inspection, setInspection] = useState(null);
  const importSource = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      let result;
      if (mode === "file") {
        if (!file) throw new Error("请选择本地 .js 音源文件");
        const body = new FormData();
        body.append("name", name);
        body.append("file", file);
        result = await api("/api/sources/import-file", {
          method: "POST",
          body,
        });
      } else if (mode === "code")
        result = await api("/api/sources/import-code", {
          method: "POST",
          body: JSON.stringify({ name, code }),
        });
      else
        result = await api("/api/sources/import-url", {
          method: "POST",
          body: JSON.stringify({ name, url }),
        });
      await refreshSources();
      setName("");
      setUrl("");
      setCode("");
      setFile(null);
      if (!result.ok) setError(`导入完成但校验失败：${result.message}`);
      else notify(result.message);
    } catch (err) {
      setError(`导入失败：${err.message}`);
    } finally {
      setBusy(false);
    }
  };
  const testSearch = async (source) => {
    const probe = keyword.trim();
    if (!probe) {
      setError(
        "先在「测试关键词」里填一首歌",
      );
      return;
    }
    setTesting(source.id);
    setError("");
    try {
      const platform = source.supportedPlatforms?.includes("tx")
        ? "tx"
        : source.supportedPlatforms?.[0];
      const result = await api(`/api/sources/${source.id}/test-search`, {
        method: "POST",
        body: JSON.stringify({ keyword: probe, platform }),
      });
      setTestData({ source, result });
      await refreshSources();
      notify(`“${source.displayName}”测试搜索成功`);
    } catch (err) {
      setError(`测试搜索失败：${err.message}`);
      await refreshSources();
    } finally {
      setTesting("");
    }
  };
  const inspect = async (source) => {
    setTesting(`inspect-${source.id}`);
    setError("");
    try {
      const result = await api(`/api/sources/${source.id}/inspect`, {
        method: "POST",
      });
      setInspection({ source, result });
      await refreshSources();
    } catch (err) {
      setError(`格式检查失败：${err.message}`);
    } finally {
      setTesting("");
    }
  };
  const testResolve = async (track) => {
    setTesting(`resolve-${track.trackId}`);
    setError("");
    try {
      const result = await api(
        `/api/sources/${testData.source.id}/test-resolve`,
        { method: "POST", body: JSON.stringify({ track, quality }) },
      );
      notify(result.message);
      await refreshSources();
    } catch (err) {
      setError(`解析失败：${err.message}`);
      await refreshSources();
    } finally {
      setTesting("");
    }
  };
  const toggle = async (source) => {
    try {
      await api(
        `/api/sources/${source.id}/${source.enabled ? "disable" : "enable"}`,
        { method: "POST" },
      );
      await refreshSources();
    } catch (err) {
      setError(err.message);
    }
  };
  const remove = async () => {
    const source = removing;
    setRemoving(null);
    if (!source) return;
    try {
      await api(`/api/sources/${source.id}`, { method: "DELETE" });
      if (logs?.source.id === source.id) setLogs(null);
      await refreshSources();
    } catch (err) {
      setError(err.message);
    }
  };
  const showLogs = async (source) => {
    try {
      setLogs({ source, items: await api(`/api/sources/${source.id}/logs`) });
    } catch (err) {
      setError(err.message);
    }
  };
  const state = (source) =>
    SOURCE_STATES[source.status] || [source.status, "neutral"];

  return (
    <Page className="sources">
      <div className="sources__top">
        {/* --- 导入 --- */}
        <Section>
          <SectionHeader
            title="导入音乐源"
            note="检查通过后自动启用"
          />
          <form className="sources__import" onSubmit={importSource}>
            <ChipGroup
              label="导入来源"
              options={IMPORT_MODES}
              value={mode}
              onChange={(id) => {
                setMode(id);
                setError("");
              }}
            />

            <Field
              label="名称"
              hint="留空则用脚本声明的名称"
              placeholder="例如：我的无损源"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />

            {mode === "url" && (
              <Field
                label="脚本地址"
                required
                type="url"
                leading={Link2}
                placeholder="https://…/latest.js"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            )}

            {mode === "file" && (
              <label className="sources__file">
                <input
                  type="file"
                  accept=".js,application/javascript,text/javascript"
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                />
                <FileUp aria-hidden="true" />
                <strong>{file?.name || "选一个 .js 文件"}</strong>
                <small>从这台电脑选，最大 2 MB</small>
              </label>
            )}

            {mode === "code" && (
              <label className="sources__code">
                <span>脚本源码</span>
                <textarea
                  required
                  rows={8}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="把完整的源码粘进来…"
                />
              </label>
            )}

            <Notice tone="info" icon={ShieldCheck}>
              音屿不自带任何音乐源。只导入你信得过、也有权使用的脚本 ——
              它不会绕过任何版权保护。
            </Notice>

            <Button type="submit" variant="primary" icon={Plus} loading={busy}>
              导入并启用
            </Button>
          </form>
        </Section>
      </div>

      {error && (
        <Notice tone="danger" icon={CircleAlert}>
          {error}
        </Notice>
      )}

      {/* --- 已装的源 --- */}
      <Section reveal>
        <SectionHeader
          title="已导入"
          note={sources.length ? `共 ${sources.length} 个` : undefined}
        />

        {/*
          这个输入框之前**根本不存在**。
          keyword 有 state、testSearch 里也读它，但全项目没有一处
          调用 setKeyword —— 于是"试搜一首"点下去只会弹
          "先填测试关键词"，而页面上没有任何地方能填。
          一个永远不可能成功的按钮。

          放在列表上方而不是每张卡片里：搜的是同一个词，
          每个源各来一个输入框只会让人以为它们互不相干。
          默认给一首歌名，点开就能用。
        */}
        {sources.length > 0 && (
          <Field
            label="测试关键词"
            hint="换成常搜的歌，结果更有参考价值"
            leading={Search}
            value={keyword}
            placeholder="例如：海阔天空"
            onChange={(event) => setKeyword(event.target.value)}
            className="sources__probe"
          />
        )}

        {sources.length ? (
          <div className="sources__list">
            {sources.map((source) => {
              const [label, tone] = state(source);
              return (
                <article className="sources__card" key={source.id}>
                  <div className="sources__card-head">
                    <span className="sources__logo">
                      <Music2 />
                    </span>
                    <div className="sources__card-text">
                      <strong>{source.displayName}</strong>
                      <small>
                        {[
                          source.metadata?.author || "自定义来源",
                          sourceTypeLabel(source.sourceType),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </div>
                    <Badge tone={tone}>{label}</Badge>
                  </div>

                  {/* 卡片上只留三件事：支持哪些平台、哪些音质、上次测的时候。
                      更细的接口能力在"检查格式"里看。 */}
                  <p className="sources__facts">
                    {source.supportedPlatforms?.length
                      ? source.supportedPlatforms.map(platformLabel).join(" · ")
                      : "支持的平台还没测出来"}
                    {source.supportedQualities?.length
                      ? ` · 最高 ${source.supportedQualities.at(-1)}`
                      : ""}
                    {source.lastTestAt
                      ? ` · ${timeAgo(source.lastTestAt)}测过`
                      : " · 还没测过"}
                  </p>

                  {source.lastErrorMessage && (
                    <Notice tone="danger" icon={CircleAlert}>
                      {source.lastErrorMessage}
                    </Notice>
                  )}

                  <div className="sources__card-actions">
                    <Button
                      size="sm"
                      icon={Gauge}
                      loading={testing === `inspect-${source.id}`}
                      onClick={() => inspect(source)}
                    >
                      检查格式
                    </Button>
                    <Button
                      size="sm"
                      icon={Search}
                      loading={testing === source.id}
                      onClick={() => testSearch(source)}
                    >
                      试搜一首
                    </Button>
                    <IconButton
                      icon={ScrollText}
                      size="sm"
                      label={`查看 ${source.displayName} 的日志`}
                      onClick={() => showLogs(source)}
                    />
                    <IconButton
                      icon={Power}
                      size="sm"
                      variant={source.enabled ? "primary" : "ghost"}
                      label={
                        source.enabled
                          ? `停用 ${source.displayName}`
                          : `启用 ${source.displayName}`
                      }
                      onClick={() => toggle(source)}
                    />
                    <IconButton
                      icon={Trash2}
                      size="sm"
                      variant="danger"
                      label={`删除 ${source.displayName}`}
                      onClick={() => setRemoving(source)}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={Wifi}
            title="还没有音乐源"
            text="填入地址、选择本地文件，或直接粘贴源码"
          />
        )}
      </Section>

      {/* --- 试搜结果 --- */}
      {testData && (
        <Section reveal>
          <SectionHeader
            title={`「${testData.source.displayName}」的搜索结果`}
            note={`${testData.result.count} 首候选 · 选一首验证播放地址`}
            actions={
              <select
                className="ui-select"
                aria-label="测试用的音质"
                value={quality}
                onChange={(event) => setQuality(event.target.value)}
              >
                {QUALITIES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            }
          />
          <ListGroup>
            {testData.result.results.map((item) => (
              <ListRow
                key={`${item.platform}-${item.trackId}`}
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
                  <span className="sources__result-actions">
                    <small>{formatTime(item.duration)}</small>
                    {item.qualities.slice(-2).map((q) => (
                      <Badge key={q}>{q}</Badge>
                    ))}
                    <Button
                      size="sm"
                      icon={TestTube2}
                      loading={testing === `resolve-${item.trackId}`}
                      onClick={() => testResolve(item)}
                    >
                      试解析
                    </Button>
                  </span>
                }
              />
            ))}
          </ListGroup>
        </Section>
      )}

      {/* --- 日志 --- */}
      <Modal
        open={Boolean(logs)}
        onClose={() => setLogs(null)}
        title={logs ? `${logs.source.displayName} 的记录` : "记录"}
        description="导入与测试记录"
        size="lg"
      >
        {logs?.items?.length ? (
          <div className="task-logs">
            {logs.items.map((item) => (
              <div className={`task-logs__line ${item.level}`} key={item.id}>
                <time>{new Date(item.created_at).toLocaleString("zh-CN")}</time>
                <p>
                  <b>{item.action}</b> {item.message}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={ScrollText}
            title="还没有记录"
            text="导入与测试的结果会记在这里"
          />
        )}
      </Modal>

      {/* --- 格式检查 --- */}
      <Modal
        open={Boolean(inspection)}
        onClose={() => setInspection(null)}
        title={inspection ? `${inspection.source.displayName} 支持到什么程度` : ""}
        size="lg"
      >
        {inspection && (
          <>
            <Notice
              tone={inspection.result.ok ? "success" : "danger"}
              icon={inspection.result.ok ? ShieldCheck : CircleAlert}
              title={`${inspection.result.detected_format} · ${inspection.result.compatibility}`}
            >
              {inspection.result.message}
            </Notice>
            <dl className="task-meta">
              <div>
                <dt>搜索</dt>
                <dd>
                  {inspection.result.methods?.search
                    ? "这个源自己实现了"
                    : "用音屿的目录适配器"}
                </dd>
              </div>
              <div>
                <dt>地址解析</dt>
                <dd>{inspection.result.methods?.resolve ? "支持" : "没有"}</dd>
              </div>
              <div>
                <dt>歌词 / 封面</dt>
                <dd>
                  {inspection.result.methods?.lyric ? "支持" : "没有"} ·{" "}
                  {inspection.result.methods?.cover ? "支持" : "没有"}
                </dd>
              </div>
              <div>
                <dt>支持平台</dt>
                <dd>
                  {inspection.result.supported_platforms
                    ?.map(platformLabel)
                    .join(" · ") || "没测出来"}
                </dd>
              </div>
              <div>
                <dt>顶层接口</dt>
                <dd>{inspection.result.top_level_keys?.join(" · ") || "没有"}</dd>
              </div>
            </dl>
          </>
        )}
      </Modal>

      {/* --- 删除确认 --- */}
      <Modal
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title={`删掉「${removing?.displayName}」？`}
        size="sm"
        actions={
          <ButtonGroup align="end">
            <Button onClick={() => setRemoving(null)}>留着</Button>
            <Button variant="danger" icon={Trash2} onClick={remove}>
              删掉
            </Button>
          </ButtonGroup>
        }
      >
        <p>
          只是把这个源移掉，已经下载进曲库的歌不受影响。
          之后想用还得重新导入一次。
        </p>
      </Modal>
    </Page>
  );
}
