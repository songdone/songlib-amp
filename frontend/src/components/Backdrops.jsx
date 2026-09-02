import { VISUAL_FALLBACKS } from "../lib/media";

function AppBackdrop({
  image,
  variant = "default",
  fallback = VISUAL_FALLBACKS.artist,
}) {
  const resolved = image || fallback;
  return (
    <div className={`app-backdrop ${variant}`} aria-hidden="true">
      <img
        key={resolved}
        className="backdrop-image current"
        src={resolved}
        alt=""
        decoding="async"
      />
      <i className="backdrop-vignette" />
      <i className="backdrop-aurora" />
    </div>
  );
}

export function ArtistBackdrop({ imageUrl }) {
  return (
    <AppBackdrop
      image={imageUrl}
      variant="home artist-backdrop"
      fallback={VISUAL_FALLBACKS.artist}
    />
  );
}

function PlayerBackdrop({ imageUrl }) {
  return (
    <AppBackdrop
      image={imageUrl}
      variant="player player-backdrop"
      fallback={VISUAL_FALLBACKS.player}
    />
  );
}

export function LoginMotionBackdrop() {
  return (
    <div className="login-motion-bg" aria-hidden="true">
      <div className="login-base-map">
        <div className="login-base-vignette" />
      </div>
      <svg
        className="login-flow-lines"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient
            id="songlib-login-line-gradient"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="0%"
          >
            <stop offset="0%" stopColor="rgba(245, 158, 11, 0)" />
            <stop offset="50%" stopColor="rgba(245, 158, 11, 0.8)" />
            <stop offset="100%" stopColor="rgba(245, 158, 11, 0)" />
          </linearGradient>
        </defs>
        {Array.from({ length: 4 }, (_, index) => (
          <path
            key={index}
            d={`M -10 ${20 + index * 15} Q ${40 + index * 5} ${30 - index * 5} ${70 + index * 10} ${50 + index * 10} T 110 ${40 + index * 10}`}
            fill="none"
            stroke="url(#songlib-login-line-gradient)"
            strokeWidth={0.55}
            strokeLinecap="round"
            strokeOpacity={0.42}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="login-gradient-top" />
      <div className="login-gradient-side" />
      <div className="login-breath-glow top-left" />
      <div className="login-breath-glow top-right" />
      <div className="login-ambient-glow" />
      <div className="login-card-glow" />
    </div>
  );
}
