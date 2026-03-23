/**
 * memo.js — Spec v2 렌더러 로직
 * Twitter-card UI, 텍스트 서식, 자동변환, 최소화, 북마크, 프로필 편집
 */
import { generatePalette, applyPalette, resetPalette, setThemeMode, PRESETS } from './theme.js';

const api = window.memoAPI;

// ── 상태 ──────────────────────────────────────
let memoData      = null;
let currentMode   = 'dark';
let isPinned      = false;
let isLiked       = false;
let isSimpleMode  = false;
let saveTimer     = null;
let mediaFolded   = false;

// ── DOM 참조 ──────────────────────────────────
const memoRoot    = document.getElementById('memoRoot');
const cardView    = document.getElementById('cardView');

const memoContent  = document.getElementById('memoContent');
const createdDate  = document.getElementById('createdDate');
const displayName  = document.getElementById('displayName');
const handleText   = document.getElementById('handleText');
const profileAvatar = document.getElementById('profileAvatar');
const symbolBtn    = document.getElementById('symbolBtn');

const btnPin         = document.getElementById('btnPin');
const btnOpacity     = document.getElementById('btnOpacity');
const opacityPopup   = document.getElementById('opacityPopup');
const opacitySlider  = document.getElementById('opacitySlider');
const opacityValue   = document.getElementById('opacityValue');
const btnMinimize    = document.getElementById('btnMinimize');
// 링크 다이얼로그
const linkDialogOverlay  = document.getElementById('linkDialogOverlay');
const linkDialogInput    = document.getElementById('linkDialogInput');
const linkDialogConfirm  = document.getElementById('linkDialogConfirm');
const linkDialogCancel   = document.getElementById('linkDialogCancel');
const btnThemeToggle = document.getElementById('btnThemeToggle');
const colorDot       = document.getElementById('colorDot');
const colorPopup     = document.getElementById('colorPopup');
const colorSwatches  = document.getElementById('colorSwatches');
const colorPickerCustom = document.getElementById('colorPickerCustom');
const btnDelete      = document.getElementById('btnDelete');

const btnReply       = document.getElementById('btnReply');
const btnThreadFold  = document.getElementById('btnThreadFold');
const btnLike       = document.getElementById('btnLike');
const btnNewMemo    = document.getElementById('btnNewMemo');
const btnImage      = document.getElementById('btnImage');
const imageFileInput  = document.getElementById('imageFileInput');
const avatarFileInput = document.getElementById('avatarFileInput');
const textColorInput  = document.getElementById('textColorInput');
const btnCapture      = document.getElementById('btnCapture');
const capturePopup    = document.getElementById('capturePopup');
const btnCaptureClipboard = document.getElementById('btnCaptureClipboard');
const btnCaptureSave      = document.getElementById('btnCaptureSave');
const btnSimpleView       = document.getElementById('btnSimpleView');
const btnFont         = document.getElementById('btnFont');
const fontPopup       = document.getElementById('fontPopup');
const fontFamilies    = document.getElementById('fontFamilies');
const fontSizeSlider  = document.getElementById('fontSizeSlider');
const fontSizeValue   = document.getElementById('fontSizeValue');
const mediaArea       = document.getElementById('mediaArea');
const mediaHeader     = document.getElementById('mediaHeader');
const fontSearch      = document.getElementById('fontSearch');

const FONT_FALLBACKS = [
  { label: '기본 (System)',   family: 'system-ui, sans-serif' },
  { label: 'Serif',           family: 'Georgia, "Times New Roman", serif' },
  { label: '고딕',            family: '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif' },
  { label: 'Monospace',       family: 'Consolas, "D2Coding", monospace' },
];
let localFonts = null; // 캐시된 로컬 폰트 목록

let savedTextRange = null; // 텍스트 색상 적용 전 선택 범위 저장

// ── 색상 유틸리티 ──────────────────────────────
function hexToHsl(hex) {
  let r = parseInt(hex.slice(1,3), 16) / 255;
  let g = parseInt(hex.slice(3,5), 16) / 255;
  let b = parseInt(hex.slice(5,7), 16) / 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h = 0, s = 0, l = (max+min)/2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d/(2-max-min) : d/(max+min);
    switch(max) {
      case r: h = ((g-b)/d + (g<b?6:0))/6; break;
      case g: h = ((b-r)/d + 2)/6; break;
      case b: h = ((r-g)/d + 4)/6; break;
    }
  }
  return [h*360, s*100, l*100];
}

function hslToHex(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q-p)*6*t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q-p)*(2/3-t)*6;
      return p;
    };
    const q = l < 0.5 ? l*(1+s) : l+s-l*s;
    const p = 2*l - q;
    r = hue2rgb(p, q, h+1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h-1/3);
  }
  return '#' + [r,g,b].map(x => Math.round(x*255).toString(16).padStart(2,'0')).join('');
}

function getCssAccentHex() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
  if (raw.startsWith('#')) return raw;
  const m = raw.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (m) return '#' + [m[1],m[2],m[3]].map(n => parseInt(n).toString(16).padStart(2,'0')).join('');
  return '#7c6af7';
}

function generateTextPalette() {
  // 디폴트 테마(accent 없음) → 빨노초파보 파스텔
  if (!memoData?.theme?.accent) {
    return [
      hslToHex(  0, 72, 80),  // 연한 빨강
      hslToHex( 46, 88, 78),  // 연한 노랑
      hslToHex(130, 52, 76),  // 연한 초록
      hslToHex(210, 72, 80),  // 연한 파랑
      hslToHex(275, 68, 80),  // 연한 보라
    ];
  }
  try {
    const [h, s] = hexToHsl(getCssAccentHex());
    const sat = Math.max(s, 60);
    return [
      hslToHex(h, Math.min(sat - 20, 80), 82),
      hslToHex(h, Math.min(sat,     90), 68),
      hslToHex(h, Math.min(sat + 5, 95), 52),
      hslToHex(h, Math.min(sat + 8, 95), 38),
      hslToHex(h, Math.min(sat + 5, 90), 25),
    ];
  } catch {
    return ['#c4b5fd', '#a78bfa', '#7c6af7', '#5b4fcf', '#3b31a1'];
  }
}

