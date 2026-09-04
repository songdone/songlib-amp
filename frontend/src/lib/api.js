import { csrfFromCookie } from "./contracts.js";

/*
 * 并发的同一个 GET 只打一次。
 *
 * 这条链路每个请求有约 370ms 的固定开销（反代 + 公网，应用自己只要
 * 34–76ms，实测），所以"同一个地址被两个组件同时要一遍"的代价是实打实的。
 * 冷启动就有：PlayerProvider 和 Dashboard 各打一次 `/api/playlists`。
 *
 * 注意这**不是缓存** —— 只在请求还在飞的时候共享同一个 Promise，
 * 完成即释放。所以不会拿到过期数据，也不需要失效策略。
 * 带 signal 的请求不参与（调用方要能单独取消它）。
 */
const inFlight = new Map();

const isPlainGet = (options) =>
  !options.signal &&
  !options.body &&
  ["GET", "HEAD"].includes(String(options.method || "GET").toUpperCase());

export const api = async (path, options = {}) => {
  if (isPlainGet(options)) {
    const existing = inFlight.get(path);
    if (existing) return existing;
    const request = apiRequest(path, options).finally(() => {
      inFlight.delete(path);
    });
    inFlight.set(path, request);
    return request;
  }
  return apiRequest(path, options);
};

const apiRequest = async (path, options = {}) => {
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
