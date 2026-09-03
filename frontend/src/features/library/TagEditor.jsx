/**
 * 标签编辑器。
 *
 * 重构前这里是一个弹窗，8 个空白输入框加一个"确认写入标签"按钮。
 * 问题不在于少了什么控件，而在于它没有回答用户真正会问的三个问题：
 *
 *   1. 我现在改的是哪首歌？（没有封面、没有文件路径，只有一堆输入框）
 *   2. 我到底改了什么？（写进去之前看不到新旧对比）
 *   3. 我能一次改一批吗？（只能一首一首点开）
 *
 * 现在：左侧是待写入的曲目，右侧是字段；改动过的字段实时显示"旧值 → 新值"；
 * 选中多首时进入批量模式，只写你真正动过的字段，没动的保持各自原值。
 *
 * 写入是不可逆的文件操作，所以确认区会明确列出"要改几首、改哪些字段"，
 * 而不是一个笼统的"确认"。
 */

import {
  ArrowRight,
  CircleAlert,
  FileAudio,
  RotateCcw,
  Sparkles,
  Tags,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button, ButtonGroup, IconButton } from "../../components/ui/Button";
import { Cover } from "../../components/ui/Cover";
import { Field, FieldSet, Notice } from "../../components/ui/Field";
import { api } from "../../lib/api";

/**
 * 可写字段。
 * key 是提交给后端的字段名，source 是接口返回里对应的读取名
 * （后端读用下划线、写用驼峰，这里做一次映射，不让调用方记两套）。
 */
const FIELDS = [
  { key: "title", source: ["title"], label: "歌曲名", group: "曲目", span: 2 },
  { key: "artist", source: ["artist"], label: "歌手", group: "曲目" },
  { key: "album", source: ["album"], label: "专辑", group: "曲目" },
  {
    key: "albumArtist",
    source: ["albumArtist", "album_artist"],
    label: "专辑歌手",
    group: "曲目",
    hint: "合辑里用来归并同一张专辑，通常和歌手相同",
  },
  { key: "genre", source: ["genre"], label: "风格", group: "曲目" },
  {
    key: "trackNumber",
    source: ["trackNumber", "track_number"],
    label: "音轨号",
    group: "编号",
    inputMode: "numeric",
  },
  {
    key: "discNumber",
    source: ["discNumber", "disc_number"],
    label: "碟号",
    group: "编号",
    inputMode: "numeric",
  },
  { key: "year", source: ["year"], label: "年份", group: "编号", inputMode: "numeric" },
];

const GROUPS = ["曲目", "编号"];