// ── 초기화 ────────────────────────────────────
async function init() {
  if (window.lucide) lucide.createIcons();

  memoData = await api.getMemo();
  const settings = await api.getSettings();
  currentMode = settings?.theme || 'dark';

  if (!memoData) return;

  // 테마
  applyTheme(memoData.theme?.accent ?? null, currentMode);
  updateThemeToggleIcon();

  // 폰트
  if (memoData.font) {
    document.documentElement.style.setProperty('--memo-font-family', memoData.font.family || 'system-ui');
    document.documentElement.style.setProperty('--memo-font-size', `${memoData.font.size || 14}px`);
  }

  // 콘텐츠 복원 (HTML 우선, fallback 플레인텍스트)
  if (memoData.contentHtml) {
    memoContent.innerHTML = memoData.contentHtml;
  } else if (memoData.content) {
    memoContent.textContent = memoData.content;
  }

  // 구형 hr-block → <hr> 마이그레이션
  memoContent.querySelectorAll('.hr-block').forEach(block => {
    const hr = document.createElement('hr');
    block.parentNode.replaceChild(hr, block);
  });

  // 저장된 미디어 그리드에 래퍼/이벤트 재적용
  initMediaGrids();

  // 답글 컨텍스트 표시
  if (memoData.parentId) {
    // 상태바 숨기고 reply 스타일 적용
    document.querySelector('.memo-card').classList.add('is-reply');

    // reply-context 바에 최소화/삭제 컨트롤 추가
    const replyCtx = document.getElementById('replyContext');
    const ctrlsDiv = document.createElement('div');
    ctrlsDiv.className = 'reply-ctx-ctrls';
    const rMinBtn = document.createElement('button');
    rMinBtn.className = 'reply-ctx-ctrl';
    rMinBtn.title = '숨기기';
    rMinBtn.innerHTML = '<i data-lucide="minimize-2" width="11" height="11"></i>';
    rMinBtn.addEventListener('click', (e) => { e.stopPropagation(); hideWindow(); });
    const rDelBtn = document.createElement('button');
    rDelBtn.className = 'reply-ctx-ctrl danger';
    rDelBtn.title = '메모 삭제';
    rDelBtn.innerHTML = '<i data-lucide="trash-2" width="11" height="11"></i>';
    rDelBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('이 메모를 삭제할까요?')) await api.deleteMemo();
    });
    ctrlsDiv.appendChild(rMinBtn);
    ctrlsDiv.appendChild(rDelBtn);
    replyCtx.appendChild(ctrlsDiv);

    const allMemos = await api.getAllMemos();
    const parent = allMemos?.find(m => m.id === memoData.parentId);
    if (parent) {
      const ctxText = document.getElementById('replyContextText');
      ctxText.textContent = `${parent.profile?.name || '메모'}에 대한 답글`;
      replyCtx.style.display = 'flex';
      ctxText.style.cursor = 'pointer';
      ctxText.addEventListener('click', () => api.focusMemo(parent.id));
      // 원본 테마 적용 버튼 — mousedown 사용 (drag region 안에서도 동작)
      const btnApplyParentTheme = document.getElementById('btnApplyParentTheme');
      if (btnApplyParentTheme) {
        btnApplyParentTheme.style.display = '';
        // mousedown: 드래그 영역에서도 이벤트 수신, 매 클릭마다 최신 부모 데이터 조회
        btnApplyParentTheme.addEventListener('mousedown', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          // 최신 부모 데이터 조회 (부모 테마가 변경된 경우 반영)
          const freshMemos = await api.getAllMemos();
          const freshParent = freshMemos?.find(m => m.id === memoData.parentId);
          if (!freshParent) return;
          const parentAccent = freshParent.theme?.accent ?? null;
          memoData.theme = { ...(memoData.theme || {}), accent: parentAccent };
          applyTheme(parentAccent, currentMode);
          renderColorSwatches();
          // 부모 폰트도 동기화
          if (freshParent.font) {
            memoData.font = { ...freshParent.font };
            document.documentElement.style.setProperty('--memo-font-family', memoData.font.family || 'system-ui');
            document.documentElement.style.setProperty('--memo-font-size', `${memoData.font.size || 14}px`);
          }
          saveMemoChanges({ theme: memoData.theme, font: memoData.font });
        });
      }
    } else {
      // 부모 메모를 못 찾아도 context bar 표시
      const ctxText = document.getElementById('replyContextText');
      ctxText.textContent = '답글 메모';
      replyCtx.style.display = 'flex';
    }

    // 아이콘 렌더 (lucide)
    if (window.lucide) lucide.createIcons({ nodes: [rMinBtn, rDelBtn] });
  }

  // 프로필
  const profile = memoData.profile || {};
  displayName.textContent = profile.name   || '메모';
  handleText.textContent  = profile.handle ? `@${profile.handle}` : '@note';
  renderAvatar();

  // 날짜 (createdAt 고정)
  if (memoData.createdAt) {
    createdDate.textContent = formatDate(memoData.createdAt);
  }

  // 핀
  isPinned = memoData.pinned || false;
  updatePinButton();

  // 잠금 모드 복원
  if (memoData.simpleMode) {
    isSimpleMode = true;
    document.querySelector('.memo-card').classList.add('simple-mode');
    memoContent.contentEditable = 'false';
    const icon = btnSimpleView?.querySelector('[data-lucide]');
    if (icon) {
      icon.setAttribute('data-lucide', 'eye');
      if (window.lucide) lucide.createIcons({ nodes: [icon] });
    }
  }

  // 투명도
  const opacity = memoData.opacity ?? 1.0;
  opacitySlider.value = opacity;
  opacityValue.textContent = `${Math.round(opacity * 100)}%`;

  // 좋아요
  isLiked = memoData.liked || false;
  updateLikeButton();

  // 스와치 렌더링
  renderColorSwatches();

  // 폰트 UI 초기화 (로컬 폰트 비동기 로드)
  await loadLocalFonts();
  renderFontOptions();
  const fontSize = memoData.font?.size || 14;
  fontSizeSlider.value = fontSize;
  fontSizeValue.textContent = `${fontSize}px`;

  // 이벤트
  bindEvents();

  // 테마 브로드캐스트 수신
  api.onThemeModeChanged((mode) => {
    currentMode = mode;
    setThemeMode(mode);
    updateThemeToggleIcon();
    applyTheme(memoData?.theme?.accent ?? null, mode);
  });
}

// ── 테마 ──────────────────────────────────────
function applyTheme(accentHex, mode) {
  if (!accentHex) {
    resetPalette();
    setThemeMode(mode);
    colorDot.style.background = 'var(--color-accent)';
    return;
  }
  const palette = generatePalette(accentHex, mode);
  applyPalette(palette);
  setThemeMode(mode);
  colorDot.style.background = accentHex;
  if (colorPickerCustom) colorPickerCustom.value = accentHex;
}

function updateThemeToggleIcon() {
  const icon = btnThemeToggle.querySelector('[data-lucide]');
  if (!icon) return;
  icon.setAttribute('data-lucide', currentMode === 'dark' ? 'sun' : 'moon');
  if (window.lucide) lucide.createIcons({ nodes: [icon] });
}

// ── 프로필 ────────────────────────────────────
function renderAvatar() {
  const name    = memoData?.profile?.name || '메';
  const dataUrl = memoData?.profile?.avatarDataUrl;
  if (dataUrl) {
    let img = profileAvatar.querySelector('img');
    if (!img) {
      profileAvatar.innerHTML = '';
      img = document.createElement('img');
      profileAvatar.appendChild(img);
    }
    img.src = dataUrl;
  } else {
    profileAvatar.innerHTML = '';
    profileAvatar.textContent = name[0].toUpperCase();
  }
}

// ── 핀 버튼 ───────────────────────────────────
function updatePinButton() {
  btnPin.classList.toggle('active', isPinned);
  const icon = btnPin.querySelector('[data-lucide]');
  if (!icon) return;
  icon.setAttribute('data-lucide', isPinned ? 'pin-off' : 'pin');
  if (window.lucide) lucide.createIcons({ nodes: [icon] });
}

// ── 좋아요 버튼 ──
function updateLikeButton() {
  btnLike.classList.toggle('active', isLiked);
}

// ── 날짜 포맷 ─────────────────────────────────
function formatDate(iso) {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── 컬러 스와치 ──────────────────────────────
function renderColorSwatches() {
  colorSwatches.innerHTML = '';
  const currentAccent = memoData?.theme?.accent ?? null;
  const isCustom = currentAccent !== null && !PRESETS.some(p => p.accent === currentAccent);

  // Default 뉴트럴 스와치
  const defBtn = document.createElement('button');
  defBtn.className = 'color-swatch';
  defBtn.style.background = 'conic-gradient(#888 0deg 180deg, #fff 180deg)';
  defBtn.title = 'Default';
  if (currentAccent === null) defBtn.classList.add('selected');
  defBtn.addEventListener('click', (e) => { e.stopPropagation(); selectAccentColor(null); });
  colorSwatches.appendChild(defBtn);

  // 프리셋 스와치
  PRESETS.filter(p => p.accent !== null).forEach(({ name, accent }) => {
    const btn = document.createElement('button');
    btn.className = 'color-swatch';
    btn.style.background = accent;
    btn.title = name;
    if (currentAccent === accent) btn.classList.add('selected');
    btn.addEventListener('click', (e) => { e.stopPropagation(); selectAccentColor(accent); });
    colorSwatches.appendChild(btn);
  });

  // 커스텀 컬러 버튼 (맨 끝)
  const customBtn = document.createElement('button');
  customBtn.className = 'color-swatch custom';
  customBtn.title = '커스텀 색상';
  if (isCustom) customBtn.classList.add('selected');
  customBtn.addEventListener('click', (e) => { e.stopPropagation(); colorPickerCustom.click(); });
  colorSwatches.appendChild(customBtn);
}

function selectAccentColor(hex) {
  memoData.theme = { ...(memoData.theme || {}), accent: hex };
  applyTheme(hex, currentMode);
  saveMemoChanges({ theme: memoData.theme });
  renderColorSwatches();
}

// ── 창 숨기기 (목록에는 계속 표시됨) ────────────
function hideWindow() {
  api.hideWindow().catch(console.error);
}

// ── 저장 ──────────────────────────────────────
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const contentHtml = memoContent.innerHTML;
    const content     = memoContent.textContent;
    const images      = getMediaImages();
    memoData.contentHtml = contentHtml;
    memoData.content     = content;
    memoData.images      = images;
    saveMemoChanges({ contentHtml, content, images });
  }, 500);
}

function saveMemoChanges(changes) {
  api.updateMemo(changes).catch(console.error);
}

// ── 미디어 그리드 (트위터 스타일 — mediaArea에 고정) ──
function getOrCreateGrid() {
  let grid = mediaArea.querySelector('.media-grid');
  if (!grid) {
    grid = document.createElement('div');
    grid.className = 'media-grid';
    mediaArea.appendChild(grid);
  }
  return grid;
}

function updateMediaHeaderVisibility() {
  const count = mediaArea.querySelectorAll('.img-wrap').length;
  mediaHeader.style.display = count > 0 ? 'flex' : 'none';
  if (count === 0) {
    mediaFolded = false;
    mediaArea.classList.remove('folded');
  } else {
    const label = document.getElementById('mediaFoldLabel');
    if (label) label.textContent = mediaFolded ? `사진 ${count}장 펼치기` : `사진 ${count}장 접기`;
  }
}

function updateGridCount(grid) {
  const count = grid.querySelectorAll('.img-wrap').length;
  if (count === 0) { grid.remove(); updateMediaHeaderVisibility(); return; }
  grid.setAttribute('data-count', Math.min(count, 4));
  updateMediaHeaderVisibility();
  scheduleSave();
}

