const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, clipboard, nativeImage, shell } = require('electron');
app.setName('nagi memo');
// GPU 캐시 에러 메시지 억제 (기능에 영향 없는 Chromium 내부 노이즈)
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
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
        theme:          'dark',
        accentColor:    null,
        font:           { family: 'system-ui', size: 14 },
        savedProfiles:  [],
        stickyNotesMode: false
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
function createMemoWindow(memoData, options = {}) {
  const {
    id,
    window: bounds = {},
    pinned   = false,
    opacity  = 1.0,
    minimized = false,
  } = memoData;

  // 최소화 상태면 작게 시작 (포스트잇 54px + 여백 = 64px)
  const BUBBLE_SIZE = 64;
  const winWidth  = minimized ? BUBBLE_SIZE : (bounds.width  || 320);
  const winHeight = minimized ? BUBBLE_SIZE : (bounds.height || 420);

  // Linux에서는 type:'desktop'으로 생성 → 데스크탑 레이어에 위치,
  // OS 드래그 선택 박스(rubber band)가 메모 위에 표시됨.
  // 핀 시 setAlwaysOnTop(true)로 정상 앱 레이어로 올라옴.
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width:     winWidth,
    height:    winHeight,
    minWidth:  minimized ? BUBBLE_SIZE : 260,
    minHeight: minimized ? BUBBLE_SIZE : 80,
    frame:      false,
    transparent:true,
    resizable:  !minimized,
    alwaysOnTop:pinned,
    opacity,
    show: false,
    ...(process.platform === 'linux' ? { type: 'desktop' } : {}),
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

  // 답글 메모: 항상 부모 아래에 고정 (독립 이동 불가)
  if (memoData.parentId) {
    let attached = false;
    let _syncing = false;
    let _parentMoveHandler   = null;
    let _parentResizeHandler = null;
    let _selfHandler         = null;

    const attach = (parentWin) => {
      if (attached) return;
      attached = true;

      // 부모가 이동하거나 리사이즈되면 답글을 부모 바로 아래로 재배치
      const snapToParent = () => {
        if (win.isDestroyed() || _syncing) return;
        if (!parentWin || parentWin.isDestroyed()) return;
        const pb = parentWin.getBounds();
        _syncing = true;
        win.setPosition(Math.round(pb.x), Math.round(pb.y + pb.height + 2));
        _syncing = false;
      };

      _parentMoveHandler   = snapToParent;
      _parentResizeHandler = snapToParent;
      parentWin.on('move',   _parentMoveHandler);
      parentWin.on('resize', _parentResizeHandler);
    };

    // 표시 시 즉시 부모 아래에 붙음 (신규 생성 또는 앱 재시작)
    win.once('show', () => {
      const parentWin = (options.immediateAttach && !options.immediateAttach.isDestroyed())
        ? options.immediateAttach
        : memoWindows.get(memoData.parentId);
      if (parentWin && !parentWin.isDestroyed()) {
        const pb = parentWin.getBounds();
        _syncing = true;
        win.setPosition(Math.round(pb.x), Math.round(pb.y + pb.height + 2));
        _syncing = false;
        attach(parentWin);
      }
    });

    win.on('closed', () => {
      if (attached) {
        const pw = memoWindows.get(memoData.parentId);
        if (pw && !pw.isDestroyed()) {
          if (_parentMoveHandler)   pw.removeListener('move',   _parentMoveHandler);
          if (_parentResizeHandler) pw.removeListener('resize', _parentResizeHandler);
        }
      }
    });
  }

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

  // aboveWin 기준으로 belowWin 위치 재계산
  const snapBelow = () => {
    if (aboveWin.isDestroyed() || belowWin.isDestroyed() || syncing) return;
    syncing = true;
    try {
      const ab  = aboveWin.getBounds();
      const bel = belowWin.getBounds();
      belowWin.setBounds({ x: ab.x, y: ab.y + ab.height + 2, width: ab.width, height: bel.height });
    } finally { syncing = false; }
  };

  // 답글이 이동/리사이즈되면 원본 아래로 재부착
  const snapBelowIfDetached = () => {
    if (aboveWin.isDestroyed() || belowWin.isDestroyed() || syncing) return;
    const ab  = aboveWin.getBounds();
    const bel = belowWin.getBounds();
    const expectedY = ab.y + ab.height + 2;
    if (Math.abs(bel.y - expectedY) > 4 || Math.abs(bel.x - ab.x) > 4) {
      syncing = true;
      try {
        belowWin.setBounds({ x: ab.x, y: expectedY, width: ab.width, height: bel.height });
      } finally { syncing = false; }
    }
  };

  snapBelow();
  aboveWin.on('resize', snapBelow);
  aboveWin.on('move',   snapBelow);
  belowWin.on('resize', snapBelowIfDetached);
  belowWin.on('move',   snapBelowIfDetached);

  belowWin.on('closed', () => {
    if (!aboveWin.isDestroyed()) {
      aboveWin.off('resize', snapBelow);
      aboveWin.off('move',   snapBelow);
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
      win.setSize(64, 64);
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

  // 메모 목록 창 열기 (숨겨진 상태면 show)
  ipcMain.handle('memo:openList', () => {
    if (listWindow && !listWindow.isDestroyed()) {
      if (!listWindow.isVisible()) listWindow.show();
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

  // 메모 목록 창 트레이로 숨기기
  ipcMain.handle('list:hide', () => {
    if (listWindow && !listWindow.isDestroyed()) listWindow.hide();
  });

  // 이미지 파일 선택 → Base64 DataURL 반환
  ipcMain.handle('file:pickImage', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win || undefined, {
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

  // 창 숨기기 (말풍선 대신 단순 hide)
  ipcMain.handle('memo:hideWindow', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.hide();
    return true;
  });

  // 메모 전체 JSON 백업 저장 (바탕화면 기본 경로)
  ipcMain.handle('memo:exportBackup', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const memos = getMemos();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const defaultName = `desktop-memo-backup-${timestamp}.json`;
    const desktopPath = app.getPath('desktop');

    const { filePath, canceled } = await dialog.showSaveDialog(win || undefined, {
      defaultPath: path.join(desktopPath, defaultName),
      filters: [{ name: 'JSON 파일', extensions: ['json'] }],
      title: '메모 백업 저장',
    });

    if (canceled || !filePath) return { success: false };

    const data = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      memoCount: memos.length,
      memos,
    }, null, 2);

    fs.writeFileSync(filePath, data, 'utf8');
    return { success: true, filePath };
  });

  // 서브 메모(답글) 일괄 잠금 — 부모 잠금 시 자식 창에 전파

  ipcMain.handle('memo:importBackup', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { filePaths, canceled } = await dialog.showOpenDialog(win || undefined, {
      filters: [{ name: 'JSON 파일', extensions: ['json'] }],
      title: '메모 백업 불러오기',
      properties: ['openFile'],
    });
    if (canceled || !filePaths?.length) return { success: false };
    try {
      const raw = fs.readFileSync(filePaths[0], 'utf8');
      const data = JSON.parse(raw);
      const imported = Array.isArray(data.memos) ? data.memos : (Array.isArray(data) ? data : null);
      if (!imported) return { success: false, error: '유효하지 않은 백업 파일입니다.' };
      const existing = getMemos();
      const existingIds = new Set(existing.map(m => m.id));
      const newMemos = imported.filter(m => m?.id && !existingIds.has(m.id));
      saveMemos([...existing, ...newMemos]);
      broadcastListUpdate();
      return { success: true, count: newMemos.length };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 저장된 프로필 전체 조회
  ipcMain.handle('profiles:getAll', () => {
    return store.get('globalSettings.savedProfiles', []);
  });

  // 프로필 저장 (name 중복 시 덮어쓰기)
  ipcMain.handle('profiles:save', (_e, profile) => {
    const profiles = store.get('globalSettings.savedProfiles', []);
    const idx = profiles.findIndex(p => p.name === profile.name);
    const entry = { ...profile, savedAt: new Date().toISOString() };
    if (idx !== -1) profiles[idx] = entry;
    else profiles.push(entry);
    store.set('globalSettings.savedProfiles', profiles);
    return true;
  });

  // 프로필 삭제
  ipcMain.handle('profiles:delete', (_e, name) => {
    let profiles = store.get('globalSettings.savedProfiles', []);
    profiles = profiles.filter(p => p.name !== name);
    store.set('globalSettings.savedProfiles', profiles);
    return true;
  });

  // 특정 메모 ID로 필드 업데이트 (목록 뷰에서 태그 편집 등)
  ipcMain.handle('memo:updateById', (_e, { id, changes }) => {
    const memos = getMemos();
    const idx = memos.findIndex(m => m.id === id);
    if (idx === -1) return false;
    const { createdAt: _ignored, ...safeChanges } = changes;
    Object.assign(memos[idx], safeChanges);
    memos[idx].updatedAt = new Date().toISOString();
    saveMemos(memos);
    broadcastListUpdate();
    return true;
  });

  // Sticky Notes 모드 토글 — 모든 창에 브로드캐스트
  ipcMain.handle('settings:setStickyNotesMode', (_e, enabled) => {
    store.set('globalSettings.stickyNotesMode', enabled);
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('stickyNotes:modeChanged', enabled);
    });
    return true;
  });

  // 앱 강조색 변경 (트레이 아이콘 색상 포함)
  ipcMain.handle('settings:setAccentColor', (_e, color) => {
    store.set('globalSettings.accentColor', color);
    updateTrayIcon();
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('settings:accentColorChanged', color);
    });
    return true;
  });

  // 심볼 아이콘 변경
  ipcMain.handle('settings:setSymbolIcon', (_e, iconId) => {
    store.set('globalSettings.symbolIcon', iconId);
    updateTrayIcon();
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('settings:symbolIconChanged', iconId);
    });
    return true;
  });

  // 창 이동 가능 여부 토글 (SN 모드 위치잠금)
  ipcMain.handle('window:setMovable', (event, movable) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.setMovable(movable);
    return true;
  });

  // 마우스 이벤트 무시 토글 (잠금 클릭스루)
  ipcMain.handle('window:setIgnoreMouseEvents', (event, ignore, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(ignore, options || {});
    return true;
  });

  // 팝업 전용 투명 창 열기 (list.html?popup=TYPE)
  ipcMain.handle('popup:open', (event, { type, width, height }) => {
    const { screen } = require('electron');
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const display   = senderWin
      ? screen.getDisplayNearestPoint(senderWin.getBounds())
      : screen.getPrimaryDisplay();
    const { workArea } = display;
    const w = Math.min(width  || 640, workArea.width  - 40);
    const h = Math.min(height || 700, workArea.height - 40);
    const x = workArea.x + Math.floor((workArea.width  - w) / 2);
    const y = workArea.y + Math.floor((workArea.height - h) / 2);
    const popup = new BrowserWindow({
      x, y, width: w, height: h,
      frame: false, transparent: true, resizable: false, show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    popup.loadFile(path.join(__dirname, 'renderer', 'list.html'), { query: { popup: type } });
    popup.once('ready-to-show', () => popup.show());
  });

  // 팝업 표시를 위한 창 확장 (현재 bounds 저장 후 중앙에 크게 배치)
  ipcMain.handle('window:expandForPopup', (event, { width, height }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return null;
    const prev = win.getBounds();
    const { screen } = require('electron');
    const display = screen.getDisplayNearestPoint({ x: prev.x + Math.floor(prev.width / 2), y: prev.y + Math.floor(prev.height / 2) });
    const { workArea } = display;
    const newW = Math.min(width,  workArea.width  - 40);
    const newH = Math.min(height, workArea.height - 40);
    const newX = workArea.x + Math.floor((workArea.width  - newW) / 2);
    const newY = workArea.y + Math.floor((workArea.height - newH) / 2);
    win.setBounds({ x: newX, y: newY, width: newW, height: newH }, true);
    return prev;
  });

  // 팝업 닫은 후 창 복원
  ipcMain.handle('window:restoreFromPopup', (event, prev) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || !prev) return;
    win.setBounds(prev, true);
  });

  // 창 폭 변경 (원본 테마 적용 시 폭 동기화)
  ipcMain.handle('window:setWidth', (event, width) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      const bounds = win.getBounds();
      // 답글 창이면 부모의 현재 x를 기준으로 정렬 (사용자가 왼쪽 드래그로 늘렸어도 올바른 위치)
      let targetX = bounds.x;
      for (const [id, w] of memoWindows) {
        if (w === win) {
          const memo = getMemoById(id);
          if (memo?.parentId) {
            const parentWin = memoWindows.get(memo.parentId);
            if (parentWin && !parentWin.isDestroyed()) {
              targetX = parentWin.getBounds().x;
            }
          }
          break;
        }
      }
      win.setSize(Math.max(200, Math.round(width)), bounds.height);
      win.setPosition(Math.round(targetX), bounds.y);
    }
    return true;
  });

  // 커스텀 앱 아이콘 설정 (트레이 + 심볼 버튼)
  // opts: { dataUrl, svgText } 또는 null (초기화)
  ipcMain.handle('settings:setCustomIcon', (_e, opts) => {
    const dataUrl = opts?.dataUrl ?? null;
    const svgText = opts?.svgText ?? null;
    store.set('globalSettings.customAppIcon',    dataUrl);
    store.set('globalSettings.customAppIconSvg', svgText);
    if (dataUrl && tray && !tray.isDestroyed()) {
      try {
        tray.setImage(nativeImage.createFromDataURL(dataUrl));
      } catch { updateTrayIcon(); }
    } else if (!dataUrl) {
      updateTrayIcon();
    }
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('settings:customIconChanged', { dataUrl, svgText });
    });
    return true;
  });

  // 외부 URL 열기
  ipcMain.handle('shell:openExternal', (_e, url) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      shell.openExternal(url);
    }
  });

}

