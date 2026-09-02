/**
 * 分享海报。
 *
 * 做成"编辑器"而不是"一键生成"，理由是海报这件事没有唯一正确答案：
 * 同一首歌，有人想要大封面，有人只想要那一句歌词。所以给四个模板、
 * 三个比例、歌词逐句勾选，右边实时出图。
 *
 * 交互上有意注意的几处：
 *
 * - 预览就是真画布，不是"近似效果"。预览用 1 倍，下载重画 2 倍，
 *   同一个绘制函数，所以看到的就是导出的。
 * - 歌词按行勾选，最多 6 行。超过 6 行的海报字号会小到看不清，
 *   与其让用户自己发现，不如直接不给选。
 * - 没有歌词时不显示歌词模板 —— 一个选了之后必然空白的选项不该出现。
 * - 主色从封面里取。不给"选颜色"，因为海报要的是和封面一致，
 *   多一个色板只会让人挑出一个不搭的颜色。
 */

import { Download, Image as ImageIcon, Music2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ButtonGroup } from "../../components/ui/Button";
import { Notice } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { ChipGroup } from "../../components/ui/Plan";
import { BRAND } from "../../config/brand";
import { coverUrlFor, normalizeTrackTitle } from "../../lib/media";
import {
  RATIOS,
  TEMPLATES,
  drawPoster,
  loadCover,
  posterFileName,
  shareableLyricLines,
} from "../../lib/poster";

const MAX_LYRIC_LINES = 6;

const RATIO_OPTIONS = Object.entries(RATIOS).map(([id, item]) => ({
  id,
  label: item.label,
}));

