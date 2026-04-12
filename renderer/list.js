/**
 * list.js — 메모 목록 뷰 로직 (스레드/답글 + 휴지통)
 */
import { setThemeMode, PRESETS } from './theme.js';

const api = window.memoAPI;

let allMemos       = [];
let trashMemos     = [];
let selectedId     = null;
let currentFilter  = 'all';
let searchQuery    = '';

// 다중 선택 삭제 모드
let isMultiSelectMode = false;
let multiSelectIds    = new Set();

// ── DOM 참조 ──
const sidebar         = document.getElementById('memoListSidebar');
const emptyList       = document.getElementById('emptyList');
const previewPane     = document.getElementById('previewPane');
const previewEmpty    = document.getElementById('previewEmpty');
const searchInput     = document.getElementById('searchInput');
const btnNewMemo      = document.getElementById('btnNewMemo');
const btnClose        = document.getElementById('btnClose');
const btnTrayList     = document.getElementById('btnTrayList');
const btnExport       = document.getElementById('btnExport');
const btnImport       = document.getElementById('btnImport');
const btnShortcutHelp = document.getElementById('btnShortcutHelp');
const btnSettings     = document.getElementById('btnSettings');
const resizeHandle    = document.getElementById('listResizeHandle');
const tagFilterChips  = document.getElementById('tagFilterChips');
const btnStickyNotes  = document.getElementById('btnStickyNotes');

let isStickyNotesMode = false;
const tagAddBar       = document.getElementById('tagAddBar');
const tagAddChips     = document.getElementById('tagAddChips');
const tagAddInput     = document.getElementById('tagAddInput');

// ── accent color 적용 함수 ──
function applyAccentColor(color) {
  if (!color) return;
  // 타이틀바 클로버 아이콘, 웰컴 오버레이 클로버
  document.documentElement.style.setProperty('--color-accent', color);
  document.documentElement.style.setProperty('--welcome-clover-color', color);
  // SVG fill 직접 업데이트 (CSS 변수가 SVG attr에 적용 안 될 때 대비)
  document.querySelectorAll('[data-accent-fill]').forEach(el => {
    el.style.color = color;
  });
}

// ── 팝업 모드 감지 ──
const _popupType = new URLSearchParams(window.location.search).get('popup');

// ── 초기화 ──
async function init() {
  if (window.lucide) lucide.createIcons();

  const settings = await api.getSettings();
  if (settings?.theme) setThemeMode(settings.theme);
  if (settings?.accentColor) applyAccentColor(settings.accentColor);

  // ── 팝업 전용 창 모드 ──
  if (_popupType) {
    // 팝업 창 투명 배경 처리
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.classList.add('popup-mode');
    // list-root 숨김, 오버레이 배경 투명화
    document.querySelector('.list-root')?.style.setProperty('display', 'none');
    ['welcomeOverlay', 'settingsOverlay', 'shortcutOverlay'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.style.background = 'transparent'; el.style.backdropFilter = 'none'; }
    });
    // 팝업별 초기화
    if (_popupType === 'welcome') {
      const overlay = document.getElementById('welcomeOverlay');
      overlay?.classList.add('visible');
      _wcGoTo(0);
      document.getElementById('welcomeClose')?.addEventListener('click', () => { if (document.getElementById('welcomeNoShow')?.checked) localStorage.setItem('welcomeShown','1'); window.close(); });
      document.getElementById('wcDismiss')?.addEventListener('click', () => window.close());
      document.getElementById('welcomeOverlay')?.addEventListener('click', e => { if (e.target.id === 'welcomeOverlay') window.close(); });
      document.getElementById('wcPrev')?.addEventListener('click', () => _wcGoTo(_wcPage - 1));
      document.getElementById('wcNext')?.addEventListener('click', () => _wcGoTo(_wcPage + 1));
      document.querySelectorAll('.wc-dot').forEach((d, i) => d.addEventListener('click', () => _wcGoTo(i)));
    } else if (_popupType === 'settings') {
      const overlay = document.getElementById('settingsOverlay');
      overlay?.classList.add('visible');
      renderSettingsColors();
      renderSettingsIcons();
      renderSettingsCustomIcon();
      document.getElementById('settingsClose')?.addEventListener('click', () => window.close());
      document.getElementById('settingsOverlay')?.addEventListener('click', e => { if (e.target.id === 'settingsOverlay') window.close(); });
      _bindSettingsFormEvents();
    } else if (_popupType === 'shortcut') {
      const overlay = document.getElementById('shortcutOverlay');
      overlay?.classList.add('visible');
      document.getElementById('shortcutClose')?.addEventListener('click', () => window.close());
      document.getElementById('shortcutOverlay')?.addEventListener('click', e => { if (e.target.id === 'shortcutOverlay') window.close(); });
    }
    document.addEventListener('keydown', e => { if (e.key === 'Escape') window.close(); });
    // accent/symbol 변경 수신 (설정 팝업에서 바꿀 경우 즉시 반영)
    api.onAccentColorChanged?.(color => applyAccentColor(color));
    return;
  }

  isStickyNotesMode = settings?.stickyNotesMode || false;
  applyListSymbolIcon(settings?.symbolIcon || 'clover');
  if (settings?.customAppIcon) applyListCloverCustomIcon(settings.customAppIcon);

  await loadMemos();
  bindEvents();

  // 최초 실행 시 웰컴 화면 표시
  if (!localStorage.getItem('welcomeShown')) {
    showWelcomeOverlay();
  }

  api.onMemoListUpdated(async () => {
    const prevSelected = selectedId;
    await loadMemos();
    if (prevSelected) selectMemo(prevSelected);
  });

  api.onThemeModeChanged((mode) => setThemeMode(mode));

  // accent color 변경 수신 — SVG 커스텀 아이콘이 있으면 새 컬러로 재렌더링
  if (api.onAccentColorChanged) {
    api.onAccentColorChanged(async (color) => {
      applyAccentColor(color);
      const settings = await api.getSettings();
      const svgSrc = settings?.customAppIconSvg;
      if (svgSrc) {
        const newPng = await svgToColoredPng(svgSrc, color);
        if (newPng) await api.setCustomIcon({ dataUrl: newPng, svgText: svgSrc });
      }
    });
  }

  // 커스텀 아이콘 변경 수신
  // preload가 opts({ dataUrl, svgText }) 객체째로 전달하므로 구조분해 필수
  if (api.onCustomIconChanged) {
    api.onCustomIconChanged(({ dataUrl } = {}) => {
      applyListCloverCustomIcon(dataUrl);
      renderSettingsCustomIcon();
    });
  }

  if (api.onSymbolIconChanged) {
    api.onSymbolIconChanged((iconId) => {
      applyListSymbolIcon(iconId);
      // 커스텀 아이콘이 없는 경우에만 타이틀에 반영
      api.getSettings().then(s => {
        if (!s?.customAppIcon) applyListCloverCustomIcon(null);
      });
    });
  }

  // 메모 창에서 보낸 스레드 접기/펼치기 요청 처리
  if (api.onThreadFold) {
    api.onThreadFold((memoId) => {
      // 해당 메모가 루트이거나 답글인 경우 모두 처리
      const btn = sidebar.querySelector(
        `.memo-list-item[data-id="${CSS.escape(memoId)}"] .thread-toggle, ` +
        `.memo-list-item[data-id="${CSS.escape(memoId)}"].reply-item ~ .memo-list-item .thread-toggle`
      );
      // 더 안전한 방법: 모든 thread-root에서 해당 memoId와 관련된 것 찾기
      sidebar.querySelectorAll('.thread-toggle').forEach(toggleBtn => {
        const rootEl = toggleBtn.closest('.memo-list-item');
        if (!rootEl) return;
        const rootId = rootEl.dataset.id;
        if (rootId === memoId) {
          toggleBtn.click();
        }
      });
    });
  }
}

