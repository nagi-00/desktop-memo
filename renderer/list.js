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
const sidebar       = document.getElementById('memoListSidebar');
const emptyList     = document.getElementById('emptyList');
const previewPane   = document.getElementById('previewPane');
const previewEmpty  = document.getElementById('previewEmpty');
const searchInput   = document.getElementById('searchInput');
const btnNewMemo    = document.getElementById('btnNewMemo');
const btnClose      = document.getElementById('btnClose');

// ── 초기화 ──
async function init() {
  if (window.lucide) lucide.createIcons();

  const settings = await api.getSettings();
  if (settings?.theme) setThemeMode(settings.theme);

  await loadMemos();
  bindEvents();

  api.onMemoListUpdated(async () => {
    const prevSelected = selectedId;
    await loadMemos();
    if (prevSelected) selectMemo(prevSelected);
  });

  api.onThemeModeChanged((mode) => setThemeMode(mode));
}

// ── 메모 로드 ──
async function loadMemos() {
  allMemos = await api.getAllMemos() || [];
  trashMemos = await api.getTrash() || [];
  renderList();
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

  if (currentFilter === 'bookmarked') list = list.filter(m => m.bookmarked);
  else if (currentFilter === 'liked') list = list.filter(m => m.liked);
  else if (currentFilter === 'threads') {
    const parentIds = new Set(list.filter(m => m.parentId).map(m => m.parentId));
    list = list.filter(m => parentIds.has(m.id) || m.parentId);
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
    memo.bookmarked ? '<span class="item-badge">★ 북마크</span>' : '',
    memo.liked      ? '<span class="item-badge">♥ 좋아요</span>' : '',
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
  renderPreview(source.find(m => m.id === id) || null, isTrash);
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
    actions.innerHTML = `
      <button class="preview-btn primary" data-action="open">메모 열기</button>
      <button class="preview-btn" data-action="reply">답글</button>
      <button class="preview-btn" data-action="new">새 메모</button>
      <button class="preview-btn danger" data-action="delete">삭제</button>
    `;
    actions.querySelector('[data-action="open"]').addEventListener('click', () => {
      api.focusMemo(memo.id);
    });
    actions.querySelector('[data-action="reply"]').addEventListener('click', () => {
      api.createReply(memo.id);
    });
    actions.querySelector('[data-action="new"]').addEventListener('click', () => {
      api.createMemo();
    });
    actions.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      await api.deleteById(memo.id);
      selectedId = null;
    });
  }

  previewPane.appendChild(header);
  previewPane.appendChild(contentEl);
  if (replies.length > 0) previewPane.appendChild(threadSection);
  previewPane.appendChild(actions);
}

// ── 이벤트 바인딩 ──
function bindEvents() {
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    renderList();
  });

  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.filter;
      selectedId = null;
      renderList();
      renderPreview(null);
    });
  });

  btnNewMemo.addEventListener('click', () => api.createMemo());
  btnClose.addEventListener('click', () => window.close());
}

// ── 유틸 ──
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

init().catch(console.error);
