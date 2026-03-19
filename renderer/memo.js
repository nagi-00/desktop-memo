import { generatePalette, applyPalette, setThemeMode, PRESETS } from './theme.js';

const api = window.memoAPI;

// ── 상태 ──────────────────────────────────
let memoData = null;
let currentMode = 'dark';
let isPinned = false;
let saveTimer = null;
let isOpacityVisible = false;
let isColorPickerVisible = false;

// ── 요소 참조 ─────────────────────────────
const memoContent   = document.getElementById('memoContent');
const charCount     = document.getElementById('charCount');
const btnPin        = document.getElementById('btnPin');
const btnOpacity    = document.getElementById('btnOpacity');
const btnDelete     = document.getElementById('btnDelete');
const btnNewMemo    = document.getElementById('btnNewMemo');
const btnThemeToggle = document.getElementById('btnThemeToggle');
const colorDot      = document.getElementById('colorDot');
const tagsArea      = document.getElementById('tagsArea');
const opacitySliderWrap = document.getElementById('opacitySliderWrap');
const opacitySlider = document.getElementById('opacitySlider');
const opacityValue  = document.getElementById('opacityValue');
const colorPickerPopup = document.getElementById('colorPickerPopup');
const colorSwatches = document.getElementById('colorSwatches');
const colorPickerCustom = document.getElementById('colorPickerCustom');

// ── 초기화 ────────────────────────────────
async function init() {
  // Lucide 아이콘 렌더링
  if (window.lucide) lucide.createIcons();

  // 메모 데이터 로드
  memoData = await api.getMemo();
  const settings = await api.getSettings();
  currentMode = settings?.theme || 'dark';

  if (!memoData) return;

  // 테마 적용
  applyAccent(memoData.theme?.accent || settings?.accentColor || '#7C3AED', currentMode);
  setThemeMode(currentMode);
  updateThemeToggleIcon();

  // 폰트 적용
  if (memoData.font) {
    document.documentElement.style.setProperty('--memo-font-family', memoData.font.family || 'system-ui');
    document.documentElement.style.setProperty('--memo-font-size', `${memoData.font.size || 14}px`);
  }

  // 콘텐츠 복원
  memoContent.textContent = memoData.content || '';
  updateCharCount();

  // 핀 상태 복원
  isPinned = memoData.pinned || false;
  updatePinButton();

  // 투명도 복원
  const opacity = memoData.opacity ?? 1.0;
  opacitySlider.value = opacity;
  opacityValue.textContent = `${Math.round(opacity * 100)}%`;

  // 태그 렌더링
  renderTags();

  // 컬러 피커 스와치 생성
  renderColorSwatches();

  // 이벤트 리스너 등록
  bindEvents();

  // 다크/라이트 브로드캐스트 수신
  api.onThemeModeChanged((mode) => {
    currentMode = mode;
    setThemeMode(mode);
    updateThemeToggleIcon();
    if (memoData?.theme?.accent) {
      applyAccent(memoData.theme.accent, mode);
    }
  });
}

// ── 팔레트 적용 ───────────────────────────
function applyAccent(accentHex, mode) {
  const palette = generatePalette(accentHex, mode);
  applyPalette(palette);
  colorDot.style.background = accentHex;
  colorPickerCustom.value = accentHex;
}

// ── 태그 렌더링 ───────────────────────────
function renderTags() {
  tagsArea.innerHTML = '';
  const tags = memoData?.tags || [];
  tags.forEach((tag) => {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.textContent = `#${tag}`;
    pill.title = '클릭하여 삭제';
    pill.addEventListener('click', () => removeTag(tag));
    tagsArea.appendChild(pill);
  });

  // 태그 입력창
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tag-input';
  input.placeholder = '태그 추가...';
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = input.value.trim().replace(/^#/, '');
      if (val && !(memoData.tags || []).includes(val)) {
        memoData.tags = [...(memoData.tags || []), val];
        saveMemoChanges({ tags: memoData.tags });
        renderTags();
      } else {
        input.value = '';
      }
    } else if (e.key === 'Backspace' && input.value === '') {
      const tags = memoData.tags || [];
      if (tags.length > 0) {
        memoData.tags = tags.slice(0, -1);
        saveMemoChanges({ tags: memoData.tags });
        renderTags();
      }
    }
  });
  tagsArea.appendChild(input);
}

function removeTag(tag) {
  memoData.tags = (memoData.tags || []).filter(t => t !== tag);
  saveMemoChanges({ tags: memoData.tags });
  renderTags();
}

// ── 컬러 스와치 렌더링 ────────────────────
function renderColorSwatches() {
  colorSwatches.innerHTML = '';
  PRESETS.forEach(({ accent }) => {
    const swatch = document.createElement('button');
    swatch.className = 'color-swatch';
    if (memoData?.theme?.accent === accent) swatch.classList.add('selected');
    swatch.style.background = accent;
    swatch.title = accent;
    swatch.addEventListener('click', () => {
      selectAccentColor(accent);
    });
    colorSwatches.appendChild(swatch);
  });
}

