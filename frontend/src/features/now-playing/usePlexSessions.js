import { useCallback, useEffect, useState } from "react";

import { api } from "../../lib/api";

export function usePlexSessions({
  pollMs = 2000,
  quietErrors = false,
  enabled = true,
} = {}) {
  const [payload, setPayload] = useState({
    sessions: [],
    clients: [],
    polledAt: Date.now(),
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) setLoading(true);
      try {
        const next = await api("/api/plex/remote/sessions");
        setPayload({
          sessions: Array.isArray(next.sessions) ? next.sessions : [],
          clients: Array.isArray(next.clients) ? next.clients : [],
          polledAt: Number(next.polledAt || Date.now()),
        });
        setError("");
      } catch (requestError) {
        if (!quietErrors) {
          setError(requestError.message || "无法读取 Plex 播放设备");
        }
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [quietErrors],
  );

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setError("");
      setPayload({ sessions: [], clients: [], polledAt: Date.now() });
      return undefined;
    }
    refresh();
    const poll = () => {
      if (document.visibilityState === "visible") refresh({ quiet: true });
    };
    const timer = window.setInterval(poll, pollMs);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [enabled, pollMs, refresh]);

  return { ...payload, loading, error, refresh };
}
