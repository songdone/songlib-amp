import { Check, Library, ListMusic, LoaderCircle, RefreshCw, Server, ShieldCheck, TestTube2, X } from "lucide-react";
import { useState } from "react";
import { Empty } from "../../components/Empty";
import { api } from "../../lib/api";

export function PlexSettingsModal({ initial, onClose, onSaved }) {
  const [draft, setDraft] = useState({
    enabled: initial.enabled ?? true,
    name: initial.name || "Plex",
    serverUrl: initial.serverUrl || "",
    externalUrl: initial.externalUrl || "",
    token: "",
    selectedLibraryKeys: initial.selectedLibraryKeys || "all",
  });
  const [libraries, setLibraries] = useState(initial.libraries || []),
    [busy, setBusy] = useState(""),
    [message, setMessage] = useState(""),
    [showToken, setShowToken] = useState(false);
  const selectedAll = draft.selectedLibraryKeys === "all";
  const selectedKeys = Array.isArray(draft.selectedLibraryKeys)
    ? draft.selectedLibraryKeys
    : [];
  const validateBaseUrl = (value, label, required = true) => {
    const raw = (value || "").trim();
    if (!raw && !required) return "";
    if (!raw) throw new Error(`${label}不能为空`);
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error(`${label}必须是 http 或 https 地址`);
    }
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.host)
      throw new Error(`${label}必须是 http 或 https 地址`);
    if (
      (parsed.pathname && parsed.pathname !== "/") ||
      parsed.search ||
      parsed.hash
    )
      throw new Error(`${label}只能填写根地址，不能带路径、参数或片段`);
    return raw.replace(/\/+$/, "");
  };
  const setField = (key, value) => setDraft((v) => ({ ...v, [key]: value }));
  const refreshLibraries = async () => {
    setBusy("libraries");
    setMessage("");
    try {
      const data = await api("/api/plex/libraries");
      setLibraries(data.items || []);
      setMessage(`已读取 ${data.items?.length || 0} 个音乐库`);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy("");
    }
  };
  const test = async () => {
    setBusy("test");
    setMessage("");
    try {
      const serverUrl = validateBaseUrl(draft.serverUrl, "服务器内网地址");
      const result = await api("/api/plex/test", {
        method: "POST",
        body: JSON.stringify({ serverUrl, token: draft.token }),
      });
      setLibraries(result.libraries || []);
      setMessage(result.message || "Plex 连接成功");
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy("");
    }
  };
  const save = async () => {
    setBusy("save");
    setMessage("");
    try {
      const safe = {
        ...draft,
        serverUrl: validateBaseUrl(draft.serverUrl, "服务器内网地址"),
        externalUrl: validateBaseUrl(draft.externalUrl, "外网播放地址", false),
      };
      const result = await api("/api/settings/plex", {
        method: "POST",
        body: JSON.stringify(safe),
      });
      onSaved(result.settings);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy("");
    }
  };
  const toggleLibrary = (key) =>
    setDraft((v) => {
      const keys = Array.isArray(v.selectedLibraryKeys)
        ? v.selectedLibraryKeys
        : [];
      return {
        ...v,
        selectedLibraryKeys: keys.includes(key)
          ? keys.filter((item) => item !== key)
          : [...keys, key],
      };
    });
  return (
    <div className="modal-wrap">
      <button className="modal-backdrop" onClick={onClose} />
      <section className="modal panel plex-modal">
        <div className="modal-head">
          <div>
            <h3>配置 Plex 媒体服务器</h3>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="plex-form">
          <label className="switch-line">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setField("enabled", e.target.checked)}
            />
            <span>启用 Plex 联动与媒体库同步</span>
          </label>
          <div className="plex-grid">
            <label>
              显示名称
              <input
                value={draft.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="例如：极空间 Plex"
              />
            </label>
            <label>
              服务器内网地址
              <input
                value={draft.serverUrl}
                onChange={(e) => setField("serverUrl", e.target.value)}
                placeholder="http://nas-address:32400"
              />
            </label>
            <label>
              外网播放地址（可选）
              <input
                value={draft.externalUrl}
                onChange={(e) => setField("externalUrl", e.target.value)}
                placeholder="https://plex.example.com"
              />
            </label>
            <label>
              X-Plex-Token
              <div className="token-row">
                <input
                  type={showToken ? "text" : "password"}
                  value={draft.token}
                  onChange={(e) => setField("token", e.target.value)}
                  placeholder={
                    initial.hasToken
                      ? "留空则继续使用已保存 Token"
                      : "输入 X-Plex-Token"
                  }
                />
                <button type="button" onClick={() => setShowToken((v) => !v)}>
                  {showToken ? "隐藏" : "显示"}
                </button>
              </div>
            </label>
          </div>
          <div className="library-mode">
            <button
              type="button"
              className={selectedAll ? "active" : ""}
              onClick={() => setField("selectedLibraryKeys", "all")}
            >
              <Library />
              同步全部音乐库
            </button>
            <button
              type="button"
              className={!selectedAll ? "active" : ""}
              onClick={() =>
                setField(
                  "selectedLibraryKeys",
                  selectedKeys.length ? selectedKeys : [],
                )
              }
            >
              <ListMusic />
              仅同步指定音乐库
            </button>
          </div>
          <div className="library-tools">
            <button
              className="secondary small"
              disabled={!!busy}
              onClick={test}
            >
              {busy === "test" ? (
                <LoaderCircle className="spin" />
              ) : (
                <TestTube2 />
              )}
              测试连接
            </button>
            <button
              className="secondary small"
              disabled={!!busy}
              onClick={refreshLibraries}
            >
              {busy === "libraries" ? (
                <LoaderCircle className="spin" />
              ) : (
                <RefreshCw />
              )}
              刷新媒体库
            </button>
          </div>
          <div className="library-list">
            {libraries.length ? (
              libraries.map((item) => (
                <label
                  key={item.key}
                  className={`library-row ${item.enabled ? "active" : ""}`}
                >
                  <input
                    type="checkbox"
                    disabled={selectedAll}
                    checked={selectedAll || selectedKeys.includes(item.key)}
                    onChange={() => toggleLibrary(item.key)}
                  />
                  <div>
                    <strong>{item.title}</strong>
                    <span>
                      {item.type || "music"} · #{item.key}
                    </span>
                  </div>
                  <i>{item.enabled ? "已同步" : "未选中"}</i>
                </label>
              ))
            ) : (
              <Empty
                icon={Library}
                title="还没有媒体库列表"
                text="先测试连接或刷新媒体库，音屿会只展示 Plex 音乐资料库。"
              />
            )}
          </div>
          {message && (
            <div className="inline-info">
              <ShieldCheck />
              {message}
            </div>
          )}
          <div className="modal-actions">
            <button className="secondary" onClick={onClose}>
              取消
            </button>
            <button className="primary" disabled={!!busy} onClick={save}>
              {busy === "save" ? <LoaderCircle className="spin" /> : <Check />}
              确认保存
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
