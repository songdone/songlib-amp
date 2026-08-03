export const DEFAULT_APPEARANCE = Object.freeze({
  theme: "system",
  glassBlur: 24,
  glassOpacity: 0.52,
  backdropBlur: 14,
  backdropOpacity: 0.58,
  fontScale: 1,
  cornerRadius: 22,
  saturation: 145,
  motion: 1,
});

const clamp = (value, min, max, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(max, Math.max(min, parsed))
    : fallback;
};

export const normalizeAppearance = (value = {}) => ({
  theme: ["system", "dark", "light"].includes(value.theme)
    ? value.theme
    : DEFAULT_APPEARANCE.theme,
  glassBlur: clamp(value.glassBlur, 8, 44, DEFAULT_APPEARANCE.glassBlur),
  glassOpacity: clamp(
    value.glassOpacity,
    0.2,
    0.88,
    DEFAULT_APPEARANCE.glassOpacity,
  ),
  backdropBlur: clamp(
    value.backdropBlur,
    0,
    36,
    DEFAULT_APPEARANCE.backdropBlur,
  ),
  backdropOpacity: clamp(
    value.backdropOpacity,
    0.18,
    0.9,
    DEFAULT_APPEARANCE.backdropOpacity,
  ),
  fontScale: clamp(value.fontScale, 0.9, 1.25, DEFAULT_APPEARANCE.fontScale),
  cornerRadius: clamp(
    value.cornerRadius,
    12,
    32,
    DEFAULT_APPEARANCE.cornerRadius,
  ),
  saturation: clamp(value.saturation, 80, 190, DEFAULT_APPEARANCE.saturation),
  motion: clamp(value.motion, 0, 1.2, DEFAULT_APPEARANCE.motion),
});

export const resolvedTheme = (theme, prefersDark = true) =>
  theme === "system" ? (prefersDark ? "dark" : "light") : theme;

export const appearanceStyle = (value) => {
  const current = normalizeAppearance(value);
  return {
    "--glass-blur": `${current.glassBlur}px`,
    "--glass-opacity": current.glassOpacity,
    "--backdrop-user-blur": `${current.backdropBlur}px`,
    "--backdrop-user-opacity": current.backdropOpacity,
    "--ui-font-scale": current.fontScale,
    "--ui-radius": `${current.cornerRadius}px`,
    "--glass-saturation": `${current.saturation}%`,
    "--motion-scale": current.motion,
  };
};