// ── 메모 로드 ──
async function loadMemos() {
  allMemos = await api.getAllMemos() || [];
  trashMemos = await api.getTrash() || [];
  renderTagFilterChips();
  renderList();
}

// ── 태그 필터 칩 렌더링 ──
function renderTagFilterChips() {
  tagFilterChips.innerHTML = '';
  const allTags = [...new Set(allMemos.flatMap(m => m.tags || []))].sort();
  allTags.forEach(tag => {
    const chip = document.createElement('button');
    chip.className = 'filter-chip tag-chip';
    chip.dataset.filter = `tag:${tag}`;
    chip.textContent = `#${tag}`;
    if (currentFilter === `tag:${tag}`) chip.classList.add('active');
    chip.addEventListener('click', () => {
      if (isMultiSelectMode) exitMultiSelectMode(); // UX-05: 필터 전환 시 다중 선택 모드 해제
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = `tag:${tag}`;
      selectedId = null;
      renderList();
      renderPreview(null);
    });
    tagFilterChips.appendChild(chip);
  });
}


// ── 필터링 ──
function getFilteredMemos() {
  if (currentFilter === 'trash') return trashMemos;

  let list = allMemos;

  if (currentFilter === 'liked') {
    list = list.filter(m => m.liked);
  } else if (currentFilter.startsWith('tag:')) {
    const tag = currentFilter.slice(4);
    list = list.filter(m => (m.tags || []).includes(tag));
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(m =>
      (m.content || '').toLowerCase().includes(q) ||
      (m.profile?.name || '').toLowerCase().includes(q) ||
      (m.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }

  return list;
}

// ── 목록 렌더링 ──
function renderList() {
  [...sidebar.children].forEach(el => {
    if (el !== emptyList) el.remove();
  });

  const isTrash = currentFilter === 'trash';
  const memos = getFilteredMemos();

  if (memos.length === 0) {
    emptyList.style.display = 'flex';
    const emptyText = emptyList.querySelector('span');
    if (emptyText) emptyText.textContent = isTrash ? '휴지통이 비어 있습니다' : '메모가 없습니다';
    renderPreview(null);
    return;
  }
  emptyList.style.display = 'none';

  const sortKey = isTrash ? 'deletedAt' : 'updatedAt';
  const sorted = memos
    .slice()
    .sort((a, b) => new Date(b[sortKey] || b.updatedAt) - new Date(a[sortKey] || a.updatedAt));

  sorted.forEach(memo => sidebar.appendChild(buildListItem(memo, { isTrashItem: isTrash })));

  // 선택된 항목이 없으면 첫 번째 메모를 자동 선택 (UX-07)
  if (!selectedId || !sorted.find(m => m.id === selectedId)) {
    selectMemo(sorted[0].id);
  }
}

function buildListItem(memo, { isTrashItem = false } = {}) {
  const el = document.createElement('div');
  el.className = 'memo-list-item';  if (isTrashItem) el.classList.add('trash-item');
  el.dataset.id = memo.id;
  if (memo.id === selectedId) el.classList.add('active');

  // 메모별 테마 색상 적용 (CSS 변수 오버라이드)
  if (memo.theme?.accent) {
    el.style.setProperty('--color-accent', memo.theme.accent);
  }

  const initial = (memo.profile?.name || '메')[0].toUpperCase();
  const accentBg = memo.theme?.accent || 'var(--color-accent)';

  const badgesHtml = [
    memo.liked ? '<span class="item-badge">♥ 좋아요</span>' : '',
    ...(memo.tags || []).slice(0, 2).map(t => `<span class="item-badge">#${escHtml(t)}</span>`)
  ].filter(Boolean).join('');

  const preview = (memo.content || '').slice(0, 40) || '(내용 없음)';
  const dateStr = memo.updatedAt
    ? new Date(memo.updatedAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
    : '';

  el.innerHTML = `
    <div class="item-avatar" style="background:${accentBg}">
      ${memo.profile?.avatarDataUrl
        ? `<img src="${memo.profile.avatarDataUrl}" alt="">`
        : initial}
    </div>
    <div class="item-info">
      <div class="item-name">
        ${escHtml(memo.profile?.name || '메모')}
      </div>
      <div class="item-preview">${escHtml(preview)}</div>
      <div class="item-date">${dateStr}</div>
      ${badgesHtml ? `<div class="item-badges">${badgesHtml}</div>` : ''}
    </div>
  `;

  // 다중 선택 모드: 체크박스 추가
  if (isMultiSelectMode && !isTrashItem) {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'ms-checkbox';
    cb.checked = multiSelectIds.has(memo.id);
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      if (cb.checked) multiSelectIds.add(memo.id);
      else multiSelectIds.delete(memo.id);
      _updateMultiSelectBar();
    });
    el.prepend(cb);
    el.addEventListener('click', () => {
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change'));
    });
  } else {
    el.addEventListener('click', () => selectMemo(memo.id));
  }

  // 우클릭 → 컨텍스트 메뉴
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectMemo(memo.id);
    if (isTrashItem) {
      showListContextMenu([
        { label: '복원', action: () => api.restoreFromTrash(memo.id) },
        'sep',
        { label: '영구 삭제', danger: true, action: async () => {
          if (confirm('영구적으로 삭제할까요? 복구할 수 없습니다.')) {
            await api.deleteFromTrash(memo.id);
            const idx = trashMemos.findIndex(m => m.id === memo.id);
            if (idx !== -1) trashMemos.splice(idx, 1);
            selectedId = null;
            renderList();
            renderPreview(null);
          }
        }},
      ], e.clientX, e.clientY);
    } else {
      showListContextMenu([
        { label: '메모 열기',  action: () => api.focusMemo(memo.id) },
        { label: '답글 추가',  action: () => api.createReply(memo.id) },
        'sep',
        { label: '삭제', danger: true, action: async () => {
          await api.deleteById(memo.id);
          selectedId = null;
        }},
      ], e.clientX, e.clientY);
    }
  });

  return el;
}

