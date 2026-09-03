import { Check, Library, RefreshCw, ShieldCheck, TestTube2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button, ButtonGroup } from "../../components/ui/Button";
import { Field, Notice } from "../../components/ui/Field";
import { EmptyState } from "../../components/ui/Layout";
import { Modal } from "../../components/ui/Modal";
import { ChipGroup } from "../../components/ui/Plan";
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
    <Modal
      open
      onClose={onClose}
      title="连接 Plex"
      description="接入 Plex 曲库，并可遥控 Plexamp"
      size="lg"
      dismissible={false}
      actions={
        <ButtonGroup align="end">
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            icon={Check}
            loading={busy === "save"}
            disabled={Boolean(busy)}
            onClick={save}
          >
            保存并连接
          </Button>
        </ButtonGroup>
      }
    >
      <div className="plex-form">
        <label className="plex-switch">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setField("enabled", event.target.checked)}
          />
          <span>
            <strong>启用 Plex</strong>
            <small>关掉之后音屿只用本地音乐目录</small>
          </span>
        </label>

        <div className="plex-grid">
          <Field
            label="显示名称"
            placeholder="例如：极空间 Plex"
            value={draft.name}
            onChange={(event) => setField("name", event.target.value)}
          />
          <Field
            label="服务器地址"
            hint="内网地址，用于读取数据"
            placeholder="http://nas-address:32400"
            value={draft.serverUrl}
            onChange={(event) => setField("serverUrl", event.target.value)}
          />
          <Field
            label="外网播放地址"
            hint="留空则仅内网可播"
            placeholder="https://plex.example.com"
            value={draft.externalUrl}
            onChange={(event) => setField("externalUrl", event.target.value)}
          />
          <Field
            label="X-Plex-Token"
            type={showToken ? "text" : "password"}
            placeholder={
              initial.hasToken ? "留空沿用已保存的" : "输入 X-Plex-Token"
            }
            value={draft.token}
            onChange={(event) => setField("token", event.target.value)}
            trailing={
              <Button
                size="sm"
                variant="quiet"
                onClick={() => setShowToken((value) => !value)}
              >
                {showToken ? "隐藏" : "显示"}
              </Button>
            }
          />
        </div>

        <ChipGroup
          label="同步哪些音乐库"
          options={[
            { id: "all", label: "全部音乐库" },
            { id: "some", label: "只同步勾选的" },
          ]}
          value={selectedAll ? "all" : "some"}
          onChange={(id) =>
            setField(
              "selectedLibraryKeys",
              id === "all" ? "all" : selectedKeys.length ? selectedKeys : [],
            )
          }
        />

        <div className="plex-tools">
          <Button
            size="sm"
            icon={TestTube2}
            loading={busy === "test"}
            disabled={Boolean(busy)}
            onClick={test}
          >
            测试连接
          </Button>
          <Button
            size="sm"
            icon={RefreshCw}
            loading={busy === "libraries"}
            disabled={Boolean(busy)}
            onClick={refreshLibraries}
          >
            读取音乐库
          </Button>
        </div>

        {libraries.length ? (
          <div className="plex-libraries">
            {libraries.map((item) => (
              <label className="plex-library" key={item.key}>
                <input
                  type="checkbox"
                  disabled={selectedAll}
                  checked={selectedAll || selectedKeys.includes(item.key)}
                  onChange={() => toggleLibrary(item.key)}
                />
                <span className="plex-library__text">
                  <strong>{item.title}</strong>
                  <small>{item.type || "music"}</small>
                </span>
                {item.enabled ? (
                  <Badge tone="success">已同步</Badge>
                ) : (
                  <Badge>没选</Badge>
                )}
              </label>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Library}
            title="还没读到音乐库"
            text="测试连接后自动列出"
          />
        )}

        {message && (
          <Notice tone="info" icon={ShieldCheck}>
            {message}
          </Notice>
        )}
      </div>
    </Modal>
  );
}
