import { Activity, ArrowDownToLine, Check, Download, FolderTree, Image, KeyRound, Library, ListMusic, Music2, Palette, Play, Plus, Radio, RefreshCw, RotateCcw, ScrollText, Server, Settings, ShieldCheck, Tags, TestTube2, UserRound, WandSparkles } from "lucide-react";
import React, { useEffect, useState } from "react";
import { Button, ButtonGroup, buttonClass } from "../../components/ui/Button";
import { Notice } from "../../components/ui/Field";
import { EmptyState, Page } from "../../components/ui/Layout";
import { Modal } from "../../components/ui/Modal";
import { PageLoader } from "../../components/PageLoader";
import { SettingBlock } from "../../components/SettingBlock";
import { BRAND } from "../../config/brand";
import { api } from "../../lib/api";
import { DEFAULT_APPEARANCE, normalizeAppearance } from "../../lib/appearance";
import { timeAgo } from "../../lib/format";
import { PlexSettingsModal } from "./PlexSettingsModal";
import { UserAccounts } from "./UserAccounts";

const ADMIN_SETTINGS_TAB_IDS = [
  "plex",
  "paths",
  "ingest",
  "scrape",
  "naming",
  "exclude",
  "appearance",
  "player",
  "user",
  "logs",
];

const LISTENER_SETTINGS_TAB_IDS = ["appearance", "user"];