function setupImgWrap(wrap, grid) {
  wrap.draggable = true;

  // 기존 삭제 버튼이 없으면 추가
  if (!wrap.querySelector('.img-remove')) {
    const removeBtn = document.createElement('button');
    removeBtn.className = 'img-remove';
    removeBtn.textContent = '×';
    wrap.appendChild(removeBtn);
  }

  // 편집 버튼 (✎) — 이미지 에디터 열기
  if (!wrap.querySelector('.img-edit')) {
    const editBtn = document.createElement('button');
    editBtn.className = 'img-edit';
    editBtn.textContent = '✎';
    editBtn.title = '이미지 편집';
    wrap.appendChild(editBtn);
  }

  // 교체 버튼 (⟳) — 파일로 교체
  if (!wrap.querySelector('.img-swap')) {
    const swapBtn = document.createElement('button');
    swapBtn.className = 'img-swap';
    swapBtn.textContent = '⟳';
    swapBtn.title = '이미지 교체';
    wrap.appendChild(swapBtn);
  }

  // 삭제 버튼 이벤트
  wrap.querySelector('.img-remove').addEventListener('click', (ev) => {
    ev.stopPropagation();
    wrap.remove();
    updateGridCount(grid);
  });

  // 편집 버튼 이벤트
  wrap.querySelector('.img-edit').addEventListener('click', (ev) => {
    ev.stopPropagation();
    openImageEditor(wrap.querySelector('img'));
  });

  // 교체 버튼 이벤트
  wrap.querySelector('.img-swap').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = wrap.querySelector('img');
        if (img) img.src = e.target.result;
        scheduleSave();
      };
      reader.readAsDataURL(file);
    });
    input.click();
  });

  // 드래그 순서 변경
  wrap.addEventListener('dragstart', (ev) => {
    wrap.classList.add('dragging');
    ev.dataTransfer.effectAllowed = 'move';
    grid._dragSrc = wrap;
  });
  wrap.addEventListener('dragend', () => {
    wrap.classList.remove('dragging');
    grid.querySelectorAll('.img-wrap').forEach(w => w.classList.remove('drag-over'));
    grid._dragSrc = null;
    updateGridCount(grid);
  });
  wrap.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    if (grid._dragSrc && grid._dragSrc !== wrap) wrap.classList.add('drag-over');
  });
  wrap.addEventListener('dragleave', () => wrap.classList.remove('drag-over'));
  wrap.addEventListener('drop', (ev) => {
    ev.preventDefault();
    wrap.classList.remove('drag-over');
    if (grid._dragSrc && grid._dragSrc !== wrap) {
      const allWraps = [...grid.querySelectorAll('.img-wrap')];
      const fromIdx = allWraps.indexOf(grid._dragSrc);
      const toIdx   = allWraps.indexOf(wrap);
      if (fromIdx < toIdx) grid.insertBefore(grid._dragSrc, wrap.nextSibling);
      else grid.insertBefore(grid._dragSrc, wrap);
    }
  });
}

function addImageToGrid(grid, src) {
  const wrap = document.createElement('div');
  wrap.className = 'img-wrap';
  const img = document.createElement('img');
  img.src = src;
  wrap.appendChild(img);
  grid.appendChild(wrap);
  setupImgWrap(wrap, grid);
}

/** 저장된 이미지 복원: memoData.images → mediaArea, 인라인 이미지 마이그레이션 */
function initMediaGrids() {
  // 1) contentHtml 내부의 인라인 이미지/그리드를 mediaArea로 마이그레이션
  const inlineGrids = memoContent.querySelectorAll('.media-grid');
  const migratedSrcs = [];
  inlineGrids.forEach(grid => {
    grid.querySelectorAll('img').forEach(img => migratedSrcs.push(img.src));
    grid.remove();
  });
  // bare <img> in content
  memoContent.querySelectorAll(':scope > img').forEach(img => {
    migratedSrcs.push(img.src);
    img.remove();
  });

  // 2) memoData.images 로드 (마이그레이션된 것과 합침)
  const savedImages = memoData.images || [];
  const allImages = [...savedImages, ...migratedSrcs];
  if (allImages.length === 0) return;

  const grid = getOrCreateGrid();
  allImages.forEach(src => addImageToGrid(grid, src));
  updateGridCount(grid);
}

/** mediaArea에서 이미지 src 배열 추출 */
function getMediaImages() {
  const grid = mediaArea.querySelector('.media-grid');
  if (!grid) return [];
  return [...grid.querySelectorAll('.img-wrap img')].map(img => img.src);
}

// ── 텍스트 서식 ──────────────────────────────
function fmt(command, value = null) {
  memoContent.focus();
  document.execCommand(command, false, value);
}

/**
 * 공백 키 입력 시 자동 변환
 * `-` or `*` → 불릿 리스트
 * `1.` 등    → 번호 리스트
 * `[]`       → 체크박스
 */
// ── 자동 변환 공통 헬퍼 ─────────────────────────
/**
 * 커서가 있는 memoContent 직접 자식 블록을 반환.
 * execCommand('insertOrderedList') 는 빈 블록에서 윗줄 내용을 흡수하는 버그가
 * 있으므로, 직접 <ol>/<ul>을 생성해 블록을 교체한다.
 */
function _currentBlock(node) {
  let el = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
  while (el && el.parentNode !== memoContent) el = el.parentNode;
  return el ?? null;
}

function _replaceBlockWithList(blockEl, listTag, node) {
  const list = document.createElement(listTag);
  const li   = document.createElement('li');
  list.appendChild(li);

  if (blockEl && blockEl !== memoContent) {
    // 블록 안에 트리거 이외의 텍스트가 있으면 li 안으로 이동
    const remaining = blockEl.textContent.trim();
    if (remaining) li.textContent = remaining;
    blockEl.replaceWith(list);
  } else {
    // 직접 자식이 아닌 경우(드문 케이스) — 커서 위치에 삽입
    memoContent.appendChild(list);
  }

  const nr = document.createRange();
  nr.setStart(li, 0);
  nr.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(nr);
}

function handleAutoConvert(e) {
  if (e.key !== ' ') return;

  const sel = window.getSelection();
  if (!sel.rangeCount) return;

  const range = sel.getRangeAt(0);
  const node  = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return;

  const textBefore = node.textContent.slice(0, range.startOffset);

  // 불릿 리스트: `- ` or `* `
  if (textBefore === '-' || textBefore === '*') {
    e.preventDefault();
    node.textContent =
      node.textContent.slice(0, range.startOffset - textBefore.length) +
      node.textContent.slice(range.startOffset);
    _replaceBlockWithList(_currentBlock(node), 'ul', node);
    return;
  }

  // 번호 리스트: `1.` `2.` 등 — 트리거가 줄 전체여야 함
  if (/^\d+\.$/.test(textBefore) && textBefore.length === node.textContent.trim().length) {
    e.preventDefault();
    node.textContent = ''; // 트리거 전체 제거
    _replaceBlockWithList(_currentBlock(node), 'ol', node);
    return;
  }

  // 체크박스: `[]` or `[ ]`
  if (textBefore === '[]' || textBefore === '[ ]') {
    e.preventDefault();
    const len    = textBefore.length;
    const offset = range.startOffset;

    const parentEl  = node.parentNode;
    const textAfter = node.splitText(offset);
    node.textContent = node.textContent.slice(0, offset - len);

    const cb    = document.createElement('div');
    cb.className = 'cb-item';
    const input = document.createElement('input');
    input.type  = 'checkbox';
    const span  = document.createElement('span');
    span.textContent = '\u00A0';
    cb.appendChild(input);
    cb.appendChild(span);
    parentEl.insertBefore(cb, textAfter);

    if (!node.textContent)     node.remove();
    if (!textAfter.textContent) textAfter.remove();

    const nr = document.createRange();
    nr.selectNodeContents(span);
    nr.collapse(false);
    sel.removeAllRanges();
    sel.addRange(nr);

    scheduleSave();
    return;
  }
}

// ── 링크 삽입 (Ctrl+K / 우클릭 메뉴) ─────────
let _linkSavedRange = null;
let _linkSelectedText = '';

function insertLink() {
  const sel = window.getSelection();
  _linkSavedRange = sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  _linkSelectedText = sel?.toString().trim() || '';

  linkDialogInput.value = 'https://';
  linkDialogOverlay.classList.add('visible');
  requestAnimationFrame(() => {
    linkDialogInput.select();
    linkDialogInput.focus();
  });
}

