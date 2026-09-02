/**
 * 下载目录（手动丢进来的音频）。
 *
 * 和"下好了，等你确认"是两件事：那边是音屿自己下的，这边是用户
 * 用别的工具下完、直接扔进下载目录的。两边都要先看清楚再入库。
 *
 * 重构掉的：
 * - confirm() 确认入库。
 * - 整块被 <label> 当行用：勾选框和三段内容塞在一个 label 里，
 *   点路径那一列也会切换勾选 —— 用户想复制路径时会误触。
 *   现在勾选框只管勾选框，行本身不触发。
 * - "整理入库 (3)" 括号里的数字。中文界面里用括号包数字是把
 *   程序里的计数直接摆出来；写成"整理这 3 首"。
 */

import { ChevronRight, CircleAlert, Download, FolderTree, Library, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button, ButtonGroup } from "../../components/ui/Button";
import { Notice } from "../../components/ui/Field";
import { EmptyState, Section, SectionHeader } from "../../components/ui/Layout";
import { Modal } from "../../components/ui/Modal";
import { PageLoader } from "../../components/PageLoader";
import { api } from "../../lib/api";

/** 一条的状态：能不能入库，不能的话为什么。 */
const stateOf = (item) => {
  if (item.conflict) return { label: "目标位置有冲突", tone: "danger", pickable: false };
  if (item.needsReview) return { label: "信息要核对", tone: "warning", pickable: true };
  return { label: "可以入库", tone: "success", pickable: true };
};

export function DownloadInboxPanel({ notify, navigate }) {
  const [data, setData] = useState({ items: [], errors: [], summary: {} });
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/local/download-inbox");
      setData(result);
      // 默认只勾没问题的那些 —— 有冲突或要核对的应该由人主动决定。
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
      value.includes(path)
        ? value.filter((item) => item !== path)
        : [...value, path],
    );

  const ingest = async () => {
    setConfirming(false);
    const items = data.items.filter((item) => selected.includes(item.sourcePath));
    if (!items.length) return;
    setBusy(true);
    try {
      await api("/api/local/download-inbox/ingest", {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      notify?.(`${items.length} 首已排进队列`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section reveal>
      <SectionHeader
        title="手动丢进下载目录的"
        note="改成什么名字、放到哪儿，都会先给你看一遍"
        actions={
          <ButtonGroup>
            <Button size="sm" icon={RefreshCw} loading={busy} onClick={load}>
              重新扫一遍
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={FolderTree}
              disabled={busy || !selected.length}
              onClick={() => setConfirming(true)}
            >
              整理这 {selected.length} 首
            </Button>
          </ButtonGroup>
        }
      />

      <p className="inbox__roots">
        <Download aria-hidden="true" />
        <code>{data.downloadRoot || "/downloads"}</code>
        <ChevronRight aria-hidden="true" />
        <Library aria-hidden="true" />
        <code>{data.musicRoot || "/music"}</code>
      </p>

      {error && (
        <Notice tone="danger" icon={CircleAlert}>
          {error}
        </Notice>
      )}

      {data.items?.length ? (
        <div className="inbox-table">
          {data.items.map((item) => {
            const state = stateOf(item);
            return (
              <div className="inbox-table__row" key={item.sourcePath}>
                {/* 勾选框独立成一格：整行是 label 的时候，
                    想选中路径复制会误触勾选。 */}
                <input
                  type="checkbox"
                  checked={selected.includes(item.sourcePath)}
                  disabled={!state.pickable}
                  onChange={() => toggle(item.sourcePath)}
                  aria-label={`整理 ${item.title}`}
                />
                <div className="inbox-table__text">
                  <strong>{item.title}</strong>
                  <small>
                    {[item.artist, item.album].filter(Boolean).join(" · ")}
                  </small>
                </div>
                <div className="inbox-table__paths">
                  <code>{item.sourcePath}</code>
                  <ChevronRight aria-hidden="true" />
                  <code>{item.targetPath}</code>
                </div>
                <Badge tone={state.tone}>{state.label}</Badge>
              </div>
            );
          })}
        </div>
      ) : busy ? (
        <PageLoader />
      ) : (
        <EmptyState
          icon={Download}
          title="下载目录是空的"
          text="用别的工具下的歌丢进这个目录，音屿也会先给你看一遍再入库。"
        />
      )}

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`把这 ${selected.length} 首放进曲库？`}
        size="sm"
        actions={
          <ButtonGroup align="end">
            <Button onClick={() => setConfirming(false)}>先不动</Button>
            <Button variant="primary" icon={FolderTree} onClick={ingest}>
              开始整理
            </Button>
          </ButtonGroup>
        }
      >
        <p>
          文件会从下载目录挪进音乐库，并按命名规则改名。原位置记下来了，
          之后能在「文件与标签 → 改动历史」里退回去。
        </p>
        <p>
          <Button variant="quiet" onClick={() => navigate?.("tasks")}>
            执行进度在「任务」页看
          </Button>
        </p>
      </Modal>
    </Section>
  );
}
