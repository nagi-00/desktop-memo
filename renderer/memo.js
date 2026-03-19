/**
 * memo.js — Spec v2 렌더러 로직
 * Twitter-card UI, 텍스트 서식, 자동변환, 최소화, 북마크, 프로필 편집
 */
import { generatePalette, applyPalette, resetPalette, setThemeMode, PRESETS } from './theme.js';

const api = window.memoAPI;

// ── 상태 ──────────────────────────────────────
let memoData     = null;
let currentMode  = 'dark';
let isPinned     = false;
let isMinimized  = false;
let isBookmarked = false;
let isLiked      = false;
let saveTimer    = null;

// ── DOM 참조 ──────────────────────────────────
const memoRoot    = document.getElementById('memoRoot');
const cardView    = document.getElementById('cardView');
const bubbleView  = document.getElementById('bubbleView');
const bubbleBtn   = document.getElementById('bubbleBtn');
const bubbleIcon  = document.getElementById('bubbleIcon');

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
const btnThemeToggle = document.getElementById('btnThemeToggle');
const colorDot       = document.getElementById('colorDot');
const colorPopup     = document.getElementById('colorPopup');
const colorSwatches  = document.getElementById('colorSwatches');
const colorPickerCustom = document.getElementById('colorPickerCustom');
const btnDelete      = document.getElementById('btnDelete');

const btnReply      = document.getElementById('btnReply');
const btnLink       = document.getElementById('btnLink');
const btnBookmark   = document.getElementById('btnBookmark');
const btnLike       = document.getElementById('btnLike');
const btnNewMemo    = document.getElementById('btnNewMemo');
const btnImage      = document.getElementById('btnImage');
const btnTextColor  = document.getElementById('btnTextColor');
const imageFileInput  = document.getElementById('imageFileInput');
const avatarFileInput = document.getElementById('avatarFileInput');
const textColorInput  = document.getElementById('textColorInput');
const bubbleEditBtn   = document.getElementById('bubbleEditBtn');
const btnCapture      = document.getElementById('btnCapture');
const capturePopup    = document.getElementById('capturePopup');
const btnCaptureClipboard = document.getElementById('btnCaptureClipboard');
const btnCaptureSave      = document.getElementById('btnCaptureSave');

let savedTextRange = null; // 텍스트 색상 적용 전 선택 범위 저장

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

  // 투명도
  const opacity = memoData.opacity ?? 1.0;
  opacitySlider.value = opacity;
  opacityValue.textContent = `${Math.round(opacity * 100)}%`;

  // 북마크 / 좋아요
  isBookmarked = memoData.bookmarked || false;
  isLiked      = memoData.liked      || false;
  updateBookmarkButton();
  updateLikeButton();

  // 버블 아이콘
  bubbleIcon.textContent = profile.bubbleIcon || '📝';

  // 스와치 렌더링
  renderColorSwatches();

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
  profileAvatar.innerHTML = '';
  const name = memoData?.profile?.name || '메';
  const img  = memoData?.profile?.avatarDataUrl;
  if (img) {
    const el = document.createElement('img');
    el.src = img;
    profileAvatar.appendChild(el);
  } else {
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

// ── 북마크 / 좋아요 버튼 (아이콘 유지, SVG fill 채색) ──
function updateBookmarkButton() {
  btnBookmark.classList.toggle('active', isBookmarked);
}

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

  // Default 뉴트럴 스와치
  const defBtn = document.createElement('button');
  defBtn.className = 'color-swatch';
  defBtn.style.background = 'conic-gradient(#888 0deg 180deg, #fff 180deg)';
  defBtn.title = 'Default (테마 없음)';
  if (currentAccent === null) defBtn.classList.add('selected');
  defBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    selectAccentColor(null);
  });
  colorSwatches.appendChild(defBtn);

  PRESETS.filter(p => p.accent !== null).forEach(({ name, accent }) => {
    const btn = document.createElement('button');
    btn.className = 'color-swatch';
    btn.style.background = accent;
    btn.title = name;
    if (currentAccent === accent) btn.classList.add('selected');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectAccentColor(accent);
    });
    colorSwatches.appendChild(btn);
  });
}

function selectAccentColor(hex) {
  memoData.theme = { ...(memoData.theme || {}), accent: hex };
  applyTheme(hex, currentMode);
  saveMemoChanges({ theme: memoData.theme });
  renderColorSwatches();
}

// ── 최소화 ────────────────────────────────────
function setMinimized(minimized, sendIpc = true) {
  isMinimized = minimized;
  memoRoot.classList.toggle('minimized', minimized);
  if (sendIpc) {
    api.toggleMinimize(minimized).catch(console.error);
  }
}