export function PosterStudio({ open, onClose, track, lyrics = [] }) {
  const [template, setTemplate] = useState("cover");
  const [ratio, setRatio] = useState("3:4");
  const [picked, setPicked] = useState([]);
  const [image, setImage] = useState(null);
  const [coverMissing, setCoverMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canvasRef = useRef(null);

  const title = normalizeTrackTitle(track?.title || track?.filename) || "未命名";
  const artist = track?.artist || track?.grandparentTitle || "";
  const album = track?.album || track?.parentTitle || "";
  const coverUrl = coverUrlFor(track);

  const candidates = useMemo(
    () => shareableLyricLines(lyrics).slice(0, 60),
    [lyrics],
  );

  const templateOptions = useMemo(
    () =>
      Object.entries(TEMPLATES)
        // 没歌词的时候歌词模板选了必然是空白的，直接不给。
        .filter(([id]) => id !== "lyric" || candidates.length > 0)
        .map(([id, item]) => ({ id, label: item.label, note: item.note })),
    [candidates.length],
  );

  // 打开时载入封面并预选歌词。依赖里带 open，关掉再打开会重新取一次 ——
  // 期间用户可能刚补好封面。
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError("");
    setCoverMissing(false);
    loadCover(coverUrl).then((loaded) => {
      if (!alive) return;
      setImage(loaded);
      setCoverMissing(Boolean(coverUrl) && !loaded);
    });
    return () => {
      alive = false;
    };
  }, [open, coverUrl]);

  useEffect(() => {
    if (!open) return;
    // 默认挑中间那几句。开头往往是"作词/作曲"之后的引子，
    // 副歌通常在中段，比第一句更适合当海报。
    const start = Math.max(0, Math.floor(candidates.length / 2) - 2);
    setPicked(candidates.slice(start, start + 4).map((line) => line.time));
    setTemplate(candidates.length ? "lyric" : "cover");
  }, [open, candidates]);

  const pickedText = useMemo(
    () =>
      candidates
        .filter((line) => picked.includes(line.time))
        .map((line) => line.text),
    [candidates, picked],
  );

  const drawOptions = useMemo(
    () => ({
      template,
      ratio,
      title,
      artist,
      album,
      lyrics: pickedText,
      image,
      footer: `${BRAND.name} · ${BRAND.cnName}`,
    }),
    [template, ratio, title, artist, album, pickedText, image],
  );

  useEffect(() => {
    if (!open || !canvasRef.current) return;
    try {
      drawPoster(canvasRef.current, { ...drawOptions, scale: 1 });
      setError("");
    } catch (err) {
      setError(`预览画失败：${err.message}`);
    }
  }, [open, drawOptions]);

  const toggleLine = (time) =>
    setPicked((value) => {
      if (value.includes(time)) return value.filter((item) => item !== time);
      if (value.length >= MAX_LYRIC_LINES) return value;
      // 按时间排序，不按点击顺序 —— 否则海报上的句子会乱序。
      return [...value, time].sort((a, b) => a - b);
    });

  const download = async () => {
    setSaving(true);
    setError("");
    try {
      // 重新画一张 2 倍图，不用预览那张 —— 预览是 1 倍，
      // 直接导出在手机上看会发虚。
      const target = document.createElement("canvas");
      drawPoster(target, { ...drawOptions, scale: 2 });
      const blob = await new Promise((resolve, reject) => {
        target.toBlob(
          (value) =>
            value ? resolve(value) : reject(new Error("画布导不出图片")),
          "image/png",
        );
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = posterFileName(title, artist);
      link.click();
      // 立刻 revoke 会让 Safari 的下载中断，退一帧再收。
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      setError(
        err.name === "SecurityError"
          ? "封面来自另一个域名，浏览器不允许把它导出成图片。换成本地封面就可以了。"
          : err.message,
      );
    } finally {
      setSaving(false);
    }
  };

  const size = RATIOS[ratio] || RATIOS["3:4"];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="做一张分享图"
      description="选模板和比例，右边就是导出的样子"
      size="xl"
      actions={
        <ButtonGroup align="end">
          <Button onClick={onClose}>关闭</Button>
          <Button
            variant="primary"
            icon={Download}
            loading={saving}
            onClick={download}
          >
            存成图片
          </Button>
        </ButtonGroup>
      }
    >
      <div className="poster-studio">
        <div className="poster-studio__controls">
          <ChipGroup
            label="模板"
            columns
            options={templateOptions}
            value={template}
            onChange={setTemplate}
          />

          <ChipGroup
            label="比例"
            options={RATIO_OPTIONS}
            value={ratio}
            onChange={setRatio}
          />

          {template === "lyric" || template === "minimal" ? (
            candidates.length ? (
              <section className="poster-lyrics">
                <header>
                  <h3>挑几句歌词</h3>
                  <small>
                    {picked.length
                      ? `选了 ${picked.length} 句，最多 ${MAX_LYRIC_LINES} 句`
                      : `还没选，最多 ${MAX_LYRIC_LINES} 句`}
                  </small>
                </header>
                <ul>
                  {candidates.map((line) => {
                    const on = picked.includes(line.time);
                    // 选满之后未选中的行禁用，而不是让人点了没反应。
                    const full = !on && picked.length >= MAX_LYRIC_LINES;
                    return (
                      <li key={line.time}>
                        <label className={full ? "is-full" : undefined}>
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={full}
                            onChange={() => toggleLine(line.time)}
                          />
                          <span>{line.text}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : (
              <Notice tone="info" icon={Music2}>
                这首歌还没有歌词。去「封面与歌词」补一份，就能做歌词海报了。
              </Notice>
            )
          ) : null}

          {coverMissing && (
            <Notice tone="warning" icon={ImageIcon}>
              封面读不出来，先用主色渐变加首字代替。多半是封面在别的域名上 ——
              把它存到本地曲库就能画进海报。
            </Notice>
          )}

          {error && <Notice tone="danger">{error}</Notice>}

          <p className="poster-studio__hint">
            <Sparkles aria-hidden="true" />
            <span>
              海报的主色是从封面里取的，所以换封面海报会跟着变。
              导出的是 {size.width * 2}×{size.height * 2} 的 PNG。
            </span>
          </p>
        </div>

        {/*
          预览容器按比例撑开，canvas 用 width:100% 缩放显示。
          canvas 的 width/height 属性是像素尺寸（1080×1440），
          CSS 尺寸另算 —— 两者不能混，混了就会拉伸变形。
        */}
        <div
          className="poster-studio__stage"
          style={{ aspectRatio: `${size.width} / ${size.height}` }}
        >
          <canvas
            ref={canvasRef}
            className="poster-studio__canvas"
            role="img"
            aria-label={`${title} 的分享图预览`}
          />
        </div>
      </div>
    </Modal>
  );
}