// 목록 창에 메모 변경 알림
function broadcastListUpdate() {
  if (listWindow && !listWindow.isDestroyed()) {
    listWindow.webContents.send('memo:listUpdated');
  }
}

// ──────────────────────────────────────────
// 트레이 아이콘 동적 생성 (순수 PNG 픽셀 렌더링 — SVG 미사용)
// ──────────────────────────────────────────
function buildTrayIcon(symbolId = 'clover', color = '#8fbc8f') {
  const zlib = require('zlib');
  const W = 32, H = 32;
  const hex = (color || '#8fbc8f').replace('#', '');
  const fr  = parseInt(hex.slice(0, 2), 16);
  const fg  = parseInt(hex.slice(2, 4), 16);
  const fb  = parseInt(hex.slice(4, 6), 16);
  const buf = Buffer.alloc(W * H * 4, 0); // RGBA all transparent

  // ── 픽셀 유틸 ──
  function setPixel(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i  = (y * W + x) * 4;
    const sA = a / 255, dA = buf[i + 3] / 255;
    const oA = sA + dA * (1 - sA);
    if (oA === 0) { buf[i] = buf[i+1] = buf[i+2] = buf[i+3] = 0; return; }
    buf[i]   = Math.round((r * sA + buf[i]   * dA * (1 - sA)) / oA);
    buf[i+1] = Math.round((g * sA + buf[i+1] * dA * (1 - sA)) / oA);
    buf[i+2] = Math.round((b * sA + buf[i+2] * dA * (1 - sA)) / oA);
    buf[i+3] = Math.round(oA * 255);
  }
  function fillCircle(cx, cy, r, r2, g2, b2, a2) {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (d <= r - 0.5) setPixel(x, y, r2, g2, b2, a2);
        else if (d <= r + 0.5) setPixel(x, y, r2, g2, b2, Math.round(a2 * (r + 0.5 - d)));
      }
    }
  }
  function drawLine(x1, y1, x2, y2, thick, r2, g2, b2, a2) {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 3;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      fillCircle(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, thick / 2, r2, g2, b2, a2);
    }
  }
  function fillRect(x, y, w, h, r2, g2, b2, a2) {
    for (let py = y; py < y + h; py++)
      for (let px = x; px < x + w; px++)
        setPixel(px, py, r2, g2, b2, a2);
  }

  // Clover only
  {
    const leafR  = W * 0.27, offset = W * 0.175;
    const leafCY = H * 0.44;
    const leaves = [
      { x: W/2 - offset, y: leafCY - offset },
      { x: W/2 + offset, y: leafCY - offset },
      { x: W/2 - offset, y: leafCY + offset },
      { x: W/2 + offset, y: leafCY + offset },
    ];
    const sw = Math.max(2, leafR * 0.18);
    for (const { x, y } of leaves) fillCircle(x, y, leafR + sw / 2, 255, 255, 255, 255);
    const stemW  = Math.max(1.5, W * 0.07);
    const stemX1 = W/2 - W * 0.01, stemY1 = leafCY + offset + leafR * 0.6;
    const stemX2 = W/2 - W * 0.18,  stemY2 = H - H * 0.08;
    drawLine(stemX1, stemY1, stemX2, stemY2, stemW + sw, 255, 255, 255, 255);
    for (const { x, y } of leaves) fillCircle(x, y, leafR, fr, fg, fb, 255);
    const cw = Math.max(1, W * 0.04);
    drawLine(W/2, leafCY - leafR, W/2, leafCY + leafR, cw, 255, 255, 255, 200);
    drawLine(W/2 - leafR, leafCY, W/2 + leafR, leafCY, cw, 255, 255, 255, 200);
    drawLine(stemX1, stemY1, stemX2, stemY2, stemW, fr, fg, fb, 255);
  }

  // ── PNG 인코딩 ──
  function crc32(b) {
    let crc = 0xffffffff;
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[i] = c; }
    for (let i = 0; i < b.length; i++) crc = t[(crc ^ b[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const tb = Buffer.from(type, 'ascii'), body = Buffer.concat([tb, data]);
    const lb = Buffer.allocUnsafe(4); lb.writeUInt32BE(data.length);
    const cb = Buffer.allocUnsafe(4); cb.writeUInt32BE(crc32(body));
    return Buffer.concat([lb, body, cb]);
  }
  const rowBytes = W * 4;
  const raw = Buffer.allocUnsafe(H * (1 + rowBytes));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + rowBytes)] = 0;
    buf.copy(raw, y * (1 + rowBytes) + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const compressed = zlib.deflateSync(raw, { level: 6 });
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = ihdr[11] = ihdr[12] = 0;
  const pngBuf = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return nativeImage.createFromBuffer(pngBuf);
}

