import { csrfFromCookie } from "./contracts";

export const api = async (path, options = {}) => {
  const { timeoutMs = 20000, ...requestOptions } = options;
  const isForm = options.body instanceof FormData;
  const csrfToken = csrfFromCookie(document.cookie);
  const unsafe = !["GET", "HEAD", "OPTIONS"].includes(
    String(options.method || "GET").toUpperCase(),
  );
  const controller = options.signal ? null : new AbortController();
  const timer = controller
    ? window.setTimeout(() => controller.abort(), Math.max(1000, timeoutMs))
    : null;
  let response;
  try {
    response = await fetch(path, {
      credentials: "include",
      headers: {
        ...(isForm ? {} : { "Content-Type": "application/json" }),
        ...(unsafe && csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        ...(options.headers || {}),
      },
      ...requestOptions,
      signal: options.signal || controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError")
      throw new Error("连接 NAS 超时，请检查局域网后重试");
    throw error;
  } finally {
    if (timer) window.clearTimeout(timer);
  }
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
