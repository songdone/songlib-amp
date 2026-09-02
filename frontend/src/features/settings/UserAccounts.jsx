import { LoaderCircle, Plus, RefreshCw, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { SectionHead } from "../../components/SectionHead";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/format";

export function UserAccounts() {
  const [items, setItems] = useState([]),
    [form, setForm] = useState({
      username: "",
      displayName: "",
      password: "",
      role: "listener",
      permissions: ["listen"],
      libraryScopes: [],
    }),
    [busy, setBusy] = useState(""),
    [message, setMessage] = useState("");
  const [resetting, setResetting] = useState(null),
    [resetPassword, setResetPassword] = useState("");
  const strength = (password) => {
    let score = 0;
    if ((password || "").length >= 10) score++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return ["太弱", "偏弱", "可用", "较强", "很强"][score];
  };
  const load = async () => {
    try {
      const data = await api("/api/users");
      setItems(data.items || []);
    } catch (err) {
      setMessage(err.message);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const create = async (event) => {
    event.preventDefault();
    if (strength(form.password) === "太弱")
      return setMessage("密码至少 10 位，建议包含大小写、数字和符号。");
    setBusy("create");
    setMessage("");
    try {
      await api("/api/users", { method: "POST", body: JSON.stringify(form) });
      setForm({
        username: "",
        displayName: "",
        password: "",
        role: "listener",
        permissions: ["listen"],
        libraryScopes: [],
      });
      setMessage("账号已创建");
      load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy("");
    }
  };
  const toggle = async (item) => {
    if (!confirm(`${item.enabled ? "停用" : "启用"}账号 ${item.username}？`))
      return;
    setBusy(item.id);
    setMessage("");
    try {
      await api(`/api/users/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !item.enabled }),
      });
      load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy("");
    }
  };
  const rename = async (item) => {
    const username = prompt(
      "新的用户名",
      item.username,
    );
    if (!username) return;
    const displayName =
      prompt("显示名称", item.displayName || username) || username;
    setBusy(item.id);
    try {
      await api(`/api/users/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ username, displayName }),
      });
      load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy("");
    }
  };
  const editAccess = async (item) => {
    const permissions = prompt(
      "操作权限",
      (item.permissions || []).join(", "),
    );
    if (permissions === null) return;
    const scopes = prompt(
      "可访问目录",
      (item.libraryScopes || []).join(", "),
    );
    if (scopes === null) return;
    setBusy(item.id);
    try {
      await api(`/api/users/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          permissions: permissions
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          libraryScopes: scopes
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        }),
      });
      setMessage("权限范围已更新");
      load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy("");
    }
  };
  const submitReset = async (event) => {
    event.preventDefault();
    if (!resetting) return;
    if (strength(resetPassword) === "太弱")
      return setMessage("新密码至少 10 位，建议包含大小写、数字和符号。");
    if (
      !confirm(
        `重置 ${resetting.username} 的密码？他要用新密码重新登录一次。`,
      )
    )
      return;
    setBusy(resetting.id);
    try {
      await api(`/api/users/${resetting.id}/password`, {
        method: "POST",
        body: JSON.stringify({ password: resetPassword }),
      });
      setMessage(`已重置 ${resetting.username} 的密码`);
      setResetting(null);
      setResetPassword("");
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy("");
    }
  };
  const remove = async (item) => {
    if (
      !confirm(
        `删掉账号 ${item.username}？\n\n他就登不进来了。音乐文件不受影响。`,
      )
    )
      return;
    setBusy(item.id);
    try {
      await api(`/api/users/${item.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy("");
    }
  };
  return (
    <section className="panel account-panel">
      <SectionHead
        title="账户与多用户"
        note="普通用户只能听歌，看不到整理曲库那几页。"
        action={
          <button className="secondary small" onClick={load}>
            <RefreshCw />
            刷新
          </button>
        }
      />
      {message && (
        <div className="inline-info">
          <ShieldCheck />
          {message}
        </div>
      )}
      <div className="account-list">
        {items.map((item) => (
          <div className="account-row" key={item.id}>
            <UserRound />
            <div>
              <strong>{item.displayName || item.username}</strong>
              <span>
                @{item.username} · {item.role || "listener"} ·{" "}
                {item.enabled ? "已启用" : "已停用"} ·{" "}
                {item.lastLoginAt
                  ? `上次登录 ${timeAgo(item.lastLoginAt)}`
                  : "未登录"}
                <br />
                权限：{(item.permissions || []).join("、")} · 目录：
                {(item.libraryScopes || []).join("、") || "未授权"}
              </span>
            </div>
            <div className="account-row-actions">
              <button className="secondary small" onClick={() => rename(item)}>
                改名
              </button>
              <button
                className="secondary small"
                onClick={() => editAccess(item)}
              >
                权限范围
              </button>
              <button
                className="secondary small"
                onClick={() => setResetting(item)}
              >
                重置密码
              </button>
              <button
                className="secondary small"
                disabled={busy === item.id}
                onClick={() => toggle(item)}
              >
                {item.enabled ? "停用" : "启用"}
              </button>
              <button className="icon-button danger" onClick={() => remove(item)}>
                <Trash2 />
              </button>
            </div>
          </div>
        ))}
      </div>
      <form className="account-create" onSubmit={create}>
        <label>
          用户名
          <input
            value={form.username}
            onChange={(e) =>
              setForm((v) => ({ ...v, username: e.target.value }))
            }
            placeholder="例如 playsong"
          />
        </label>
        <label>
          显示名称
          <input
            value={form.displayName}
            onChange={(e) =>
              setForm((v) => ({ ...v, displayName: e.target.value }))
            }
            placeholder="例如 PlaySong"
          />
        </label>
        <label>
          角色
          <select
            value={form.role}
            onChange={(e) => {
              const role = e.target.value;
              setForm((v) => ({
                ...v,
                role,
                permissions:
                  role === "listener"
                    ? ["listen"]
                    : role === "library_admin"
                      ? [
                          "listen",
                          "manage_library",
                          "manage_sources",
                          "view_logs",
                        ]
                      : [
                          "listen",
                          "manage_library",
                          "manage_sources",
                          "manage_users",
                          "view_logs",
                        ],
                libraryScopes: role === "listener" ? [] : ["*"],
              }));
            }}
          >
            <option value="listener">普通用户</option>
            <option value="library_admin">曲库管理员</option>
            <option value="admin">管理员</option>
          </select>
        </label>
        <label className="account-scope">
          可访问目录
          <input
            value={(form.libraryScopes || []).join(", ")}
            onChange={(event) =>
              setForm((value) => ({
                ...value,
                libraryScopes: event.target.value
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
              }))
            }
            placeholder="例如「周杰伦, 五月天」；填 * 就是全部"
          />
          <small>填 /music 下面的目录名，这个账号只能听到这些目录里的歌。</small>
        </label>
        <div className="account-permissions">
          {[
            ["listen", "播放"],
            ["manage_library", "曲库管理"],
            ["manage_sources", "音乐源"],
            ["view_logs", "日志/备份"],
            ["manage_users", "用户管理"],
          ].map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={(form.permissions || []).includes(key)}
                disabled={key === "listen"}
                onChange={() =>
                  setForm((value) => ({
                    ...value,
                    permissions: value.permissions.includes(key)
                      ? value.permissions.filter((item) => item !== key)
                      : [...value.permissions, key],
                  }))
                }
              />
              {label}
            </label>
          ))}
        </div>
        <label>
          初始密码
          <input
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) =>
              setForm((v) => ({ ...v, password: e.target.value }))
            }
            placeholder="至少 10 位"
          />
          <small>强度：{strength(form.password)}</small>
        </label>
        <button className="primary small" disabled={busy === "create"}>
          {busy === "create" ? <LoaderCircle className="spin" /> : <Plus />}
          新建用户
        </button>
      </form>
      <p className="setting-copy">
        主人账号的密码忘了，只能在跑这个服务的机器上重置 ——
        步骤见部署文档的「恢复管理员访问」。重置之后所有人都要重新登录。
      </p>
      {resetting && (
        <div className="modal-wrap">
          <button
            className="modal-backdrop"
            onClick={() => setResetting(null)}
          />
          <form
            className="modal panel password-reset-modal"
            onSubmit={submitReset}
          >
            <div className="modal-head">
              <div>
                <h3>重置 {resetting.username} 的密码</h3>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setResetting(null)}
                aria-label="关闭"
                title="关闭"
              >
                <X />
              </button>
            </div>
            <label>
              新密码
              <input
                autoFocus
                type="password"
                autoComplete="new-password"
                minLength="10"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder="至少 10 位"
              />
              <small>强度：{strength(resetPassword)}</small>
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setResetting(null)}
              >
                取消
              </button>
              <button className="primary" disabled={busy === resetting.id}>
                {busy === resetting.id ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <ShieldCheck />
                )}
                确认重置
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