function updateTrayIcon() {
  if (!tray) return;
  const accentColor  = store.get('globalSettings.accentColor')  || '#8fbc8f';
  const symbolId     = store.get('globalSettings.symbolIcon')   || 'clover';
  const customDataUrl = store.get('globalSettings.customAppIcon') || null;
  try {
    if (customDataUrl) {
      // 커스텀 PNG: 32x32으로 리사이즈해서 클리핑 없이 정사각형으로 표시
      let img = nativeImage.createFromDataURL(customDataUrl);
      img = img.resize({ width: 32, height: 32 });
      tray.setImage(img);
    } else {
      tray.setImage(buildTrayIcon(symbolId, accentColor));
    }
  } catch {
    const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
    try { tray.setImage(nativeImage.createFromPath(iconPath)); } catch { /* ignore */ }
  }
}

// ──────────────────────────────────────────
// 시스템 트레이
// ──────────────────────────────────────────
function setupTray() {
  // 초기 아이콘: PNG 파일 (SVG 실패 시 fallback)
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  try { tray = new Tray(iconPath); } catch { return; }
  tray.setToolTip('nagi memo');

  // 트레이 아이콘 클릭 → 숨겨진 창 모두 복원
  tray.on('click', () => {
    let anyShown = false;
    for (const [, win] of memoWindows) {
      if (win && !win.isDestroyed() && !win.isVisible()) {
        win.show();
        win.focus();
        anyShown = true;
      }
    }
    if (listWindow && !listWindow.isDestroyed() && !listWindow.isVisible()) {
      listWindow.show();
      listWindow.focus();
      anyShown = true;
    }
    // 모두 보이는 상태라면 클릭 시 목록 창 열기/포커스
    if (!anyShown) {
      if (listWindow && !listWindow.isDestroyed()) {
        listWindow.focus();
      }
    }
  });

  updateTrayIcon();
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
    {
      label: '모든 창 숨기기 (트레이 최소화)',
      click: () => {
        for (const [, win] of memoWindows) {
          if (win && !win.isDestroyed() && win.isVisible()) win.hide();
        }
        if (listWindow && !listWindow.isDestroyed()) listWindow.hide();
      }
    },
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

  // (자식 창은 createMemoWindow 내의 snap 동작으로 자유롭게 이동 가능)

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