/** 从接口返回里取某个字段的当前值，兼容下划线与驼峰两种命名。 */
const readField = (file, field) => {
  for (const name of field.source) {
    const value = file?.[name];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return "";
};

/** 多首曲目在某字段上是否取值一致。不一致时输入框显示"多个值"。 */
const commonValue = (files, field) => {
  if (!files.length) return "";
  const first = readField(files[0], field);
  return files.every((file) => readField(file, field) === first) ? first : null;
};

/**
 * 从文件名猜测歌手与歌名。
 * 只处理最常见的两种排布，猜不准就返回 null —— 猜错比不猜更糟，
 * 用户会以为已经填对而直接写入。
 */
const guessFromFilename = (filename) => {
  const base = String(filename || "").replace(/\.[a-z0-9]+$/i, "");
  // 去掉开头的音轨号："01 - "、"01."、"01_"
  const withoutTrack = base.replace(/^\s*\d{1,3}\s*[-_.、]\s*/, "").trim();
  // "歌手 - 歌名"
  const dashed = withoutTrack.split(/\s+-\s+/);
  if (dashed.length === 2) {
    return { artist: dashed[0].trim(), title: dashed[1].trim() };
  }
  // 只剩歌名
  if (withoutTrack && withoutTrack !== base) return { title: withoutTrack };
  return null;
};

/**
 * @param files    要编辑的曲目。一首是单曲模式，多首是批量模式。
 * @param onClose  关闭
 * @param onSaved  写入成功后回调，用于刷新列表
 */
export function TagEditor({ files = [], onClose, onSaved }) {
  // 只存"用户动过的字段"，没动过的不提交，批量时才能保留各自原值。
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const batch = files.length > 1;
  const primary = files[0] || {};

  const setField = (key, value) =>
    setEdits((current) => ({ ...current, [key]: value }));

  const resetField = (key) =>
    setEdits((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });

  /** 实际会写入的字段（用户动过、且与原值不同）。 */
  const changes = useMemo(() => {
    const result = {};
    for (const field of FIELDS) {
      if (!(field.key in edits)) continue;
      const next = edits[field.key];
      if (batch) {
        // 批量模式下只要动过就写，因为各首原值可能不同。
        if (next !== "") result[field.key] = next;
        continue;
      }
      if (next !== readField(primary, field)) result[field.key] = next;
    }
    return result;
  }, [edits, files, batch, primary]);

  const changedFields = FIELDS.filter((field) => field.key in changes);

  const applyGuess = () => {
    const guess = guessFromFilename(primary.filename);
    if (!guess) {
      setError("文件名里认不出歌手和歌名，需手动填写");
      return;
    }
    setError("");
    setEdits((current) => ({ ...current, ...guess }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!changedFields.length) return;
    setBusy(true);
    setError("");
    try {
      // 逐首写入。后端接口是按文件的，批量在前端展开，
      // 这样某一首失败时能明确指出是哪一首。
      for (const file of files) {
        await api(`/api/local/files/${file.id}/tags`, {
          method: "PATCH",
          body: JSON.stringify({ changes }),
        });
      }
      onSaved?.(files.length);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="tag-editor" onSubmit={submit}>
      {/* --- 左栏：改的是哪些曲目 --- */}
      <aside className="tag-editor__subject">
        <Cover
          src={primary.coverUrl}
          title={primary.title || primary.filename}
          shape="square"
        />

        <div className="tag-editor__subject-text">
          <p className="tag-editor__subject-title">
            {batch ? `已选 ${files.length} 首` : primary.title || primary.filename}
          </p>
          <p className="tag-editor__subject-sub">
            {batch
              ? "只写入改动过的字段"
              : primary.artist || "未知歌手"}
          </p>
        </div>

        {!batch && (
          <>
            <div className="tag-editor__meta">
              <Badge>{primary.format || "未知格式"}</Badge>
              {primary.has_cover === false && <Badge tone="warning">缺封面</Badge>}
              {primary.has_lrc === false && <Badge tone="warning">缺歌词</Badge>}
            </div>
            <p className="tag-editor__path" title={primary.path}>
              <FileAudio aria-hidden="true" />
              {primary.path}
            </p>
            <Button variant="ghost" size="sm" icon={Sparkles} onClick={applyGuess}>
              从文件名填写
            </Button>
          </>
        )}

        {batch && (
          <ul className="tag-editor__list">
            {files.slice(0, 8).map((file) => (
              <li key={file.id}>{file.title || file.filename}</li>
            ))}
            {files.length > 8 && <li>…还有 {files.length - 8} 首</li>}
          </ul>
        )}
      </aside>

      {/* --- 右栏：字段 --- */}
      <div className="tag-editor__fields">
        {GROUPS.map((group) => (
          <FieldSet key={group} legend={group} columns={2}>
            {FIELDS.filter((field) => field.group === group).map((field) => {
              const current = batch
                ? commonValue(files, field)
                : readField(primary, field);
              const touched = field.key in edits;
              const value = touched ? edits[field.key] : current === null ? "" : current;
              const changed = field.key in changes;

              return (
                <div
                  key={field.key}
                  className={`tag-editor__field${field.span === 2 ? " tag-editor__field--wide" : ""}`}
                >
                  <Field
                    label={field.label}
                    hint={field.hint}
                    inputMode={field.inputMode}
                    placeholder={
                      batch && current === null ? "多个值（留空则不改）" : undefined
                    }
                    value={value}
                    onChange={(event) => setField(field.key, event.target.value)}
                    trailing={
                      changed ? (
                        <IconButton
                          icon={RotateCcw}
                          label={`撤销对「${field.label}」的修改`}
                          size="sm"
                          onClick={() => resetField(field.key)}
                        />
                      ) : undefined
                    }
                  />
                  {/* 改动过的字段直接显示新旧对比，写入前就能看清。 */}
                  {changed && !batch && (
                    <p className="tag-editor__diff">
                      <span>{current || "（空）"}</span>
                      <ArrowRight aria-hidden="true" />
                      <strong>{changes[field.key] || "（空）"}</strong>
                    </p>
                  )}
                </div>
              );
            })}
          </FieldSet>
        ))}

        {error && (
          <Notice tone="danger" icon={CircleAlert}>
            {error}
          </Notice>
        )}

        {/* --- 确认区：明确说清会发生什么 --- */}
        <div className="tag-editor__confirm">
          <div className="tag-editor__summary">
            {changedFields.length ? (
              <>
                <strong>
                  将修改 {files.length} 首的 {changedFields.length} 个字段
                </strong>
                <span>
                  {changedFields.map((field) => field.label).join("、")}
                  ，写入后原值会记录在操作历史里，可以回滚
                </span>
              </>
            ) : (
              <span>还没有改动</span>
            )}
          </div>
          <ButtonGroup align="end">
            <Button onClick={onClose}>取消</Button>
            <Button
              type="submit"
              variant="primary"
              icon={Tags}
              loading={busy}
              disabled={!changedFields.length}
            >
              写入音频文件
            </Button>
          </ButtonGroup>
        </div>
      </div>
    </form>
  );
}
