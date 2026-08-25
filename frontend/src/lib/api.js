import { csrfFromCookie } from "./contracts";

export const api = async (path, options = {}) => {
  const isForm = options.body instanceof FormData;
  const csrfToken = csrfFromCookie(document.cookie);
  const unsafe = !["GET", "HEAD", "OPTIONS"].includes(
    String(options.method || "GET").toUpperCase(),
  );
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(unsafe && csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      typeof data.detail === "string" ? data.detail : data.detail?.message;
    const error = new Error(
      data.message || detail || `请求失败 (${response.status})`,
    );
    error.code = data.error_code || data.detail?.error_code;
    throw error;
  }
  return data;
};
