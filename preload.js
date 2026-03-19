const { contextBridge, ipcRenderer } = require('electron');

// URL 쿼리에서 memoId, windowType 파싱
const urlParams  = new URLSearchParams(window.location.search);
const memoId     = urlParams.get('memoId');

contextBridge.exposeInMainWorld('memoAPI', {
  // ── 현재 창 메모 ID ──
  memoId,

  // ── 데이터 조회 ──
  getMemo:    () => ipcRenderer.invoke('memo:get', memoId),
  getSettings:() => ipcRenderer.invoke('settings:get'),

  // ── 메모 CRUD ──
  createMemo: ()          => ipcRenderer.invoke('memo:create'),
  createReply:(parentId)  => ipcRenderer.invoke('memo:createReply', { parentId }),
  updateMemo: (changes)   => ipcRenderer.invoke('memo:update', { id: memoId, changes }),
  deleteMemo: ()          => ipcRenderer.invoke('memo:delete', memoId),
  deleteById: (id)        => ipcRenderer.invoke('memo:delete', id),
  getTrash:   ()          => ipcRenderer.invoke('memo:getTrash'),
  restoreFromTrash: (id)  => ipcRenderer.invoke('memo:restoreFromTrash', id),
  emptyTrash: ()          => ipcRenderer.invoke('memo:emptyTrash'),

  // ── 윈도우 제어 ──
  pinMemo:        (pinned)  => ipcRenderer.invoke('memo:pin',        { id: memoId, pinned }),
  setOpacity:     (opacity) => ipcRenderer.invoke('memo:setOpacity', { id: memoId, opacity }),
  saveWindowState:(bounds)  => ipcRenderer.invoke('window:saveState',{ id: memoId, bounds }),
  toggleMinimize: (minimized) => ipcRenderer.invoke('memo:toggleMinimize', { id: memoId, minimized }),
  closeWindow:    ()        => ipcRenderer.invoke('window:close'),

  // ── 테마 ──
  updateTheme:  (theme) => ipcRenderer.invoke('theme:update',  { id: memoId, theme }),
  setThemeMode: (mode)  => ipcRenderer.invoke('theme:setMode', mode),

  // ── 메모 목록 / 공통 ──
  openList:   ()     => ipcRenderer.invoke('memo:openList'),
  getAllMemos: ()     => ipcRenderer.invoke('memo:getAll'),
  focusMemo:  (id)   => ipcRenderer.invoke('memo:focus', id),

  // ── 이벤트 수신 ──
  onThemeModeChanged: (callback) => {
    const handler = (_e, mode) => callback(mode);
    ipcRenderer.on('theme:modeChanged', handler);
    return () => ipcRenderer.removeListener('theme:modeChanged', handler);
  },

  // ── 파일 선택 ──
  pickImageFile: () => ipcRenderer.invoke('file:pickImage'),

  // ── 캡처 (이미지 저장 / 클립보드) ──
  captureCard: ({ rect, action }) => ipcRenderer.invoke('memo:captureCard', { id: memoId, rect, action }),

  onMemoListUpdated: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('memo:listUpdated', handler);
    return () => ipcRenderer.removeListener('memo:listUpdated', handler);
  },
});
