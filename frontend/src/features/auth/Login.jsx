/**
 * 登录页。
 *
 * 重构前这里是一张营销落地页：左半屏放大标题、一句产品介绍和四张功能卡
 * （私人曲库 / 连续播放 / 本地优先 / 为你发现），右半屏浮一张登录卡片。
 * 加上顶部 logo，品牌名在同一屏出现三次，还带"YOUR MUSIC, AT HOME"和
 * "SECURE ACCESS"两行英文点缀，按钮写着"进入音屿控制台"。
 * 而且顶部 logo 与左侧标题实际重叠。
 *
 * 登录页只有一个任务：让已经决定要用这个应用的人进去。
 * 功能介绍对着一个正在输密码的人讲没有意义 —— 他早就装好了。
 *
 * 现在：一屏居中、一个品牌标记、两个输入框、一个按钮。
 * 背景是随机取自曲库的一张模糊封面（拿不到就退回纯色渐变），
 * 让人一眼看出这是自己的音乐库，而不是一张通用的粒子壁纸。
 */

import { CircleAlert, Eye, EyeOff, KeyRound, User } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, IconButton } from "../../components/ui/Button";
import { Field, Notice } from "../../components/ui/Field";
import { BRAND } from "../../config/brand";
import { api } from "../../lib/api";

export function Login({ onLogin }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [backdrop, setBackdrop] = useState("");

  /**
   * 登录前是未鉴权状态，取不到曲库封面是正常的，
   * 失败就安静地用纯色背景，不打扰正在登录的人。
   */
  useEffect(() => {
    let cancelled = false;
    api("/api/library/albums?pageSize=12")
      .then((result) => {
        if (cancelled) return;
        const covers = (result.items || [])
          .map((item) => item.thumbUrl)
          .filter(Boolean);
        if (covers.length) {
          setBackdrop(covers[Math.floor(Math.random() * covers.length)]);
        }
      })
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
      <div className="login__backdrop" aria-hidden="true">
        {backdrop && <img src={backdrop} alt="" />}
      </div>

      <div className="login__panel">
        <div className="login__brand">
          <img src={BRAND.mark} alt="" className="login__mark" />
          <p className="login__name">{BRAND.cnName}</p>
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

        <button
          type="button"
          className="login__help"
          onClick={() =>
            setError(
              "重置密码需要在运行这个服务的机器上操作，具体步骤见部署文档里的「恢复管理员访问」。",
            )
          }
        >
          忘记密码了？
        </button>
      </div>
    </main>
  );
}