// ── 선택 ──
function selectMemo(id) {
  selectedId = id;
  sidebar.querySelectorAll('.memo-list-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });
  const isTrash = currentFilter === 'trash';
  const source = isTrash ? trashMemos : allMemos;
  const memo = source.find(m => m.id === id) || null;
  renderPreview(memo, isTrash);
  renderTagAddBar(memo, isTrash);
}

// ── 태그 추가 바 ──
function renderTagAddBar(memo, isTrash) {
  if (!memo || isTrash) {
    tagAddBar.style.display = 'none';
    return;
  }
  tagAddBar.style.display = 'flex';
  renderTagChips(memo);
}

function renderTagChips(memo) {
  tagAddChips.innerHTML = '';
  (memo.tags || []).forEach(tag => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip-item';
    chip.innerHTML = `#${escHtml(tag)} <button class="tag-chip-remove" data-tag="${escHtml(tag)}" title="태그 삭제">×</button>`;
    chip.querySelector('.tag-chip-remove').addEventListener('click', async (e) => {
      e.stopPropagation();
      const newTags = (memo.tags || []).filter(t => t !== tag);
      memo.tags = newTags;
      await api.updateById(memo.id, { tags: newTags });
      renderTagChips(memo);
      renderTagFilterChips();
    });
    tagAddChips.appendChild(chip);
  });
}

// ── 태그 입력 처리 ──
function bindTagInput() {
  tagAddInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const value = tagAddInput.value.trim().replace(/^#/, '').toLowerCase();
    if (!value) return;
    tagAddInput.value = '';
    if (!selectedId) return;
    const memo = allMemos.find(m => m.id === selectedId);
    if (!memo) return;
    const tags = memo.tags || [];
    if (tags.includes(value)) return;
    memo.tags = [...tags, value];
    await api.updateById(memo.id, { tags: memo.tags });
    renderTagChips(memo);
    renderTagFilterChips();
  });
  tagAddInput.addEventListener('click', (e) => e.stopPropagation());
}

