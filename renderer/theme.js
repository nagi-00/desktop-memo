/**
 * theme.js — HSL 기반 팔레트 자동 생성 + CSS custom properties 주입
 */

/**
 * HEX → HSL 변환
 */
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

/**
 * HSL → HEX 변환
 */
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
 * 대표색 1개 → 전체 팔레트 자동 생성
 */
export function generatePalette(accentHex, mode = 'dark') {
  const [h, s, l] = hexToHsl(accentHex);
  const isDark = mode === 'dark';

  return {
    accent:        accentHex,
    accentHover:   hslToHex(h, s, Math.min(l + 10, 95)),
    background:    isDark ? hslToHex(h, 20, 8)  : hslToHex(h, 15, 97),
    surface:       isDark ? hslToHex(h, 20, 13) : hslToHex(h, 15, 92),
    surfaceHover:  isDark ? hslToHex(h, 20, 18) : hslToHex(h, 15, 87),
    border:        isDark ? hslToHex(h, 30, 20) : hslToHex(h, 25, 82),
    borderHover:   isDark ? hslToHex(h, 30, 28) : hslToHex(h, 25, 74),
    text:          isDark ? hslToHex(h, 15, 90) : hslToHex(h, 10, 10),
    textMuted:     isDark ? hslToHex(h, 10, 50) : hslToHex(h, 10, 45),
    textPlaceholder: isDark ? hslToHex(h, 10, 30) : hslToHex(h, 10, 65),
  };
}

/**
 * 팔레트를 :root CSS custom properties로 주입
 */
export function applyPalette(palette) {
  const root = document.documentElement;
  root.style.setProperty('--color-accent',        palette.accent);
  root.style.setProperty('--color-accent-hover',  palette.accentHover);
  root.style.setProperty('--color-bg',            palette.background);
  root.style.setProperty('--color-surface',       palette.surface);
  root.style.setProperty('--color-surface-hover', palette.surfaceHover);
  root.style.setProperty('--color-border',        palette.border);
  root.style.setProperty('--color-border-hover',  palette.borderHover);
  root.style.setProperty('--color-text',          palette.text);
  root.style.setProperty('--color-text-muted',    palette.textMuted);
  root.style.setProperty('--color-text-placeholder', palette.textPlaceholder);
}

/**
 * 다크/라이트 모드 전환
 */
export function setThemeMode(mode) {
  document.documentElement.setAttribute('data-theme', mode);
}

/**
 * 프리셋 팔레트
 */
export const PRESETS = [
  { name: 'Violet',    accent: '#7C3AED' },
  { name: 'Rose',      accent: '#E11D48' },
  { name: 'Sky',       accent: '#0EA5E9' },
  { name: 'Emerald',   accent: '#10B981' },
  { name: 'Amber',     accent: '#F59E0B' },
];
