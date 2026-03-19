/**
 * theme.js — HSL 기반 팔레트 자동 생성 + CSS custom properties 주입
 * Spec v2: 뉴트럴 디폴트, 페일 프리셋, 액션 버튼 색상 파생
 */

/** HEX → HSL */
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

/** HSL → HEX */
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * 대표색 → 전체 팔레트 자동 생성 (spec v2 준수)
 * - 배경: 테마색 hue 유지, 채도 15%, 명도 8~10% (dark) / 97% (light)
 * - 액션 버튼 4색: hue shift 파생
 */
export function generatePalette(accentHex, mode = 'dark') {
  const [h, s, l] = hexToHsl(accentHex);
  const isDark = mode === 'dark';

  // 채도가 0에 가까우면 (무채색 선택) 액션 버튼도 무채색으로
  const isAchromatic = s <= 5;

  return {
    accent:        accentHex,
    accentHover:   hslToHex(h, s, Math.min(l + 8, 92)),
    background:    isDark ? hslToHex(h, 15, 10) : hslToHex(h, 15, 97),
    surface:       isDark ? hslToHex(h, 15, 14) : hslToHex(h, 12, 93),
    surfaceHover:  isDark ? hslToHex(h, 15, 19) : hslToHex(h, 12, 87),
    border:        isDark ? hslToHex(h, 20, 22) : hslToHex(h, 18, 84),
    borderHover:   isDark ? hslToHex(h, 20, 30) : hslToHex(h, 18, 76),
    text:          isDark ? hslToHex(h, 10, 92) : hslToHex(h, 8,  8),
    textMuted:     isDark ? hslToHex(h, 8,  52) : hslToHex(h, 8,  44),
    textPlaceholder: isDark ? hslToHex(h, 8, 30) : hslToHex(h, 8, 65),
    // 액션 버튼 4색 — 낮은 채도(뮤트 톤), 무채색 선택 시 그레이스케일
    actionReply:    isAchromatic ? hslToHex(0, 0, 55) : hslToHex(h,               26, 62),
    actionLink:     isAchromatic ? hslToHex(0, 0, 62) : hslToHex((h + 30)  % 360, 32, 60),
    actionBookmark: isAchromatic ? hslToHex(0, 0, 58) : hslToHex(h,               32, 62),
    actionLike:     isAchromatic ? hslToHex(0, 0, 66) : hslToHex(h,               38, 66),
  };
}

/** 팔레트 → :root CSS custom properties 주입 */
export function applyPalette(palette) {
  const root = document.documentElement;
  root.style.setProperty('--color-accent',          palette.accent);
  root.style.setProperty('--color-accent-hover',    palette.accentHover);
  root.style.setProperty('--color-bg',              palette.background);
  root.style.setProperty('--color-surface',         palette.surface);
  root.style.setProperty('--color-surface-hover',   palette.surfaceHover);
  root.style.setProperty('--color-border',          palette.border);
  root.style.setProperty('--color-border-hover',    palette.borderHover);
  root.style.setProperty('--color-text',            palette.text);
  root.style.setProperty('--color-text-muted',      palette.textMuted);
  root.style.setProperty('--color-text-placeholder',palette.textPlaceholder);
  // 액션 버튼 색상
  if (palette.actionReply)    root.style.setProperty('--action-reply',    palette.actionReply);
  if (palette.actionLink)     root.style.setProperty('--action-link',     palette.actionLink);
  if (palette.actionBookmark) root.style.setProperty('--action-bookmark', palette.actionBookmark);
  if (palette.actionLike)     root.style.setProperty('--action-like',     palette.actionLike);
}

/** 팔레트 CSS 변수 초기화 (뉴트럴 기본값으로 리셋) */
export function resetPalette() {
  const root = document.documentElement;
  [
    '--color-accent', '--color-accent-hover',
    '--color-bg', '--color-surface', '--color-surface-hover',
    '--color-border', '--color-border-hover',
    '--color-text', '--color-text-muted', '--color-text-placeholder',
    '--action-reply', '--action-link', '--action-bookmark', '--action-like',
  ].forEach(p => root.style.removeProperty(p));
}

/** 다크/라이트 모드 전환 */
export function setThemeMode(mode) {
  document.documentElement.setAttribute('data-theme', mode);
}

/**
 * 프리셋 팔레트 (spec v2)
 * - 모든 프리셋: 채도 55% 이하, 명도 55% 이상 (페일 톤)
 * - accent: null → Default 뉴트럴 (테마 미적용)
 */
const PRESET_DEFS = [
  { name: 'Default', accent: null },
  { name: 'Ocean',   h: 210, s: 45, l: 62 }, // 페일 블루
  { name: 'Moss',    h: 152, s: 35, l: 58 }, // 페일 그린
  { name: 'Dusk',    h: 270, s: 30, l: 65 }, // 페일 라벤더
  { name: 'Sand',    h: 35,  s: 40, l: 68 }, // 페일 베이지
  { name: 'Rose',    h: 340, s: 35, l: 68 }, // 페일 로즈
  { name: '노랑',    h: 50,  s: 58, l: 65 }, // 노랑
  { name: '분홍',    h: 345, s: 50, l: 70 }, // 분홍
];

export const PRESETS = PRESET_DEFS.map(p =>
  p.accent !== undefined
    ? { name: p.name, accent: p.accent }
    : { name: p.name, accent: hslToHex(p.h, p.s, p.l) }
);
