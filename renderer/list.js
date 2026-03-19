/**
 * list.js — 메모 목록 뷰 로직
 */
import { setThemeMode } from './theme.js';

const api = window.memoAPI;

let allMemos       = [];
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

  // 테마 모드 적용
  const settings = await api.getSettings();
  if (settings?.theme) setThemeMode(settings.theme);

  await loadMemos();

  bindEvents();

  // 메모 변경 수신
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
  renderList();
}

// ── 필터링 ──
function getFilteredMemos() {
  let list = allMemos;

  if (currentFilter === 'bookmarked') list = list.filter(m => m.bookmarked);
  else if (currentFilter === 'liked') list = list.filter(m => m.liked);

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
  // 기존 항목 제거 (emptyList 제외)
  [...sidebar.children].forEach(el => {
    if (el !== emptyList) el.remove();
  });

  const memos = getFilteredMemos();

  if (memos.length === 0) {
    emptyList.style.display = 'flex';
    renderPreview(null);
    return;
  }
  emptyList.style.display = 'none';

  memos
    .slice()
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .forEach(memo => sidebar.appendChild(buildListItem(memo)));
}

function buildListItem(memo) {
  const el = document.createElement('div');
  el.className = 'memo-list-item';
  el.dataset.id = memo.id;
  if (memo.id === selectedId) el.classList.add('active');

  const initial = (memo.profile?.name || '메')[0].toUpperCase();
  const accentBg = memo.theme?.accent || 'var(--color-accent)';

  const badgesHtml = [
    memo.bookmarked ? '<span class="item-badge">★ 북마크</span>' : '',
    memo.liked      ? '<span class="item-badge">♥ 좋아요</span>' : '',
    ...(memo.tags || []).slice(0, 2).map(t => `<span class="item-badge">#${t}</span>`)
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
      <div class="item-name">${escHtml(memo.profile?.name || '메모')}</div>
      <div class="item-preview">${escHtml(preview)}</div>
      <div class="item-date">${dateStr}</div>
      ${badgesHtml ? `<div class="item-badges">${badgesHtml}</div>` : ''}
    </div>
  `;

  el.addEventListener('click', () => selectMemo(memo.id));
  return el;
}

// ── 선택 ──
function selectMemo(id) {
  selectedId = id;
  // 활성 클래스 갱신
  sidebar.querySelectorAll('.memo-list-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });
  renderPreview(allMemos.find(m => m.id === id) || null);
}

// ── 미리보기 ──
function renderPreview(memo) {
  // 기존 동적 콘텐츠 제거
  [...previewPane.children].forEach(el => {
    if (el !== previewEmpty) el.remove();
  });

  if (!memo) {
    previewEmpty.style.display = 'flex';
    return;
  }
  previewEmpty.style.display = 'none';

  const initial  = (memo.profile?.name || '메')[0].toUpperCase();
  const accentBg = memo.theme?.accent || 'var(--color-accent)';
  const content  = memo.contentHtml
    ? memo.contentHtml
    : escHtml(memo.content || '(내용 없음)');

  const dateStr = memo.createdAt
    ? new Date(memo.createdAt).toLocaleString('ko-KR', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      })
    : '';

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

  const contentEl = document.createElement('div');
  contentEl.className = 'preview-content';
  contentEl.innerHTML = content;

  const actions = document.createElement('div');
  actions.className = 'preview-actions';
  actions.innerHTML = `
    <button class="preview-btn primary" data-action="open">메모 열기</button>
    <button class="preview-btn" data-action="new">새 메모</button>
    <button class="preview-btn danger" data-action="delete">삭제</button>
  `;
  actions.querySelector('[data-action="open"]').addEventListener('click', () => {
    api.focusMemo(memo.id);
  });
  actions.querySelector('[data-action="new"]').addEventListener('click', () => {
    api.createMemo();
  });
  actions.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    if (confirm(`"${memo.profile?.name || '메모'}"를 삭제할까요?`)) {
      // 삭제는 IPC를 통해 main에서 처리
      // getAllMemos로 폴링 대신 onMemoListUpdated로 자동 반영
      await api.focusMemo(memo.id); // 창을 포커스한 뒤 삭제는 사용자가 해당 창에서 진행
    }
  });

  previewPane.appendChild(header);
  previewPane.appendChild(contentEl);
  previewPane.appendChild(actions);
}

// ── 이벤트 바인딩 ──
function bindEvents() {
  // 검색
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    renderList();
  });

  // 필터 칩
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.filter;
      renderList();
    });
  });

  // 새 메모
  btnNewMemo.addEventListener('click', () => api.createMemo());

  // 닫기
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
