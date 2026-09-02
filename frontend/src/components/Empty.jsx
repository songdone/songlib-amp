import { Music2 } from "lucide-react";

export function Empty({ icon: Icon = Music2, title, text }) {
  return (
    <div className="empty">
      <div>
        <Icon />
      </div>
      <h4>{title}</h4>
      <p>{text}</p>
    </div>
  );
}
