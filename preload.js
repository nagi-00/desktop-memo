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
  hideList:   ()     => ipcRenderer.invoke('list:hide'),
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

  // ── 외부 URL 열기 ──
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // ── 창 숨기기 ──
  hideWindow: () => ipcRenderer.invoke('memo:hideWindow'),

  // ── 백업/내보내기/불러오기 ──
  exportMemos: () => ipcRenderer.invoke('memo:exportBackup'),
  importMemos: () => ipcRenderer.invoke('memo:importBackup'),

  // ── 특정 ID 메모 업데이트 (목록 뷰용) ──
  updateById: (id, changes) => ipcRenderer.invoke('memo:updateById', { id, changes }),

  // ── 저장된 프로필 ──
  getProfiles:   ()        => ipcRenderer.invoke('profiles:getAll'),
  saveProfile:   (profile) => ipcRenderer.invoke('profiles:save', profile),
  deleteProfile: (name)    => ipcRenderer.invoke('profiles:delete', name),

  // ── Sticky Notes 모드 ──
  setStickyNotesMode: (enabled) => ipcRenderer.invoke('settings:setStickyNotesMode', enabled),
  onStickyNotesModeChanged: (callback) => {
    const handler = (_e, enabled) => callback(enabled);
    ipcRenderer.on('stickyNotes:modeChanged', handler);
    return () => ipcRenderer.removeListener('stickyNotes:modeChanged', handler);
  },

  // ── 앱 강조색 (트레이 아이콘 색상) ──
  setAccentColor: (color) => ipcRenderer.invoke('settings:setAccentColor', color),
  onAccentColorChanged: (callback) => {
    const handler = (_e, color) => callback(color);
    ipcRenderer.on('settings:accentColorChanged', handler);
    return () => ipcRenderer.removeListener('settings:accentColorChanged', handler);
  },

  // ── 커스텀 앱 아이콘 ──
  setCustomIcon: (opts) => ipcRenderer.invoke('settings:setCustomIcon', opts),
  onCustomIconChanged: (callback) => {
    const handler = (_e, opts) => callback(opts);
    ipcRenderer.on('settings:customIconChanged', handler);
    return () => ipcRenderer.removeListener('settings:customIconChanged', handler);
  },

  // ── 심볼 아이콘 선택 ──
  setSymbolIcon: (iconId) => ipcRenderer.invoke('settings:setSymbolIcon', iconId),
  onSymbolIconChanged: (callback) => {
    const handler = (_e, iconId) => callback(iconId);
    ipcRenderer.on('settings:symbolIconChanged', handler);
    return () => ipcRenderer.removeListener('settings:symbolIconChanged', handler);
  },

  // ── 창 이동 잠금 (SN 위치잠금) ──
  setWindowMovable: (movable) => ipcRenderer.invoke('window:setMovable', movable),

  // ── 마우스 이벤트 무시 (잠금 클릭스루) ──
  setIgnoreMouseEvents: (ignore, options) => ipcRenderer.invoke('window:setIgnoreMouseEvents', ignore, options),

  // ── 팝업 전용 창 열기 ──
  openPopup: (opts) => ipcRenderer.invoke('popup:open', opts),

  // ── 팝업 창 확장/복원 (legacy fallback) ──
  expandWindowForPopup:   (size)  => ipcRenderer.invoke('window:expandForPopup', size),
  restoreWindowFromPopup: (prev)  => ipcRenderer.invoke('window:restoreFromPopup', prev),

  // ── 서브 메모 일괄 잠금 (부모→자식 전파) ──
  onParentLocked: (callback) => {
    const handler = (_e, locked) => callback(locked);
    ipcRenderer.on('memo:parentLocked', handler);
    return () => ipcRenderer.removeListener('memo:parentLocked', handler);
  },

  // ── 창 폭 변경 (원본 테마 적용 시 동기화) ──
  setWindowWidth: (w) => ipcRenderer.invoke('window:setWidth', w),

  // ── 답글 스레드 접기 ──

  // ── 캡처 (이미지 저장 / 클립보드) ──
  captureCard: ({ rect, action }) => ipcRenderer.invoke('memo:captureCard', { id: memoId, rect, action }),

  onMemoListUpdated: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('memo:listUpdated', handler);
    return () => ipcRenderer.removeListener('memo:listUpdated', handler);
  },

  onThreadFold: (callback) => {
    const handler = (_e, memoId) => callback(memoId);
    ipcRenderer.on('thread:fold', handler);
    return () => ipcRenderer.removeListener('thread:fold', handler);
  },
});
