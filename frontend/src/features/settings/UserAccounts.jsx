import { Plus, RefreshCw, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, ButtonGroup, IconButton } from "../../components/ui/Button";
import { Field, Notice } from "../../components/ui/Field";
import { SectionHeader } from "../../components/ui/Layout";
import { Modal } from "../../components/ui/Modal";
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
  /** 待确认的破坏性动作。`{ kind, item }`，kind 是 toggle / remove / reset。 */
  const [pending, setPending] = useState(null);
  /** 正在编辑的账号，连同草稿。改名和改权限合成一个表单。 */
  const [editing, setEditing] = useState(null);
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
    setPending(null);
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
  /**
   * 改名和改权限合成一个表单。
   *
   * 原来是四个连环 prompt()（用户名 → 显示名 → 权限 → 目录）：
   * 填错了没法回退，中途取消已经填的就丢了，而且权限那一格要求用户
   * 手打逗号分隔的英文枚举。现在一个弹窗里一次改完，能看到原值。
   */
  const openEditor = (item) =>
    setEditing({
      item,
      username: item.username,
      displayName: item.displayName || "",
      permissions: (item.permissions || []).join(", "),
      libraryScopes: (item.libraryScopes || []).join(", "),
    });

  const commaList = (value) =>
    String(value || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

  const saveEditor = async () => {
    const draft = editing;
    setEditing(null);
    if (!draft?.username.trim()) return;
    setBusy(draft.item.id);
    try {
      await api(`/api/users/${draft.item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          username: draft.username.trim(),
          displayName: draft.displayName.trim() || draft.username.trim(),
          permissions: commaList(draft.permissions),
          libraryScopes: commaList(draft.libraryScopes),
        }),
      });
      setMessage("账号已更新");
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
    setPending(null);
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
    setPending(null);
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
    <section className="account-panel">
      <SectionHeader
        title="账户与多用户"
        note="普通用户只能听歌，看不到整理曲库那几页"
        actions={
          <Button size="sm" icon={RefreshCw} onClick={load}>
            刷新
          </Button>
        }
      />
      {message && (
        <Notice tone="success" icon={ShieldCheck}>
          {message}
        </Notice>
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
              <Button size="sm" onClick={() => openEditor(item)}>
                改名与权限
              </Button>
              <Button size="sm" onClick={() => setResetting(item)}>
                重置密码
              </Button>
              <Button
                size="sm"
                disabled={busy === item.id}
                onClick={() => setPending({ kind: "toggle", item })}
              >
                {item.enabled ? "停用" : "启用"}
              </Button>
              <IconButton
                icon={Trash2}
                size="sm"
                variant="danger"
                label={`删除账号 ${item.username}`}
                onClick={() => setPending({ kind: "remove", item })}
              />
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
        <Button
          type="submit"
          variant="primary"
          size="sm"
          icon={Plus}
          loading={busy === "create"}
        >
          新建用户
        </Button>
      </form>
      <p className="setting-copy">
        主人账号的密码忘了，只能在跑这个服务的机器上重置 ——
        步骤见部署文档的「恢复管理员访问」。重置之后所有人都要重新登录。
      </p>
      {/* --- 重置密码 --- */}
      <Modal
        open={Boolean(resetting)}
        onClose={() => setResetting(null)}
        title={resetting ? `重置 ${resetting.username} 的密码` : ""}
        description="他要用新密码重新登录一次"
        size="sm"
        actions={
          <ButtonGroup align="end">
            <Button onClick={() => setResetting(null)}>取消</Button>
            <Button
              variant="primary"
              icon={ShieldCheck}
              loading={busy === resetting?.id}
              disabled={strength(resetPassword) === "太弱"}
              onClick={() => setPending({ kind: "reset", item: resetting })}
            >
              重置
            </Button>
          </ButtonGroup>
        }
      >
        <Field
          label="新密码"
          type="password"
          autoComplete="new-password"
          autoFocus
          minLength={10}
          placeholder="至少 10 位"
          value={resetPassword}
          onChange={(event) => setResetPassword(event.target.value)}
          hint={`强度：${strength(resetPassword)}`}
        />
      </Modal>

      {/* --- 改名与权限。原来是四个连环 prompt()。 --- */}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `${editing.item.username} 的账号设置` : ""}
        size="md"
        actions={
          <ButtonGroup align="end">
            <Button onClick={() => setEditing(null)}>取消</Button>
            <Button
              variant="primary"
              disabled={!editing?.username.trim()}
              onClick={saveEditor}
            >
              保存
            </Button>
          </ButtonGroup>
        }
      >
        {editing && (
          <div className="account-editor">
            <Field
              label="用户名"
              hint="登录用的名字"
              value={editing.username}
              onChange={(event) =>
                setEditing((v) => ({ ...v, username: event.target.value }))
              }
            />
            <Field
              label="显示名称"
              hint="不填就用用户名"
              value={editing.displayName}
              onChange={(event) =>
                setEditing((v) => ({ ...v, displayName: event.target.value }))
              }
            />
            <Field
              label="操作权限"
              hint="逗号分隔。留空就只能听歌。"
              value={editing.permissions}
              onChange={(event) =>
                setEditing((v) => ({ ...v, permissions: event.target.value }))
              }
            />
            <Field
              label="可访问目录"
              hint="填 /music 下面的目录名，逗号分隔；填 * 就是全部"
              value={editing.libraryScopes}
              onChange={(event) =>
                setEditing((v) => ({ ...v, libraryScopes: event.target.value }))
              }
            />
          </div>
        )}
      </Modal>

      {/* --- 停用 / 删除 / 重置的最终确认 --- */}
      <Modal
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        title={
          pending?.kind === "remove"
            ? `删掉账号 ${pending.item.username}？`
            : pending?.kind === "toggle"
              ? `${pending.item.enabled ? "停用" : "启用"} ${pending.item.username}？`
              : `确认重置 ${pending?.item?.username} 的密码？`
        }
        size="sm"
        actions={
          <ButtonGroup align="end">
            <Button onClick={() => setPending(null)}>先不动</Button>
            <Button
              variant={pending?.kind === "remove" ? "danger" : "primary"}
              onClick={() => {
                if (pending?.kind === "remove") remove(pending.item);
                else if (pending?.kind === "toggle") toggle(pending.item);
                else submitReset();
              }}
            >
              {pending?.kind === "remove"
                ? "删掉"
                : pending?.kind === "toggle"
                  ? pending.item.enabled
                    ? "停用"
                    : "启用"
                  : "重置"}
            </Button>
          </ButtonGroup>
        }
      >
        <p>
          {pending?.kind === "remove"
            ? "他就登不进来了。音乐文件和已有的播放记录不受影响。"
            : pending?.kind === "toggle"
              ? pending.item.enabled
                ? "停用之后他登不进来，但账号和权限都留着，随时能再启用。"
                : "启用之后他就能用原来的密码登录了。"
            : "他当前的登录会失效，要用新密码重新登录一次。"}
        </p>
      </Modal>
    </section>
  );
}
