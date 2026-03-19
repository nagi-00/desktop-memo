const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, clipboard, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

let Store;
let store;
let tray       = null;
let listWindow = null;

// memoId → BrowserWindow 매핑
const memoWindows = new Map();

// 휴지통 (인메모리 — 재부팅 시 소멸)
let trash = [];

// ──────────────────────────────────────────
// electron-store 동적 import (ESM)
// ──────────────────────────────────────────
async function initStore() {
  const { default: ElectronStore } = await import('electron-store');
  Store = ElectronStore;
  store = new Store({
    defaults: {
      memos: [],
      globalSettings: {
        theme:       'dark',
        accentColor: null,   // null = 뉴트럴 기본
        font:        { family: 'system-ui', size: 14 }
      }
    }
  });
}

// ──────────────────────────────────────────
// 메모 기본 객체 생성 헬퍼
// ──────────────────────────────────────────
function buildNewMemo(overrides = {}) {
  const globalSettings = store.get('globalSettings');
  return {
    id:          uuidv4(),
    content:     '',
    contentHtml: '',
    tags:        [],
    images:      [],
    font:        { ...globalSettings.font },
    theme:       { accent: globalSettings.accentColor },
    profile: {
      name:       '메모',
      handle:     'note',
      badge:      'check',
      symbol:     'heart',
      bubbleIcon: '📝',
      avatarDataUrl: null
    },
    window:     { x: undefined, y: undefined, width: 320, height: 420 },
    pinned:     false,
    opacity:    1.0,
    minimized:  false,
    bookmarked: false,
    liked:      false,
    parentId:   null,        // null = 최상위, string = 부모 메모 ID (답글/스레드)
    prevBounds: null,
    createdAt:  new Date().toISOString(),
    updatedAt:  new Date().toISOString(),
    ...overrides
  };
}

// ──────────────────────────────────────────
// 메모 윈도우 생성
// ──────────────────────────────────────────
function createMemoWindow(memoData) {
  const {
    id,
    window: bounds = {},
    pinned   = false,
    opacity  = 1.0,
    minimized = false,
  } = memoData;

  // 최소화 상태면 작게 시작
  const winWidth  = minimized ? 80  : (bounds.width  || 320);
  const winHeight = minimized ? 80  : (bounds.height || 420);

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width:     winWidth,
    height:    winHeight,
    minWidth:  minimized ? 64  : 260,
    minHeight: minimized ? 64  : 200,
    frame:      false,
    transparent:true,
    resizable:  !minimized,
    alwaysOnTop:pinned,
    opacity,
    show: false,
    webPreferences: {
      preload:         path.join(__dirname, 'preload.js'),
      contextIsolation:true,
      nodeIntegration: false,
      webSecurity:     true,
    }
  });

  // local-fonts 퍼미션 자동 허용 (폰트 선택기용)
  win.webContents.session.setPermissionRequestHandler((wc, permission, callback) => {
    if (permission === 'local-fonts') return callback(true);
    callback(false);
  });

  win.loadFile(path.join(__dirname, 'renderer', 'memo.html'), {
    query: { memoId: id }
  });

  win.once('ready-to-show', () => win.show());

  // bounds 자동 저장 (debounce)
  let boundsTimer = null;
  const saveBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (win.isDestroyed()) return;
      updateMemoField(id, 'window', win.getBounds());
    }, 300);
  };
  win.on('resize', saveBounds);
  win.on('move',   saveBounds);

  // 닫기: 기본은 숨기기 (forceClose 플래그가 있을 때만 실제 닫힘)
  win.on('close', (e) => {
    if (!win._forceClose) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    memoWindows.delete(id);
    updateTrayMenu();
  });

  memoWindows.set(id, win);
  return win;
}

// ──────────────────────────────────────────
// Store 헬퍼
// ──────────────────────────────────────────
const getMemos      = ()          => store.get('memos', []);
const saveMemos     = (memos)     => store.set('memos', memos);
const getMemoById   = (id)        => getMemos().find(m => m.id === id) || null;

function updateMemoField(id, field, value) {
  const memos = getMemos();
  const idx   = memos.findIndex(m => m.id === id);
  if (idx === -1) return;
  memos[idx][field]    = value;
  memos[idx].updatedAt = new Date().toISOString();
  saveMemos(memos);
}

