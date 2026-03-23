/**
 * list.js — 메모 목록 뷰 로직 (스레드/답글 + 휴지통)
 */
import { setThemeMode } from './theme.js';

const api = window.memoAPI;

let allMemos       = [];
let trashMemos     = [];
let selectedId     = null;
let currentFilter  = 'all';
let searchQuery    = '';

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
const btnShortcutHelp = document.getElementById('btnShortcutHelp');
const resizeHandle    = document.getElementById('listResizeHandle');
const tagFilterChips  = document.getElementById('tagFilterChips');
const btnStickyNotes  = document.getElementById('btnStickyNotes');

let isStickyNotesMode = false;
const tagAddBar       = document.getElementById('tagAddBar');
const tagAddChips     = document.getElementById('tagAddChips');
const tagAddInput     = document.getElementById('tagAddInput');

// ── 초기화 ──
async function init() {
  if (window.lucide) lucide.createIcons();

  const settings = await api.getSettings();
  if (settings?.theme) setThemeMode(settings.theme);
  isStickyNotesMode = settings?.stickyNotesMode || false;
  // 버튼 상태는 bindEvents() 안의 updateStickyNotesBtn()에서 최종 반영됨

  await loadMemos();
  bindEvents();

  // 최초 실행 시 단축키 도움말 자동 표시
  if (!localStorage.getItem('shortcutHelpShown')) {
    showShortcutOverlay();
    localStorage.setItem('shortcutHelpShown', '1');
  }

  api.onMemoListUpdated(async () => {
    const prevSelected = selectedId;
    await loadMemos();
    if (prevSelected) selectMemo(prevSelected);
  });

  api.onThemeModeChanged((mode) => setThemeMode(mode));

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

// ── 스레드 그룹화 ──
function buildThreads(memos) {
  const byId = new Map();
  memos.forEach(m => byId.set(m.id, m));

  const roots = [];
  const children = new Map();

  memos.forEach(m => {
    if (!m.parentId || !byId.has(m.parentId)) {
      roots.push(m);
    } else {
      const arr = children.get(m.parentId) || [];
      arr.push(m);
      children.set(m.parentId, arr);
    }
  });

  children.forEach(arr => arr.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));

  roots.sort((a, b) => {
    const aLatest = getThreadLatest(a.id, children, byId);
    const bLatest = getThreadLatest(b.id, children, byId);
    return bLatest - aLatest;
  });

  return { roots, children };
}

function getThreadLatest(id, children, byId) {
  let latest = 0;
  const memo = byId.get(id);
  if (memo) latest = new Date(memo.updatedAt).getTime();
  const kids = children.get(id) || [];
  kids.forEach(k => {
    const t = new Date(k.updatedAt).getTime();
    if (t > latest) latest = t;
  });
  return latest;
}

// ── 필터링 ──
function getFilteredMemos() {
  if (currentFilter === 'trash') return trashMemos;

  let list = allMemos;

  if (currentFilter === 'liked') {
    list = list.filter(m => m.liked);
  } else if (currentFilter === 'threads') {
    const parentIds = new Set(list.filter(m => m.parentId).map(m => m.parentId));
    list = list.filter(m => parentIds.has(m.id) || m.parentId);
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

  if (isTrash) {
    // 휴지통: 단순 리스트 (스레드 없음)
    memos
      .slice()
      .sort((a, b) => new Date(b.deletedAt || b.updatedAt) - new Date(a.deletedAt || a.updatedAt))
      .forEach(memo => sidebar.appendChild(buildListItem(memo, { isTrashItem: true })));
    return;
  }

  const { roots, children } = buildThreads(memos);

  roots.forEach(root => {
    const replies = children.get(root.id) || [];
    const hasReplies = replies.length > 0;

    // 루트 아이템
    const rootEl = buildListItem(root, { isThreadRoot: hasReplies, replyCount: replies.length });
    sidebar.appendChild(rootEl);

    // 답글 — 접기/펼치기 지원
    if (hasReplies) {
      const replyEls = [];
      replies.forEach((reply, idx) => {
        const isLast = idx === replies.length - 1;
        const replyEl = buildListItem(reply, { isReply: true, isLastReply: isLast });
        sidebar.appendChild(replyEl);
        replyEls.push(replyEl);
      });
      const toggleBtn = rootEl.querySelector('.thread-toggle');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const collapsed = toggleBtn.dataset.collapsed === 'true';
          const next = !collapsed;
          toggleBtn.dataset.collapsed = String(next);
          toggleBtn.title = next ? '답글 펼치기' : '답글 접기';
          toggleBtn.classList.toggle('collapsed', next);
          replyEls.forEach(el => {
            if (next) {
              el.style.maxHeight = el.scrollHeight + 'px';
              requestAnimationFrame(() => { el.style.maxHeight = '0'; el.style.opacity = '0'; });
            } else {
              el.style.maxHeight = el.scrollHeight + 'px';
              el.style.opacity = '1';
              el.addEventListener('transitionend', () => { el.style.maxHeight = ''; }, { once: true });
            }
          });
        });
      }
    }
  });
}

