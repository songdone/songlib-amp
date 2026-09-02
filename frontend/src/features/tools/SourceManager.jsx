import { CircleAlert, Code2, FileUp, Gauge, Link2, LoaderCircle, Music2, Plus, Power, ScrollText, Search, ShieldCheck, TestTube2, Trash2, Wifi, X } from "lucide-react";
import { useState } from "react";
import { Empty } from "../../components/Empty";
import { SectionHead } from "../../components/SectionHead";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/format";

const SOURCE_STATES = {
  unverified: ["未验证", "muted"],
  imported: ["已导入", "amber"],
  search_ok: ["搜索可用", "blue"],
  inspect_ok: ["接口已授权", "green"],
  partial: ["接口已授权", "green"],
  degraded: ["已授权 · 运行异常", "amber"],
  resolve_ok: ["解析可用", "green"],
  unavailable: ["不可用", "red"],
  disabled: ["已禁用", "muted"],
};

export function SourceManager({ sources, refreshSources, notify }) {
  const [mode, setMode] = useState("url"),
    [name, setName] = useState(""),
    [url, setUrl] = useState(""),
    [code, setCode] = useState(""),
    [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [keyword, setKeyword] = useState(""),
    [quality, setQuality] = useState("320k");
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
        if (!file) throw new Error("请选择本地 .js 音乐源文件。");
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
        "填一首你真会去搜的歌，测出来的结果才有参考价值。",
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
  const remove = async (source) => {
    if (!confirm(`删掉「${source.displayName}」？只是移除这个源，曲库里的歌不受影响。`))
      return;
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
  return (
    <div className="page sources-page">
      <section className="source-layout">
        <form className="panel source-import" onSubmit={importSource}>
          <SectionHead
            title="导入音乐源"
            note="识别到音乐接口后会立即启用"
          />
          <div className="import-tabs">
            {[
              ["url", Link2, "在线 URL"],
              ["file", FileUp, "本地文件"],
              ["code", Code2, "粘贴源码"],
            ].map(([id, Icon, label]) => (
              <button
                type="button"
                className={mode === id ? "active" : ""}
                onClick={() => {
                  setMode(id);
                  setError("");
                }}
                key={id}
              >
                <Icon />
                {label}
              </button>
            ))}
          </div>
          <label>
            显示名称（可选）
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：我的无损源"
            />
          </label>
          {mode === "url" && (
            <label>
              Raw JavaScript URL
              <input
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…/latest.js"
              />
            </label>
          )}
          {mode === "file" && (
            <label className="file-picker">
              <input
                type="file"
                accept=".js,application/javascript,text/javascript"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <FileUp />
              <strong>{file?.name || "选择本地 .js 文件"}</strong>
              <span>从这台电脑选文件，最大 2 MB</span>
            </label>
          )}
          {mode === "code" && (
            <label>
              JavaScript 源码
              <textarea
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="粘贴完整 LX 自定义音乐源源码…"
              />
            </label>
          )}
          <p className="modal-note">
            <ShieldCheck />
            音屿不自带任何音乐源。只导入你信得过、也有权使用的脚本 —— 它不会绕过任何版权保护。
          </p>
          <button className="primary full" disabled={busy}>
            {busy ? <LoaderCircle className="spin" /> : <Plus />}导入并启用
          </button>
        </form>
        <section className="panel source-guide">
          <h3>导入之后要做什么</h3>
          <p>
            导入时会先检查一遍脚本，通过就直接启用，可以马上去搜歌。
            旁边那两个测试是看这个源支持到什么程度，测不过也照样能用。
          </p>
          <ol>
            <li>
              <b>01</b> 导入并检查脚本结构
            </li>
            <li>
              <b>02</b> 校验通过后自动启用
            </li>
            <li>
              <b>03</b> 搜索与下载权限立即开放
            </li>
            <li>
              <b>04</b> 实际使用时记录接口状态
            </li>
          </ol>
        </section>
      </section>
      {error && (
        <div className="inline-error">
          <CircleAlert />
          {error}
        </div>
      )}
      <section className="panel installed-sources">
        <SectionHead
          title="已安装音乐源"
          note={`共 ${sources.length} 个`}
        />
        {sources.length ? (
          <div className="source-cards">
            {sources.map((source) => {
              const [label, tone] = SOURCE_STATES[source.status] || [
                source.status,
                "muted",
              ];
              return (
                <article className="source-card" key={source.id}>
                  <div className="source-card-head">
                    <div className="source-logo">
                      <Music2 />
                    </div>
                    <div>
                      <strong>{source.displayName}</strong>
                      <span>
                        {source.metadata?.author || "自定义来源"} ·{" "}
                        {source.sourceType}
                      </span>
                    </div>
                    <i className={`source-state ${tone}`}>{label}</i>
                  </div>
                  <dl>
                    <div>
                      <dt>检测格式</dt>
                      <dd>
                        {source.detectedFormat || "待检查"} ·{" "}
                        {source.compatibility || "未知"}
                      </dd>
                    </div>
                    <div>
                      <dt>使用权限</dt>
                      <dd>
                        {source.accessGranted
                          ? "搜索与下载已开放"
                          : source.enabled
                            ? "等待接口识别"
                            : "已停用"}
                      </dd>
                    </div>
                    <div>
                      <dt>运行验证</dt>
                      <dd>
                        搜索 {source.searchOk ? "成功" : "待运行"} · 解析{" "}
                        {source.resolveOk ? "成功" : "待运行"}
                      </dd>
                    </div>
                    <div>
                      <dt>支持平台</dt>
                      <dd>
                        {source.supportedPlatforms?.join(" · ") || "未知"}
                      </dd>
                    </div>
                    <div>
                      <dt>支持音质</dt>
                      <dd>
                        {source.supportedQualities?.join(" · ") || "待测试"}
                      </dd>
                    </div>
                    <div>
                      <dt>最近测试</dt>
                      <dd>
                        {source.lastTestAt
                          ? timeAgo(source.lastTestAt)
                          : "尚未测试"}
                      </dd>
                    </div>
                  </dl>
                  {source.lastErrorMessage && (
                    <p className="source-error">
                      <CircleAlert />
                      {source.lastErrorMessage}
                    </p>
                  )}
                  <div className="source-actions">
                    <button
                      className="secondary small"
                      disabled={testing === `inspect-${source.id}`}
                      onClick={() => inspect(source)}
                    >
                      {testing === `inspect-${source.id}` ? (
                        <LoaderCircle className="spin" />
                      ) : (
                        <Gauge />
                      )}
                      检查格式
                    </button>
                    <button
                      className="secondary small"
                      disabled={testing === source.id}
                      onClick={() => testSearch(source)}
                    >
                      {testing === source.id ? (
                        <LoaderCircle className="spin" />
                      ) : (
                        <Search />
                      )}
                      测试搜索
                    </button>
                    <button
                      className="icon-button"
                      title="查看日志"
                      aria-label="查看日志"
                      onClick={() => showLogs(source)}
                    >
                      <ScrollText />
                    </button>
                    <button
                      className={`icon-button ${source.enabled ? "powered" : ""}`}
                      title={source.enabled ? "禁用" : "启用"}
                      onClick={() => toggle(source)}
                    >
                      <Power />
                    </button>
                    <button
                      className="icon-button danger"
                      title="删除"
                      onClick={() => remove(source)}
                    >
                      <Trash2 />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty
            icon={Wifi}
            title="还没有音乐源"
            text="填地址、选本地文件，或者直接粘源码。"
          />
        )}
      </section>
      {testData && (
        <section className="panel source-test">
          <SectionHead
            title={`测试搜索 · ${testData.source.displayName}`}
            note={`找到 ${testData.result.count} 首候选歌曲，可选择一首测试播放地址`}
            action={
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
              >
                <option value="128k">128K</option>
                <option value="320k">320K</option>
                <option value="flac">FLAC</option>
                <option value="flac24bit">Hi-Res</option>
              </select>
            }
          />
          <div className="result-list">
            {testData.result.results.map((item) => (
              <div
                className="result-row source-result"
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
                <button
                  className="secondary small"
                  disabled={testing === `resolve-${item.trackId}`}
                  onClick={() => testResolve(item)}
                >
                  {testing === `resolve-${item.trackId}` ? (
                    <LoaderCircle className="spin" />
                  ) : (
                    <TestTube2 />
                  )}
                  测试解析
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {logs && (
        <div className="modal-wrap">
          <button className="modal-backdrop" onClick={() => setLogs(null)} />
          <section className="modal panel log-modal">
            <div className="modal-head">
              <div>
                <h3>{logs.source.displayName}</h3>
              </div>
              <button className="icon-button" onClick={() => setLogs(null)} aria-label="关闭日志" title="关闭">
                <X />
              </button>
            </div>
            <div className="log-list">
              {logs.items.length ? (
                logs.items.map((item) => (
                  <div className={item.level} key={item.id}>
                    <time>
                      {new Date(item.created_at).toLocaleString("zh-CN")}
                    </time>
                    <b>{item.action}</b>
                    <p>{item.message}</p>
                  </div>
                ))
              ) : (
                <Empty
                  icon={ScrollText}
                  title="暂无日志"
                  text="导入和测试的结果都会记在这里。"
                />
              )}
            </div>
          </section>
        </div>
      )}
      {inspection && (
        <div className="modal-wrap">
          <button
            className="modal-backdrop"
            onClick={() => setInspection(null)}
          />
          <section className="modal panel inspect-modal">
            <div className="modal-head">
              <div>
                <h3>{inspection.source.displayName}</h3>
              </div>
              <button
                className="icon-button"
                onClick={() => setInspection(null)}
                aria-label="关闭格式检查"
                title="关闭"
              >
                <X />
              </button>
            </div>
            <div className="inspect-summary">
              <i
                className={`source-state ${inspection.result.ok ? "green" : "red"}`}
              >
                {inspection.result.compatibility}
              </i>
              <strong>{inspection.result.detected_format}</strong>
              <p>{inspection.result.message}</p>
            </div>
            <dl>
              <div>
                <dt>顶层接口</dt>
                <dd>{inspection.result.top_level_keys?.join(" · ") || "无"}</dd>
              </div>
              <div>
                <dt>搜索</dt>
                <dd>
                  {inspection.result.methods?.search
                    ? "源内置"
                    : "音屿目录适配器"}
                </dd>
              </div>
              <div>
                <dt>地址解析</dt>
                <dd>{inspection.result.methods?.resolve ? "支持" : "缺失"}</dd>
              </div>
              <div>
                <dt>歌词 / 封面</dt>
                <dd>
                  {inspection.result.methods?.lyric ? "支持" : "—"} /{" "}
                  {inspection.result.methods?.cover ? "支持" : "—"}
                </dd>
              </div>
              <div>
                <dt>平台</dt>
                <dd>
                  {inspection.result.supported_platforms?.join(" · ") || "未知"}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      )}
    </div>
  );
}
