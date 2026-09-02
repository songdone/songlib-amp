import { LoaderCircle } from "lucide-react";

export function PageLoader() {
  return (
    <div className="page-loader">
      <LoaderCircle className="spin" />
      <span>正在读取音乐库…</span>
    </div>
  );
}
