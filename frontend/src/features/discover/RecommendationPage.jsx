import { ChevronRight, CircleAlert, Disc3, Play, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { PageLoader } from "../../components/PageLoader";
import { api } from "../../lib/api";
import { recommendationPlaybackInput } from "../../lib/contracts";
import { fmt } from "../../lib/format";

export function RecommendationPage({ play, navigate, isAdmin = true }) {
  const [data, setData] = useState({ profile: {}, items: [], eventCount: 0 });
  const [exploration, setExploration] = useState(0.35);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const applyRecommendationData = (value = {}) => {
    const normalized = {
      profile: value.profile || {},
      items: Array.isArray(value.items) ? value.items : [],
      eventCount: Number(value.eventCount || 0),
    };
    setData(normalized);
    return normalized;
  };
  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/recommendations");
      const normalized = applyRecommendationData(result);
      if (!normalized.items.length) {
        const refreshed = await api("/api/recommendations/refresh", {
          method: "POST",
          body: JSON.stringify({ exploration, discoveries: [] }),
        });
        applyRecommendationData(refreshed);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const refresh = async () => {
    setBusy(true);
    try {
      applyRecommendationData(
        await api("/api/recommendations/refresh", {
          method: "POST",
          body: JSON.stringify({ exploration, discoveries: [] }),
        }),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const profile = data.profile || {};
  const playRecommendation = (item) => {
    const target = recommendationPlaybackInput(item);
    if (target) play(target);
  };
  return (
    <div className="page recommendation-page refined-recommendation-page">
      <section className="recommendation-intro">
        <div>
          <span className="eyebrow"><Sparkles />FOR YOU</span>
          <h1>为你推荐</h1>
          <p>
            {profile.explanation ||
              "从你的收藏与播放习惯中挑选熟悉的声音，也留出发现新音乐的空间。"}
          </p>
        </div>
        <div className="exploration-control">
          <div>
            <span>熟悉度</span>
            <strong>{100 - Math.round(exploration * 100)}%</strong>
          </div>
          <input
            aria-label="推荐探索比例"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={exploration}
            onChange={(event) => setExploration(Number(event.target.value))}
          />
          <div>
            <span>探索度</span>
            <strong>{Math.round(exploration * 100)}%</strong>
          </div>
          <button className="secondary small" onClick={refresh} disabled={busy}>
            <RefreshCw className={busy ? "spin" : ""} />
            换一批
          </button>
        </div>
      </section>
      {error && (
        <div className="recommendation-error">
          <CircleAlert />
          <div>
            <strong>推荐暂时没有加载成功</strong>
            <span>{error}</span>
          </div>
          <button className="secondary small" onClick={load}>重试</button>
        </div>
      )}
      <section className="recommendation-signals" aria-label="推荐画像摘要">
        <div>
          <span>完整听完</span>
          <strong>{Math.round((profile.completionRate || 0) * 100)}%</strong>
          <small>完成率</small>
        </div>
        <i />
        <div>
          <span>快速跳过</span>
          <strong>{Math.round((profile.skipRate || 0) * 100)}%</strong>
          <small>跳过率</small>
        </div>
        <i />
        <div>
          <span>本地行为</span>
          <strong>{fmt(data.eventCount)}</strong>
          <small>不会上传完整历史</small>
        </div>
      </section>
      <section className="recommendation-profile">
        <article>
          <header>
            <h2>常听音乐人</h2>
            <span>收藏与完整播放的权重更高</span>
          </header>
          <div className="profile-tags">
            {(profile.topArtists || []).length ? (
              profile.topArtists.map((item) => (
                <span key={item.name}>
                  {item.name}
                  <small>{item.score}</small>
                </span>
              ))
            ) : (
              <p>继续播放与收藏，常听音乐人会逐渐浮现。</p>
            )}
          </div>
        </article>
        <article>
          <header>
            <h2>偏好年代与流派</h2>
            <span>只根据本地标签与播放行为计算</span>
          </header>
          <div className="profile-tags">
            {[...(profile.favoriteDecades || []), ...(profile.topGenres || [])]
              .length ? (
              [
                ...(profile.favoriteDecades || []),
                ...(profile.topGenres || []),
              ].map((item) => (
                <span key={item.name}>
                  {item.name}
                  <small>{item.score}</small>
                </span>
              ))
            ) : (
              <p>曲库标签越完整，推荐理由会越准确。</p>
            )}
          </div>
        </article>
      </section>
      <section className="recommendation-feed">
        <header className="recommendation-feed-head">
          <div>
            <span>今日发现</span>
            <h2>根据你的口味挑选</h2>
          </div>
          <small>已过滤 Live、伴奏、DJ 与重复版本</small>
        </header>
        {busy && !data.items.length ? (
          <PageLoader />
        ) : data.items.length ? (
          <div className="recommendation-grid">
            {data.items.slice(0, 24).map((item) => (
              <article key={item.id}>
                <div className="recommendation-cover"><Disc3 /><span>{item.inLibrary ? "库内" : "库外"}</span></div>
                <div><strong>{item.title}</strong><p>{item.artist}{item.album ? ` · ${item.album}` : ""}</p><small>{(item.reasons || []).join(" · ")}</small></div>
                {item.inLibrary ? (
                  <button className="icon-button" onClick={() => playRecommendation(item)} aria-label={`播放 ${item.title}`}><Play /></button>
                ) : isAdmin ? (
                  <button className="text-button recommendation-source-link" onClick={() => navigate("download")}>查找授权来源<ChevronRight /></button>
                ) : <em>可向管理员申请入库</em>}
              </article>
            ))}
          </div>
        ) : (
          <div className="recommendation-empty">
            <span><Sparkles /></span>
            <div>
              <strong>推荐正在认识你的口味</strong>
              <p>先从曲库播放或收藏几首歌曲，下一次刷新就会有更贴合的结果。</p>
            </div>
            <button className="secondary" onClick={() => navigate("library")}>
              打开音乐库
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
