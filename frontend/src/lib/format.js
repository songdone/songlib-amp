

export const fmt = (value) => new Intl.NumberFormat("zh-CN").format(value || 0);

export const pct = (value, total) => (total ? Math.round((value / total) * 100) : 0);

export const formatTime = (value) => {
  const seconds = Math.max(0, Math.floor(Number(value || 0)));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export const durationLabel = (value) => {
  const seconds = Math.floor(Number(value || 0) / 1000);
  if (!seconds) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} 小时 ${minutes} 分钟` : `${minutes} 分钟`;
};

export const timeAgo = (value) => {
  if (!value) return "刚刚";
  const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return `${Math.max(0, seconds)} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return new Date(value).toLocaleDateString("zh-CN");
};
