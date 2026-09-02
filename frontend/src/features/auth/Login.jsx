import { Activity, CircleAlert, Eye, EyeOff, KeyRound, LoaderCircle, LogIn, Play, Server, ShieldCheck, User } from "lucide-react";
import { useState } from "react";
import { LoginMotionBackdrop } from "../../components/Backdrops";
import { BRAND } from "../../config/brand";
import { api } from "../../lib/api";

function LoginFeatureCard({ icon: Icon, title, desc }) {
  return (
    <div className="login-motion-feature">
      <div>
        <Icon />
      </div>
      <section>
        <h4>{title}</h4>
        <p>{desc}</p>
      </section>
    </div>
  );
}

export function Login({ onLogin }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      onLogin();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="login-page login-motion-page">
      <LoginMotionBackdrop />
      <div className="login-motion-logo">
        <div className="login-motion-logo-mark">
          <img src={BRAND.mark} alt="" />
        </div>
        <div>
          <h1>
            {BRAND.name}
            <span>|</span>
            {BRAND.cnName}
          </h1>
          <p>让散落的音乐 回到自己的岛屿</p>
        </div>
      </div>

      <div className="login-motion-shell">
        <div className="login-motion-grid">
          <section className="login-motion-left">
            <div>
              <div className="login-motion-copy">
                <h3>
                  <span />
                  YOUR MUSIC, AT HOME
                </h3>
                <h2>
                  让散落的音乐,
                  <br />
                  回到自己的<span>岛屿。</span>
                </h2>
                <p>
                  一处收藏、整理和播放 NAS
                  里的音乐，也能与 Plex 保持同步。
                </p>
              </div>
              <div className="login-motion-features">
                <LoginFeatureCard
                  delay={0.3}
                  icon={Server}
                  title="私人曲库"
                  desc="音乐始终留在家中"
                />
                <LoginFeatureCard
                  delay={0.4}
                  icon={Play}
                  title="连续播放"
                  desc="歌曲、队列与歌词相伴"
                />
                <LoginFeatureCard
                  delay={0.5}
                  icon={ShieldCheck}
                  title="本地优先"
                  desc="听歌记录由你掌控"
                />
                <LoginFeatureCard
                  delay={0.6}
                  icon={Activity}
                  title="为你发现"
                  desc="从熟悉走向新的旋律"
                />
              </div>
            </div>
          </section>

          <section className="login-motion-right">
            <div className="login-motion-card-group">
              <div className="login-motion-hover-glow" />
              <div className="login-motion-card">
                <div className="login-motion-card-line" />
                <div className="login-motion-card-head">
                  <div>
                    <img src={BRAND.mark} alt="" />
                  </div>
                  <h2>
                    {BRAND.name}
                    <span>{BRAND.cnName}</span>
                  </h2>
                  <p>SECURE ACCESS</p>
                </div>

                <form className="login-motion-form" onSubmit={submit}>
                  <h3>登录控制台</h3>
                  <label htmlFor="songlib-login-username">用户名</label>
                  <div className="login-motion-input">
                    <User />
                    <input
                      id="songlib-login-username"
                      name="username"
                      type="text"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck="false"
                      enterKeyHint="next"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="输入用户名"
                    />
                  </div>
                  <label htmlFor="songlib-login-password">密码</label>
                  <div className="login-motion-input">
                    <KeyRound />
                    <input
                      id="songlib-login-password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      enterKeyHint="go"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </button>
                  </div>
                  <div className="login-motion-row">
                    <span>会话仅保存在当前浏览器</span>
                    <button
                      type="button"
                      onClick={() =>
                        setError(
                          "请联系这台音屿实例的管理员，按部署文档中的“恢复管理员访问”流程重置密码。",
                        )
                      }
                    >
                      忘记密码？
                    </button>
                  </div>
                  {error && (
                    <div className="form-error login-motion-error">
                      <CircleAlert />
                      {error}
                    </div>
                  )}
                  <button
                    className="login-motion-submit"
                    disabled={busy || !password}
                  >
                    {busy ? <LoaderCircle className="spin" /> : <LogIn />}
                    进入音屿控制台
                  </button>
                </form>

                <footer>
                  <span className="status-dot" />
                  NAS 本地运行 · 数据不会上传云端
                </footer>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
