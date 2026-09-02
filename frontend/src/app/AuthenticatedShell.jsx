import { useCallback, useEffect, useMemo, useState } from "react";
import { ArtistBackdrop } from "../components/Backdrops";
import { PageLoader } from "../components/PageLoader";
import { Toast } from "../components/Toast";
import { BRAND } from "../config/brand";
import { Dashboard } from "../features/dashboard/Dashboard";
import { DiscoverPage } from "../features/discover/DiscoverPage";
import { LocalLibraryPage } from "../features/library/LocalLibraryPage";
import { MediaLibrary } from "../features/library/MediaLibrary";
import { MePage } from "../features/me/MePage";
import { MiniPlayer } from "../features/player/MiniPlayer";
import { usePlayerCore } from "../features/player/PlayerProvider";
import { PlaylistsPage } from "../features/playlists/PlaylistsPage";
import { GlobalSearchPage } from "../features/search/GlobalSearchPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { MobileNav } from "../features/shell/MobileNav";
import { Sidebar } from "../features/shell/Sidebar";
import { Topbar } from "../features/shell/Topbar";
import { DownloadCenter } from "../features/tools/DownloadCenter";
import { ManagementHub } from "../features/tools/ManagementHub";
import { ScrapeCenter } from "../features/tools/ScrapeCenter";
import { SourceManager } from "../features/tools/SourceManager";
import { Tasks } from "../features/tools/Tasks";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { buildAmbientDeck } from "../lib/ambient";
import { api } from "../lib/api";
import { DEFAULT_APPEARANCE, appearanceStyle, normalizeAppearance, resolvedTheme } from "../lib/appearance";
import { clearFastCache, readFastCache, writeFastCache } from "../lib/cache";
import { managementNav, pageMeta } from "../lib/nav-model";
import { userIsAdmin } from "../lib/permissions";
import { knownPage, libraryDetailFromPath, libraryTabFromPath, pageFromPath, pathForLibraryDetail, pathForLibraryTab, pathForPage, pathForPlaylist, pathForSettingsTab, playlistIdFromPath, settingsTabFromPath } from "../lib/routes";
import { storedJson } from "../lib/storage";
import { NowPlayingRoute } from "./NowPlayingRoute";