// ──────────────────────────────────────────
// 답글 창 부착 (aboveWin 바로 아래에 belowWin 고정)
// ──────────────────────────────────────────
function attachChildWindow(aboveWin, belowWin) {
  let syncing = false;
  const sync = () => {
    if (aboveWin.isDestroyed() || belowWin.isDestroyed() || syncing) return;
    syncing = true;
    try {
      const ab  = aboveWin.getBounds();
      const bel = belowWin.getBounds();
      belowWin.setBounds({ x: ab.x, y: ab.y + ab.height + 2, width: ab.width, height: bel.height });
    } finally { syncing = false; }
  };
  sync();
  aboveWin.on('resize', sync);
  aboveWin.on('move',   sync);
  belowWin.on('closed', () => {
    if (!aboveWin.isDestroyed()) {
      aboveWin.off('resize', sync);
      aboveWin.off('move',   sync);
    }
  });
}

// ──────────────────────────────────────────
// IPC 핸들러
// ──────────────────────────────────────────
function registerIpcHandlers() {
  // 메모 조회
  ipcMain.handle('memo:get', (_e, memoId) => getMemoById(memoId));

  // 전체 메모 조회 (목록 뷰용)
  ipcMain.handle('memo:getAll', () => getMemos());

  // 글로벌 설정
  ipcMain.handle('settings:get', () => store.get('globalSettings'));

  // 새 메모 생성
  ipcMain.handle('memo:create', () => {
    const memo = buildNewMemo();
    const memos = getMemos();
    memos.push(memo);
    saveMemos(memos);
    createMemoWindow(memo);
    updateTrayMenu();
    broadcastListUpdate();
    return memo.id;
  });

  // 답글(스레드) 메모 생성
  ipcMain.handle('memo:createReply', (_e, { parentId }) => {
    const parent = getMemoById(parentId);
    if (!parent) return null;

    // 같은 부모를 가진 기존 형제 중 가장 최근 것 → 그 아래에 붙임
    const siblings = getMemos()
      .filter(m => m.parentId === parentId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    let attachAbove = memoWindows.get(parentId);
    if (siblings.length > 0) {
      const lastWin = memoWindows.get(siblings[0].id);
      if (lastWin && !lastWin.isDestroyed()) attachAbove = lastWin;
    }

    let replyX, replyY, replyWidth = 320;
    if (attachAbove && !attachAbove.isDestroyed()) {
      const pb = attachAbove.getBounds();
      replyX = pb.x; replyY = pb.y + pb.height + 2; replyWidth = pb.width;
    }

    const memo = buildNewMemo({
      parentId,
      profile: { ...parent.profile },
      theme:   { ...parent.theme },
      font:    { ...parent.font },
      window:  { x: replyX, y: replyY, width: replyWidth, height: 420 },
    });
    const memos = getMemos();
    memos.push(memo);
    saveMemos(memos);
    const replyWin = createMemoWindow(memo);
    if (attachAbove && !attachAbove.isDestroyed()) {
      attachChildWindow(attachAbove, replyWin);
    }
    updateTrayMenu();
    broadcastListUpdate();
    return memo.id;
  });

  // 메모 업데이트
  ipcMain.handle('memo:update', (_e, { id, changes }) => {
    const memos = getMemos();
    const idx   = memos.findIndex(m => m.id === id);
    if (idx === -1) return false;
    // createdAt은 절대 변경 불가
    const { createdAt: _ignored, ...safeChanges } = changes;
    Object.assign(memos[idx], safeChanges);
    memos[idx].updatedAt = new Date().toISOString();
    saveMemos(memos);
    broadcastListUpdate();
    return true;
  });

  // 메모 삭제 → 휴지통으로 이동 (인메모리, 재부팅 시 소멸)
  ipcMain.handle('memo:delete', (_e, memoId) => {
    const memos = getMemos();
    const idx = memos.findIndex(m => m.id === memoId);
    if (idx !== -1) {
      trash.push({ ...memos[idx], deletedAt: new Date().toISOString() });
      memos.splice(idx, 1);
      saveMemos(memos);
    }
    const win = memoWindows.get(memoId);
    if (win && !win.isDestroyed()) {
      win._forceClose = true;
      win.close();
    }
    updateTrayMenu();
    broadcastListUpdate();
    return true;
  });

  // 휴지통 조회
  ipcMain.handle('memo:getTrash', () => trash);

  // 휴지통에서 복원
  ipcMain.handle('memo:restoreFromTrash', (_e, memoId) => {
    const idx = trash.findIndex(m => m.id === memoId);
    if (idx === -1) return false;
    const [memo] = trash.splice(idx, 1);
    delete memo.deletedAt;
    const memos = getMemos();
    memos.push(memo);
    saveMemos(memos);
    createMemoWindow(memo);
    updateTrayMenu();
    broadcastListUpdate();
    return true;
  });

  // 휴지통 비우기
  ipcMain.handle('memo:emptyTrash', () => {
    trash = [];
    broadcastListUpdate();
    return true;
  });

  // 핀 토글
  ipcMain.handle('memo:pin', (_e, { id, pinned }) => {
    const win = memoWindows.get(id);
    if (win && !win.isDestroyed()) win.setAlwaysOnTop(pinned);
    updateMemoField(id, 'pinned', pinned);
    return true;
  });

  // 투명도
  ipcMain.handle('memo:setOpacity', (_e, { id, opacity }) => {
    const win = memoWindows.get(id);
    if (win && !win.isDestroyed()) win.setOpacity(opacity);
    updateMemoField(id, 'opacity', opacity);
    return true;
  });

  // 최소화 ↔ 복원
  ipcMain.handle('memo:toggleMinimize', (_e, { id, minimized }) => {
    const win = memoWindows.get(id);
    if (!win || win.isDestroyed()) return false;

    if (minimized) {
      // 현재 bounds 저장 후 축소
      const prev = win.getBounds();
      updateMemoField(id, 'prevBounds', prev);
      win.setResizable(false);
      win.setSize(72, 72);
    } else {
      // 이전 크기로 복원
      const memo = getMemoById(id);
      const prev = memo?.prevBounds || { width: 320, height: 420 };
      win.setMinimumSize(260, 200);
      win.setResizable(true);
      win.setSize(prev.width || 320, prev.height || 420);
      if (prev.x != null && prev.y != null) {
        win.setPosition(Math.round(prev.x), Math.round(prev.y));
      }
    }
    updateMemoField(id, 'minimized', minimized);
    return true;
  });

  // 창 위치/크기 저장
  ipcMain.handle('window:saveState', (_e, { id, bounds }) => {
    updateMemoField(id, 'window', bounds);
    return true;
  });

  // 창 닫기 (목록 창 등)
  ipcMain.handle('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.close();
    return true;
  });

  // 테마 업데이트
  ipcMain.handle('theme:update', (_e, { id, theme }) => {
    updateMemoField(id, 'theme', theme);
    return true;
  });

  // 다크/라이트 모드 → 모든 창 broadcast
  ipcMain.handle('theme:setMode', (_e, mode) => {
    store.set('globalSettings.theme', mode);
    for (const [, win] of memoWindows) {
      if (!win.isDestroyed()) win.webContents.send('theme:modeChanged', mode);
    }
    if (listWindow && !listWindow.isDestroyed()) {
      listWindow.webContents.send('theme:modeChanged', mode);
    }
    return true;
  });

  // 메모 카드 캡처 (상태바 제외 영역 → PNG 저장 or 클립보드)
  ipcMain.handle('memo:captureCard', async (_e, { id, rect, action }) => {
    const win = memoWindows.get(id);
    if (!win || win.isDestroyed()) return { success: false };

    const image = await win.webContents.capturePage(rect);

    if (action === 'clipboard') {
      clipboard.writeImage(image);
      return { success: true };
    } else {
      const { filePath } = await dialog.showSaveDialog(win, {
        defaultPath: `memo-${Date.now()}.png`,
        filters: [{ name: 'PNG 이미지', extensions: ['png'] }],
      });
      if (filePath) {
        fs.writeFileSync(filePath, image.toPNG());
        return { success: true, filePath };
      }
      return { success: false };
    }
  });

  // 메모 복원 (숨김 → 보임)
  ipcMain.handle('memo:restore', (_e, memoId) => {
    const win = memoWindows.get(memoId);
    if (win && !win.isDestroyed()) { win.show(); win.focus(); }
    return true;
  });

  // 특정 메모 포커스 (목록 뷰에서 클릭)
  ipcMain.handle('memo:focus', (_e, memoId) => {
    const win = memoWindows.get(memoId);
    if (win && !win.isDestroyed()) {
      if (!win.isVisible()) win.show();
      win.focus();
    }
    return true;
  });

  // 메모 목록 창 열기
  ipcMain.handle('memo:openList', () => {
    if (listWindow && !listWindow.isDestroyed()) {
      listWindow.focus();
      return;
    }
    listWindow = new BrowserWindow({
      width:     600,
      height:    440,
      minWidth:  480,
      minHeight: 320,
      frame:     false,
      transparent: false,
      resizable: true,
      show:      false,
      webPreferences: {
        preload:         path.join(__dirname, 'preload.js'),
        contextIsolation:true,
        nodeIntegration: false,
      }
    });
    listWindow.loadFile(path.join(__dirname, 'renderer', 'list.html'));
    listWindow.once('ready-to-show', () => listWindow.show());
    listWindow.on('closed', () => { listWindow = null; });
  });

  // 이미지 파일 선택 → Base64 DataURL 반환 (renderer input.click() 미동작 대안)
  ipcMain.handle('file:pickImage', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }]
    });
    if (result.canceled || !result.filePaths.length) return null;
    const filePath = result.filePaths[0];
    const data = fs.readFileSync(filePath);
    const ext  = path.extname(filePath).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    return `data:${mime};base64,${data.toString('base64')}`;
  });
}

