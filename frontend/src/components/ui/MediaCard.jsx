/**
 * 媒体卡片：歌手、专辑、歌单在网格里的统一呈现。
 *
 * 重构前的问题：
 *   - 每张卡片都挂着"缺封面 / 待同步 / 缺中文简介 / 缺背景"四个角标和小标签。
 *     这些是资料库的维护状态，属于"管音乐"，不属于"听音乐"。
 *     用户来浏览时看到的是一排待办事项，不是自己的音乐。
 *   - 歌手和专辑都是方形，视觉上分不出来。
 *   - 整张 article 用 role="button"，里面又嵌了播放和查看两个真按钮，
 *     嵌套交互元素，键盘 Tab 顺序也乱。
 *
 * 现在：
 *   - 卡片只呈现听众关心的信息：封面、名字、一行副标题。
 *   - 歌手圆形、专辑方形，形状本身就是类型。
 *   - 主体是一个链接式按钮（进入详情），播放按钮浮在封面上，
 *     二者是兄弟节点而不是嵌套。
 *   - 维护状态交给"音乐工具"里的专门界面，不在这里泄漏。
 */

import { Play } from "lucide-react";
import { Cover } from "./Cover";
import { IconButton } from "./Button";

/**
 * @param kind      artist | album | playlist
 * @param title     主标题
 * @param subtitle  一行副标题（歌手名、年份、曲目数…）
 * @param coverUrl  封面地址，缺失时 Cover 会自己退回占位
 * @param onOpen    点击卡片主体
 * @param onPlay    点击封面上的播放按钮；不传则不显示播放按钮
 */
export function MediaCard({
  kind = "album",
  title,
  subtitle,
  coverUrl,
  onOpen,
  onPlay,
  playLabel,
}) {
  const shape = kind === "artist" ? "round" : kind === "playlist" ? "rounded" : "square";
  const name = title || "未命名";

  return (
    <article className="ui-media-card">
      <div className="ui-media-card__art">
        <Cover src={coverUrl} title={name} shape={shape}>
          {onPlay && (
            <IconButton
              icon={Play}
              label={playLabel || `播放 ${name}`}
              variant="primary"
              size="lg"
              className="ui-media-card__play"
              onClick={(event) => {
                event.stopPropagation();
                onPlay();
              }}
            />
          )}
        </Cover>
      </div>

      {/* 主体按钮铺满卡片但排在封面之下，
          这样点卡片任意处都能进详情，而播放按钮仍然可以单独命中。 */}
      <button type="button" className="ui-media-card__body" onClick={onOpen}>
        <span className="ui-media-card__title">{name}</span>
        {subtitle && <span className="ui-media-card__subtitle">{subtitle}</span>}
      </button>
    </article>
  );
}

/** 媒体卡片网格。列宽自适应，不写死断点。 */
export function MediaGrid({ children, min = 150 }) {
  return (
    <div
      className="ui-media-grid"
      style={{ "--media-card-min": `${min}px` }}
    >
      {children}
    </div>
  );
}