// ── 미리보기 ──
function renderPreview(memo, isTrash = false) {
  [...previewPane.children].forEach(el => {
    if (el !== previewEmpty) el.remove();
  });

  if (!memo) {
    previewPane.style.removeProperty('--color-accent');
    previewEmpty.style.display = 'flex';
    return;
  }
  previewEmpty.style.display = 'none';

  // 미리보기 패널에 메모 테마 색상 적용
  if (memo.theme?.accent) {
    previewPane.style.setProperty('--color-accent', memo.theme.accent);
  } else {
    previewPane.style.removeProperty('--color-accent');
  }

  const initial  = (memo.profile?.name || '메')[0].toUpperCase();
  const accentBg = memo.theme?.accent || 'var(--color-accent)';

  const parentMemo = memo.parentId
    ? (isTrash ? trashMemos : allMemos).find(m => m.id === memo.parentId)
    : null;

  const replies = isTrash ? [] : allMemos
    .filter(m => m.parentId === memo.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  const content  = memo.contentHtml
    ? memo.contentHtml
    : escHtml(memo.content || '(내용 없음)');

  const dateStr = memo.createdAt
    ? new Date(memo.createdAt).toLocaleString('ko-KR', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      })
    : '';

  // 부모 메모 컨텍스트
  if (parentMemo) {
    const ctx = document.createElement('div');
    ctx.className = 'preview-thread-ctx';
    ctx.innerHTML = `
      <span class="thread-ctx-icon">↩</span>
      <span class="thread-ctx-text">
        <strong>${escHtml(parentMemo.profile?.name || '메모')}</strong>의 답글
      </span>
    `;
    ctx.style.cursor = 'pointer';
    ctx.addEventListener('click', () => selectMemo(parentMemo.id));
    previewPane.appendChild(ctx);
  }

  // 헤더
  const header = document.createElement('div');
  header.className = 'preview-header';
  header.innerHTML = `
    <div class="preview-avatar" style="background:${accentBg}">
      ${memo.profile?.avatarDataUrl
        ? `<img src="${memo.profile.avatarDataUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
        : initial}
    </div>
    <div class="preview-profile">
      <div class="preview-name">${escHtml(memo.profile?.name || '메모')}</div>
      <div class="preview-handle">${escHtml(memo.profile?.handle ? '@' + memo.profile.handle : '@note')}</div>
      <div style="font-size:11px;color:var(--color-text-placeholder);margin-top:2px">${dateStr}</div>
    </div>
  `;

  // 본문
  const contentEl = document.createElement('div');
  contentEl.className = 'preview-content';
  contentEl.innerHTML = content;
  if (memo.font?.family) contentEl.style.fontFamily = memo.font.family;
  if (memo.font?.size)   contentEl.style.fontSize   = `${memo.font.size}px`;

  // 이미지 미리보기
  if (memo.images && memo.images.length > 0) {
    const imgGrid = document.createElement('div');
    imgGrid.className = 'preview-images';
    imgGrid.setAttribute('data-count', Math.min(memo.images.length, 4));
    memo.images.slice(0, 4).forEach(src => {
      const img = document.createElement('img');
      img.src = src;
      imgGrid.appendChild(img);
    });
    contentEl.appendChild(imgGrid);
  }

  // 답글 스레드 표시
  const threadSection = document.createElement('div');
  if (replies.length > 0) {
    threadSection.className = 'preview-thread';
    const threadHeader = document.createElement('div');
    threadHeader.className = 'preview-thread-header';
    threadHeader.textContent = `답글 ${replies.length}개`;
    threadSection.appendChild(threadHeader);

    replies.forEach(reply => {
      const replyEl = document.createElement('div');
      replyEl.className = 'preview-thread-item';
      const rInitial = (reply.profile?.name || '메')[0].toUpperCase();
      const rAccent = reply.theme?.accent || 'var(--color-accent)';
      const rPreview = (reply.content || '').slice(0, 60) || '(내용 없음)';
      const rDate = reply.updatedAt
        ? new Date(reply.updatedAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
        : '';
      replyEl.innerHTML = `
        <div class="thread-item-line"></div>
        <div class="thread-item-avatar" style="background:${rAccent}">
          ${reply.profile?.avatarDataUrl
            ? `<img src="${reply.profile.avatarDataUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
            : rInitial}
        </div>
        <div class="thread-item-body">
          <span class="thread-item-name">${escHtml(reply.profile?.name || '메모')}</span>
          <span class="thread-item-date">${rDate}</span>
          <div class="thread-item-text">${escHtml(rPreview)}</div>
        </div>
      `;
      replyEl.addEventListener('click', () => selectMemo(reply.id));
      threadSection.appendChild(replyEl);
    });
  }

  // 액션 버튼
  const actions = document.createElement('div');
  actions.className = 'preview-actions';

  if (isTrash) {
    actions.innerHTML = `
      <button class="preview-btn primary" data-action="restore">복원</button>
      <button class="preview-btn danger" data-action="permanent-delete">영구 삭제</button>
    `;
    actions.querySelector('[data-action="restore"]').addEventListener('click', async () => {
      await api.restoreFromTrash(memo.id);
    });
    actions.querySelector('[data-action="permanent-delete"]').addEventListener('click', async () => {
      if (confirm('영구적으로 삭제할까요? 복구할 수 없습니다.')) {
        await api.deleteFromTrash(memo.id);
        const idx = trashMemos.findIndex(m => m.id === memo.id);
        if (idx !== -1) trashMemos.splice(idx, 1);
        selectedId = null;
        renderList();
        renderPreview(null);
      }
    });
  } else {
    // 일반 메모: 우클릭 메뉴로 이동 (열기/답글/삭제)
    // 미리보기 패널에는 빠르게 열기 버튼만 남김
    actions.innerHTML = `
      <button class="preview-btn primary" data-action="open">메모 열기</button>
    `;
    actions.querySelector('[data-action="open"]').addEventListener('click', () => {
      api.focusMemo(memo.id);
    });
  }

  previewPane.appendChild(header);
  previewPane.appendChild(contentEl);
  if (replies.length > 0) previewPane.appendChild(threadSection);
  previewPane.appendChild(actions);
}

