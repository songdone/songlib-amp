import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../lib/api";
import { reconcileRemoteSessionClock } from "../../lib/remotePlayback";

export function usePlexSessions({
  pollMs = 4000,
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
  const refreshSequence = useRef(0);
  const inFlightRef = useRef(null);

  const refresh = useCallback(
    async ({ quiet = false } = {}) => {
      if (inFlightRef.current) return inFlightRef.current;
      const sequence = ++refreshSequence.current;
      if (!quiet) setLoading(true);
      const request = (async () => {
        try {
          const next = await api("/api/plex/remote/sessions");
          if (sequence !== refreshSequence.current) return;
          const receivedAt = Date.now();
          setPayload((current) => {
            const previousById = new Map(
              current.sessions.map((session) => [session.id, session]),
            );
            return {
              sessions: (Array.isArray(next.sessions) ? next.sessions : []).map(
                (session) =>
                  reconcileRemoteSessionClock(
                    previousById.get(session.id),
                    session,
                    receivedAt,
                  ),
              ),
              clients: Array.isArray(next.clients) ? next.clients : [],
              clientsStale: Boolean(next.clientsStale),
              clientWarning: String(next.clientWarning || ""),
              polledAt: receivedAt,
              serverPolledAt: Number(next.polledAt || 0),
            };
          });
          setError("");
        } catch (requestError) {
          if (!quietErrors) {
            setError(requestError.message || "无法读取 Plex 播放设备");
          }
        } finally {
          if (!quiet) setLoading(false);
          inFlightRef.current = null;
        }
      })();
      inFlightRef.current = request;
      return request;
    },
    [quietErrors],
  );

  useEffect(() => {
    if (!enabled) {
      refreshSequence.current += 1;
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