function _applyLink() {
  const url = linkDialogInput.value.trim();
  linkDialogOverlay.classList.remove('visible');
  if (!url || url === 'https://') return;

  const text = _linkSelectedText || url;
  const accent = getCssAccentHex();
  const linkHtml = `<a href="${url}" target="_blank" rel="noopener" style="color:${accent};font-weight:700;">${escHtml(text)}</a>`;

  memoContent.focus();
  const s = window.getSelection();
  s.removeAllRanges();
  if (_linkSavedRange) {
    s.addRange(_linkSavedRange);
    if (!_linkSavedRange.collapsed) _linkSavedRange.deleteContents();
  }
  document.execCommand('insertHTML', false, linkHtml);
  scheduleSave();
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── 폰트 옵션 렌더 (로컬 폰트 열거) ──────────────
async function loadLocalFonts() {
  if (localFonts) return localFonts;
  try {
    if ('queryLocalFonts' in window) {
      const fonts = await window.queryLocalFonts();
      const seen = new Set();
      localFonts = [];
      for (const f of fonts) {
        if (!seen.has(f.family)) {
          seen.add(f.family);
          localFonts.push({ label: f.family, family: `"${f.family}"` });
        }
      }
      localFonts.sort((a, b) => a.label.localeCompare(b.label));
      return localFonts;
    }
  } catch { /* permission denied or not supported */ }
  localFonts = FONT_FALLBACKS;
  return localFonts;
}

function renderFontOptions(filter = '') {
  fontFamilies.innerHTML = '';
  const currentFamily = memoData?.font?.family || 'system-ui, sans-serif';
  const fonts = localFonts || FONT_FALLBACKS;
  const lowerFilter = filter.toLowerCase();
  const filtered = lowerFilter
    ? fonts.filter(f => f.label.toLowerCase().includes(lowerFilter))
    : fonts;
  const toShow = filtered.slice(0, 80); // 성능을 위해 최대 80개

  toShow.forEach(({ label, family }) => {
    const btn = document.createElement('button');
    btn.className = 'font-opt';
    btn.textContent = label;
    btn.style.fontFamily = family;
    if (currentFamily === family) btn.classList.add('selected');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      memoData.font = { ...(memoData.font || {}), family };
      document.documentElement.style.setProperty('--memo-font-family', family);
      saveMemoChanges({ font: memoData.font });
      renderFontOptions(fontSearch.value);
    });
    fontFamilies.appendChild(btn);
  });
}

// ── 이미지 에디터 ────────────────────────────
let imgEditorTarget      = null; // 편집 중인 <img> 요소
let imgEditorSrc         = new Image();
let imgEditorOriginalSrc = null; // 원본 이미지 (초기화용)
const imgEditorState = { rotation: 0, flipH: false, flipV: false, scale: 100, offsetX: 0, offsetY: 0 };

function openImageEditor(imgEl) {
  imgEditorTarget = imgEl;
  // dataset.originalSrc: 최초 한 번만 설정 → 적용 후 재편집 시에도 진짜 원본 유지
  if (!imgEl.dataset.originalSrc) imgEl.dataset.originalSrc = imgEl.src;
  imgEditorOriginalSrc = imgEl.dataset.originalSrc;

  Object.assign(imgEditorState, { rotation: 0, flipH: false, flipV: false, scale: 100, offsetX: 0, offsetY: 0 });
  document.getElementById('imgScale').value           = 100;
  document.getElementById('imgRotateSlider').value    = 0;
  document.getElementById('imgScaleVal').textContent  = '100%';
  document.getElementById('imgRotateVal').textContent = '0°';

  // 프로필 아바타 편집 시 원형 가이드 표시
  const circleOverlay = document.getElementById('imgEditorCircleOverlay');
  if (circleOverlay) {
    circleOverlay.classList.toggle('visible', !!imgEl.closest('#profileAvatar'));
  }

  imgEditorSrc = new Image();
  imgEditorSrc.onload = () => {
    redrawEditorCanvas();
    document.getElementById('imgEditorOverlay').classList.add('visible');
  };
  imgEditorSrc.src = imgEl.src; // 현재 (편집된) 이미지로 시작
}

function redrawEditorCanvas() {
  const CANVAS_W = 380, CANVAS_H = 260;
  const canvas = document.getElementById('imgEditorCanvas');
  const ctx    = canvas.getContext('2d');
  canvas.width  = CANVAS_W;
  canvas.height = CANVAS_H;

  const img = imgEditorSrc;
  const rot = imgEditorState.rotation; // 임의 각도 (도)
  const nw = img.naturalWidth, nh = img.naturalHeight;

  // 회전된 이미지의 바운딩 박스 기준으로 fit 스케일 계산
  const rotRad = rot * Math.PI / 180;
  const absCos = Math.abs(Math.cos(rotRad));
  const absSin = Math.abs(Math.sin(rotRad));
  const rotW   = nw * absCos + nh * absSin;
  const rotH   = nw * absSin + nh * absCos;
  const fitScale  = Math.min(CANVAS_W / rotW, CANVAS_H / rotH);
  const drawScale = fitScale * (imgEditorState.scale / 100);

  // 배경을 테마 배경색으로 채움 (검정 여백 방지)
  const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim() || '#1a1a2e';
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.save();
  ctx.translate(CANVAS_W / 2 + imgEditorState.offsetX, CANVAS_H / 2 + imgEditorState.offsetY);
  ctx.rotate(rotRad);
  if (imgEditorState.flipH) ctx.scale(-1, 1);
  if (imgEditorState.flipV) ctx.scale(1, -1);
  ctx.drawImage(img, -nw * drawScale / 2, -nh * drawScale / 2, nw * drawScale, nh * drawScale);
  ctx.restore();
}

function applyImageEdit() {
  if (!imgEditorTarget || !imgEditorSrc.naturalWidth) return;
  const CANVAS_W = 380, CANVAS_H = 260, DPR = 2;
  const img = imgEditorSrc;
  const rot = imgEditorState.rotation;
  const nw = img.naturalWidth, nh = img.naturalHeight;

  const rotRad = rot * Math.PI / 180;
  const absCos = Math.abs(Math.cos(rotRad));
  const absSin = Math.abs(Math.sin(rotRad));
  const rotW   = nw * absCos + nh * absSin;
  const rotH   = nw * absSin + nh * absCos;
  const fitScale  = Math.min(CANVAS_W / rotW, CANVAS_H / rotH);
  const drawScale = fitScale * (imgEditorState.scale / 100) * DPR;

  const offscreen = document.createElement('canvas');
  offscreen.width  = CANVAS_W * DPR;
  offscreen.height = CANVAS_H * DPR;
  const ctx = offscreen.getContext('2d');
  // 배경을 테마 배경색으로 채움
  const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim() || '#1a1a2e';
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, CANVAS_W * DPR, CANVAS_H * DPR);
  ctx.save();
  ctx.translate(
    CANVAS_W * DPR / 2 + imgEditorState.offsetX * DPR,
    CANVAS_H * DPR / 2 + imgEditorState.offsetY * DPR
  );
  ctx.rotate(rotRad);
  if (imgEditorState.flipH) ctx.scale(-1, 1);
  if (imgEditorState.flipV) ctx.scale(1, -1);
  ctx.drawImage(img, -nw * drawScale / 2, -nh * drawScale / 2, nw * drawScale, nh * drawScale);
  ctx.restore();
  const resultDataUrl = offscreen.toDataURL('image/jpeg', 0.92);
  imgEditorTarget.src = resultDataUrl;
  // 아바타 이미지면 프로필에도 저장
  if (imgEditorTarget.closest('#profileAvatar')) {
    memoData.profile = { ...(memoData.profile || {}), avatarDataUrl: resultDataUrl };
    saveMemoChanges({ profile: memoData.profile });
  } else {
    scheduleSave();
  }
  document.getElementById('imgEditorOverlay').classList.remove('visible');
  document.getElementById('imgEditorCircleOverlay')?.classList.remove('visible');
  imgEditorTarget = null;
}

// ── 텍스트 하이라이트 토글 ────────────────────
function toggleHighlight() {
  const sel = window.getSelection();
  if (!sel?.rangeCount || sel.isCollapsed) return;
  memoContent.focus();

  const range = sel.getRangeAt(0);
  let node = range.commonAncestorContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
  const existingMark = node.closest?.('mark');

  if (existingMark && memoContent.contains(existingMark)) {
    // 하이라이트 제거
    const parent = existingMark.parentNode;
    const frag = document.createDocumentFragment();
    while (existingMark.firstChild) frag.appendChild(existingMark.firstChild);
    parent.replaceChild(frag, existingMark);
    parent.normalize();
  } else {
    // 하이라이트 적용
    try {
      const mark = document.createElement('mark');
      range.surroundContents(mark);
    } catch {
      const mark = document.createElement('mark');
      const frag = range.extractContents();
      mark.appendChild(frag);
      range.insertNode(mark);
    }
  }
  scheduleSave();
}

// ── 서식 상태 초기화 (더블엔터 후 호출) ─────────
function resetFormattingAtCursor() {
  // 임시 문자 삽입 → select → removeFormat → 삭제
  // 이렇게 해야 브라우저의 "활성 서식" 기억이 초기화됨
  document.execCommand('insertText', false, '\u200B');
  const sel2 = window.getSelection();
  if (sel2?.rangeCount) {
    const r2 = sel2.getRangeAt(0).cloneRange();
    r2.setStart(r2.startContainer, r2.startOffset - 1);
    sel2.removeAllRanges();
    sel2.addRange(r2);
    document.execCommand('removeFormat');
    r2.collapse(false);
    sel2.removeAllRanges();
    sel2.addRange(r2);
    document.execCommand('delete');
  }
}