// ── 웰컴 오버레이 (캐러셀) ──
let _wcPage = 0;
const WC_TOTAL = 4;
let _popupPrevBounds = null; // 팝업 표시 전 창 크기 저장

function _wcGoTo(n) {
  _wcPage = Math.max(0, Math.min(WC_TOTAL - 1, n));
  const track = document.getElementById('wcTrack');
  if (track) track.style.transform = `translateX(-${_wcPage * 100}%)`;
  document.querySelectorAll('.wc-dot').forEach((d, i) => {
    d.classList.toggle('active', i === _wcPage);
  });
  const prev = document.getElementById('wcPrev');
  const next = document.getElementById('wcNext');
  if (prev) prev.disabled = _wcPage === 0;
  if (next) next.disabled = _wcPage === WC_TOTAL - 1;
}

function showWelcomeOverlay() {
  api.openPopup?.({ type: 'welcome', width: 640, height: 700 });
}

function hideWelcomeOverlay() {
  // 팝업 창 모드에서는 window.close()로 닫힘; 일반 모드에선 no-op
  document.getElementById('welcomeOverlay')?.classList.remove('visible');
}

// ── 심볼 아이콘 목록 ──
// 4잎 클로버: 2×2 격자 배열 + 흰 + 십자 + 줄기
const CLOVER_SVG_SMALL = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true"><circle cx="7.8" cy="6.4" r="6"/><circle cx="16.2" cy="6.4" r="6"/><circle cx="7.8" cy="14.8" r="6"/><circle cx="16.2" cy="14.8" r="6"/><line x1="12" y1="4.6" x2="12" y2="16.6" stroke="white" stroke-width="1.5" stroke-linecap="round"/><line x1="6" y1="10.6" x2="18" y2="10.6" stroke="white" stroke-width="1.5" stroke-linecap="round"/><path d="M12 18.4L7.7 22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