// 목록 창에 메모 변경 알림
function broadcastListUpdate() {
  if (listWindow && !listWindow.isDestroyed()) {
    listWindow.webContents.send('memo:listUpdated');
  }
}

// ──────────────────────────────────────────
// 시스템 트레이
// ──────────────────────────────────────────
function setupTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  try { tray = new Tray(iconPath); } catch { return; }
  tray.setToolTip('Desktop Memo');
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const memos = getMemos();

  const hiddenItems = memos
    .filter(m => {
      const win = memoWindows.get(m.id);
      return win && !win.isDestroyed() && !win.isVisible();
    })
    .map(m => ({
      label: (m.profile?.name || m.content?.slice(0, 24) || '(빈 메모)'),
      click: () => {
        const win = memoWindows.get(m.id);
        if (win && !win.isDestroyed()) { win.show(); win.focus(); }
      }
    }));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '새 메모 만들기',
      click: () => {
        const memo = buildNewMemo();
        const memos = getMemos();
        memos.push(memo);
        saveMemos(memos);
        createMemoWindow(memo);
        updateTrayMenu();
        broadcastListUpdate();
      }
    },
    { type: 'separator' },
    ...(hiddenItems.length > 0
      ? [{ label: '숨겨진 메모', enabled: false }, ...hiddenItems, { type: 'separator' }]
      : []),
    { label: '메모 목록 열기', click: () => ipcMain.emit('open-list') },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() }
  ]);
  tray.setContextMenu(contextMenu);
}

