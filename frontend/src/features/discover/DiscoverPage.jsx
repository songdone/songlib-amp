/**
 * 发现。
 *
 * 重构前的状况：这一页路由到 RecommendationPage，只有本地推荐 ——
 * 没有任何平台歌单。真正会读 /api/discovery/playlists 的 DiscoverPage
 * 存在，但没有任何地方 import 它，是一份死代码。
 *
 * 现在两块合成一页，用视图切换：
 *
 *   平台热门 —— 主动抓网易云和 QQ 音乐的分类与热门歌单，
 *              点进一张歌单能看到每首歌在自己库里有没有，
 *              没有的可以直接排进下载队列。这是这一页的主要用途。
 *   猜你想听 —— 本地行为算出来的推荐。放第二位，因为它只有在
 *              听过一阵之后才有内容。
 *
 * 分类用 <select> 而不是胶囊：QQ 音乐有 65 个分类、分六组，
 * 铺成胶囊会占掉半屏；optgroup 正好能表达它自己的分组。
 * 网易云只有十个，为一致起见也走同一个控件。
 */

import {
  CircleAlert,
  Download,
  ExternalLink,
  ListMusic,
  LocateFixed,
  Play,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button, ButtonGroup, IconButton } from "../../components/ui/Button";
import { Cover } from "../../components/ui/Cover";
import { Notice } from "../../components/ui/Field";
import {
  EmptyState,
  Page,
  Section,
  SectionHeader,
} from "../../components/ui/Layout";
import { ChipGroup } from "../../components/ui/Plan";
import { StatGrid, StatTile } from "../../components/ui/StatTile";
import { PageLoader } from "../../components/PageLoader";
import { api } from "../../lib/api";
import { recommendationPlaybackInput } from "../../lib/contracts";
import { fmt } from "../../lib/format";

const VIEWS = [
  { id: "platform", label: "平台热门" },
  { id: "forYou", label: "猜你想听" },
];

/** 一页列多少首曲目。三百首一次铺完会卡。 */
const TRACK_PAGE = 50;

/** 播放量按万/亿收：平台给的是原始次数，八位数字读不出量级。 */
const playCountText = (value) => {
  const count = Number(value || 0);
  if (count >= 100_000_000) return `${(count / 100_000_000).toFixed(1)} 亿次播放`;
  if (count >= 10_000) return `${Math.round(count / 10_000)} 万次播放`;
  if (count > 0) return `${fmt(count)} 次播放`;
  return "";
};