function selectAccentColor(hex) {
  memoData.theme = { ...(memoData.theme || {}), accent: hex };
  applyAccent(hex, currentMode);
  saveMemoChanges({ theme: memoData.theme });
  // 스와치 선택 상태 업데이트
  colorSwatches.querySelectorAll('.color-swatch').forEach(s => {
    s.classList.toggle('selected', s.style.background === hex || s.title === hex);
  });
}

// ── 핀 버튼 ──────────────────────────────
function updatePinButton() {
  btnPin.classList.toggle('active', isPinned);
  const icon = btnPin.querySelector('[data-lucide]');
  if (icon) {
    icon.setAttribute('data-lucide', isPinned ? 'pin-off' : 'pin');
    if (window.lucide) lucide.createIcons({ nodes: [icon] });
  }
}

// ── 테마 토글 아이콘 ─────────────────────
function updateThemeToggleIcon() {
  const icon = btnThemeToggle.querySelector('[data-lucide]');
  if (icon) {
    icon.setAttribute('data-lucide', currentMode === 'dark' ? 'sun' : 'moon');
    if (window.lucide) lucide.createIcons({ nodes: [icon] });
  }
}

// ── 글자수 업데이트 ───────────────────────
function updateCharCount() {
  const len = memoContent.textContent.length;
  charCount.textContent = len > 0 ? `${len}자` : '0';
}

// ── 자동 저장 (debounce 500ms) ───────────
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const content = memoContent.textContent;
    memoData.content = content;
    saveMemoChanges({ content });
  }, 500);
}

function saveMemoChanges(changes) {
  api.updateMemo(changes).catch(console.error);
}

// ── 이벤트 바인딩 ─────────────────────────
function bindEvents() {
  // 본문 입력
  memoContent.addEventListener('input', () => {
    updateCharCount();
    scheduleSave();
  });

  // 새 메모
  btnNewMemo.addEventListener('click', () => {
    api.createMemo();
  });

  // 핀 토글
  btnPin.addEventListener('click', async () => {
    isPinned = !isPinned;
    await api.pinMemo(isPinned);
    updatePinButton();
  });

  // 투명도 팝업 토글
  btnOpacity.addEventListener('click', (e) => {
    e.stopPropagation();
    isOpacityVisible = !isOpacityVisible;
    opacitySliderWrap.classList.toggle('visible', isOpacityVisible);
    // 컬러피커 닫기
    isColorPickerVisible = false;
    colorPickerPopup.classList.remove('visible');
  });

  opacitySlider.addEventListener('input', () => {
    const val = parseFloat(opacitySlider.value);
    opacityValue.textContent = `${Math.round(val * 100)}%`;
    api.setOpacity(val);
  });

  // 삭제
  btnDelete.addEventListener('click', async () => {
    const ok = confirm('이 메모를 삭제할까요?');
    if (ok) {
      await api.deleteMemo();
    }
  });

  // 테마 모드 토글
  btnThemeToggle.addEventListener('click', async () => {
    const newMode = currentMode === 'dark' ? 'light' : 'dark';
    await api.setThemeMode(newMode);
    // 로컬 즉시 반영 (브로드캐스트 수신 전 미리)
    currentMode = newMode;
    setThemeMode(newMode);
    updateThemeToggleIcon();
    if (memoData?.theme?.accent) {
      applyAccent(memoData.theme.accent, newMode);
    }
  });

  // 컬러 도트 클릭
  colorDot.addEventListener('click', (e) => {
    e.stopPropagation();
    isColorPickerVisible = !isColorPickerVisible;
    colorPickerPopup.classList.toggle('visible', isColorPickerVisible);
    // 투명도 팝업 닫기
    isOpacityVisible = false;
    opacitySliderWrap.classList.remove('visible');
  });

  // 커스텀 컬러 피커
  colorPickerCustom.addEventListener('input', () => {
    selectAccentColor(colorPickerCustom.value);
  });

  // 외부 클릭 시 팝업 닫기
  document.addEventListener('click', (e) => {
    if (!colorPickerPopup.contains(e.target) && e.target !== colorDot) {
      isColorPickerVisible = false;
      colorPickerPopup.classList.remove('visible');
    }
    if (!opacitySliderWrap.contains(e.target) && e.target !== btnOpacity) {
      isOpacityVisible = false;
      opacitySliderWrap.classList.remove('visible');
    }
  });

  // Ctrl+N: 새 메모
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      api.createMemo();
    }
  });
}

// ── 실행 ──────────────────────────────────
init().catch(console.error);
