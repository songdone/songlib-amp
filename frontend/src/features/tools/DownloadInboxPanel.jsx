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

import { ChevronRight, CircleAlert, Copy, Download, FolderTree, Library, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button, ButtonGroup } from "../../components/ui/Button";
import { Notice } from "../../components/ui/Field";
import { PathText } from "../../components/ui/PathText";
import { EmptyState, Section, SectionHeader } from "../../components/ui/Layout";
import { Modal } from "../../components/ui/Modal";
import { PageLoader } from "../../components/PageLoader";
import { api } from "../../lib/api";

/**
 * 一条的状态：能不能入库，不能的话为什么。
 *
 * "曲库里已经有" 是可勾选的（pickable），不是禁止 —— 用户完全可能
 * 就是想要两个版本（一个无损一个车载 MP3）。但默认不勾，
 * 而且如果新的那份还更差，说法要更明确一点。
 */
const stateOf = (item) => {
  // 目标位置上那份就是同一首歌 —— 这不是"冲突"，是"已经入过库了"。
  // 说成冲突会让人以为要去解决什么，其实什么都不用做。
  if (alreadyInLibrary(item))
    return { label: "已经在曲库里了", tone: "neutral", pickable: false };
  if (item.conflict) return { label: "目标位置有冲突", tone: "danger", pickable: false };
  if (item.worseThanExisting)
    return { label: "已有更好的版本", tone: "warning", pickable: true };
  if (item.existing?.length)
    return { label: "曲库里已经有", tone: "warning", pickable: true };
  if (item.needsReview) return { label: "信息要核对", tone: "warning", pickable: true };
  return { label: "可以入库", tone: "success", pickable: true };
};

/** 目标路径上已经躺着同一首歌。 */
const alreadyInLibrary = (item) =>
  Boolean(item.conflict) &&
  (item.existing || []).some((entry) => entry.path === item.targetPath);

const formatSize = (bytes) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** 一份音频的规格，用来和曲库里那份并排比较。 */
const specOf = (item) =>
  [
    (item.ext || item.format || "").replace(".", "").toUpperCase(),
    item.bitrate ? `${item.bitrate}kbps` : "",
    item.size ? formatSize(item.size) : "",
  ]
    .filter(Boolean)
    .join(" · ");

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
      // 默认只勾"确实是新歌、信息也齐"的那些。
      // 曲库里已经有的一律不勾 —— 要不要再存一份必须由人决定。
      setSelected(
        (result.items || [])
          .filter(
            (item) =>
              !item.conflict && !item.needsReview && !item.existing?.length,
          )
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
                  <PathText path={item.sourcePath} />
                  <ChevronRight aria-hidden="true" />
                  <PathText path={item.targetPath} />
                </div>
                <Badge tone={state.tone}>{state.label}</Badge>

                {/*
                  曲库里已有的同一首，跟这一份并排列出来。
                  这是"要不要再存一份"唯一需要的信息：两边的格式、
                  码率和体积摆在一起，用户一眼就能决定。
                  跨整行显示，不挤在路径那一列里。
                */}
                {item.existing?.length > 0 && (
                  <div className="inbox-dupe">
                    <p className="inbox-dupe__lead">
                      <Copy aria-hidden="true" />
                      <span>
                        {alreadyInLibrary(item)
                          ? "这首歌已经在曲库里了，位置也一样。下载目录里这份可以直接删掉。"
                          : `曲库里已经有${
                              item.existing.length > 1
                                ? ` ${item.existing.length} 份`
                                : "一份"
                            }${
                              item.worseThanExisting
                                ? "，而且比这个好。入库之后就是两份。"
                                : "。入库之后就是两份。"
                            }`}
                      </span>
                    </p>
                    <ul>
                      <li className="inbox-dupe__incoming">
                        <Badge tone="accent">这一份</Badge>
                        <PathText path={item.sourcePath} />
                        <span>{specOf(item) || "规格未知"}</span>
                      </li>
                      {item.existing.map((existing) => (
                        <li key={existing.id}>
                          <Badge tone="neutral">曲库里的</Badge>
                          <PathText path={existing.path} />
                          <span>{specOf(existing) || "规格未知"}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
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