// ──────────────────────────────────────────
// 앱 초기화
// ──────────────────────────────────────────
app.whenReady().then(async () => {
  await initStore();
  registerIpcHandlers();
  setupTray();

  let memos = getMemos();

  // minimized 상태 초기화 (앱 재시작 시 모두 펼침)
  let changed = false;
  for (const m of memos) {
    if (m.minimized) { m.minimized = false; changed = true; }
  }
  if (changed) saveMemos(memos);

  if (memos.length === 0) {
    // 첫 실행: 기본 메모 1개
    const memo = buildNewMemo();
    saveMemos([memo]);
    createMemoWindow(memo);
  } else {
    for (const memo of memos) createMemoWindow(memo);
  }

  // 답글 창을 부모 창 아래에 재부착 (시작 시)
  const sorted = [...memos].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const attached = new Set();
  function attachThread(memoId) {
    if (attached.has(memoId)) return;
    attached.add(memoId);
    const kids = sorted.filter(m => m.parentId === memoId);
    let prevWin = memoWindows.get(memoId);
    for (const kid of kids) {
      const kidWin = memoWindows.get(kid.id);
      if (prevWin && !prevWin.isDestroyed() && kidWin && !kidWin.isDestroyed()) {
        attachChildWindow(prevWin, kidWin);
      }
      prevWin = kidWin;
      attachThread(kid.id);
    }
  }
  sorted.filter(m => !m.parentId).forEach(m => attachThread(m.id));

  updateTrayMenu();
});

// 모든 창이 닫혀도 트레이로 상주
app.on('window-all-closed', () => {});

// macOS dock 클릭
app.on('activate', () => {
  for (const [, win] of memoWindows) {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }
});

// 종료 전 bounds 저장
app.on('before-quit', () => {
  for (const [id, win] of memoWindows) {
    if (!win.isDestroyed()) {
      win._forceClose = true;
      updateMemoField(id, 'window', win.getBounds());
    }
  }
});
