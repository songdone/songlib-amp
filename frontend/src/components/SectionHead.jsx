

export function SectionHead({ title, note, action }) {
  return (
    <div className="section-head">
      <div>
        <h3>{title}</h3>
        {note && <p>{note}</p>}
      </div>
      {action}
    </div>
  );
}
