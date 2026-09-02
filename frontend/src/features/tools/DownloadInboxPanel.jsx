import { ChevronRight, CircleAlert, Download, FolderTree, Library, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Empty } from "../../components/Empty";
import { PageLoader } from "../../components/PageLoader";
import { SectionHead } from "../../components/SectionHead";
import { api } from "../../lib/api";

export function DownloadInboxPanel({ notify, navigate }) {
  const [data, setData] = useState({ items: [], errors: [], summary: {} });
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/local/download-inbox");
      setData(result);
      setSelected(
        (result.items || [])
          .filter((item) => !item.conflict && !item.needsReview)
          .map((item) => item.sourcePath),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const toggle = (path) =>
    setSelected((value) =>
      value.includes(path) ? value.filter((item) => item !== path) : [...value, path],
    );
  const ingest = async () => {
    const items = data.items.filter((item) => selected.includes(item.sourcePath));
    if (!items.length) return;
    if (!confirm(`把这 ${items.length} 首放进曲库？\n\n文件会从下载目录挪到音乐库。原位置记下来了，之后能退回去。`)) return;
    setBusy(true);
    try {
      await api("/api/local/download-inbox/ingest", {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      notify?.(`${items.length} 首已排进队列`);
      navigate?.("tasks");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel download-inbox-panel">
      <SectionHead
        title="下载目录"
        note="先看清楚会改成什么名字、放到哪儿，再挪"
        action={
          <div className="pending-actions">
            <button className="secondary small" onClick={load} disabled={busy}><RefreshCw className={busy ? "spin" : ""} />重新扫描</button>
            <button className="primary small" onClick={ingest} disabled={busy || !selected.length}><FolderTree />整理入库 ({selected.length})</button>
          </div>
        }
      />
      <div className="inbox-roots">
        <span><Download />下载目录 <code>{data.downloadRoot || "/downloads"}</code></span>
        <ChevronRight />
        <span><Library />音乐库 <code>{data.musicRoot || "/music"}</code></span>
      </div>
      {error && <div className="inline-error"><CircleAlert />{error}</div>}
      {data.items?.length ? (
        <div className="inbox-table">
          {data.items.map((item) => (
            <label className={item.conflict ? "conflict" : item.needsReview ? "review" : ""} key={item.sourcePath}>
              <input type="checkbox" checked={selected.includes(item.sourcePath)} disabled={item.conflict} onChange={() => toggle(item.sourcePath)} />
              <div>
                <strong>{item.title}</strong>
                <small>{item.artist} · {item.album}</small>
              </div>
              <div className="inbox-paths">
                <code>{item.sourcePath}</code>
                <ChevronRight />
                <code>{item.targetPath}</code>
              </div>
              <em>{item.conflict ? "目标冲突" : item.needsReview ? "请核对信息" : "可入库"}</em>
            </label>
          ))}
        </div>
      ) : busy ? <PageLoader /> : (
        <Empty icon={Download} title="下载目录是空的" text="手动丢进这个目录的音频，也会先给你看一遍再入库。" />
      )}
    </section>
  );
}
