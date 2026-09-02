/**
 * 登录页。
 *
 * 保留旧版的氛围和左右分栏构图 —— 那部分是对的，暖金背景加statement 排版
 * 让人一进来就知道这是什么产品。修掉的是下面这些实际缺陷：
 *
 *   - 左上角 logo 用绝对定位，压在标题和上方英文小字上（真实重叠）。
 *     现在 logo 是左栏正常文档流里的第一个元素，不会压到任何东西。
 *   - "PRIVATE MUSIC OPERATIONS" / "SECURE ACCESS" 两行英文装饰，
 *     不传达信息。换成一个真实状态徽章。
 *   - "登录控制台" / "进入音屿控制台"：这是个人 NAS 音乐播放器，
 *     不是企业控制台。
 *   - 品牌名同屏出现三次（左上 logo、标题、卡片头）。现在只出现一次。
 *   - "SSO 单点登录（企业）"和"运营洞察 / 深度分析音乐资产"是 to-B 话术，
 *     跟这个产品无关。
 *
 * 背景从一张固定的金色粒子位图换成 SoundField —— 用 CSS 画的声波地平线，
 * 颜色跟主题走、任何分辨率都清晰、体积几乎为零。
 */

import { CircleAlert, Disc3, Eye, EyeOff, KeyRound, Radio, ShieldCheck, User } from "lucide-react";
import { useEffect, useState } from "react";
import { Halo, LiveBadge } from "../../components/ui/Badge";
import { Button, IconButton } from "../../components/ui/Button";
import { Field, Notice } from "../../components/ui/Field";
import { SoundField } from "../../components/ui/SoundField";
import { VideoBackdrop } from "../../components/ui/VideoBackdrop";
import { BRAND } from "../../config/brand";
import { api } from "../../lib/api";

/**
 * 左栏的三条卖点。
 * 写用户能得到什么，不写系统有什么模块 ——
 * 旧版的"运营洞察 / 深度分析音乐资产"就是后者。
 */
const HIGHLIGHTS = [
  {
    icon: Disc3,
    title: "整座曲库在自己手里",
    desc: "音乐存在你的 NAS 上，不依赖任何云服务",
  },
  {
    icon: Radio,
    title: "从手机放到电视",
    desc: "接管 Plexamp，或把歌词投到 Apple TV",
  },
  {
    icon: ShieldCheck,
    title: "听歌记录不出门",
    desc: "播放历史只写在本地，推荐也在本地算",
  },
];

export function Login({ onLogin }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  /**
   * 探一次服务状态，用来在徽章上显示真实信息。
   * 这是未鉴权端点；失败就当作"未就绪"，不打扰正在登录的人。
   */
  useEffect(() => {
    let cancelled = false;
    api("/api/health/live")
      .then(() => !cancelled && setReady(true))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
    <main className="login">
      {/* 背景四层，从下到上：环境光晕 → 音乐岛屿循环视频 → 光柱 → 压暗遮罩。
          都不参与交互，也不进入无障碍树。

          视频源自带两处水印：左上角固定的一处已在转码时裁掉；
          另一处会沿画面四周游走，靠 login.css 里的椭圆渐变遮罩
          把外圈完全淡出来遮住 —— 它始终贴边移动，不进中心。 */}
      <div className="ambient" aria-hidden="true" />
      <VideoBackdrop
        poster="/visuals/login-island.jpg"
        sources={[
          { src: "/visuals/login-island.webm", type: "video/webm" },
          { src: "/visuals/login-island.mp4", type: "video/mp4" },
        ]}
      />
      <span className="light-beam" aria-hidden="true" />
      {/* 同心环从岛屿位置向外扩散，呼应视频里那束光。 */}
      <span className="login__halo">
        <Halo />
      </span>
      {/* 贴底的声波条，给画面持续的动，也点题"这是个音乐应用"。 */}
      <SoundField />
      <div className="login__scrim" aria-hidden="true" />

      <div className="login__grid">
        {/* --- 左栏：产品是什么 --- */}
        <section className="login__intro">
          <div className="login__brand enter enter-1">
            <img src={BRAND.mark} alt="" className="login__mark float" />
            <span className="login__wordmark">
              {BRAND.name}
              <b aria-hidden="true">|</b>
              {BRAND.cnName}
            </span>
          </div>

          <div className="enter enter-2">
            <LiveBadge>{ready ? "服务已就绪" : "正在连接本地服务"}</LiveBadge>
          </div>

          <h1 className="login__headline enter enter-3">
            让散落的音乐，
            <br />
            回到自己的<span>岛屿</span>。
          </h1>

          <p className="login__lead enter enter-4">
            把 NAS 上的音乐、Plex 资料库和歌单收在一处，随时接着听。
          </p>

          <ul className="login__highlights enter enter-5">
            {HIGHLIGHTS.map(({ icon: Icon, title, desc }) => (
              <li key={title}>
                <span className="login__highlight-icon">
                  <Icon />
                </span>
                <span>
                  <strong>{title}</strong>
                  <small>{desc}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* --- 右栏：登录 --- */}
        <section className="login__card-wrap enter enter-3">
          <div className="login__card glass glass--thick glow-ring">
            <div className="login__card-head">
              <h2>欢迎回来</h2>
              <p>用你的账号继续</p>
            </div>

            <form className="login__form" onSubmit={submit}>
              <Field
                label="用户名"
                leading={User}
                name="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck="false"
                enterKeyHint="next"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />

              <Field
                label="密码"
                leading={KeyRound}
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                enterKeyHint="go"
                placeholder="输入密码"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                trailing={
                  <IconButton
                    icon={showPassword ? EyeOff : Eye}
                    label={showPassword ? "隐藏密码" : "显示密码"}
                    size="sm"
                    onClick={() => setShowPassword((value) => !value)}
                  />
                }
              />

              {error && (
                <Notice tone="danger" icon={CircleAlert}>
                  {error}
                </Notice>
              )}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                block
                loading={busy}
                disabled={!password}
              >
                {busy ? "正在登录" : "登录"}
              </Button>
            </form>

            <div className="login__card-foot">
              <button
                type="button"
                onClick={() =>
                  setError(
                    "重置密码需要在运行这个服务的机器上操作，步骤见部署文档的「恢复管理员访问」。",
                  )
                }
              >
                忘记密码了？
              </button>
              <span>登录状态只保存在这台设备</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