// ── 저장 ──────────────────────────────────────
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const contentHtml = memoContent.innerHTML;
    const content     = memoContent.textContent;
    memoData.contentHtml = contentHtml;
    memoData.content     = content;
    saveMemoChanges({ contentHtml, content });
  }, 500);
}

function saveMemoChanges(changes) {
  api.updateMemo(changes).catch(console.error);
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
function handleAutoConvert(e) {
  if (e.key !== ' ') return;

  const sel = window.getSelection();
  if (!sel.rangeCount) return;

  const range    = sel.getRangeAt(0);
  const node     = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return;

  const textBefore = node.textContent.slice(0, range.startOffset);

  // 불릿 리스트: `- ` or `* `
  if (textBefore === '-' || textBefore === '*') {
    e.preventDefault();
    // 트리거 문자 제거
    node.textContent =
      node.textContent.slice(0, range.startOffset - textBefore.length) +
      node.textContent.slice(range.startOffset);
    const r2 = document.createRange();
    r2.setStart(node, 0); r2.collapse(true);
    sel.removeAllRanges(); sel.addRange(r2);
    document.execCommand('insertUnorderedList', false, null);
    return;
  }

  // 번호 리스트: `1.` `2.` 등
  if (/^\d+\.$/.test(textBefore)) {
    e.preventDefault();
    const len = textBefore.length;
    node.textContent =
      node.textContent.slice(0, range.startOffset - len) +
      node.textContent.slice(range.startOffset);
    const r2 = document.createRange();
    r2.setStart(node, 0); r2.collapse(true);
    sel.removeAllRanges(); sel.addRange(r2);
    document.execCommand('insertOrderedList', false, null);
    return;
  }

  // 체크박스: `[]` or `[ ]`
  if (textBefore === '[]' || textBefore === '[ ]') {
    e.preventDefault();
    const len = textBefore.length;
    node.textContent =
      node.textContent.slice(0, range.startOffset - len) +
      node.textContent.slice(range.startOffset);
    // 커서 앞에 체크박스 삽입
    const cb = document.createElement('label');
    cb.className = 'cb-item';
    cb.innerHTML = '<input type="checkbox"><span>&nbsp;</span>';
    cb.querySelector('input').addEventListener('change', (ev) => {
      cb.classList.toggle('checked', ev.target.checked);
      scheduleSave();
    });
    document.execCommand('insertHTML', false, cb.outerHTML);
    return;
  }
}

// ── 링크 삽입 (Ctrl+K) ────────────────────────
function insertLink() {
  const sel = window.getSelection();
  const selectedText = sel?.toString().trim() || '';
  const url = prompt('URL을 입력하세요:', 'https://');
  if (!url) return;
  const text = selectedText || url;
  memoContent.focus();
  if (selectedText) {
    document.execCommand('createLink', false, url);
  } else {
    document.execCommand('insertHTML', false,
      `<a href="${url}" target="_blank" rel="noopener">${text}</a>`);
  }
  scheduleSave();
}

// ── 이벤트 바인딩 ─────────────────────────────
function bindEvents() {
  // 콘텐츠 입력
  memoContent.addEventListener('input', scheduleSave);

  // 서식 단축키
  memoContent.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'b')                       { e.preventDefault(); fmt('bold'); }
    else if (mod && e.key === 'i')                  { e.preventDefault(); fmt('italic'); }
    else if (mod && e.key === 'u')                  { e.preventDefault(); fmt('underline'); }
    else if (mod && e.shiftKey && e.key === 'X')    { e.preventDefault(); fmt('strikeThrough'); }
    else if (mod && e.key === 'k')                  { e.preventDefault(); insertLink(); }
    else if (mod && e.key === 'z')                  { e.preventDefault(); document.execCommand('undo'); }
    else if (mod && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
      e.preventDefault(); document.execCommand('redo');
    } else if (e.key === 'Enter' && !e.shiftKey && !mod) {
      // 빈 리스트 항목에서 엔터 → 리스트 서식 해제
      const sel = window.getSelection();
      if (sel?.rangeCount && sel.isCollapsed) {
        let node = sel.getRangeAt(0).startContainer;
        if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
        const li = node.closest?.('li');
        if (li && li.textContent.trim() === '') {
          e.preventDefault();
          document.execCommand('outdent', false);
          scheduleSave();
        }
      }
    } else if (e.key === '-') {
      // --- 입력 시 수평 구분선으로 자동 변환
      const sel = window.getSelection();
      if (sel?.rangeCount) {
        const range = sel.getRangeAt(0);
        const node  = range.startContainer;
        if (node.nodeType === Node.TEXT_NODE) {
          const textBefore = node.textContent.slice(0, range.startOffset);
          if (textBefore === '--') {
            e.preventDefault();
            node.textContent = node.textContent.slice(range.startOffset);
            const r2 = document.createRange();
            r2.setStart(node, 0); r2.collapse(true);
            sel.removeAllRanges(); sel.addRange(r2);
            document.execCommand('insertHTML', false, '<hr>');
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

  // 최소화 ↔ 복원
  btnMinimize.addEventListener('click', () => setMinimized(true));
  bubbleBtn.addEventListener('click',   () => setMinimized(false));

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

  // 북마크
  btnBookmark.addEventListener('click', () => {
    isBookmarked = !isBookmarked;
    saveMemoChanges({ bookmarked: isBookmarked });
    updateBookmarkButton();
  });

  // 좋아요
  btnLike.addEventListener('click', () => {
    isLiked = !isLiked;
    saveMemoChanges({ liked: isLiked });
    updateLikeButton();
  });

  // 링크 버튼
  btnLink.addEventListener('click', insertLink);

  // 이미지 첨부
  btnImage.addEventListener('click', () => imageFileInput.click());
  imageFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      memoContent.focus();
      document.execCommand('insertHTML', false,
        `<img src="${ev.target.result}" style="max-width:75%;max-height:180px;border-radius:6px;margin:4px 0;display:block;object-fit:contain">`
      );
      scheduleSave();
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  // 글자 색상
  btnTextColor.addEventListener('click', () => {
    const sel = window.getSelection();
    if (sel?.rangeCount && !sel.isCollapsed) {
      savedTextRange = sel.getRangeAt(0).cloneRange();
    }
    textColorInput.click();
  });
  textColorInput.addEventListener('change', () => {
    const color = textColorInput.value;
    btnTextColor.style.setProperty('--tc-current', color);
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

  // 아바타 클릭 → 이미지 업로드
  profileAvatar.addEventListener('click', () => avatarFileInput.click());
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

  // 버블 아이콘 편집
  bubbleEditBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const current = memoData?.profile?.bubbleIcon || '📝';
    const icon = prompt('아이콘 이모지를 입력하세요:', current);
    if (icon !== null) {
      const trimmed = icon.trim() || '📝';
      memoData.profile = { ...(memoData.profile || {}), bubbleIcon: trimmed };
      bubbleIcon.textContent = trimmed;
      saveMemoChanges({ profile: memoData.profile });
    }
  });

  // 답글 (Phase 3 placeholder)
  btnReply.addEventListener('click', () => {
    // TODO Phase 3: 세부 메모(답글) 윈도우 열기
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
    bubbleIcon.textContent = memoData.profile.bubbleIcon || '📝';
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

  // 캡처 팝업 토글
  btnCapture.addEventListener('click', (e) => {
    e.stopPropagation();
    capturePopup.classList.toggle('visible');
  });

  // 캡처 — 상태바 제외 카드 영역 계산 후 IPC
  async function doCapture(action) {
    capturePopup.classList.remove('visible');
    const statusBar = document.getElementById('statusBar');
    const cardView  = document.getElementById('cardView');
    const sbH   = statusBar.getBoundingClientRect().height;
    const rect  = cardView.getBoundingClientRect();
    const dpr   = window.devicePixelRatio || 1;
    const captureRect = {
      x:      Math.round(rect.x      * dpr),
      y:      Math.round((rect.y + sbH) * dpr),
      width:  Math.round(rect.width  * dpr),
      height: Math.round((rect.height - sbH) * dpr),
    };
    try {
      await api.captureCard({ rect: captureRect, action });
    } catch (err) {
      console.error('캡처 실패:', err);
    }
  }

  btnCaptureClipboard.addEventListener('click', () => doCapture('clipboard'));
  btnCaptureSave.addEventListener('click',      () => doCapture('save'));

  // 외부 클릭 시 팝업 닫기
  document.addEventListener('click', (e) => {
    const opWrap  = document.getElementById('opacityWrap');
    const colWrap = document.getElementById('colorWrap');
    const capWrap = document.getElementById('captureWrap');
    if (!opWrap?.contains(e.target))  opacityPopup.classList.remove('visible');
    if (!colWrap?.contains(e.target)) colorPopup.classList.remove('visible');
    if (!capWrap?.contains(e.target)) capturePopup.classList.remove('visible');
  });

  // 전역 단축키
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      api.createMemo();
    }
  });
}

// ── 실행 ──────────────────────────────────────
init().catch(console.error);
