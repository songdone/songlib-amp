/**
 * 设置项卡片。
 *
 * 设置页十个标签页共用它，所以改这里等于改整页的观感。
 * 标题用 h3 —— 顶栏那个页名是 h1，标签页本身不是标题层级里的一环。
 */

export function SettingBlock({ icon: Icon, title, note, children }) {
  return (
    <section className="setting-card">
      <header className="setting-card__head">
        {Icon && (
          <span className="setting-card__icon" aria-hidden="true">
            <Icon />
          </span>
        )}
        <div className="setting-card__text">
          <h3>{title}</h3>
          {note && <p>{note}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}
