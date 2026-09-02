/**
 * 封面图。
 *
 * 重构前缺封面时会铺一张带大号"SONGLIB AMP / NO COVER ART"金色水印的
 * SVG，十张并排就是一堵噪音墙，还会盖过真正有封面的内容。
 *
 * 现在的占位规则：
 *   - 底色由标题哈希决定，同一张专辑每次进来颜色一致，不同专辑互相区分；
 *   - 中间只放标题首字，字重轻、对比低，安静但可辨认；
 *   - 不出现品牌名，不出现"缺封面"字样 —— 那是库存状态，不是浏览信息。
 *
 * 歌手用圆形，专辑和单曲用方形，这是听众已有的心理预期，不要混用。
 */

import { useState } from "react";

/**
 * 标题 -> 稳定的色相。用简单字符串哈希，够均匀且不引依赖。
 * 导出是为了让别处（如首页 hero 的色光衬底）在没有封面时
 * 能取到跟占位图完全一样的色相，两者不会各说各话。
 */
export const hueOf = (text) => {
  const value = String(text || "");
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
};

/**
 * 取用于占位的首字。
 * 中文取第一个字，英文取首字母，都没有就留空 —— 留空也比放个错的好。
 */
const initialOf = (text) => {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  const first = [...trimmed][0];
  return /[\p{L}\p{N}]/u.test(first) ? first.toUpperCase() : "";
};

const SHAPES = new Set(["square", "round", "rounded"]);

/**
 * @param src    封面地址。空、加载失败都会退回占位。
 * @param title  用于生成占位色和首字，也用于 alt。
 * @param shape  square 专辑/单曲，round 歌手，rounded 歌单
 * @param size   任意 CSS 长度；不传则填满父容器。
 */
export function Cover({
  src,
  title,
  shape = "square",
  size,
  className = "",
  children,
}) {
  const [failed, setFailed] = useState(false);
  const safeShape = SHAPES.has(shape) ? shape : "square";
  const showImage = Boolean(src) && !failed;
  const hue = hueOf(title);

  return (
    <div
      className={["ui-cover", `ui-cover--${safeShape}`, className]
        .filter(Boolean)
        .join(" ")}
      style={{
        width: size,
        height: size,
        // 占位底色：低饱和、低亮度，深浅主题下都不刺眼。
        "--cover-hue": hue,
      }}
    >
      {showImage ? (
        <img
          src={src}
          alt={title ? `${title} 的封面` : ""}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="ui-cover__placeholder" aria-hidden="true">
          {initialOf(title)}
        </span>
      )}
      {children && <div className="ui-cover__overlay">{children}</div>}
    </div>
  );
}
