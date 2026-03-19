const { app, BrowserWindow, ipcMain, Tray, Menu, nativeTheme, dialog } = require('electron');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

let Store;
let store;
let tray = null;

// memoId → BrowserWindow 매핑
const memoWindows = new Map();

// electron-store 동적 import (ESM 모듈)
async function initStore() {
  const { default: ElectronStore } = await import('electron-store');
  Store = ElectronStore;
  store = new Store({
    defaults: {
      memos: [],
      globalSettings: {
        theme: 'dark',
        accentColor: '#7C3AED',
        font: { family: 'system-ui', size: 14 }
      }
    }
  });
}

// ──────────────────────────────────────────
// 메모 윈도우 생성
// ──────────────────────────────────────────
function createMemoWindow(memoData) {
  const {
    id,
    window: bounds = {},
    pinned = false,
    opacity = 1.0
  } = memoData;

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width || 320,
    height: bounds.height || 400,
    minWidth: 260,
    minHeight: 180,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: pinned,
    opacity,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'memo.html'), {
    query: { memoId: id }
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  // bounds 자동 저장 (debounce 300ms)
  let boundsTimer = null;
  const saveBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const b = win.getBounds();
      updateMemoField(id, 'window', b);
    }, 300);
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);

  // 닫기 요청 처리
  win.on('close', (e) => {
    if (win.isDestroyed()) return;
    // 렌더러가 직접 memo:delete를 보내지 않은 경우: 숨기기
    // memo:delete IPC를 받으면 forceClose 플래그를 세팅함
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
// store 헬퍼
// ──────────────────────────────────────────
function getMemos() {
  return store.get('memos', []);
}

function saveMemos(memos) {
  store.set('memos', memos);
}

function updateMemoField(id, field, value) {
  const memos = getMemos();
  const idx = memos.findIndex(m => m.id === id);
  if (idx === -1) return;
  memos[idx][field] = value;
  memos[idx].updatedAt = new Date().toISOString();
  saveMemos(memos);
}

function getMemoById(id) {
  return getMemos().find(m => m.id === id) || null;
}

// ──────────────────────────────────────────
// IPC 핸들러
// ──────────────────────────────────────────
function registerIpcHandlers() {
  // 메모 데이터 조회 (렌더러 초기화용)
  ipcMain.handle('memo:get', (_e, memoId) => {
    return getMemoById(memoId);
  });

  // 글로벌 설정 조회
  ipcMain.handle('settings:get', () => {
    return store.get('globalSettings');
  });

  // 새 메모 생성
  ipcMain.handle('memo:create', () => {
    const id = uuidv4();
    const newMemo = {
      id,
      content: '',
      tags: [],
      images: [],
      font: { ...store.get('globalSettings.font') },
      theme: { accent: store.get('globalSettings.accentColor') },
      window: { x: undefined, y: undefined, width: 320, height: 400 },
      pinned: false,
      opacity: 1.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const memos = getMemos();
    memos.push(newMemo);
    saveMemos(memos);
    createMemoWindow(newMemo);
    updateTrayMenu();
    return id;
  });

  // 메모 내용/설정 업데이트
  ipcMain.handle('memo:update', (_e, { id, changes }) => {
    const memos = getMemos();
    const idx = memos.findIndex(m => m.id === id);
    if (idx === -1) return false;
    Object.assign(memos[idx], changes);
    memos[idx].updatedAt = new Date().toISOString();
    saveMemos(memos);
    return true;
  });

  // 메모 삭제
  ipcMain.handle('memo:delete', (_e, memoId) => {
    const memos = getMemos().filter(m => m.id !== memoId);
    saveMemos(memos);
    const win = memoWindows.get(memoId);
    if (win && !win.isDestroyed()) {
      win._forceClose = true;
      win.close();
    }
    updateTrayMenu();
    return true;
  });

  // 핀 토글
  ipcMain.handle('memo:pin', (_e, { id, pinned }) => {
    const win = memoWindows.get(id);
    if (win && !win.isDestroyed()) {
      win.setAlwaysOnTop(pinned);
    }
    updateMemoField(id, 'pinned', pinned);
    return true;
  });

  // 투명도 설정
  ipcMain.handle('memo:setOpacity', (_e, { id, opacity }) => {
    const win = memoWindows.get(id);
    if (win && !win.isDestroyed()) {
      win.setOpacity(opacity);
    }
    updateMemoField(id, 'opacity', opacity);
    return true;
  });

  // bounds 저장 (렌더러에서도 호출 가능)
  ipcMain.handle('window:saveState', (_e, { id, bounds }) => {
    updateMemoField(id, 'window', bounds);
    return true;
  });

  // 테마 업데이트 → 모든 창 broadcast
  ipcMain.handle('theme:update', (_e, { id, theme }) => {
    updateMemoField(id, 'theme', theme);
    // 동일 창에 반영 (이미 렌더러에서 처리하지만 broadcast도 가능)
    return true;
  });

  // 다크/라이트 모드 토글 → 모든 창 broadcast
  ipcMain.handle('theme:setMode', (_e, mode) => {
    store.set('globalSettings.theme', mode);
    // 모든 열린 메모 창에 전달
    for (const [, win] of memoWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('theme:modeChanged', mode);
      }
    }
    return true;
  });

  // 숨겨진 메모 복원
  ipcMain.handle('memo:restore', (_e, memoId) => {
    const win = memoWindows.get(memoId);
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
    return true;
  });
}

// ──────────────────────────────────────────
// 시스템 트레이
// ──────────────────────────────────────────
function setupTray() {
  // 트레이 아이콘 (없으면 빈 이미지 사용)
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  try {
    tray = new Tray(iconPath);
  } catch {
    // 아이콘 없으면 무시 (개발 중)
    return;
  }
  tray.setToolTip('Desktop Memo');
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const memos = getMemos();
  const hiddenMemos = memos.filter(m => {
    const win = memoWindows.get(m.id);
    return win && !win.isDestroyed() && !win.isVisible();
  });

  const hiddenItems = hiddenMemos.length > 0
    ? [
        { label: '숨겨진 메모 복원', enabled: false },
        ...hiddenMemos.map(m => ({
          label: m.content?.slice(0, 30) || '(빈 메모)',
          click: () => {
            const win = memoWindows.get(m.id);
            if (win && !win.isDestroyed()) {
              win.show();
              win.focus();
            }
          }
        })),
        { type: 'separator' }
      ]
    : [];

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '새 메모 만들기',
      click: async () => {
        await ipcMain.emit('memo:create-from-tray');
        // 직접 생성
        const id = uuidv4();
        const globalSettings = store.get('globalSettings');
        const newMemo = {
          id,
          content: '',
          tags: [],
          images: [],
          font: { ...globalSettings.font },
          theme: { accent: globalSettings.accentColor },
          window: { x: undefined, y: undefined, width: 320, height: 400 },
          pinned: false,
          opacity: 1.0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        const memos = getMemos();
        memos.push(newMemo);
        saveMemos(memos);
        createMemoWindow(newMemo);
        updateTrayMenu();
      }
    },
    { type: 'separator' },
    ...hiddenItems,
    {
      label: '종료',
      click: () => {
        app.quit();
      }
    }
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

  // 저장된 메모 복원
  const memos = getMemos();
  if (memos.length === 0) {
    // 첫 실행: 기본 메모 1개 생성
    const id = uuidv4();
    const globalSettings = store.get('globalSettings');
    const defaultMemo = {
      id,
      content: '',
      tags: [],
      images: [],
      font: { ...globalSettings.font },
      theme: { accent: globalSettings.accentColor },
      window: { x: undefined, y: undefined, width: 320, height: 400 },
      pinned: false,
      opacity: 1.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    saveMemos([defaultMemo]);
    createMemoWindow(defaultMemo);
  } else {
    // 기존 메모 모두 복원
    for (const memo of memos) {
      createMemoWindow(memo);
    }
  }

  updateTrayMenu();
});

// 모든 창이 닫혀도 앱 유지 (트레이로 상주)
app.on('window-all-closed', () => {
  // 트레이 모드: 종료 안 함
  // macOS 동작도 통일
});

app.on('activate', () => {
  // macOS dock 클릭 시 메모 복원
  for (const [, win] of memoWindows) {
    if (!win.isDestroyed() && !win.isVisible()) {
      win.show();
    }
  }
});

// 앱 종료 전 모든 창 bounds 저장
app.on('before-quit', () => {
  for (const [id, win] of memoWindows) {
    if (!win.isDestroyed()) {
      win._forceClose = true;
      const b = win.getBounds();
      updateMemoField(id, 'window', b);
    }
  }
});
