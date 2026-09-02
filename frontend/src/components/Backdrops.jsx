/**
 * 背景层。
 *
 * 这里原先有一套"兜底图"机制：拿不到歌手背景 / 播放器背景时，
 * 铺上 fallback-artist.svg 或 fallback-player.svg —— 两张印着
 * "SONGLIB AMP" 金色水印的图。缺图时整屏都是品牌噪音。
 *
 * 现在没有兜底图：拿不到图就什么都不铺，由 styles/motion.css 的
 * .ambient 环境光晕撑起画面纵深。没有内容时应该是安静的，
 * 不该用一张占位图假装有内容。
 */

/**
 * @param image 背景图地址。空值时只渲染渐变层，不渲染 img。
 */
function AppBackdrop({ image, variant = "default" }) {
  return (
    <div className={`app-backdrop ${variant}`} aria-hidden="true">
      {image && (
        <img
          key={image}
          className="backdrop-image current"
          src={image}
          alt=""
          decoding="async"
          loading="lazy"
        />
      )}
      <i className="backdrop-vignette" />
      <i className="backdrop-aurora" />
    </div>
  );
}

export function ArtistBackdrop({ imageUrl }) {
  return <AppBackdrop image={imageUrl} variant="home artist-backdrop" />;
}

export function PlayerBackdrop({ imageUrl }) {
  return <AppBackdrop image={imageUrl} variant="player player-backdrop" />;
}

export { AppBackdrop };