function _filledSvg(path, w = 16) {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="${w}" height="${w}" aria-hidden="true">${path}</svg>`;
}
const _FILLED = {
  heart:        `<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>`,
  moon:         `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/><line x1="17" y1="3" x2="17" y2="7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="15" y1="5" x2="19" y2="5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="21" y1="9" x2="21" y2="13" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="19" y1="11" x2="23" y2="11" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>`,
  'pen-sparkle':`<path d="M5 1.5C5.5 3.5 8.5 4.5 9.5 5.5C8.5 6.5 5.5 7.5 5 9.5C4.5 7.5 1.5 6.5 0.5 5.5C1.5 4.5 4.5 3.5 5 1.5Z"/><rect x="7" y="9" width="14" height="6" rx="3" transform="rotate(-47 14 12)"/><rect x="13" y="20.5" width="9" height="2.5" rx="1.25"/>`,
  note:         `<path fill-rule="evenodd" d="M4 2C2.9 2 2 2.9 2 4v16c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2H4zM14 22v-6h6z"/>`,
};

const SYMBOL_ICONS = [
  { id: 'clover', label: '클로버', svg: CLOVER_SVG_SMALL },
];

// ── 설정 오버레이 ──
// 메모 테마 색상과 동일한 프리셋 사용 (theme.js PRESETS)
const PRESET_COLORS = PRESETS
  .filter(p => p.accent !== null)
  .map(p => ({ color: p.accent, label: p.name }));

// PNG 파일 → 64×64 PNG data URL
async function fileToIconPng(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        canvas.getContext('2d').drawImage(img, 0, 0, 64, 64);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(null);
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// SVG 텍스트에 액센트 컬러 주입 후 64×64 PNG로 변환
async function svgToColoredPng(svgText, color, size = 64) {
  return new Promise((resolve) => {
    // fill/stroke 속성을 currentColor로 교체 (none 제외), SVG에 color 스타일 주입
    const colored = svgText
      .replace(/fill="(?!none\b)[^"]*"/gi,   'fill="currentColor"')
      .replace(/stroke="(?!none\b)[^"]*"/gi, 'stroke="currentColor"')
      .replace(/<svg\b/, `<svg style="color:${color}"`);
    const blob = new Blob([colored], { type: 'image/svg+xml' });
    const url  = URL.createObjectURL(blob);
    const img  = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      canvas.getContext('2d').drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// SVG 파일 텍스트로 읽기
function readFileAsText(file) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload  = (e) => resolve(e.target.result);
    fr.onerror = ()  => resolve(null);
    fr.readAsText(file);
  });
}

let _listSymbolIconId = 'clover';

function applyListSymbolIcon(iconId) {
  const svgEl = document.getElementById('listCloverSvg');
  if (!svgEl) return;
  _listSymbolIconId = iconId || 'clover';
  const def = SYMBOL_ICONS.find(ic => ic.id === _listSymbolIconId) || SYMBOL_ICONS[0];
  const tmp = document.createElement('div');
  tmp.innerHTML = def.svg;
  const parsed = tmp.querySelector('svg');
  if (!parsed) return;
  svgEl.setAttribute('viewBox', parsed.getAttribute('viewBox') || '0 0 24 24');
  svgEl.setAttribute('fill', parsed.getAttribute('fill') || 'currentColor');
  svgEl.innerHTML = parsed.innerHTML;
}

function applyListCloverCustomIcon(dataUrl) {
  const svg = document.getElementById('listCloverSvg');
  const img = document.getElementById('listCustomIconImg');
  if (!svg || !img) return;
  if (dataUrl) {
    svg.style.display = 'none';
    img.src = dataUrl;
    img.style.display = '';
  } else {
    img.style.display = 'none';
    svg.style.display = '';
    applyListSymbolIcon(_listSymbolIconId);
  }
}

function renderSettingsCustomIcon() {
  const preview = document.getElementById('settingsIconPreview');
  const resetBtn = document.getElementById('btnResetIcon');
  if (!preview) return;
  api.getSettings().then(settings => {
    const url = settings?.customAppIcon;
    if (url) {
      preview.innerHTML = `<img src="${url}" width="32" height="32" style="object-fit:contain;border-radius:4px;display:block" alt=""/>`;
      if (resetBtn) resetBtn.style.display = '';
    } else {
      preview.innerHTML = `<span style="width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;opacity:0.25;font-size:22px">◻</span>`;
      if (resetBtn) resetBtn.style.display = 'none';
    }
  });
}

function showSettingsOverlay() {
  api.openPopup?.({ type: 'settings', width: 420, height: 560 });
}

function hideSettingsOverlay() {
  document.getElementById('settingsOverlay')?.classList.remove('visible');
}

// 설정 폼 이벤트 바인딩 (팝업 창 / 일반 모드 공용)
function _bindSettingsFormEvents() {
  document.getElementById('settingsCustomColor')?.addEventListener('input', async (e) => {
    const color = e.target.value;
    await api.setAccentColor(color);
    applyAccentColor(color);
    updateSettingsSwatchActive(color);
  });
  document.getElementById('btnDarkMode')?.addEventListener('click', async () => {
    await api.setThemeMode('dark'); setThemeMode('dark');
  });
  document.getElementById('btnLightMode')?.addEventListener('click', async () => {
    await api.setThemeMode('light'); setThemeMode('light');
  });
  document.getElementById('btnUploadIcon')?.addEventListener('click', () => {
    document.getElementById('iconFileInput')?.click();
  });
  document.getElementById('iconFileInput')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
    let pngDataUrl, svgText = null;
    if (isSvg) {
      svgText = await readFileAsText(file);
      if (!svgText) { e.target.value = ''; return; }
      const s = await api.getSettings();
      pngDataUrl = await svgToColoredPng(svgText, s?.accentColor || '#8fbc8f');
    } else {
      pngDataUrl = await fileToIconPng(file);
    }
    if (pngDataUrl) { await api.setCustomIcon({ dataUrl: pngDataUrl, svgText }); renderSettingsCustomIcon(); }
    e.target.value = '';
  });
  document.getElementById('btnResetIcon')?.addEventListener('click', async () => {
    await api.setCustomIcon({ dataUrl: null, svgText: null });
    renderSettingsCustomIcon();
  });
  document.getElementById('btnIconStack')?.addEventListener('click', (e) => {
    e.preventDefault(); api.openExternal('https://iconstack.lovable.app/');
  });
}

function renderSettingsColors() {
  const row = document.getElementById('settingsColorRow');
  if (!row) return;
  row.innerHTML = '';
  PRESET_COLORS.forEach(({ color, label }) => {
    const btn = document.createElement('button');
    btn.className = 'settings-color-swatch';
    btn.style.background = color;
    btn.title = label;
    btn.addEventListener('click', async () => {
      await api.setAccentColor(color);
      applyAccentColor(color);
      document.getElementById('settingsCustomColor').value = color;
      updateSettingsSwatchActive(color);
    });
    row.appendChild(btn);
  });
  // 현재 선택 색상 표시
  api.getSettings().then(settings => {
    if (settings?.accentColor) {
      updateSettingsSwatchActive(settings.accentColor);
      document.getElementById('settingsCustomColor').value = settings.accentColor;
    }
  });
}

function renderSettingsIcons() {
  const row = document.getElementById('settingsIconRow');
  if (!row) return;
  row.innerHTML = '';
  api.getSettings().then(settings => {
    const currentIcon = settings?.symbolIcon || 'clover';
    SYMBOL_ICONS.forEach(def => {
      const btn = document.createElement('button');
      btn.className = 'settings-icon-btn';
      btn.title = def.label;
      btn.dataset.iconId = def.id;
      if (def.id === currentIcon) btn.classList.add('active');
      btn.innerHTML = def.svg;
      const label = document.createElement('span');
      label.className = 'settings-icon-label';
      label.textContent = def.label;
      btn.appendChild(label);
      btn.addEventListener('click', async () => {
        await api.setSymbolIcon(def.id);
        row.querySelectorAll('.settings-icon-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
      row.appendChild(btn);
    });
  });
}

function updateSettingsSwatchActive(color) {
  document.querySelectorAll('.settings-color-swatch').forEach(btn => {
    btn.classList.toggle('active', btn.style.background === color ||
      btn.style.backgroundColor === color ||
      toHex(btn.style.backgroundColor) === color.toLowerCase());
  });
}

function toHex(rgb) {
  const m = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return rgb;
  return '#' + [m[1],m[2],m[3]].map(n => parseInt(n).toString(16).padStart(2,'0')).join('');
}

// ── 단축키 도움말 오버레이 ──
function showShortcutOverlay() {
  api.openPopup?.({ type: 'shortcut', width: 460, height: 580 });
}

function hideShortcutOverlay() {
  document.getElementById('shortcutOverlay')?.classList.remove('visible');
}

// ── 이벤트 바인딩 ──
function bindEvents() {
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    renderList();
  });

  // 기본 필터 칩
  document.querySelectorAll('.filter-chip:not(.tag-chip)').forEach(chip => {
    chip.addEventListener('click', () => {
      if (isMultiSelectMode) exitMultiSelectMode(); // UX-05: 필터 전환 시 다중 선택 모드 해제
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.filter;
      selectedId = null;
      renderList();
      renderPreview(null);
      tagAddBar.style.display = 'none';
    });
  });

  btnNewMemo.addEventListener('click', () => api.createMemo());

  // 타이틀바 클로버 클릭 → 웰컴 오버레이 표시
  document.querySelector('.list-title-clover')?.addEventListener('click', showWelcomeOverlay);

  // Sticky Notes 모드 토글
  function updateStickyNotesBtn() {
    btnStickyNotes?.classList.toggle('sn-active', isStickyNotesMode);
    if (btnStickyNotes) {
      btnStickyNotes.title = isStickyNotesMode
        ? 'Sticky Notes 모드 해제 (클릭)'
        : 'Sticky Notes처럼 사용하기';
    }
  }
  updateStickyNotesBtn(); // 초기 상태 반영

  // 메모 창에서 SN 모드를 변경했을 때 목록 창도 동기화
  api.onStickyNotesModeChanged?.((enabled) => {
    isStickyNotesMode = enabled;
    updateStickyNotesBtn();
  });

  btnStickyNotes?.addEventListener('click', async () => {
    isStickyNotesMode = !isStickyNotesMode;
    await api.setStickyNotesMode(isStickyNotesMode);
    updateStickyNotesBtn();
  });

  // 사이드바 빈 공간 우클릭 → 새 메모 / 선택 삭제
  sidebar.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.memo-list-item')) return; // 항목 우클릭은 항목이 처리
    e.preventDefault();
    if (isMultiSelectMode) {
      showListContextMenu([{ label: '선택 모드 취소', action: exitMultiSelectMode }], e.clientX, e.clientY);
      return;
    }
    const items = [{ label: '새 메모', action: () => api.createMemo() }];
    if (currentFilter !== 'trash' && allMemos.length > 0) {
      items.push('sep');
      items.push({ label: '선택 삭제', danger: true, action: enterMultiSelectMode });
    }
    showListContextMenu(items, e.clientX, e.clientY);
  });
  btnClose.addEventListener('click', () => window.close());
  btnTrayList?.addEventListener('click', () => api.hideList());

  // 내보내기
  btnExport?.addEventListener('click', async () => {
    const result = await api.exportMemos();
    if (result?.success) {
      const fname = result.filePath.split(/[\\/]/).pop();
      showToast(`백업 저장 완료: ${fname}`);
    }
  });

  // 불러오기
  btnImport?.addEventListener('click', async () => {
    const result = await api.importMemos();
    if (result?.success) {
      if (result.count === 0) {
        showToast('새로운 메모가 없습니다 (모두 이미 존재)');
      } else {
        const skipped = (result.total ?? 0) - result.count;
        const skipMsg = skipped > 0 ? ` (중복 ${skipped}개 건너뜀)` : '';
        showToast(`${result.count}개 메모 불러오기 완료${skipMsg}`);
      }
      await loadMemos();
    } else if (result?.error) {
      showToast(`불러오기 실패: ${result.error}`);
    }
  });

  // 단축키 도움말
  btnShortcutHelp?.addEventListener('click', showShortcutOverlay);
  document.getElementById('shortcutClose')?.addEventListener('click', hideShortcutOverlay);
  document.getElementById('shortcutOverlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('shortcutOverlay')) hideShortcutOverlay();
  });

  // 웰컴 오버레이
  document.getElementById('welcomeClose')?.addEventListener('click', hideWelcomeOverlay);
  document.getElementById('wcDismiss')?.addEventListener('click', hideWelcomeOverlay);
  document.getElementById('welcomeOverlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('welcomeOverlay')) hideWelcomeOverlay();
  });
  document.getElementById('wcPrev')?.addEventListener('click', () => _wcGoTo(_wcPage - 1));
  document.getElementById('wcNext')?.addEventListener('click', () => _wcGoTo(_wcPage + 1));
  document.querySelectorAll('.wc-dot').forEach((d, i) => {
    d.addEventListener('click', () => _wcGoTo(i));
  });

  // 설정 오버레이
  btnSettings?.addEventListener('click', showSettingsOverlay);
  document.getElementById('settingsClose')?.addEventListener('click', hideSettingsOverlay);
  document.getElementById('settingsOverlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('settingsOverlay')) hideSettingsOverlay();
  });
  _bindSettingsFormEvents();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (isMultiSelectMode) { exitMultiSelectMode(); return; }
      hideShortcutOverlay();
      hideSettingsOverlay();
      hideWelcomeOverlay();
    }
  });

  bindTagInput();

  // ── 좌우 구분선 드래그 리사이즈 ──
  if (resizeHandle) {
    let _drag = null;

    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const curWidth = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--list-sidebar-width'), 10
      ) || 240;
      _drag = { startX: e.clientX, startWidth: curWidth };
      resizeHandle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!_drag) return;
      const newWidth = Math.max(140, Math.min(440, _drag.startWidth + e.clientX - _drag.startX));
      document.documentElement.style.setProperty('--list-sidebar-width', `${newWidth}px`);
    });

    document.addEventListener('mouseup', () => {
      if (!_drag) return;
      _drag = null;
      resizeHandle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  }
}

// ── 컨텍스트 메뉴 ──
function showListContextMenu(items, x, y) {
  document.getElementById('listContextMenu')?.remove();
  const menu = document.createElement('div');
  menu.id = 'listContextMenu';
  menu.className = 'list-context-menu';
  menu.style.left = `${x}px`;
  menu.style.top  = `${y}px`;

  items.forEach(item => {
    if (item === 'sep') {
      const d = document.createElement('div');
      d.className = 'ctx-sep';
      menu.appendChild(d);
    } else {
      const btn = document.createElement('button');
      btn.className = 'ctx-item' + (item.danger ? ' danger' : '');
      btn.textContent = item.label;
      btn.addEventListener('click', (e) => { e.stopPropagation(); menu.remove(); item.action(); });
      menu.appendChild(btn);
    }
  });

  document.body.appendChild(menu);
  // 화면 밖으로 나가면 위치 조정
  const r = menu.getBoundingClientRect();
  if (r.right  > window.innerWidth)  menu.style.left = `${x - r.width}px`;
  if (r.bottom > window.innerHeight) menu.style.top  = `${y - r.height}px`;

  const close = (e) => {
    if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close, true); }
  };
  setTimeout(() => document.addEventListener('mousedown', close, true), 0);
}

// ── 유틸 ──
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── 다중 선택 모드 ──
function enterMultiSelectMode() {
  isMultiSelectMode = true;
  multiSelectIds.clear();
  sidebar.classList.add('multi-select-mode');
  renderList();
  _showMultiSelectBar();
}

function exitMultiSelectMode() {
  isMultiSelectMode = false;
  multiSelectIds.clear();
  sidebar.classList.remove('multi-select-mode');
  renderList();
  document.getElementById('multiSelectBar')?.remove();
}

function _showMultiSelectBar() {
  document.getElementById('multiSelectBar')?.remove();
  const bar = document.createElement('div');
  bar.id = 'multiSelectBar';
  bar.className = 'multi-select-bar';
  bar.innerHTML = `
    <span class="ms-count">0개 선택됨</span>
    <div class="ms-actions">
      <button class="ms-cancel-btn">취소</button>
      <button class="ms-delete-btn" disabled>삭제</button>
    </div>
  `;
  sidebar.insertBefore(bar, sidebar.firstChild);

  bar.querySelector('.ms-cancel-btn').addEventListener('click', exitMultiSelectMode);
  bar.querySelector('.ms-delete-btn').addEventListener('click', async () => {
    if (!multiSelectIds.size) return;
    if (!confirm(`선택한 ${multiSelectIds.size}개의 메모를 삭제할까요?`)) return;
    for (const id of multiSelectIds) {
      await api.deleteById(id);
    }
    if (multiSelectIds.has(selectedId)) selectedId = null;
    exitMultiSelectMode();
  });
}

function _updateMultiSelectBar() {
  const bar = document.getElementById('multiSelectBar');
  if (!bar) return;
  bar.querySelector('.ms-count').textContent = `${multiSelectIds.size}개 선택됨`;
  bar.querySelector('.ms-delete-btn').disabled = multiSelectIds.size === 0;
}

function showToast(msg) {
  let toast = document.getElementById('listToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'listToast';
    toast.className = 'list-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('visible'), 3000);
}

init().catch(console.error);
