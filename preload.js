const { contextBridge, ipcRenderer } = require('electron');

// URL 쿼리에서 memoId 파싱
const urlParams = new URLSearchParams(window.location.search);
const memoId = urlParams.get('memoId');

contextBridge.exposeInMainWorld('memoAPI', {
  // 현재 창의 memoId
  memoId,

  // ── 데이터 조회 ──
  getMemo: () => ipcRenderer.invoke('memo:get', memoId),
  getSettings: () => ipcRenderer.invoke('settings:get'),

  // ── 메모 CRUD ──
  createMemo: () => ipcRenderer.invoke('memo:create'),
  updateMemo: (changes) => ipcRenderer.invoke('memo:update', { id: memoId, changes }),
  deleteMemo: () => ipcRenderer.invoke('memo:delete', memoId),

  // ── 윈도우 제어 ──
  pinMemo: (pinned) => ipcRenderer.invoke('memo:pin', { id: memoId, pinned }),
  setOpacity: (opacity) => ipcRenderer.invoke('memo:setOpacity', { id: memoId, opacity }),
  saveWindowState: (bounds) => ipcRenderer.invoke('window:saveState', { id: memoId, bounds }),

  // ── 테마 ──
  updateTheme: (theme) => ipcRenderer.invoke('theme:update', { id: memoId, theme }),
  setThemeMode: (mode) => ipcRenderer.invoke('theme:setMode', mode),

  // ── 이벤트 수신 ──
  onThemeModeChanged: (callback) => {
    const handler = (_e, mode) => callback(mode);
    ipcRenderer.on('theme:modeChanged', handler);
    // cleanup 함수 반환
    return () => ipcRenderer.removeListener('theme:modeChanged', handler);
  }
});