/** 把分类按平台自己的分组归拢，交给 optgroup。 */
const groupCategories = (categories) => {
  const groups = new Map();
  categories.forEach((item) => {
    const key = item.group || "分类";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return [...groups.entries()];
};

export function DiscoverPage({ play, navigate, isAdmin = true }) {
  const [view, setView] = useState("platform");

  // --- 平台热门 ---
  const [platforms, setPlatforms] = useState([]);
  const [platform, setPlatform] = useState("netease");
  const [feed, setFeed] = useState(null);
  const [feedLoading, setFeedLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [trackPage, setTrackPage] = useState(1);
  const [queueing, setQueueing] = useState(false);

  // --- 猜你想听 ---
  const [recs, setRecs] = useState({ profile: {}, items: [], eventCount: 0 });
  const [exploration, setExploration] = useState(0.35);
  const [recsLoading, setRecsLoading] = useState(false);

  const [error, setError] = useState("");
  const [queued, setQueued] = useState("");

  useEffect(() => {
    api("/api/discovery/platforms")
      .then((result) => setPlatforms(result.items || []))
      .catch(() => setPlatforms([]));
  }, []);

  const loadFeed = async (platformId, category = "") => {
    setFeedLoading(true);
    setError("");
    setDetail(null);
    try {
      const result = await api(
        `/api/discovery/playlists?platform=${encodeURIComponent(platformId)}` +
          `&category=${encodeURIComponent(category)}`,
      );
      setFeed(result);
      // 平台自己的抓取失败（分类挂了但歌单还在，或反之）不算整页出错，
      // 单独提示，页面其余部分照常可用。
      setError((result.errors || []).filter(Boolean).join("；"));
    } catch (err) {
      setFeed(null);
      setError(err.message);
    } finally {
      setFeedLoading(false);
    }
  };

  useEffect(() => {
    loadFeed(platform);
  }, [platform]);

  const loadRecs = async () => {
    setRecsLoading(true);
    try {
      const result = await api("/api/recommendations/refresh", {
        method: "POST",
        body: JSON.stringify({ exploration, discoveries: [] }),
      });
      setRecs({
        profile: result.profile || {},
        items: Array.isArray(result.items) ? result.items : [],
        eventCount: Number(result.eventCount || 0),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setRecsLoading(false);
    }
  };

  useEffect(() => {
    if (view !== "forYou" || recs.items.length) return;
    setRecsLoading(true);
    api("/api/recommendations")
      .then((result) =>
        setRecs({
          profile: result.profile || {},
          items: Array.isArray(result.items) ? result.items : [],
          eventCount: Number(result.eventCount || 0),
        }),
      )
      .catch((err) => setError(err.message))
      .finally(() => setRecsLoading(false));
  }, [view]);

  const openPlaylist = async (item) => {
    setDetailLoading(true);
    setError("");
    setQueued("");
    setTrackPage(1);
    try {
      setDetail(
        await api(
          `/api/discovery/playlists/${encodeURIComponent(item.id)}` +
            `?platform=${encodeURIComponent(item.platform || platform)}`,
        ),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const locateMatched = async (track) => {
    const resources = track?.localTrack?.resources || [];
    const local = resources.find((item) => item.type === "local_file");
    if (local?.path) {
      await navigator.clipboard?.writeText(local.path);
      setQueued("文件路径已复制");
      return;
    }
    const plexResource = resources.find((item) => item.type === "plex_item");
    if (plexResource?.id) {
      const info = await api(`/api/plex/items/${plexResource.id}/playback`);
      if (info.openPlexUrl) window.open(info.openPlexUrl, "_blank");
    }
  };

  const queueMissing = async () => {
    const tracks = (detail?.tracks || []).filter((item) => item.canDownload);
    if (!tracks.length || !detail.downloadSource) return;
    setQueueing(true);
    setError("");
    try {
      const result = await api("/api/discovery/download-missing", {
        method: "POST",
        body: JSON.stringify({
          sourceId: detail.downloadSource.id,
          quality: "320k",
          tracks,
        }),
      });
      if (result.created) {
        // 不自动跳走：用户还在核对这张歌单，页面被换掉会丢上下文。
        setQueued(`${result.created} 首已排进下载队列`);
      } else {
        setError(result.errors?.[0]?.error || "没有找到可用的下载候选");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setQueueing(false);
    }
  };

  const activePlatform = platforms.find((item) => item.id === platform);
  const categories = feed?.categories || [];
  const playlists = feed?.playlists || [];
  const tracks = detail?.tracks || [];
  const trackPages = Math.max(1, Math.ceil(tracks.length / TRACK_PAGE));
  const visibleTracks = tracks.slice(
    (trackPage - 1) * TRACK_PAGE,
    trackPage * TRACK_PAGE,
  );

  return (
    <Page className="discover">
      <p className="discover__lead">
        翻翻各平台的热门歌单。点开一张，音屿会逐首对一遍你自己的曲库 ——
        有的直接放，没有的可以排进下载队列。
      </p>

      <ChipGroup label="看什么" options={VIEWS} value={view} onChange={setView} />

      {error && (
        <Notice tone="danger" icon={CircleAlert}>
          {error}
        </Notice>
      )}

      {queued && (
        <Notice tone="success" icon={Download}>
          {queued}
          <Button variant="quiet" onClick={() => navigate?.("tasks")}>
            去看执行进度
          </Button>
        </Notice>
      )}

      {/* ============ 平台热门 ============ */}
      {view === "platform" && (
        <Section>
          {platforms.length > 0 && (
            <ChipGroup
              label="平台"
              options={platforms.map((item) => ({
                id: item.id,
                label: item.name,
              }))}
              value={platform}
              onChange={setPlatform}
            />
          )}

          {activePlatform?.browseOnly ? (
            <EmptyState
              icon={ExternalLink}
              title={`${activePlatform.name}暂时只能在官网浏览`}
              text={activePlatform.note}
              action={
                <Button
                  icon={ExternalLink}
                  onClick={() =>
                    window.open(activePlatform.siteUrl, "_blank", "noopener")
                  }
                >
                  打开{activePlatform.name}
                </Button>
              }
            />
          ) : detail || detailLoading ? (
            /* --- 歌单详情 --- */
            <>
              <SectionHeader
                title={detail?.playlist?.title || "正在读取歌单"}
                note={
                  detail
                    ? [
                        detail.playlist.creator,
                        `${fmt(detail.summary.total)} 首`,
                        playCountText(detail.playlist.playCount),
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : ""
                }
                actions={
                  <ButtonGroup>
                    <Button size="sm" onClick={() => setDetail(null)}>
                      返回歌单列表
                    </Button>
                    {detail?.playlist?.sourceUrl && (
                      <Button
                        size="sm"
                        icon={ExternalLink}
                        onClick={() =>
                          window.open(
                            detail.playlist.sourceUrl,
                            "_blank",
                            "noopener",
                          )
                        }
                      >
                        在平台打开
                      </Button>
                    )}
                  </ButtonGroup>
                }
              />

              {detailLoading ? (
                <PageLoader />
              ) : (
                <>
                  <StatGrid>
                    <StatTile
                      tone="success"
                      value={fmt(detail.summary.matched)}
                      label="首库里已经有"
                      detail="可以直接播放"
                    />
                    <StatTile
                      tone="warning"
                      value={fmt(detail.summary.downloadable)}
                      label="首可以下载补齐"
                      detail={
                        detail.downloadSource
                          ? `将通过${detail.downloadSource.name || "已启用音源"}`
                          : "需要先在「音乐源」里启用一个音源"
                      }
                    />
                    <StatTile
                      value={fmt(detail.summary.unavailable)}
                      label="首暂时找不到"
                      detail="曲库里没有，音源也搜不到"
                    />
                  </StatGrid>

                  {isAdmin && detail.summary.downloadable > 0 && (
                    <div className="discover__bulk">
                      <Button
                        variant="primary"
                        icon={Download}
                        loading={queueing}
                        disabled={!detail.downloadSource}
                        onClick={queueMissing}
                      >
                        把缺的 {detail.summary.downloadable} 首都排进下载
                      </Button>
                      {!detail.downloadSource && (
                        <Button
                          variant="quiet"
                          onClick={() => navigate?.("sources")}
                        >
                          去启用音源
                        </Button>
                      )}
                    </div>
                  )}

                  <div className="discover-tracks">
                    {visibleTracks.map((item, index) => {
                      const number = (trackPage - 1) * TRACK_PAGE + index + 1;
                      const matched = item.matchStatus === "matched";
                      return (
                        <div
                          className="discover-tracks__row"
                          key={`${item.platformTrackId}-${index}`}
                        >
                          <span className="discover-tracks__index">
                            {String(number).padStart(2, "0")}
                          </span>
                          <Cover
                            src={item.coverUrl}
                            title={item.title}
                            size="36px"
                            shape="square"
                          />
                          <div className="discover-tracks__text">
                            <strong>{item.title || "未知曲目"}</strong>
                            <small>
                              {[item.artist || "未知歌手", item.album]
                                .filter(Boolean)
                                .join(" · ")}
                            </small>
                          </div>
                          <div className="discover-tracks__state">
                            {matched ? (
                              <Badge tone="success">
                                {item.localTrack?.sourceSummary || "库里有"}
                              </Badge>
                            ) : item.canDownload ? (
                              <Badge tone="warning">可下载</Badge>
                            ) : (
                              <Badge>找不到</Badge>
                            )}
                          </div>
                          <div className="discover-tracks__actions">
                            {matched ? (
                              <>
                                <IconButton
                                  icon={Play}
                                  size="sm"
                                  label={`播放 ${item.title}`}
                                  onClick={() =>
                                    item.localTrack && play(item.localTrack)
                                  }
                                />
                                <IconButton
                                  icon={LocateFixed}
                                  size="sm"
                                  label={
                                    item.localTrack?.sourceTypes?.includes(
                                      "local_file",
                                    )
                                      ? `复制 ${item.title} 的文件路径`
                                      : `在 Plex 里打开 ${item.title}`
                                  }
                                  onClick={() => locateMatched(item)}
                                />
                              </>
                            ) : item.canDownload && isAdmin ? (
                              <IconButton
                                icon={Download}
                                size="sm"
                                label={`去下载 ${item.title}`}
                                onClick={() => {
                                  localStorage.setItem(
                                    "songlib-download-query",
                                    `${item.title} ${item.artist}`,
                                  );
                                  navigate?.("download");
                                }}
                              />
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {tracks.length > TRACK_PAGE && (
                    <div className="discover__pager">
                      <Button
                        size="sm"
                        disabled={trackPage <= 1}
                        onClick={() => setTrackPage((value) => value - 1)}
                      >
                        上一页
                      </Button>
                      <span>
                        第 {trackPage} / {trackPages} 页 · 共 {tracks.length} 首
                      </span>
                      <Button
                        size="sm"
                        disabled={trackPage >= trackPages}
                        onClick={() => setTrackPage((value) => value + 1)}
                      >
                        下一页
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            /* --- 歌单列表 --- */
            <>
              {categories.length > 0 && (
                <label className="discover__category">
                  <span>分类</span>
                  <select
                    className="ui-select"
                    value={feed?.selectedCategory || ""}
                    onChange={(event) => loadFeed(platform, event.target.value)}
                  >
                    {groupCategories(categories).map(([group, items]) => (
                      <optgroup label={group} key={group}>
                        {items.map((item) => (
                          <option value={item.value} key={item.id}>
                            {item.name}
                            {item.count ? `（${fmt(item.count)}）` : ""}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
              )}

              {feedLoading ? (
                <PageLoader />
              ) : playlists.length ? (
                <div className="discover-grid">
                  {playlists.map((item) => (
                    <button
                      type="button"
                      className="discover-card"
                      key={`${item.platform}-${item.id}`}
                      onClick={() => openPlaylist(item)}
                    >
                      <Cover
                        src={item.coverUrl}
                        title={item.title}
                        shape="rounded"
                      />
                      <strong>{item.title}</strong>
                      <small>
                        {[
                          item.creator,
                          item.trackCount ? `${fmt(item.trackCount)} 首` : "",
                          playCountText(item.playCount),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={ListMusic}
                  title="这个分类下没读到歌单"
                  text="换一个分类，或者过一会儿再试。平台接口偶尔会抽风，你的曲库和播放不受影响。"
                  action={
                    <Button
                      icon={RefreshCw}
                      onClick={() => loadFeed(platform, feed?.selectedCategory)}
                    >
                      重新读取
                    </Button>
                  }
                />
              )}
            </>
          )}
        </Section>
      )}

      {/* ============ 猜你想听 ============ */}
      {view === "forYou" && (
        <Section>
          <SectionHeader
            title="猜你想听"
            note={
              recs.profile.explanation ||
              "根据你听完、收藏和跳过的歌算出来，只在本机计算"
            }
            actions={
              <Button
                size="sm"
                icon={RefreshCw}
                loading={recsLoading}
                onClick={loadRecs}
              >
                换一批
              </Button>
            }
          />

          <label className="discover__slider">
            <span>
              熟悉的 {100 - Math.round(exploration * 100)}% · 没听过的{" "}
              {Math.round(exploration * 100)}%
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={exploration}
              aria-label="没听过的音乐占多少"
              onChange={(event) => setExploration(Number(event.target.value))}
            />
            <small>拉高会多推没听过的，换一批后生效</small>
          </label>

          {recsLoading && !recs.items.length ? (
            <PageLoader />
          ) : recs.items.length ? (
            <div className="discover-tracks">
              {recs.items.slice(0, 30).map((item, index) => (
                <div
                  className="discover-tracks__row"
                  key={item.id || `${item.title}-${index}`}
                >
                  <span className="discover-tracks__index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <Cover
                    src={item.coverUrl || item.albumCoverUrl}
                    title={item.title}
                    size="36px"
                    shape="square"
                  />
                  <div className="discover-tracks__text">
                    <strong>{item.title}</strong>
                    <small>
                      {[item.artist || "未知歌手", item.album]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </div>
                  <div className="discover-tracks__state">
                    {(item.reasons || []).slice(0, 2).map((reason) => (
                      <Badge key={reason}>{reason}</Badge>
                    ))}
                  </div>
                  <div className="discover-tracks__actions">
                    {item.inLibrary ? (
                      <IconButton
                        icon={Play}
                        size="sm"
                        label={`播放 ${item.title}`}
                        onClick={() => {
                          const target = recommendationPlaybackInput(item);
                          if (target) play(target);
                        }}
                      />
                    ) : isAdmin ? (
                      <IconButton
                        icon={Download}
                        size="sm"
                        label={`去下载 ${item.title}`}
                        onClick={() => {
                          localStorage.setItem(
                            "songlib-download-query",
                            `${item.title} ${item.artist}`,
                          );
                          navigate?.("download");
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Sparkles}
              title="还没攒够素材"
              text="放几首歌、收藏或跳过几次，这里就会开始给结果。也可以先去「平台热门」翻翻别人的歌单。"
              action={
                <Button variant="primary" onClick={() => setView("platform")}>
                  去看平台热门
                </Button>
              }
            />
          )}
        </Section>
      )}
    </Page>
  );
}