// ── 이벤트 바인딩 ─────────────────────────────
function bindEvents() {
  // 체크박스 delegated 이벤트 (박스 자체 클릭만 토글)
  memoContent.addEventListener('change', (e) => {
    if (e.target.matches('.cb-item input[type="checkbox"]')) {
      const cbItem = e.target.closest('.cb-item');
      if (cbItem) cbItem.classList.toggle('checked', e.target.checked);
      scheduleSave();
    }
  });

  // 콘텐츠 입력
  memoContent.addEventListener('input', scheduleSave);

  // 본문 내 링크 클릭 → 외부 브라우저 열기
  memoContent.addEventListener('click', (e) => {
    const anchor = e.target.closest('a[href]');
    if (anchor) {
      e.preventDefault();
      api.openExternal(anchor.href);
    }
  });

  // HR 블록(contenteditable=false) 클릭 시 커서 탈출
  memoContent.addEventListener('click', (e) => {
    // 패딩 영역(memoContent 자체) 클릭 → 마지막 편집 가능 요소로 커서 이동
    if (e.target === memoContent) {
      const lastEl = memoContent.lastElementChild;
      if (lastEl?.getAttribute('contenteditable') === 'false') {
        const newDiv = document.createElement('div');
        newDiv.innerHTML = '<br>';
        memoContent.appendChild(newDiv);
        try {
          const range = document.createRange();
          range.setStart(newDiv, 0);
          range.collapse(true);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          memoContent.focus();
        } catch {}
      }
      return;
    }
    // 커서가 contenteditable=false 내부에 있으면 다음 형제로 탈출
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    let cur = node;
    while (cur && cur !== memoContent) {
      if (cur.getAttribute?.('contenteditable') === 'false') {
        let next = cur.nextSibling;
        if (!next) {
          const newDiv = document.createElement('div');
          newDiv.innerHTML = '<br>';
          cur.parentNode.appendChild(newDiv);
          next = newDiv;
        }
        try {
          const range = document.createRange();
          range.setStart(next, 0);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          memoContent.focus();
        } catch {}
        break;
      }
      cur = cur.parentNode;
    }
  });

  // 서식 단축키
  memoContent.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'b')                            { e.preventDefault(); fmt('bold'); }
    else if (mod && e.key === 'i')                       { e.preventDefault(); fmt('italic'); }
    else if (mod && e.key === 'u')                       { e.preventDefault(); fmt('underline'); }
    else if (mod && e.shiftKey && e.key === 'X')         { e.preventDefault(); fmt('strikeThrough'); }
    else if (mod && e.shiftKey && e.key === 'H')         { e.preventDefault(); toggleHighlight(); }
    else if (mod && e.key === 'k')                       { e.preventDefault(); insertLink(); }
    else if (mod && e.key === 'z')                       { e.preventDefault(); document.execCommand('undo'); }
    else if (mod && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
      e.preventDefault(); document.execCommand('redo');
    } else if (e.key === 'Enter' && !e.shiftKey && !mod) {
      const sel = window.getSelection();
      if (sel?.rangeCount && sel.isCollapsed) {
        let node = sel.getRangeAt(0).startContainer;
        if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;

        // 하이라이트(<mark>) 안에서 Enter → mark 밖으로 탈출
        const markEl = node.closest?.('mark');
        if (markEl && memoContent.contains(markEl)) {
          e.preventDefault();
          let topEl = markEl;
          while (topEl.parentNode && topEl.parentNode !== memoContent) topEl = topEl.parentNode;
          const newDiv = document.createElement('div');
          newDiv.innerHTML = '<br>';
          memoContent.insertBefore(newDiv, topEl.nextSibling);
          const r = document.createRange();
          r.setStart(newDiv, 0);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
          resetFormattingAtCursor();
          scheduleSave();
          return;
        }

        // 체크박스 아이템 안에서 Enter
        const cbItem = node.closest?.('.cb-item');
        if (cbItem) {
          e.preventDefault();
          const span = cbItem.querySelector('span');
          const text = span ? span.textContent.replace(/\u00A0/g, '').trim() : '';

          // memoContent 직계 자식 레벨까지 올라가서 삽입 (들여쓰기 방지)
          let insertRef = cbItem;
          while (insertRef.parentNode && insertRef.parentNode !== memoContent) {
            insertRef = insertRef.parentNode;
          }

          if (text === '') {
            // 빈 체크박스에서 Enter → 체크박스 삭제, 일반 텍스트로 전환
            const newP = document.createElement('div');
            newP.innerHTML = '<br>';
            memoContent.insertBefore(newP, insertRef.nextSibling);
            cbItem.remove();
            const r = document.createRange();
            r.setStart(newP, 0);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
            // 브라우저의 활성 서식 기억 초기화
            resetFormattingAtCursor();
          } else {
            // 내용이 있는 체크박스에서 Enter → 새 체크박스 생성
            const newCb = document.createElement('div');
            newCb.className = 'cb-item';
            const newInput = document.createElement('input');
            newInput.type = 'checkbox';
            const newSpan = document.createElement('span');
            newSpan.textContent = '\u00A0';
            newCb.appendChild(newInput);
            newCb.appendChild(newSpan);
            memoContent.insertBefore(newCb, insertRef.nextSibling);
            const r = document.createRange();
            r.selectNodeContents(newSpan);
            r.collapse(false);
            sel.removeAllRanges();
            sel.addRange(r);
          }
          scheduleSave();
          return;
        }

        // 빈 리스트 항목에서 엔터 → 리스트 서식 해제
        const li = node.closest?.('li');
        if (li && li.textContent.trim() === '') {
          e.preventDefault();
          document.execCommand('outdent', false);
          scheduleSave();
        }
      }
    } else if (e.key === 'Backspace') {
      // 백스페이스: 체크박스 / 리스트 서식 간편 해제
      const bSel = window.getSelection();
      if (bSel?.rangeCount && bSel.isCollapsed) {
        const bRange = bSel.getRangeAt(0);
        let bNode = bRange.startContainer;
        if (bNode.nodeType === Node.TEXT_NODE) bNode = bNode.parentNode;

        // 체크박스 아이템 — 커서가 span 맨 앞에 있을 때 서식 해제
        const cbItem = bNode.closest?.('.cb-item');
        if (cbItem && memoContent.contains(cbItem)) {
          const cbSpan = cbItem.querySelector('span');
          const atStart = bRange.startOffset === 0 &&
            (bRange.startContainer === cbSpan || cbSpan?.contains(bRange.startContainer));
          if (atStart) {
            e.preventDefault();
            const text = cbSpan?.textContent.replace(/\u00A0/g, '').trim() || '';
            let ref = cbItem;
            while (ref.parentNode && ref.parentNode !== memoContent) ref = ref.parentNode;
            const newDiv = document.createElement('div');
            if (text) newDiv.textContent = text; else newDiv.innerHTML = '<br>';
            memoContent.insertBefore(newDiv, ref.nextSibling);
            ref.remove();
            const r = document.createRange();
            r.setStart(newDiv, 0); r.collapse(true);
            bSel.removeAllRanges(); bSel.addRange(r);
            scheduleSave();
            return;
          }
        }

        // 리스트 아이템 — 빈 li에서 백스페이스 → 리스트 탈출
        const li = bNode.closest?.('li');
        if (li && memoContent.contains(li) && li.textContent.trim() === '') {
          e.preventDefault();
          const list = li.parentElement;
          const prevEl = list.previousSibling;
          li.remove();
          if (list.children.length === 0) {
            // 빈 리스트 → 일반 div로 교체
            const newDiv = document.createElement('div');
            newDiv.innerHTML = '<br>';
            list.parentNode.insertBefore(newDiv, list);
            list.remove();
            const r = document.createRange();
            r.setStart(newDiv, 0); r.collapse(true);
            bSel.removeAllRanges(); bSel.addRange(r);
          } else if (prevEl) {
            // 이전 요소 끝으로 커서 이동
            const r = document.createRange();
            r.selectNodeContents(prevEl); r.collapse(false);
            bSel.removeAllRanges(); bSel.addRange(r);
          }
          scheduleSave();
          return;
        }
      }
    } else if (e.key === '-') {
      // --- 입력 시 수평 구분선으로 자동 변환 (<hr> — 텍스트 흐름 안에서 동작)
      const sel = window.getSelection();
      if (sel?.rangeCount) {
        const range = sel.getRangeAt(0);
        const node  = range.startContainer;
        if (node.nodeType === Node.TEXT_NODE) {
          const textBefore = node.textContent.slice(0, range.startOffset);
          if (textBefore === '--') {
            e.preventDefault();
            // 트리거 문자(--) 제거
            node.textContent =
              node.textContent.slice(0, range.startOffset - 2) +
              node.textContent.slice(range.startOffset);
            // 현재 블록의 최상위 요소 찾기
            let topEl = node;
            while (topEl.parentNode && topEl.parentNode !== memoContent) topEl = topEl.parentNode;
            // <hr> 삽입
            const hr = document.createElement('hr');
            memoContent.insertBefore(hr, topEl.nextSibling);
            // hr 뒤에 새 줄 (없으면 생성)
            let nextEl = hr.nextSibling;
            if (!nextEl) {
              nextEl = document.createElement('div');
              nextEl.innerHTML = '<br>';
              memoContent.appendChild(nextEl);
            }
            // 커서를 hr 다음 줄로 이동
            try {
              const r2 = document.createRange();
              r2.setStart(nextEl, 0);
              r2.collapse(true);
              sel.removeAllRanges();
              sel.addRange(r2);
              memoContent.focus();
            } catch {}
            scheduleSave();
          }
        }
      }
    }
    handleAutoConvert(e);
  });

  // URL 붙여넣기 → 하이퍼링크 자동 변환
  memoContent.addEventListener('paste', (e) => {
    const text = e.clipboardData.getData('text/plain').trim();
    if (/^https?:\/\/\S+$/.test(text)) {
      e.preventDefault();
      const sel  = window.getSelection();
      const label = sel?.toString().trim() || text;
      document.execCommand('insertHTML', false,
        `<a href="${text}" target="_blank" rel="noopener">${label}</a>`);
    }
  });

  // 핀
  btnPin.addEventListener('click', async () => {
    isPinned = !isPinned;
    await api.pinMemo(isPinned);
    updatePinButton();
  });

  // 투명도
  btnOpacity.addEventListener('click', (e) => {
    e.stopPropagation();
    opacityPopup.classList.toggle('visible');
    colorPopup.classList.remove('visible');
  });
  opacitySlider.addEventListener('input', () => {
    const val = parseFloat(opacitySlider.value);
    opacityValue.textContent = `${Math.round(val * 100)}%`;
    api.setOpacity(val);
  });

  // 숨기기 (목록에는 계속 보임)
  btnMinimize.addEventListener('click', hideWindow);

  // 테마 토글
  btnThemeToggle.addEventListener('click', async () => {
    const newMode = currentMode === 'dark' ? 'light' : 'dark';
    await api.setThemeMode(newMode);
    currentMode = newMode;
    setThemeMode(newMode);
    updateThemeToggleIcon();
    applyTheme(memoData?.theme?.accent ?? null, newMode);
  });

  // 컬러 도트
  colorDot.addEventListener('click', (e) => {
    e.stopPropagation();
    colorPopup.classList.toggle('visible');
    opacityPopup.classList.remove('visible');
  });
  colorPickerCustom.addEventListener('input', () => {
    selectAccentColor(colorPickerCustom.value);
  });

  // 삭제
  btnDelete.addEventListener('click', async () => {
    if (confirm('이 메모를 삭제할까요?')) await api.deleteMemo();
  });

  // 새 메모
  btnNewMemo.addEventListener('click', () => api.createMemo());

  // 좋아요
  btnLike.addEventListener('click', () => {
    isLiked = !isLiked;
    saveMemoChanges({ liked: isLiked });
    updateLikeButton();
  });

  // 답글 스레드 접기/펼치기 버튼
  btnThreadFold.addEventListener('click', () => {
    const id = memoData?.parentId || memoData?.id;
    if (id) api.foldThread(id);
  });

  // 이미지 첨부 — Twitter-style 미디어 그리드
  btnImage.addEventListener('click', () => imageFileInput.click());
  imageFileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const grid = getOrCreateGrid();

    let loaded = 0;
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        addImageToGrid(grid, ev.target.result);
        loaded++;
        if (loaded === files.length) updateGridCount(grid);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  });

  // 글자 색상 — textColorInput (우클릭 메뉴 커스텀 색상용)
  textColorInput.addEventListener('change', () => {
    const color = textColorInput.value;
    memoContent.focus();
    if (savedTextRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedTextRange);
      savedTextRange = null;
    }
    document.execCommand('foreColor', false, color);
    scheduleSave();
  });

  // 아바타 클릭 → 파일 선택 후 에디터 자동 오픈
  profileAvatar.addEventListener('click', async (e) => {
    e.stopPropagation();
    const dataUrl = await api.pickImageFile();
    if (!dataUrl) return;
    memoData.profile = { ...(memoData.profile || {}), avatarDataUrl: dataUrl };
    saveMemoChanges({ profile: memoData.profile });
    renderAvatar();
    // 선택한 이미지 즉시 에디터로 오픈
    await new Promise(r => requestAnimationFrame(r));
    const img = profileAvatar.querySelector('img');
    if (img) openImageEditor(img);
  });
  // 아바타 우클릭 → 컨텍스트 메뉴 (편집/삭제/프로필 저장·불러오기)
  profileAvatar.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('.avatar-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'avatar-menu';
    profileAvatar.style.position = 'relative';

    if (memoData?.profile?.avatarDataUrl) {
      const editBtn = document.createElement('button');
      editBtn.textContent = '사진 편집';
      editBtn.addEventListener('click', (ev) => {
        ev.stopPropagation(); menu.remove();
        const img = profileAvatar.querySelector('img');
        if (img) openImageEditor(img);
      });
      menu.appendChild(editBtn);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'danger';
      removeBtn.textContent = '사진 삭제';
      removeBtn.addEventListener('click', (ev) => {
        ev.stopPropagation(); menu.remove();
        memoData.profile = { ...(memoData.profile || {}), avatarDataUrl: null };
        saveMemoChanges({ profile: memoData.profile });
        renderAvatar();
      });
      menu.appendChild(removeBtn);

      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:var(--color-border);margin:3px 0';
      menu.appendChild(sep);
    }

    // 이 프로필 저장
    const saveProfileBtn = document.createElement('button');
    saveProfileBtn.textContent = '이 프로필 저장';
    saveProfileBtn.addEventListener('click', async (ev) => {
      ev.stopPropagation(); menu.remove();
      const profile = memoData?.profile || {};
      await api.saveProfile({
        name: profile.name || '메모',
        handle: profile.handle || 'note',
        avatarDataUrl: profile.avatarDataUrl || null,
      });
    });
    menu.appendChild(saveProfileBtn);

    // 저장된 프로필 불러오기
    const loadProfileBtn = document.createElement('button');
    loadProfileBtn.textContent = '저장된 프로필 불러오기';
    loadProfileBtn.addEventListener('click', async (ev) => {
      ev.stopPropagation(); menu.remove();
      showProfileLoadOverlay();
    });
    menu.appendChild(loadProfileBtn);

    profileAvatar.appendChild(menu);
    const closeMenu = () => { menu.remove(); document.removeEventListener('click', closeMenu); };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  });
  avatarFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      memoData.profile = { ...(memoData.profile || {}), avatarDataUrl: ev.target.result };
      saveMemoChanges({ profile: memoData.profile });
      renderAvatar();
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  // 답글 (스레드)
  btnReply.addEventListener('click', () => {
    if (memoData?.id) api.createReply(memoData.id);
  });

  // 심볼 버튼 → 메모 목록 열기
  symbolBtn.addEventListener('click', () => api.openList());

  // 프로필 이름 인라인 편집
  displayName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); displayName.blur(); }
  });
  displayName.addEventListener('blur', () => {
    const name = displayName.textContent.trim() || '메모';
    displayName.textContent = name;
    memoData.profile = { ...(memoData.profile || {}), name };
    saveMemoChanges({ profile: memoData.profile });
    renderAvatar();
  });

  // 핸들 인라인 편집
  handleText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleText.blur(); }
  });
  handleText.addEventListener('blur', () => {
    let handle = handleText.textContent.trim().replace(/^@/, '') || 'note';
    handleText.textContent = `@${handle}`;
    memoData.profile = { ...(memoData.profile || {}), handle };
    saveMemoChanges({ profile: memoData.profile });
  });

  // 폰트 팝업
  btnFont.addEventListener('click', (e) => {
    e.stopPropagation();
    fontPopup.classList.toggle('visible');
    opacityPopup.classList.remove('visible');
    colorPopup.classList.remove('visible');
    capturePopup.classList.remove('visible');
    if (fontPopup.classList.contains('visible')) {
      fontSearch.value = '';
      renderFontOptions();
      fontSearch.focus();
    }
  });
  fontSearch.addEventListener('input', () => renderFontOptions(fontSearch.value));
  fontSearch.addEventListener('click', (e) => e.stopPropagation());
  fontSizeSlider.addEventListener('input', () => {
    const size = parseInt(fontSizeSlider.value, 10);
    fontSizeValue.textContent = `${size}px`;
    document.documentElement.style.setProperty('--memo-font-size', `${size}px`);
    memoData.font = { ...(memoData.font || {}), size };
    saveMemoChanges({ font: memoData.font });
  });

  // 캡처 팝업 토글
  btnCapture.addEventListener('click', (e) => {
    e.stopPropagation();
    capturePopup.classList.toggle('visible');
    fontPopup.classList.remove('visible');
  });

  // 캡처 — 상태바 제외, 투명 여백 포함 카드 영역 캡처
  async function doCapture(action) {
    capturePopup.classList.remove('visible');
    // 이미지 에디터가 열려있으면 캡처 중 임시 숨김
    const editorOverlay = document.getElementById('imgEditorOverlay');
    const editorOpen = editorOverlay.classList.contains('visible');
    if (editorOpen) editorOverlay.style.visibility = 'hidden';
    // 리페인트 대기 (팝업이 완전히 사라진 뒤 캡처)
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const memoCard  = document.querySelector('.memo-card');
    const statusBar = document.getElementById('statusBar');
    const sbRect   = statusBar.getBoundingClientRect();
    const cardRect = memoCard.getBoundingClientRect();
    const dpr      = window.devicePixelRatio || 1;
    const pad      = Math.round(6 * dpr); // 투명 여백
    const captureRect = {
      x:      Math.max(0, Math.floor(cardRect.x * dpr) - pad),
      y:      Math.max(0, Math.floor(cardRect.y * dpr) - pad),
      width:  Math.ceil(cardRect.width * dpr) + pad * 2,
      height: Math.ceil(cardRect.height * dpr) + pad * 2,
    };
    try {
      await api.captureCard({ rect: captureRect, action });
    } catch (err) {
      console.error('캡처 실패:', err);
    } finally {
      if (editorOpen) editorOverlay.style.visibility = '';
    }
  }

  btnCaptureClipboard.addEventListener('click', () => doCapture('clipboard'));
  btnCaptureSave.addEventListener('click',      () => doCapture('save'));

  // 미디어 영역 접기/펼치기
  document.getElementById('btnMediaFold').addEventListener('click', () => {
    mediaFolded = !mediaFolded;
    mediaArea.classList.toggle('folded', mediaFolded);
    updateMediaHeaderVisibility();
    const icon = document.getElementById('mediaFoldIcon');
    if (icon) {
      icon.setAttribute('data-lucide', mediaFolded ? 'chevron-down' : 'chevron-up');
      if (window.lucide) lucide.createIcons({ nodes: [icon] });
    }
  });

  // 하이라이트 버튼 (우클릭 메뉴에서만 사용 — action bar 버튼 삭제됨)

  // ── 잠금 토글 (simple-mode = 콘텐츠 잠금) ────────
  function applyLockMode(locked) {
    isSimpleMode = locked;
    document.querySelector('.memo-card').classList.toggle('simple-mode', locked);
    // 콘텐츠 편집 가능 여부 제어
    memoContent.contentEditable = locked ? 'false' : 'true';
    const icon = btnSimpleView?.querySelector('[data-lucide]');
    if (icon) {
      icon.setAttribute('data-lucide', locked ? 'eye' : 'eye-off');
      if (window.lucide) lucide.createIcons({ nodes: [icon] });
    }
    saveMemoChanges({ simpleMode: locked });
  }

  btnSimpleView?.addEventListener('click', () => applyLockMode(!isSimpleMode));

  // 잠금 복원 버튼
  document.getElementById('btnRestoreDetail')?.addEventListener('click', () => applyLockMode(false));


  // ── 우클릭 서식 메뉴 (텍스트 선택 시) ───────────
  {
    let fmtMenu = null;

    function hideFmtMenu() {
      if (fmtMenu) { fmtMenu.remove(); fmtMenu = null; }
    }

    function showFmtMenu(x, y, hasSelection = false, insertHrFn = null) {
      hideFmtMenu();
      fmtMenu = document.createElement('div');
      fmtMenu.className = 'fmt-menu';

      if (hasSelection) {
        const makeBtn = (label, cmd, val) => {
          const btn = document.createElement('button');
          btn.className = 'fmt-btn';
          btn.textContent = label;
          btn.title = cmd;
          btn.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            memoContent.focus();
            document.execCommand(cmd, false, val || null);
            scheduleSave();
            hideFmtMenu();
          });
          return btn;
        };

        fmtMenu.appendChild(makeBtn('B', 'bold'));
        fmtMenu.appendChild(makeBtn('I', 'italic'));
        fmtMenu.appendChild(makeBtn('U', 'underline'));
        fmtMenu.appendChild(makeBtn('S', 'strikeThrough'));

        const sep1 = document.createElement('span');
        sep1.className = 'fmt-sep';
        fmtMenu.appendChild(sep1);

        // 글자색 팔레트 — 5색 + 커스텀
        const fmtColors = generateTextPalette();
        fmtColors.forEach(color => {
          const sw = document.createElement('button');
          sw.className = 'fmt-btn fmt-color-swatch';
          sw.title = color;
          sw.innerHTML = `<span style="width:14px;height:14px;border-radius:50%;background:${color};display:inline-block;border:1.5px solid rgba(128,128,128,0.3);flex-shrink:0"></span>`;
          sw.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            const sel2 = window.getSelection();
            if (sel2?.rangeCount && !sel2.isCollapsed) savedTextRange = sel2.getRangeAt(0).cloneRange();
            memoContent.focus();
            if (savedTextRange) {
              const s2 = window.getSelection();
              s2.removeAllRanges();
              s2.addRange(savedTextRange);
              savedTextRange = null;
            }
            document.execCommand('foreColor', false, color);
            scheduleSave();
            hideFmtMenu();
          });
          fmtMenu.appendChild(sw);
        });
        // 커스텀 색상
        const customColorBtn = document.createElement('button');
        customColorBtn.className = 'fmt-btn fmt-color-swatch';
        customColorBtn.title = '커스텀 색상';
        customColorBtn.innerHTML = '<span style="width:14px;height:14px;border-radius:50%;border:1.5px dashed rgba(160,160,160,0.7);display:inline-block;flex-shrink:0"></span>';
        customColorBtn.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          const sel2 = window.getSelection();
          if (sel2?.rangeCount && !sel2.isCollapsed) savedTextRange = sel2.getRangeAt(0).cloneRange();
          hideFmtMenu();
          textColorInput.click();
        });
        fmtMenu.appendChild(customColorBtn);

        const sep2 = document.createElement('span');
        sep2.className = 'fmt-sep';
        fmtMenu.appendChild(sep2);

        const linkBtn = document.createElement('button');
        linkBtn.className = 'fmt-btn';
        linkBtn.title = '링크 삽입';
        linkBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
        linkBtn.addEventListener('mousedown', (ev) => { ev.preventDefault(); hideFmtMenu(); insertLink(); });
        fmtMenu.appendChild(linkBtn);

        const hlBtn = document.createElement('button');
        hlBtn.className = 'fmt-btn';
        hlBtn.title = '하이라이트';
        hlBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>';
        hlBtn.addEventListener('mousedown', (ev) => { ev.preventDefault(); hideFmtMenu(); toggleHighlight(); });
        fmtMenu.appendChild(hlBtn);

        if (insertHrFn) {
          const sep3 = document.createElement('span');
          sep3.className = 'fmt-sep';
          fmtMenu.appendChild(sep3);
        }
      }

      // 구분선 삽입 버튼 (항상 표시)
      if (insertHrFn) {
        const hrBtn = document.createElement('button');
        hrBtn.className = 'fmt-btn';
        hrBtn.title = '구분선 삽입';
        hrBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/></svg>';
        hrBtn.addEventListener('mousedown', (ev) => { ev.preventDefault(); hideFmtMenu(); insertHrFn(); });
        fmtMenu.appendChild(hrBtn);
      }

      document.body.appendChild(fmtMenu);
      const rect = fmtMenu.getBoundingClientRect();
      let fx = x, fy = y - rect.height - 8;
      if (fx + rect.width > window.innerWidth)  fx = window.innerWidth - rect.width - 4;
      if (fy < 0) fy = y + 8;
      fmtMenu.style.left = `${fx}px`;
      fmtMenu.style.top  = `${fy}px`;
    }

    // 구분선 삽입 함수 (우클릭 메뉴 & 키보드에서 사용)
    function insertHr() {
      memoContent.focus();
      const sel2 = window.getSelection();
      const hr = document.createElement('hr');
      if (sel2?.rangeCount) {
        const r = sel2.getRangeAt(0);
        r.deleteContents();
        // 현재 위치 기준 삽입
        let topEl = r.startContainer;
        if (topEl.nodeType === Node.TEXT_NODE) topEl = topEl.parentNode;
        while (topEl.parentNode && topEl.parentNode !== memoContent) topEl = topEl.parentNode;
        memoContent.insertBefore(hr, topEl.nextSibling);
      } else {
        memoContent.appendChild(hr);
      }
      // hr 다음에 새 줄 보장
      let nextEl = hr.nextSibling;
      if (!nextEl) {
        nextEl = document.createElement('div');
        nextEl.innerHTML = '<br>';
        memoContent.appendChild(nextEl);
      }
      try {
        const r2 = document.createRange();
        r2.setStart(nextEl, 0);
        r2.collapse(true);
        sel2.removeAllRanges();
        sel2.addRange(r2);
        memoContent.focus();
      } catch {}
      scheduleSave();
    }

    memoContent.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const sel = window.getSelection();
      const hasSelection = sel && !sel.isCollapsed && sel.toString().trim().length > 0;
      showFmtMenu(e.clientX, e.clientY, hasSelection, insertHr);
    });

    document.addEventListener('click', (e) => {
      if (fmtMenu && !fmtMenu.contains(e.target)) hideFmtMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (fmtMenu && e.key === 'Escape') hideFmtMenu();
    });
  }

  // 이미지 에디터 닫기 헬퍼
  function closeImageEditor() {
    document.getElementById('imgEditorOverlay').classList.remove('visible');
    document.getElementById('imgEditorCircleOverlay')?.classList.remove('visible');
    imgEditorTarget = null;
  }

  // 이미지 에디터 이벤트
  document.getElementById('imgEditorClose').addEventListener('click', closeImageEditor);
  document.getElementById('imgEditorCancel').addEventListener('click', closeImageEditor);
  document.getElementById('imgEditorApply').addEventListener('click', applyImageEdit);

  // 초기화: 원본 이미지로 완전히 되돌리기 (적용 후에도 가능)
  document.getElementById('imgEditorReset')?.addEventListener('click', () => {
    if (!imgEditorTarget || !imgEditorOriginalSrc) return;
    imgEditorTarget.src = imgEditorOriginalSrc;
    // 아바타면 프로필에도 저장
    if (imgEditorTarget.closest('#profileAvatar')) {
      memoData.profile = { ...(memoData.profile || {}), avatarDataUrl: imgEditorOriginalSrc };
      saveMemoChanges({ profile: memoData.profile });
      renderAvatar();
    } else {
      scheduleSave();
    }
    // 에디터 상태도 리셋 후 원본으로 재로드
    Object.assign(imgEditorState, { rotation: 0, flipH: false, flipV: false, scale: 100, offsetX: 0, offsetY: 0 });
    document.getElementById('imgScale').value        = 100;
    document.getElementById('imgRotateSlider').value = 0;
    document.getElementById('imgScaleVal').textContent  = '100%';
    document.getElementById('imgRotateVal').textContent = '0°';
    imgEditorSrc = new Image();
    imgEditorSrc.onload = redrawEditorCanvas;
    imgEditorSrc.src = imgEditorOriginalSrc;
  });

  document.getElementById('imgFlipH').addEventListener('click', () => {
    imgEditorState.flipH = !imgEditorState.flipH;
    redrawEditorCanvas();
  });
  document.getElementById('imgFlipV').addEventListener('click', () => {
    imgEditorState.flipV = !imgEditorState.flipV;
    redrawEditorCanvas();
  });
  document.getElementById('imgScale').addEventListener('input', (e) => {
    imgEditorState.scale = parseInt(e.target.value);
    document.getElementById('imgScaleVal').textContent = `${imgEditorState.scale}%`;
    redrawEditorCanvas();
  });
  document.getElementById('imgRotateSlider').addEventListener('input', (e) => {
    imgEditorState.rotation = parseInt(e.target.value);
    document.getElementById('imgRotateVal').textContent = `${imgEditorState.rotation}°`;
    redrawEditorCanvas();
  });
  document.getElementById('imgResetTransform').addEventListener('click', () => {
    Object.assign(imgEditorState, { rotation: 0, flipH: false, flipV: false, scale: 100, offsetX: 0, offsetY: 0 });
    document.getElementById('imgScale').value        = 100;
    document.getElementById('imgRotateSlider').value = 0;
    document.getElementById('imgScaleVal').textContent  = '100%';
    document.getElementById('imgRotateVal').textContent = '0°';
    redrawEditorCanvas();
  });

  // 캔버스 드래그로 이미지 이동 (pan)
  {
    const editorCanvas = document.getElementById('imgEditorCanvas');
    let _drag = null;
    editorCanvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      _drag = { x: e.clientX - imgEditorState.offsetX, y: e.clientY - imgEditorState.offsetY };
      editorCanvas.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e) => {
      if (!_drag) return;
      imgEditorState.offsetX = e.clientX - _drag.x;
      imgEditorState.offsetY = e.clientY - _drag.y;
      redrawEditorCanvas();
    });
    window.addEventListener('mouseup', () => {
      if (!_drag) return;
      _drag = null;
      editorCanvas.style.cursor = 'grab';
    });
  }

  // 외부 클릭 시 팝업 닫기
  document.addEventListener('click', (e) => {
    const opWrap   = document.getElementById('opacityWrap');
    const colWrap  = document.getElementById('colorWrap');
    const capWrap  = document.getElementById('captureWrap');
    const fntWrap  = document.getElementById('fontWrap');
    if (!opWrap?.contains(e.target))  opacityPopup.classList.remove('visible');
    if (!colWrap?.contains(e.target)) colorPopup.classList.remove('visible');
    if (!capWrap?.contains(e.target)) capturePopup.classList.remove('visible');
    if (!fntWrap?.contains(e.target)) fontPopup.classList.remove('visible');
  });

  // 프로필 로드 오버레이 닫기
  document.getElementById('profileLoadClose')?.addEventListener('click', () => {
    document.getElementById('profileLoadOverlay')?.classList.remove('visible');
  });
  document.getElementById('profileLoadOverlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('profileLoadOverlay')) {
      document.getElementById('profileLoadOverlay').classList.remove('visible');
    }
  });

  // 링크 다이얼로그 이벤트
  linkDialogConfirm?.addEventListener('click', _applyLink);
  linkDialogCancel?.addEventListener('click', () => linkDialogOverlay.classList.remove('visible'));
  linkDialogInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); _applyLink(); }
    if (e.key === 'Escape') { e.preventDefault(); linkDialogOverlay.classList.remove('visible'); }
    e.stopPropagation();
  });

  // 전역 단축키
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      api.createMemo();
    }
  });

  // 반응형 액션바: 너비에 따라 낮은 우선순위 버튼부터 동적 숨김
  {
    const actionIcons = document.querySelector('.action-icons');
    const BTN = 32;
    const hideOrder = [
      '.action-icon-btn.reply',
      '.action-icon-btn.thread-fold',
      '.action-icon-btn.font',
      '.action-icon-btn.image',
      '.action-icon-btn.like',
      '.action-icon-btn.new-memo',
    ];

    function syncActionIcons() {
      if (!actionIcons) return;
      const w = actionIcons.getBoundingClientRect().width;
      if (w === 0) return;
      const slots  = Math.floor(w / BTN);
      const toHide = Math.max(0, hideOrder.length - slots);
      hideOrder.forEach((sel, i) => {
        const btn = actionIcons.querySelector(sel);
        if (btn) btn.style.display = i < toHide ? 'none' : '';
      });
    }

    // 즉시 실행 (첫 렌더)
    syncActionIcons();
    requestAnimationFrame(syncActionIcons);
    setTimeout(syncActionIcons, 150);

    // 창 크기 변경 시
    window.addEventListener('resize', syncActionIcons);

    // 요소 크기 변경 시 (ResizeObserver)
    if (actionIcons && typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(syncActionIcons).observe(actionIcons);
    }
  }
}

