import { Check, CircleAlert, X } from "lucide-react";
import { useEffect } from "react";

export function Toast({ toast, clear }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(clear, 3200);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className={`toast ${toast.type || "ok"}`}>
      {toast.type === "error" ? <CircleAlert /> : <Check />}
      <span>{toast.message}</span>
      <button onClick={clear}>
        <X />
      </button>
    </div>
  );
}
