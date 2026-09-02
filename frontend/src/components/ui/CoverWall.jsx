/**
 * 封面墙。两排封面朝相反方向匀速横移。
 *
 * 这是一块纯装饰，作用是让"曲库里有这些东西"被看见，
 * 而不是靠一行统计数字说出来。
 *
 * 为什么封面不做成可点的：
 *
 * 匀速移动的点击目标点不中，是实打实的交互事故。给它加"悬停暂停"
 * 只是把问题藏起来 —— 用户得先发现"要停下来才点得到"。
 * 而且一排要铺满宽屏得把内容重复好几份，每份都可点就意味着同一张
 * 封面在页面上有五个按钮：读屏器念五遍，Tab 停五次。
 *
 * 所以整块 aria-hidden，真正的入口放在区块标题旁边。
 * 这些封面在同一页的"最近加入"网格里都点得到，没有功能损失。
 */

import { Cover } from "./Cover";

/** 少于这个数量就不铺墙 —— 循环太短，看得出是同几张在转。 */
const MIN_ITEMS = 8;

/**
 * 一个半段要铺够多宽，否则窄内容在宽屏上右侧会露白。
 * 2000px 覆盖到 2K 显示器的内容区宽度。
 */
const HALF_TARGET_PX = 2000;

/** 单元宽度上限（clamp 的最大值）加一道间隙，用来估算需要几份。 */
const CELL_PITCH_PX = 116;

/** 把一排拆成上下两排，交错分配而不是前后切分，
    避免同一位歌手的几张专辑挤在同一排。 */
const splitRows = (items) => [
  items.filter((_, index) => index % 2 === 0),
  items.filter((_, index) => index % 2 === 1),
];

function Row({ items, reverse }) {
  // 一排必须由两个完全等宽的半段组成，动画位移一半后才能无缝回到起点。
  // 曲库小的时候一份铺不满屏幕，所以每个半段内部重复到够宽为止。
  const copiesPerHalf = Math.max(
    1,
    Math.ceil(HALF_TARGET_PX / Math.max(items.length * CELL_PITCH_PX, 1)),
  );
  const cells = [];
  for (let copy = 0; copy < copiesPerHalf * 2; copy += 1) {
    items.forEach((item, index) =>
      cells.push({ item, key: `${copy}-${index}` }),
    );
  }

  return (
    <div className={reverse ? "marquee marquee--reverse" : "marquee"}>
      {cells.map(({ item, key }) => (
        <span key={key} className="cover-wall__cell">
          <Cover
            src={item.coverUrl}
            title={item.title}
            shape="square"
            size="var(--cover-wall-size)"
          />
        </span>
      ))}
    </div>
  );
}

/** @param items 形如 `{ key, title, coverUrl }` 的数组 */
export function CoverWall({ items = [] }) {
  if (items.length < MIN_ITEMS) return null;
  const [top, bottom] = splitRows(items);
  return (
    <div className="cover-wall marquee-mask" aria-hidden="true">
      <Row items={top} />
      <Row items={bottom} reverse />
    </div>
  );
}
