import { ChevronRight, CircleAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Brand } from "../../components/Brand";
import { Button } from "../../components/ui/Button";
import { VideoBackdrop } from "../../components/ui/VideoBackdrop";
import { api } from "../../lib/api";

export function SetupWizard({ onComplete }) {
  const [form, setForm] = useState({
    username: "admin",
    displayName: "",
    password: "",
    confirmPassword: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    if (form.password !== form.confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/setup/complete", {
        method: "POST",
        body: JSON.stringify({
          username: form.username,
          displayName: form.displayName,
          password: form.password,
        }),
      });
      onComplete();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="setup-page login">
      {/* 和登录页用同一套背景：环境光晕 + 音乐岛屿 + 压暗遮罩。
          首装是用户见到的第一屏，和登录页保持一致的观感。 */}
      <div className="ambient" aria-hidden="true" />
      <VideoBackdrop
        poster="/visuals/login-island.jpg"
        sources={[
          { src: "/visuals/login-island.webm", type: "video/webm" },
          { src: "/visuals/login-island.mp4", type: "video/mp4" },
        ]}
      />
      <div className="login__scrim" aria-hidden="true" />
      {/* 不再挂 .panel —— 那是一段硬编码深色渐变。首装卡片的
          玻璃质感由 login.css 里的 .setup-card 自己给。 */}
      <section className="setup-card">
        <Brand />
        <span className="eyebrow"><ShieldCheck />首次设置</span>
        <h1>创建这座音乐岛的主人账号</h1>
        <p>账号和听歌记录都只存在这台机器上。建好之后再连音乐目录或 Plex。</p>
        <form onSubmit={submit}>
          <label>
            <span>用户名</span>
            <input autoFocus value={form.username} onChange={(event) => update("username", event.target.value)} />
          </label>
          <label>
            <span>显示名称</span>
            <input value={form.displayName} onChange={(event) => update("displayName", event.target.value)} placeholder="例如：我的音屿" />
          </label>
          <label>
            <span>管理员密码</span>
            <input type="password" value={form.password} onChange={(event) => update("password", event.target.value)} placeholder="至少 12 个字符" />
          </label>
          <label>
            <span>确认密码</span>
            <input type="password" value={form.confirmPassword} onChange={(event) => update("confirmPassword", event.target.value)} />
          </label>
          {error && <div className="form-error"><CircleAlert />{error}</div>}
          <Button
            type="submit"
            variant="primary"
            block
            icon={ChevronRight}
            loading={busy}
            disabled={form.password.length < 12}
          >
            创建账号并进入
          </Button>
        </form>
        <footer><ShieldCheck />不设默认密码，这串字符不会写进日志</footer>
      </section>
    </main>
  );
}
