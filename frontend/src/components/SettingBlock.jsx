

export function SettingBlock({ icon: Icon, title, note, children }) {
  return (
    <section className="setting-card">
      <div className="setting-title">
        <Icon />
        <div>
          <h3>{title}</h3>
          <p>{note}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