export function SettingsPage({
  settings,
  logout,
  navigate,
  isAdmin = true,
  initialTab = "",
  onTabChange,
  onSettingsChange,
  appearance = DEFAULT_APPEARANCE,
  onAppearanceChange,
}) {
  const allowedTabIds = isAdmin
    ? ADMIN_SETTINGS_TAB_IDS
    : LISTENER_SETTINGS_TAB_IDS;
  const resolveTab = (value) =>
    allowedTabIds.includes(value) ? value : allowedTabIds[0];
  const [current, setCurrent] = useState(""),
    [next, setNext] = useState(""),
    [message, setMessage] = useState("");
  const [tab, setTab] = useState(() => resolveTab(initialTab)),
    [draft, setDraft] = useState({}),
    [plexOpen, setPlexOpen] = useState(false),
    [plex, setPlex] = useState(settings.plex || {});
  const [profile, setProfile] = useState(settings.user || {}),
    [logs, setLogs] = useState(null),
    [logsLoading, setLogsLoading] = useState(false);
  const [fnosDraft, setFnosDraft] = useState({
    serverUrl: settings.fnosMusic?.serverUrl || "",
    authMode: settings.fnosMusic?.authMode || "password",
    username: settings.fnosMusic?.accountLabel || "",
    password: "",
    token: "",
  });
  const [backups, setBackups] = useState([]),
    [backupBusy, setBackupBusy] = useState(""),
    // 要恢复的那份备份。全站最后一个原生 confirm() 就在这里 ——
    // 它是破坏性最大的操作（设置回滚 + 强制登出），却只有一行系统弹窗，
    // 既说不清会丢什么，也不能取消到一半。
    [restoring, setRestoring] = useState(null);
  const defaultPlayerPrefs = {
    defaultSource: "local_first",
    remoteBitrate: "320k",
    autoTranscode: false,
    showLyrics: true,
    blurBackground: true,
    extractColor: true,
  };
  const [playerPrefs, setPlayerPrefs] = useState({
    ...defaultPlayerPrefs,
    ...(settings.player || {}),
  });
  const appearancePrefs = normalizeAppearance(appearance);
  const updateAppearance = (key, value) =>
    onAppearanceChange?.({ ...appearancePrefs, [key]: value });
  useEffect(() => {
    setDraft(settings || {});
    setPlex(settings.plex || {});
    setProfile(settings.user || {});
    setFnosDraft((value) => ({
      ...value,
      serverUrl: settings.fnosMusic?.serverUrl || "",
      authMode: settings.fnosMusic?.authMode || "password",
      username: settings.fnosMusic?.accountLabel || "",
      password: "",
      token: "",
    }));
    setPlayerPrefs({ ...defaultPlayerPrefs, ...(settings.player || {}) });
  }, [settings]);
  useEffect(() => {
    setTab(resolveTab(initialTab));
  }, [initialTab, isAdmin]);
  const changeTab = (value) => {
    const nextTab = resolveTab(value);
    setTab(nextTab);
    onTabChange?.(nextTab);
  };
  const change = async (event) => {
    event.preventDefault();
    setMessage("");
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      setMessage("密码已更新，请重新登录");
      setTimeout(logout, 1200);
    } catch (err) {
      setMessage(err.message);
    }
  };
  const save = async () => {
    if (!isAdmin) return setMessage("当前账号没有修改系统设置权限");
    await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ values: draft }),
    });
    setMessage("设置已保存");
  };
  const savePlayerPrefs = async () => {
    if (!isAdmin) return setMessage("当前账号没有修改播放器全局偏好权限");
    const values = { ...draft, player: playerPrefs };
    await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ values }),
    });
    setDraft(values);
    setMessage("已保存，播放器那边马上生效");
  };
  const togglePlayerPref = (key) =>
    setPlayerPrefs((value) => ({ ...value, [key]: !value[key] }));
  const saveProfile = async (values) => {
    const result = await api("/api/profile", {
      method: "PATCH",
      body: JSON.stringify({ values }),
    });
    setProfile(result.profile);
    onSettingsChange?.((value) => ({ ...value, user: result.profile }));
    setMessage("个人资料已保存");
  };
  const uploadAvatar = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const body = new FormData();
    body.append("file", file);
    try {
      const result = await api("/api/profile/avatar", { method: "POST", body });
      setProfile(result.profile);
      setMessage("头像已换好");
    } catch (err) {
      setMessage(err.message);
    } finally {
      event.target.value = "";
    }
  };
  const loadLogs = async () => {
    if (!isAdmin) return;
    setLogsLoading(true);
    try {
      setLogs(await api("/api/logs/summary?limit=120"));
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLogsLoading(false);
    }
  };
  const loadBackups = async () => {
    try {
      const data = await api("/api/backups");
      setBackups(data.items || []);
    } catch (err) {
      setMessage(err.message);
    }
  };
  const createBackup = async () => {
    setBackupBusy("create");
    try {
      await api("/api/backups", { method: "POST" });
      setMessage("数据库备份已创建");
      await loadBackups();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBackupBusy("");
    }
  };
  const restoreBackup = async (item) => {
    setRestoring(null);
    setBackupBusy(item.name);
    try {
      const result = await api(
        `/api/backups/${encodeURIComponent(item.name)}/restore`,
        { method: "POST" },
      );
      setMessage(result.message);
      setTimeout(logout, 1200);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBackupBusy("");
    }
  };
  useEffect(() => {
    if (tab === "logs") {
      if (!logs) loadLogs();
      loadBackups();
    }
  }, [tab]);
  const refreshPlex = async () => setPlex(await api("/api/settings/plex"));
  const syncPlex = async () => {
    try {
      await api("/api/plex/sync", { method: "POST" });
      setMessage("Plex 同步任务已加入队列");
    } catch (err) {
      setMessage(err.message);
    }
  };
  const testSavedPlex = async () => {
    try {
      const result = await api("/api/plex/test", {
        method: "POST",
        body: JSON.stringify({ serverUrl: plex.serverUrl, token: "" }),
      });
      setMessage(result.message || "Plex 连接成功");
      await refreshPlex();
    } catch (err) {
      setMessage(err.message);
    }
  };
  const testFnosMusic = async () => {
    try {
      const result = await api("/api/settings/fnos/test", { method: "POST" });
      setMessage(result.message || "飞牛音乐连接成功");
    } catch (err) {
      setMessage(err.message);
    }
  };
  const saveFnosMusic = async () => {
    if (!isAdmin) return setMessage("当前账号没有修改连接的权限");
    try {
      const result = await api("/api/settings/fnos", {
        method: "POST",
        body: JSON.stringify(fnosDraft),
      });
      setFnosDraft((value) => ({
        ...value,
        password: "",
        token: "",
        ...result.fnosMusic,
        username: result.fnosMusic?.accountLabel || value.username,
      }));
      onSettingsChange?.((value) => ({
        ...value,
        fnosMusic: result.fnosMusic,
      }));
      setMessage(result.message || "飞牛音乐连接已保存");
    } catch (err) {
      setMessage(err.message);
    }
  };
  const tabs = isAdmin
    ? [
        { id: "plex", label: "Plex 连接", icon: Server, group: "连接与存储" },
        { id: "paths", label: "媒体目录", icon: FolderTree, group: "连接与存储" },
        { id: "ingest", label: "下载入库规则", icon: ArrowDownToLine, group: "整理规则" },
        { id: "scrape", label: "元数据规则", icon: WandSparkles, group: "整理规则" },
        { id: "naming", label: "文件命名", icon: Tags, group: "整理规则" },
        { id: "exclude", label: "扫描排除", icon: ShieldCheck, group: "整理规则" },
        { id: "appearance", label: "外观与主题", icon: Palette, group: "体验" },
        { id: "player", label: "播放与歌词", icon: Play, group: "体验" },
        { id: "user", label: "用户与安全", icon: UserRound, group: "账户与系统" },
        { id: "logs", label: "备份与日志", icon: ScrollText, group: "账户与系统" },
      ]
    : [
        { id: "appearance", label: "外观与主题", icon: Palette, group: "体验" },
        { id: "user", label: "用户与安全", icon: UserRound, group: "账户" },
      ];
  const templates = draft.namingTemplates || settings.namingTemplates || {};
  const scrapeRules = draft.scrapeRules || settings.scrapeRules || {
    defaultMode: "missing",
    writeCover: true,
    writeLyrics: true,
    refreshPlex: true,
    skipExistingCover: true,
    skipExistingLyrics: true,
  };
  const templateLabels = {
    album: "普通专辑",
    multiDisc: "多碟专辑",
    compilation: "合辑",
    unknown: "信息不完整",
  };
  const templateExample = (value) =>
    String(value || "")
      .replaceAll("{artist}", "周杰伦")
      .replaceAll("{album}", "叶惠美")
      .replaceAll("{year}", "2003")
      .replaceAll("{discNumber}", "2")
      .replaceAll("{trackNumber}", "03")
      .replaceAll("{title}", "晴天")
      .replaceAll("{ext}", "flac");
  return (
    <Page className="settings-page">
      <nav className="settings-tabs" aria-label="设置分类">
        {tabs.map((item, index) => {
          const Icon = item.icon;
          const showGroup = index === 0 || tabs[index - 1].group !== item.group;
          return (
            <React.Fragment key={item.id}>
              {showGroup && <span className="settings-tab-group">{item.group}</span>}
              <button
                className={tab === item.id ? "active" : ""}
                onClick={() => changeTab(item.id)}
              >
                <Icon />
                {item.label}
              </button>
            </React.Fragment>
          );
        })}
      </nav>
      <section className="settings-workbench">
        {message && (
          <Notice tone="success" icon={ShieldCheck}>
            {message}
          </Notice>
        )}
        {tab === "plex" && (
          <div className="settings-grid">
            <SettingBlock
              icon={Server}
              title="Plex 连接"
              note="接入 Plex 曲库，并可遥控 Plexamp"
            >
              <dl>
                <div>
                  <dt>启用状态</dt>
                  <dd>{plex.enabled ? "已启用" : "未启用"}</dd>
                </div>
                <div>
                  <dt>服务器名称</dt>
                  <dd>{plex.name || settings.plexServerName}</dd>
                </div>
                <div>
                  <dt>Plex 地址</dt>
                  <dd>{plex.serverUrl || settings.plexUrl}</dd>
                </div>
                <div>
                  <dt>外网播放地址</dt>
                  <dd>{plex.externalUrl || settings.externalPlexUrl}</dd>
                </div>
                <div>
                  <dt>Token</dt>
                  <dd>{plex.hasToken ? "已保存" : "未保存"}</dd>
                </div>
                <div>
                  <dt>同步媒体库</dt>
                  <dd>
                    {plex.selectedLibraryKeys === "all"
                      ? "全部音乐库"
                      : (plex.selectedLibraryKeys || []).join(", ") ||
                        "未选择"}{" "}
                    · {plex.syncedLibraryCount || 0} 个
                  </dd>
                </div>
                <div>
                  <dt>最近连接</dt>
                  <dd>
                    {plex.lastConnectedAt
                      ? timeAgo(plex.lastConnectedAt)
                      : "尚未测试"}
                  </dd>
                </div>
                <div>
                  <dt>最近同步</dt>
                  <dd>
                    {plex.lastSyncAt ? timeAgo(plex.lastSyncAt) : "尚未同步"}
                  </dd>
                </div>
              </dl>
              <ButtonGroup wrap>
                <Button
                  size="sm"
                  variant="primary"
                  icon={Settings}
                  onClick={() => setPlexOpen(true)}
                >
                  配置 Plex
                </Button>
                <Button size="sm" icon={TestTube2} onClick={testSavedPlex}>
                  测试连接
                </Button>
                <Button size="sm" icon={RefreshCw} onClick={syncPlex}>
                  立即同步
                </Button>
              </ButtonGroup>
            </SettingBlock>
            <SettingBlock
              icon={Library}
              title="Plex 音乐资料库"
              note="只同步勾选的音乐库"
            >
              {plex.libraries?.length ? (
                <div className="plex-library-chips">
                  {plex.libraries.map((item) => (
                    <span
                      key={item.key}
                      className={item.enabled ? "active" : ""}
                    >
                      {item.title}
                      <small>#{item.key}</small>
                    </span>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={Library}
                  title="未读取到音乐库"
                  text="连接 Plex 后自动列出"
                />
              )}
            </SettingBlock>
            <SettingBlock
              icon={Radio}
              title="飞牛音乐"
              note="歌单可按原顺序同步"
            >
              <dl>
                <div>
                  <dt>服务地址</dt>
                  <dd>{settings.fnosMusic?.serverUrl || "未配置"}</dd>
                </div>
                <div>
                  <dt>连接状态</dt>
                  <dd>{settings.fnosMusic?.configured ? "已连接" : "待配置"}</dd>
                </div>
                <div>
                  <dt>认证方式</dt>
                  <dd>
                    {settings.fnosMusic?.configured
                      ? settings.fnosMusic?.authMode === "password"
                        ? "飞牛音乐账号"
                        : "服务令牌"
                      : "飞牛音乐账号或服务令牌"}
                  </dd>
                </div>
              </dl>
              <div className="fnos-config-form">
                <label>
                  服务地址
                  <input
                    value={fnosDraft.serverUrl}
                    placeholder="http://NAS地址:5666"
                    onChange={(event) =>
                      setFnosDraft((value) => ({
                        ...value,
                        serverUrl: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  认证方式
                  <select
                    value={fnosDraft.authMode}
                    onChange={(event) =>
                      setFnosDraft((value) => ({
                        ...value,
                        authMode: event.target.value,
                        password: "",
                        token: "",
                      }))
                    }
                  >
                    <option value="password">飞牛音乐账号</option>
                    <option value="token">服务令牌</option>
                  </select>
                </label>
                {fnosDraft.authMode === "password" ? (
                  <>
                    <label>
                      飞牛音乐账号
                      <input
                        autoComplete="username"
                        value={fnosDraft.username}
                        onChange={(event) =>
                          setFnosDraft((value) => ({
                            ...value,
                            username: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      飞牛音乐密码
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={fnosDraft.password}
                        placeholder={
                          settings.fnosMusic?.configured
                            ? "重新连接时输入"
                            : "仅用于换取服务会话"
                        }
                        onChange={(event) =>
                          setFnosDraft((value) => ({
                            ...value,
                            password: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </>
                ) : (
                  <label className="fnos-token-field">
                    服务令牌
                    <input
                      type="password"
                      autoComplete="off"
                      value={fnosDraft.token}
                      placeholder={
                        settings.fnosMusic?.configured
                          ? "如需替换请输入新令牌"
                          : "music-token"
                      }
                      onChange={(event) =>
                        setFnosDraft((value) => ({
                          ...value,
                          token: event.target.value,
                        }))
                      }
                    />
                  </label>
                )}
              </div>
              <p className="setting-explainer">
                账号密码只用于向飞牛音乐换取服务会话，密码不会保存。派生令牌保存在
                NAS 的受保护数据目录中，也不会回显到页面。
              </p>
              <ButtonGroup wrap>
                <Button size="sm" variant="primary" icon={Check} onClick={saveFnosMusic}>
                  保存并连接
                </Button>
                <Button
                  size="sm"
                  icon={TestTube2}
                  onClick={testFnosMusic}
                  disabled={!settings.fnosMusic?.configured}
                >
                  测试连接
                </Button>
                <Button
                  size="sm"
                  icon={ListMusic}
                  onClick={() => navigate?.("playlists")}
                >
                  打开歌单
                </Button>
              </ButtonGroup>
            </SettingBlock>
            <SettingBlock
              icon={Activity}
              title="系统信息"
              note="反馈问题时请附带"
            >
              <dl>
                <div>
                  <dt>产品</dt>
                  <dd>{BRAND.fullName}</dd>
                </div>
                <div>
                  <dt>版本</dt>
                  <dd>v{settings.version || BRAND.version}</dd>
                </div>
                <div>
                  <dt>音乐源文件限制</dt>
                  <dd>{settings.sourceMaxSizeMb} MB</dd>
                </div>
                <div>
                  <dt>单音频限制</dt>
                  <dd>{settings.maxDownloadMb} MB</dd>
                </div>
              </dl>
            </SettingBlock>
          </div>
        )}
        {tab === "paths" && (
          <div className="settings-grid">
            <SettingBlock
              icon={FolderTree}
              title="本地路径"
              note="读写范围仅限这几个目录"
            >
              <dl>
                <div>
                  <dt>正式音乐库</dt>
                  <dd>{settings.musicRoot}</dd>
                </div>
                <div>
                  <dt>授权下载暂存区</dt>
                  <dd>{settings.downloadTempDir}</dd>
                </div>
                <div>
                  <dt>下载处理中转区</dt>
                  <dd>{settings.incomingDir}</dd>
                </div>
                <div>
                  <dt>下载接收目录</dt>
                  <dd>{settings.manualDownloadDir}</dd>
                </div>
                <div>
                  <dt>音乐库回收站</dt>
                  <dd>{settings.trashDir}</dd>
                </div>
                <div>
                  <dt>下载回收站</dt>
                  <dd>{settings.downloadTrashDir}</dd>
                </div>
              </dl>
            </SettingBlock>
            <SettingBlock
              icon={Image}
              title="保存规则"
              note="封面与歌词的存放位置"
            >
              <dl>
                <div>
                  <dt>歌词保存</dt>
                  <dd>{settings.lyricRule}</dd>
                </div>
                <div>
                  <dt>封面保存</dt>
                  <dd>{settings.coverRule}</dd>
                </div>
              </dl>
            </SettingBlock>
          </div>
        )}
        {tab === "ingest" && (
          <div className="settings-grid">
            <SettingBlock
              icon={Download}
              title="下载与入库"
              note="先入暂存区，确认后进曲库"
            >
              <dl>
                <div>
                  <dt>临时下载</dt>
                  <dd>{settings.downloadTempDir}</dd>
                </div>
                <div>
                  <dt>待入库</dt>
                  <dd>{settings.incomingDir}</dd>
                </div>
                <div>
                  <dt>正式曲库</dt>
                  <dd>{settings.musicRoot}</dd>
                </div>
              </dl>
              <Button
                size="sm"
                variant="primary"
                icon={Check}
                onClick={() => navigate?.("download")}
              >
                打开暂存区
              </Button>
            </SettingBlock>
            <SettingBlock
              icon={RotateCcw}
              title="撤销与回滚"
              note="标签、移动、入库都保留原值"
            >
              <p className="setting-copy">
                每次改动都能在「文件与标签 → 改动历史」里逐条退回去。
                入库前会先检查目标位置有没有冲突；不要的歌取消入库会挪到回收站，
                不会直接删掉。
              </p>
            </SettingBlock>
          </div>
        )}
        {tab === "scrape" && (
          <SettingBlock
            icon={WandSparkles}
            title="刮削规则"
            note="默认值 · 每次执行可单独调整"
          >
            <div className="settings-switches">
              <label>
                默认模式
                <select
                  value={scrapeRules.defaultMode}
                  onChange={(e) => setDraft((value) => ({ ...value, scrapeRules: { ...scrapeRules, defaultMode: e.target.value } }))}
                >
                  <option value="missing">只补缺失</option>
                  <option value="incremental">增量更新</option>
                  <option value="refresh">全量刷新</option>
                  <option value="force">强制覆盖</option>
                </select>
              </label>
              {[
                ["写入 cover.jpg", "writeCover"],
                ["写入同名 .lrc", "writeLyrics"],
                ["完成后刷新 Plex", "refreshPlex"],
                ["跳过已有封面", "skipExistingCover"],
                ["跳过已有歌词", "skipExistingLyrics"],
              ].map(([label, key]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={!!scrapeRules[key]}
                    onChange={() => setDraft((value) => ({ ...value, scrapeRules: { ...scrapeRules, [key]: !scrapeRules[key] } }))}
                  />
                  {label}
                </label>
              ))}
            </div>
            <Button size="sm" icon={Check} onClick={save}>
              保存
            </Button>
          </SettingBlock>
        )}
        {tab === "naming" && (
          <SettingBlock
            icon={Tags}
            title="命名规则"
            note="整理目录时的目标路径模板"
          >
            <div className="template-list">
              {Object.entries(templates).map(([key, value]) => (
                <label key={key}>
                  {templateLabels[key] || key}
                  <input
                    value={value}
                    onChange={(e) =>
                      setDraft((v) => ({
                        ...v,
                        namingTemplates: {
                          ...(v.namingTemplates || templates),
                          [key]: e.target.value,
                        },
                      }))
                    }
                  />
                  <small>
                    示例：
                    {templateExample(value)}
                  </small>
                </label>
              ))}
            </div>
            <Button size="sm" icon={Check} onClick={save}>
              保存
            </Button>
          </SettingBlock>
        )}
        {tab === "exclude" && (
          <SettingBlock
            icon={ShieldCheck}
            title="扫描排除规则"
            note="扫描时跳过这些目录"
          >
            <label className="exclude-editor">
              每行一个目录
              <textarea
                value={(draft.excludeDirs || settings.excludeDirs || []).join(
                  "\n",
                )}
                onChange={(event) =>
                  setDraft((value) => ({
                    ...value,
                    excludeDirs: event.target.value
                      .split(/\r?\n/)
                      .map((item) => item.trim())
                      .filter(Boolean),
                  }))
                }
              />
            </label>
            <Button size="sm" icon={Check} onClick={save}>
              保存
            </Button>
          </SettingBlock>
        )}
        {tab === "appearance" && (
          <div className="settings-grid appearance-settings-grid">
            <SettingBlock
              icon={Palette}
              title="外观与主题"
              note="实时预览 · 仅本设备"
            >
              <div className="theme-choice" role="group" aria-label="界面主题">
                {[
                  ["system", "跟随系统"],
                  ["dark", "深色"],
                  ["light", "浅色"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    className={appearancePrefs.theme === value ? "active" : ""}
                    onClick={() => updateAppearance("theme", value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="appearance-sliders">
                {[
                  ["玻璃模糊度", "glassBlur", 8, 44, 1, "px"],
                  ["玻璃透明度", "glassOpacity", 0.2, 0.88, 0.01, "%"],
                  ["背景模糊度", "backdropBlur", 0, 36, 1, "px"],
                  ["背景图可见度", "backdropOpacity", 0.18, 0.9, 0.01, "%"],
                  ["字号大小", "fontScale", 0.9, 1.25, 0.01, "%"],
                  ["圆角大小", "cornerRadius", 12, 32, 1, "px"],
                  ["色彩饱和度", "saturation", 80, 190, 1, "%"],
                  ["动效强度", "motion", 0, 1.2, 0.05, "%"],
                ].map(([label, key, min, max, step, unit]) => {
                  const value = appearancePrefs[key];
                  const formatted =
                    unit === "%"
                      ? `${Math.round(value * (key === "saturation" ? 1 : 100))}%`
                      : `${Math.round(value)}${unit}`;
                  return (
                    <label className="appearance-range" key={key}>
                      <span>
                        <b>{label}</b>
                        <output>{formatted}</output>
                      </span>
                      <input
                        type="range"
                        min={min}
                        max={max}
                        step={step}
                        value={value}
                        onChange={(event) =>
                          updateAppearance(key, Number(event.target.value))
                        }
                      />
                    </label>
                  );
                })}
              </div>
              <div className="appearance-live-preview" aria-label="外观设置实时预览">
                <div className="appearance-preview-panel">
                  <span className="appearance-preview-icon"><Music2 /></span>
                  <span className="appearance-preview-copy">
                    <strong>实时预览</strong>
                    <small>拖动滑块时，模糊、透明度、字号、圆角与色彩会立即变化</small>
                  </span>
                  <span className="appearance-preview-chip">正在生效</span>
                </div>
              </div>
              <ButtonGroup wrap>
                <Button
                  size="sm"
                  icon={RotateCcw}
                  onClick={() => onAppearanceChange?.(DEFAULT_APPEARANCE)}
                >
                  恢复推荐值
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  icon={Check}
                  onClick={() => setMessage("外观偏好已保存在当前设备")}
                >
                  完成
                </Button>
              </ButtonGroup>
            </SettingBlock>
          </div>
        )}
        {tab === "player" && (
          <SettingBlock
            icon={Play}
            title="播放器设置"
            note="随账号同步"
          >
            <div className="settings-switches">
              {[
                ["本地优先", "defaultSource", true],
                ["远程默认 320K", "remoteBitrate", true],
                ["自动转码", "autoTranscode"],
                ["显示歌词", "showLyrics"],
                ["背景低模糊", "blurBackground"],
                ["封面取色", "extractColor"],
              ].map(([label, key, derived]) => (
                <label
                  key={key}
                  title={
                    derived ? "改了要保存才生效" : "可以直接保存"
                  }
                >
                  <input
                    type="checkbox"
                    checked={
                      key === "defaultSource"
                        ? playerPrefs.defaultSource === "local_first"
                        : key === "remoteBitrate"
                          ? playerPrefs.remoteBitrate === "320k"
                          : !!playerPrefs[key]
                    }
                    onChange={() =>
                      key === "defaultSource"
                        ? setPlayerPrefs((v) => ({
                            ...v,
                            defaultSource:
                              v.defaultSource === "local_first"
                                ? "plex_first"
                                : "local_first",
                          }))
                        : key === "remoteBitrate"
                          ? setPlayerPrefs((v) => ({
                              ...v,
                              remoteBitrate:
                                v.remoteBitrate === "320k"
                                  ? "original"
                                  : "320k",
                            }))
                          : togglePlayerPref(key)
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <ButtonGroup wrap>
              <Button size="sm" variant="primary" icon={Check} onClick={savePlayerPrefs}>
                保存
              </Button>
              <Button size="sm" icon={Play} onClick={() => navigate?.("player")}>
                打开播放器
              </Button>
            </ButtonGroup>
          </SettingBlock>
        )}
        {tab === "user" && (
          <div className="settings-grid">
            <SettingBlock
              icon={UserRound}
              title="用户偏好"
              note="仅影响当前账号"
            >
              <div className="profile-card">
                <div className="profile-avatar">
                  {profile?.avatarUrl ? (
                    <img src={profile.avatarUrl} alt="" />
                  ) : (
                    <UserRound />
                  )}
                </div>
                <div>
                  <strong>
                    {profile?.displayName || settings.user?.username || "admin"}
                  </strong>
                  <span>@{settings.user?.username || "admin"}</span>
                  {/* 是 <label> 而不是 <button>：点它要触发里面那个
                      隐藏的 file input。借按钮外观，语义保持 label。 */}
                  <label
                    className={buttonClass({ size: "sm", extra: "avatar-upload" })}
                  >
                    <Image className="ui-btn__icon" aria-hidden="true" />
                    <span className="ui-btn__label">更换头像</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={uploadAvatar}
                    />
                  </label>
                </div>
              </div>
              <div className="profile-form">
                <label>
                  显示名称
                  <input
                    value={profile?.displayName || ""}
                    onChange={(e) =>
                      setProfile((v) => ({ ...v, displayName: e.target.value }))
                    }
                  />
                </label>
                <label>
                  默认音源
                  <select
                    value={profile?.defaultSource || "tx"}
                    onChange={(e) =>
                      setProfile((v) => ({
                        ...v,
                        defaultSource: e.target.value,
                      }))
                    }
                  >
                    <option value="tx">QQ 音乐</option>
                    <option value="wy">网易云</option>
                  </select>
                </label>
                <label>
                  默认音质
                  <select
                    value={profile?.defaultQuality || "320k"}
                    onChange={(e) =>
                      setProfile((v) => ({
                        ...v,
                        defaultQuality: e.target.value,
                      }))
                    }
                  >
                    <option value="128k">128K</option>
                    <option value="320k">320K</option>
                    <option value="flac">FLAC</option>
                    <option value="flac24bit">Hi-Res</option>
                  </select>
                </label>
                <label>
                  界面字号
                  <select
                    value={profile?.fontSize || "standard"}
                    onChange={(e) =>
                      setProfile((value) => ({
                        ...value,
                        fontSize: e.target.value,
                      }))
                    }
                  >
                    <option value="compact">紧凑</option>
                    <option value="standard">标准</option>
                    <option value="large">大号</option>
                  </select>
                </label>
                <Button size="sm" icon={Check} onClick={() => saveProfile(profile)}>
                  保存
                </Button>
              </div>
            </SettingBlock>
            <section className="setting-card">
              <div className="setting-title">
                <KeyRound />
                <div>
                  <h3>修改密码</h3>
                  <p>换掉登录音屿用的密码。改完需要重新登录一次。</p>
                </div>
              </div>
              <form className="password-form" onSubmit={change}>
                <label>
                  当前密码
                  <input
                    type="password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                  />
                </label>
                <label>
                  新密码
                  <input
                    type="password"
                    minLength="10"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    placeholder="至少 10 个字符"
                  />
                </label>
                {message && <p className="form-message">{message}</p>}
                {/* 这个在 <form onSubmit> 里，必须是 submit 才能回车提交。 */}
                <Button type="submit" icon={ShieldCheck}>
                  更新密码
                </Button>
              </form>
            </section>
          </div>
        )}
        {tab === "logs" && (
          <>
            <SettingBlock
              icon={ShieldCheck}
              title="备份与恢复"
              note="账号与设置 · 不含音乐文件"
            >
              <div className="backup-toolbar">
                <Button
                  size="sm"
                  variant="primary"
                  icon={Plus}
                  loading={backupBusy === "create"}
                  disabled={!!backupBusy}
                  onClick={createBackup}
                >
                  创建备份
                </Button>
                <span>备份保存在 NAS 的 /data/backups</span>
              </div>
              <div className="backup-list">
                {backups.length ? (
                  backups.map((item) => (
                    <div key={item.name}>
                      <ShieldCheck />
                      <div>
                        <strong>{item.name}</strong>
                        <span>
                          {new Date(item.createdAt).toLocaleString("zh-CN")} ·{" "}
                          {(item.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                      </div>
                      {/* 是 <a download> 而不是按钮：走浏览器自己的下载，
                          不需要 JS 接管。借按钮外观。 */}
                      <a
                        className={buttonClass({ size: "sm" })}
                        href={`/api/backups/${encodeURIComponent(item.name)}/download`}
                      >
                        <Download className="ui-btn__icon" aria-hidden="true" />
                        <span className="ui-btn__label">导出</span>
                      </a>
                      <Button
                        size="sm"
                        icon={RotateCcw}
                        loading={backupBusy === item.name}
                        disabled={!!backupBusy}
                        onClick={() => setRestoring(item)}
                      >
                        恢复
                      </Button>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    icon={ShieldCheck}
                    title="还没有备份"
                    text="创建一份备份，换机器或出问题时可恢复"
                  />
                )}
              </div>
            </SettingBlock>
            <SettingBlock
              icon={ScrollText}
              title="运行日志"
              note="排查问题从这里开始"
            >
              <div className="log-toolbar">
                <Button
                  size="sm"
                  icon={RefreshCw}
                  loading={logsLoading}
                  onClick={loadLogs}
                >
                  刷新日志
                </Button>
                <span>
                  {logs?.updatedAt
                    ? `更新于 ${new Date(logs.updatedAt).toLocaleString("zh-CN")}`
                    : "点击刷新读取日志"}
                </span>
              </div>
              {logsLoading ? (
                <PageLoader />
              ) : (
                <div className="settings-log-grid">
                  <div>
                    <h3>任务日志</h3>
                    {(logs?.jobLogs || []).slice(0, 30).map((item) => (
                      <div className={`log-line ${item.level}`} key={item.id}>
                        <time>
                          {new Date(item.created_at).toLocaleString("zh-CN")}
                        </time>
                        <strong>
                          {item.job_title || item.job_kind || "任务"}
                        </strong>
                        <span>{item.message}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h3>音乐源日志</h3>
                    {(logs?.sourceLogs || []).slice(0, 30).map((item) => (
                      <div className={`log-line ${item.level}`} key={item.id}>
                        <time>
                          {new Date(item.created_at).toLocaleString("zh-CN")}
                        </time>
                        <strong>{item.source_name || item.action}</strong>
                        <span>{item.message}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h3>操作与回滚</h3>
                    {(logs?.operations || []).slice(0, 30).map((item) => (
                      <div className={`log-line ${item.status}`} key={item.id}>
                        <time>
                          {new Date(item.created_at).toLocaleString("zh-CN")}
                        </time>
                        <strong>{item.action}</strong>
                        <span>
                          {item.target_id || item.error_message || "已记录"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </SettingBlock>
          </>
        )}
        {isAdmin && tab === "user" && <UserAccounts />}
      </section>
      <Modal
        open={!!restoring}
        onClose={() => setRestoring(null)}
        title="恢复这份备份？"
        size="sm"
        actions={
          <ButtonGroup align="end">
            <Button onClick={() => setRestoring(null)}>取消</Button>
            <Button
              variant="danger"
              icon={RotateCcw}
              onClick={() => restoreBackup(restoring)}
            >
              确认恢复
            </Button>
          </ButtonGroup>
        }
      >
        {restoring && (
          <>
            <p className="restore-target">
              <ShieldCheck aria-hidden="true" />
              <span>
                <strong>{restoring.name}</strong>
                <small>
                  {new Date(restoring.createdAt).toLocaleString("zh-CN")}
                </small>
              </span>
            </p>
            {/* 用"会 / 不会"两栏说清代价。原来的 confirm 把这些
                挤在一行文字里，用户点确定时其实没读完。 */}
            <dl className="restore-impact">
              <div>
                <dt>会回到备份时的状态</dt>
                <dd>账号与权限、Plex 与音源配置、命名与刮削规则、外观偏好</dd>
              </div>
              <div>
                <dt>不会动</dt>
                <dd>音乐文件本身，一个字节都不改</dd>
              </div>
              <div className="restore-impact__warn">
                <dt>会丢</dt>
                <dd>
                  {new Date(restoring.createdAt).toLocaleString("zh-CN")}{" "}
                  之后改的设置，找不回来
                </dd>
              </div>
            </dl>
            <p className="restore-note">恢复完会退出登录，用新的密码重新进。</p>
          </>
        )}
      </Modal>

      {isAdmin && plexOpen && (
        <PlexSettingsModal
          initial={plex}
          onClose={() => setPlexOpen(false)}
          onSaved={async (next) => {
            setPlex(next);
            onSettingsChange?.((value) => ({ ...value, plex: next }));
            setPlexOpen(false);
            setMessage("Plex 配置已保存");
          }}
        />
      )}
    </Page>
  );
}