function buildListItem(memo, { isThreadRoot = false, isReply = false, isLastReply = false, replyCount = 0, isTrashItem = false } = {}) {
  const el = document.createElement('div');
  el.className = 'memo-list-item';
  if (isReply) el.classList.add('reply-item');
  if (isReply && isLastReply) el.classList.add('last-reply');
  if (isThreadRoot && replyCount > 0) el.classList.add('thread-root');
  if (isTrashItem) el.classList.add('trash-item');
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
        ${isReply ? '<span class="reply-label">답글</span>' : ''}
        ${isThreadRoot && replyCount > 0 ? `<span class="thread-count">${replyCount}</span>` : ''}
      </div>
      <div class="item-preview">${escHtml(preview)}</div>
      <div class="item-date">${dateStr}</div>
      ${badgesHtml ? `<div class="item-badges">${badgesHtml}</div>` : ''}
    </div>
  `;

  // 스레드 루트에 접기/펼치기 토글 버튼 추가
  if (isThreadRoot && replyCount > 0) {
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'thread-toggle';
    toggleBtn.dataset.collapsed = 'false';
    toggleBtn.title = '답글 접기';
    toggleBtn.innerHTML = `<span class="tt-arrow">▾</span>${replyCount}`;
    toggleBtn.addEventListener('click', (e) => e.stopPropagation());
    el.appendChild(toggleBtn);
  }

  el.addEventListener('click', () => selectMemo(memo.id));

  // 우클릭 → 컨텍스트 메뉴
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectMemo(memo.id);
    if (isTrashItem) {
      showListContextMenu([
        { label: '복원', action: () => api.restoreFromTrash(memo.id) },
        'sep',
        { label: '영구 삭제', danger: true, action: () => {
          if (confirm('영구적으로 삭제할까요? 복구할 수 없습니다.')) {
            api.emptyTrash();
            selectedId = null;
            renderList();
            renderPreview(null);
          }
        }},
      ], e.clientX, e.clientY);
    } else {
      showListContextMenu([
        { label: '메모 열기',  action: () => api.focusMemo(memo.id) },
        { label: '답글 작성',  action: () => api.createReply(memo.id) },
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
    actions.querySelector('[data-action="permanent-delete"]').addEventListener('click', () => {
      if (confirm('영구적으로 삭제할까요? 복구할 수 없습니다.')) {
        const idx = trashMemos.findIndex(m => m.id === memo.id);
        if (idx !== -1) trashMemos.splice(idx, 1);
        api.emptyTrash(); // 전체 비우기 대신 클라이언트에서 제거 후 목록 갱신
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

// ── 단축키 도움말 오버레이 ──
function showShortcutOverlay() {
  document.getElementById('shortcutOverlay').classList.add('visible');
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

  btnStickyNotes?.addEventListener('click', async () => {
    isStickyNotesMode = !isStickyNotesMode;
    await api.setStickyNotesMode(isStickyNotesMode);
    updateStickyNotesBtn();
  });

  // 사이드바 빈 공간 우클릭 → 새 메모 / 선택 삭제
  sidebar.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.memo-list-item')) return; // 항목 우클릭은 항목이 처리
    e.preventDefault();
    const items = [{ label: '새 메모', action: () => api.createMemo() }];
    if (selectedId) {
      items.push('sep');
      items.push({ label: '선택 삭제', danger: true, action: async () => {
        await api.deleteById(selectedId);
        selectedId = null;
      }});
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

  // 단축키 도움말
  btnShortcutHelp?.addEventListener('click', showShortcutOverlay);
  document.getElementById('shortcutClose')?.addEventListener('click', () => {
    document.getElementById('shortcutOverlay').classList.remove('visible');
  });
  document.getElementById('shortcutOverlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('shortcutOverlay')) {
      document.getElementById('shortcutOverlay').classList.remove('visible');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.getElementById('shortcutOverlay')?.classList.remove('visible');
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