export function AuthenticatedShell({ setAuthenticated }) {
  const [active, setActive] = useState(() =>
    pageFromPath(window.location.pathname),
  );
  const [routeRevision, setRouteRevision] = useState(0);
  const [menu, setMenu] = useState(false);
  const [stats, setStats] = useState(() => readFastCache("dashboard", {}));
  const [jobs, setJobs] = useState(() => readFastCache("jobs", []));
  const [sources, setSources] = useState(() => readFastCache("sources", []));
  const [settingsData, setSettingsData] = useState(() =>
    readFastCache("settings", {}),
  );
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [ambientIndex, setAmbientIndex] = useState(0);
  const [ambientDeck, setAmbientDeck] = useState([]);
  const [manualBackdrop, setManualBackdrop] = useState(null);
  const [appearance, setAppearance] = useState(() =>
    normalizeAppearance(storedJson("songlib-appearance", DEFAULT_APPEARANCE)),
  );
  // The shell only needs track identity and stable playback commands. Keeping
  // the high-frequency media clock in the player route and mini players avoids
  // reconciling every page on each HTMLAudioElement timeupdate.
  const player = usePlayerCore();
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const theme = resolvedTheme(appearance.theme, prefersDark);
  // 主题必须落到 :root 上，不能只挂在下面那个 .visual-shell div 上：
  // 设计 token 定义在 :root[data-theme="light"]，而且 color-scheme 只有在
  // 根元素上才会影响滚动条、表单控件和 body 背景。
  // div 上的 data-theme 仍然保留，legacy 样式层还依赖它。
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const changeAppearance = useCallback((value) => {
    const normalized = normalizeAppearance(value);
    setAppearance(normalized);
    try {
      localStorage.setItem("songlib-appearance", JSON.stringify(normalized));
    } catch {
      // Live preview remains available even when persistent storage is blocked.
    }
  }, []);
  const updatePath = useCallback((path, { replace = false } = {}) => {
    if (window.location.pathname === path) return;
    window.history[replace ? "replaceState" : "pushState"]({}, "", path);
  }, []);
  const navigate = useCallback(
    (page, { replace = false } = {}) => {
      const target = knownPage(page) ? page : "home";
      setManualBackdrop(null);
      setActive(target);
      updatePath(pathForPage(target), { replace });
    },
    [updatePath],
  );
  const load = async () => {
    setLoading(true);
    try {
      const [s, cfg, j, src] = await Promise.all([
        api("/api/dashboard"),
        api("/api/settings"),
        api("/api/jobs").catch(() => []),
        api("/api/sources").catch(() => []),
      ]);
      setStats(writeFastCache("dashboard", s));
      setSettingsData(writeFastCache("settings", cfg));
      setJobs(writeFastCache("jobs", Array.isArray(j) ? j : []));
      setSources(writeFastCache("sources", Array.isArray(src) ? src : []));
    } catch (err) {
      if (err.message.includes("登录")) setAuthenticated(false);
      else setToast({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };
  const refreshJobs = async () =>
    setJobs(writeFastCache("jobs", await api("/api/jobs")));
  const refreshSources = useCallback(
    async () =>
      setSources(writeFastCache("sources", await api("/api/sources"))),
    [],
  );
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    const onPopState = () => {
      setManualBackdrop(null);
      setActive(pageFromPath(window.location.pathname));
      setRouteRevision((value) => value + 1);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    const title = pageMeta[active]?.[0];
    document.title = title ? `${title} - ${BRAND.fullName}` : BRAND.fullName;
  }, [active]);
  useEffect(() => {
    const canPoll =
      userIsAdmin(settingsData.user) ||
      settingsData.user?.permissions?.includes("manage_library");
    const jobPages = ["manage", "tasks", "download", "local", "scrape"];
    if (!canPoll || !jobPages.includes(active)) return undefined;
    const refreshVisible = () => {
      if (document.visibilityState === "visible") refreshJobs().catch(() => {});
    };
    const timer = setInterval(refreshVisible, 8000);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [active, settingsData.user?.role, settingsData.user?.permissions?.join("|")]);
  const ambientImages = useMemo(
    () => (Array.isArray(stats?.heroImages) ? stats.heroImages : []),
    [stats?.heroImages],
  );
  useEffect(() => {
    setAmbientDeck(buildAmbientDeck(ambientImages));
    setAmbientIndex(0);
  }, [ambientImages]);
  useEffect(() => {
    if (active === "player" || manualBackdrop || ambientDeck.length < 2)
      return;
    const timer = setInterval(() => {
      if (ambientIndex + 1 < ambientDeck.length) {
        setAmbientIndex(ambientIndex + 1);
      } else {
        setAmbientDeck(buildAmbientDeck(ambientImages));
        setAmbientIndex(0);
      }
    }, 14000);
    return () => clearInterval(timer);
  }, [
    active,
    ambientDeck,
    ambientImages,
    ambientIndex,
    manualBackdrop,
  ]);
  const runJob = async (kind, payload = {}) => {
    try {
      await api("/api/jobs", {
        method: "POST",
        body: JSON.stringify({ kind, payload }),
      });
      setToast({ message: "任务已加入队列" });
      refreshJobs();
      navigate("tasks");
    } catch (err) {
      setToast({ type: "error", message: err.message });
    }
  };
  const createDownload = async (item, sourceId, quality) => {
    try {
      const result = await api("/api/downloads", {
        method: "POST",
        body: JSON.stringify({ item, sourceId, quality }),
      });
      setToast({ message: `《${item.title}》已加入下载队列` });
      refreshJobs();
      return result;
    } catch (err) {
      setToast({ type: "error", message: err.message });
      throw err;
    }
  };
  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    clearFastCache();
    setAuthenticated(false);
  };
  const playTrack = async (item, queue = []) => {
    await player.play(item, queue);
  };
  const isAdmin = userIsAdmin(settingsData.user);
  const permissions = settingsData.user?.permissions || [];
  const canManageLibrary = isAdmin || permissions.includes("manage_library");
  const canManageSources = isAdmin || permissions.includes("manage_sources");
  const canOpenManagement = canManageLibrary || canManageSources;
  // iPad Pro 10.5" reports 834 CSS pixels in portrait. Treat portrait tablets
  // as touch navigation instead of squeezing the desktop sidebar beside them.
  const isMobile = useMediaQuery("(max-width: 900px)");
  useEffect(() => {
    if (
      !loading &&
      !canOpenManagement &&
      managementNav.some((item) => item.id === active)
    )
      navigate("home", { replace: true });
  }, [loading, canOpenManagement, active, navigate]);
  const [title, subtitle] = pageMeta[active] || pageMeta.home;
  const hero =
    manualBackdrop ||
    ambientDeck[ambientIndex % Math.max(ambientDeck.length, 1)] ||
    {};
  const playerTrack = player.currentTrack || {};
  // 没有歌手背景图时不铺兜底图 —— 环境光晕已经撑起纵深。
  const shellBackdrop = hero.imageUrl || "";
  const showMiniPlayer = !!player.currentTrack && active !== "player";
  return (
    <div
      className={`app-shell visual-shell route-${active} ${showMiniPlayer ? "has-mini-player" : ""}`}
      data-font-size={settingsData.user?.fontSize || "standard"}
      data-theme={theme}
      style={appearanceStyle(appearance)}
    >
      {/* 环境光晕：两团极淡的品牌色径向渐变，从右上和左下渗入。
          近黑画布如果完全均匀会显得没做完，这一层给画面纵深，
          又不干扰任何前景文字（透明度都在 0.1 以下）。
          position:fixed，页面滚动时光源不动，内容像是在光下移动。 */}
      <div className="ambient" aria-hidden="true" />
      <ArtistBackdrop imageUrl={shellBackdrop} />
      {(!isMobile || menu) && (
        <Sidebar
          active={active}
          onChange={navigate}
          open={menu}
          close={() => setMenu(false)}
          logout={logout}
          version={settingsData.version}
          openPlayer={() => navigate("player")}
          isAdmin={canOpenManagement}
        />
      )}
      {/*
        player-main-shell 让浅色主题的画布规则跳过这一格。
        沉浸式播放页是故意始终深色的（见 features/now-playing/now-playing.css）。

        这个类名之前只存在于两处**注释和选择器**里 ——
        sidebar.css 写了 `.main:not(.player-main-shell)` 把它排除在外，
        now-playing.css 的开头也说明了这件事，但从来没有元素挂上它。
        结果是：浅色主题下 main 变成 #f6f6f8，而这一页的文字色钉在
        #f6f6f8，整页文字、按钮、右侧面板全部消失。
      */}
      <main className={active === "player" ? "main player-main-shell" : "main"}>
        {/*
          深浅切换直接放在顶栏 —— 原先只能进设置里翻三层才能换。
          themePreference 传的是用户偏好（可能是 system），
          不是 resolvedTheme 的结果 —— 这样按钮才能显示"跟随系统"这一档。
        */}
        {active !== "player" && <Topbar
          title={title}
          subtitle={subtitle}
          openMenu={() => setMenu(true)}
          onNavigate={navigate}
          logout={logout}
          profile={settingsData.user}
          themePreference={appearance.theme}
          onThemeChange={(next) => changeAppearance({ ...appearance, theme: next })}
          hasTaskActivity={jobs.some((job) =>
            ["running", "queued", "waiting_confirm"].includes(job.status),
          )}
        />}
        {loading &&
          (active === "manage" ||
            managementNav.some(
              (item) => item.id !== "settings" && item.id === active,
            )) && (
          <div className="management-route-loading" aria-label="正在载入管理数据">
            <PageLoader />
          </div>
        )}
        {active === "home" && (
          <Dashboard
            stats={stats}
            jobs={jobs}
            loading={loading}
            navigate={navigate}
            runJob={runJob}
            isAdmin={canManageLibrary}
            plexConfigured={Boolean(
              settingsData.plex?.enabled && settingsData.plex?.serverUrl,
            )}
          />
        )}{" "}
        {active === "library" && (
          <MediaLibrary
            key={`library-${routeRevision}`}
            initialTab={libraryTabFromPath(window.location.pathname)}
            initialDetail={libraryDetailFromPath(window.location.pathname)}
            play={playTrack}
            previewBackdrop={setManualBackdrop}
            onDetailBackdrop={setManualBackdrop}
            onTabChange={(tab) => updatePath(pathForLibraryTab(tab))}
            onDetailChange={(detail, fallbackTab) =>
              updatePath(
                detail
                  ? pathForLibraryDetail(detail.type, detail.ratingKey)
                  : pathForLibraryTab(fallbackTab || "artists"),
              )
            }
          />
        )}{" "}
        {active === "playlists" && (
          <PlaylistsPage
            key={`playlists-${routeRevision}`}
            play={playTrack}
            notify={(message) => setToast({ message })}
            initialPlaylistId={playlistIdFromPath(window.location.pathname)}
            onPlaylistChange={(id, options) =>
              updatePath(pathForPlaylist(id), options)
            }
          />
        )}{" "}
        {active === "search" && (
          <GlobalSearchPage
            play={playTrack}
            navigate={navigate}
            isAdmin={canManageLibrary}
          />
        )}{" "}
        {active === "me" && <MePage navigate={navigate} />}{" "}
        {active === "manage" && canOpenManagement && (
          <ManagementHub
            navigate={navigate}
            stats={stats}
            jobs={jobs}
            permissions={
              isAdmin
                ? ["manage_users", "manage_library", "manage_sources"]
                : permissions
            }
          />
        )}{" "}
        {canManageLibrary && active === "local" && (
          <LocalLibraryPage
            runJob={runJob}
            play={playTrack}
            notify={(message) => setToast({ message })}
            navigate={navigate}
          />
        )}{" "}
        {canManageLibrary && active === "scrape" && (
          <ScrapeCenter jobs={jobs} navigate={navigate} settings={settingsData} />
        )}{" "}
        {canManageLibrary && active === "download" && (
          <DownloadCenter
            sources={sources}
            refreshSources={refreshSources}
            createDownload={createDownload}
            navigate={navigate}
            notify={(message) => setToast({ message })}
            playPreview={playTrack}
          />
        )}{" "}
        {canManageSources && active === "sources" && (
          <SourceManager
            sources={sources}
            refreshSources={refreshSources}
            notify={(message) => setToast({ message })}
          />
        )}{" "}
        {active === "discover" && (
          <DiscoverPage
            play={playTrack}
            navigate={navigate}
            isAdmin={canManageLibrary}
          />
        )}{" "}
        {active === "player" && (
          <NowPlayingRoute
            navigate={navigate}
            playerSettings={settingsData.player}
          />
        )}{" "}
        {canManageLibrary && active === "tasks" && (
          <Tasks jobs={jobs} refresh={refreshJobs} navigate={navigate} />
        )}{" "}
        {active === "settings" && (
          <SettingsPage
            settings={settingsData}
            logout={logout}
            navigate={navigate}
            isAdmin={isAdmin}
            initialTab={settingsTabFromPath(
              window.location.pathname,
              isAdmin ? "plex" : "appearance",
            )}
            onTabChange={(tab) => updatePath(pathForSettingsTab(tab))}
            onSettingsChange={setSettingsData}
            appearance={appearance}
            onAppearanceChange={changeAppearance}
          />
        )}{" "}
        {isMobile && (
          <MobileNav
            active={active}
            change={navigate}
            isAdmin={canOpenManagement}
          />
        )}
      </main>
      {showMiniPlayer && (
        <MiniPlayer
          openPlayer={() => navigate("player")}
          navigate={navigate}
        />
      )}
      <Toast toast={toast} clear={() => setToast(null)} />
    </div>
  );
}