// ── 저장된 프로필 불러오기 오버레이 ──────────────
async function showProfileLoadOverlay() {
  const overlay = document.getElementById('profileLoadOverlay');
  const list    = document.getElementById('profileLoadList');
  const profiles = await api.getProfiles();
  list.innerHTML = '';

  if (!profiles || profiles.length === 0) {
    list.innerHTML = '<div class="profile-load-empty">저장된 프로필이 없습니다</div>';
  } else {
    profiles.forEach(p => {
      const item = document.createElement('div');
      item.className = 'profile-load-item';

      const avatar = document.createElement('div');
      avatar.className = 'profile-load-avatar';
      if (p.avatarDataUrl) {
        const img = document.createElement('img');
        img.src = p.avatarDataUrl;
        avatar.appendChild(img);
      } else {
        avatar.textContent = (p.name || '메')[0].toUpperCase();
      }

      const info = document.createElement('div');
      info.className = 'profile-load-info';
      info.innerHTML = `<strong>${escHtml(p.name || '메모')}</strong><span>@${escHtml(p.handle || 'note')}</span>`;

      const applyBtn = document.createElement('button');
      applyBtn.className = 'profile-load-apply';
      applyBtn.textContent = '적용';
      applyBtn.addEventListener('click', () => {
        memoData.profile = {
          ...(memoData.profile || {}),
          name: p.name,
          handle: p.handle,
          avatarDataUrl: p.avatarDataUrl,
        };
        saveMemoChanges({ profile: memoData.profile });
        displayName.textContent = p.name || '메모';
        handleText.textContent  = p.handle ? `@${p.handle}` : '@note';
        renderAvatar();
        overlay.classList.remove('visible');
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'profile-load-del';
      delBtn.textContent = '삭제';
      delBtn.addEventListener('click', async () => {
        await api.deleteProfile(p.name);
        item.remove();
        if (list.querySelectorAll('.profile-load-item').length === 0) {
          list.innerHTML = '<div class="profile-load-empty">저장된 프로필이 없습니다</div>';
        }
      });

      item.appendChild(avatar);
      item.appendChild(info);
      item.appendChild(applyBtn);
      item.appendChild(delBtn);
      list.appendChild(item);
    });
  }

  overlay.classList.add('visible');
}

// ── 실행 ──────────────────────────────────────
init().catch(console.error);
