import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, powerMonitor, protocol, screen, session, Tray, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { existsSync, readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createInitialState, applyAction, advanceSimulation } from '../core/simulation.js';
import { validateAction } from '../core/validation.js';
import type { FileResult, Snapshot, TerrariumState } from '../shared/types.js';
import { LocalStore, readSaveFile, writeSaveFile } from './storage.js';
import { clampToWorkArea, moveWidgetWithinArea, validWidgetDelta, onlineElapsed, WIDGET_DIMENSIONS, type Bounds } from './window-state.js';

app.setName('Mosslight');
// Test launch uses its own data directory; never read or mutate a user's real bottle.
const testData = process.argv.find((arg) => arg.startsWith('--mosslight-test-data='))?.slice('--mosslight-test-data='.length);
if (testData) {
  if (!isAbsolute(testData) || !testData.includes('mosslight-test-')) throw new Error('Invalid test data directory');
  app.setPath('userData', testData);
}
protocol.registerSchemesAsPrivileged([{ scheme: 'mosslight', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (!app.requestSingleInstanceLock()) app.quit();
else void app.whenReady().then(start).catch((error: unknown) => {
  dialog.showErrorBox('Mosslight could not start', error instanceof Error ? error.message : String(error));
  app.quit();
});

let widget: BrowserWindow | null = null;
let workshop: BrowserWindow | null = null;
let tray: Tray | null = null;
let state: TerrariumState;
let store: LocalStore;
let storageStatus = 'Saved locally · Available offline';
let offlineHours = 0;
let quitting = false;
const suspensionReasons = new Set<'sleep' | 'lock'>();
let suspendAt = 0;
let lastMonotonic = performance.now();
let lastSave = performance.now();
let timer: ReturnType<typeof setInterval> | undefined;
let positionSaveTimer: ReturnType<typeof setTimeout> | undefined;
let dialogOpen = false;
let lastPreferenceKey = '';
let snapshotRevision = 0;
const strokeRates = new WeakMap<Electron.WebContents, { start: number; count: number }>();
const moveRates = new WeakMap<Electron.WebContents, { start: number; count: number }>();

function snapshot(): Snapshot { return { state, meta: { revision: ++snapshotRevision, version: app.getVersion(), platform: process.platform, storageStatus, offlineHours } }; }
function broadcast(): void {
  for (const win of [widget, workshop]) if (win && !win.isDestroyed() && !win.webContents.isLoading()) win.webContents.send('terrarium:update', snapshot());
}
function save(): void {
  // This is the last ATTEMPT, including a failed disk write. Continuous tools
  // must not retry synchronously at pointer frequency on a full/unwritable disk.
  lastSave = performance.now();
  try {
    store.save(state);
    if (storageStatus.startsWith('Save failed')) storageStatus = 'Saved locally · Available offline';
  }
  catch (error) { storageStatus = `Save failed. Export a backup: ${error instanceof Error ? error.message : String(error)}. Check disk space and permissions, then restart.`; }
}
function advanceOnline(): void {
  if (suspensionReasons.size > 0) return;
  const nowMono = performance.now();
  const delta = onlineElapsed(lastMonotonic, nowMono);
  state = advanceSimulation(state, delta.ms, delta.mode, Date.now());
  lastMonotonic = nowMono;
}
function validateSender(event: IpcMainEvent | IpcMainInvokeEvent): void {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame || ![widget?.webContents, workshop?.webContents].includes(event.sender)) throw new Error('Untrusted sender');
  const url = new URL(frame.url);
  if (url.protocol !== 'mosslight:' || url.host !== 'app' || url.pathname !== '/index.html') throw new Error('Untrusted page');
}
function configureWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => { event.preventDefault(); });
  win.webContents.on('will-attach-webview', (event) => { event.preventDefault(); });
}
function readPosition(): Bounds | null {
  const path = join(store.directory, 'window.json');
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2048) return null;
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || typeof value !== 'object') return null;
    const v = value as Bounds;
    if (![v.x, v.y, v.width, v.height].every(Number.isFinite)) return null;
    return v;
  } catch { return null; }
}
function savePosition(): void {
  if (!widget || widget.isDestroyed()) return;
  const path = join(store.directory, 'window.json');
  try {
    if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() || lstatSync(path).nlink > 1)) return;
    writeFileSync(path, JSON.stringify(widget.getBounds()), { mode: 0o600 });
  } catch { /* Window position must not interfere with saving the actual terrarium. */ }
}
function rescueWidget(): void {
  if (!widget || widget.isDestroyed()) return;
  const area = screen.getDisplayMatching(widget.getBounds()).workArea;
  widget.setBounds(clampToWorkArea(widget.getBounds(), area));
}
function showWidget(): void {
  if (!widget || widget.isDestroyed()) return;
  rescueWidget();
  widget.setIgnoreMouseEvents(false);
  widget.showInactive();
  // On Windows, Electron's behind-taskbar levels can lose topmost status.
  // Keep the bottle inside workArea, using the working native topmost level.
  widget.setAlwaysOnTop(state.preferences.alwaysOnTop, process.platform === 'win32' ? 'pop-up-menu' : 'floating');
}
function applyPreferences(): void {
  const key = JSON.stringify(state.preferences);
  if (key === lastPreferenceKey || !widget) return;
  const dim = WIDGET_DIMENSIONS[state.preferences.widgetSize];
  const old = widget.getBounds();
  const area = screen.getDisplayMatching(old).workArea;
  widget.setBounds(clampToWorkArea({ x: old.x + old.width - dim.width, y: old.y + old.height - dim.height, ...dim }, area));
  widget.setAlwaysOnTop(state.preferences.alwaysOnTop, process.platform === 'win32' ? 'pop-up-menu' : 'floating');
  if (app.isPackaged && !testData) app.setLoginItemSettings({ openAtLogin: state.preferences.launchAtLogin });
  lastPreferenceKey = key;
}
function createWidget(): void {
  const area = screen.getPrimaryDisplay().workArea;
  const dim = WIDGET_DIMENSIONS[state.preferences.widgetSize];
  const previous = readPosition();
  const anchor = previous ?? { x: area.x + area.width - dim.width - 24, y: area.y + area.height - dim.height - 16, ...dim };
  const targetArea = screen.getDisplayMatching(anchor).workArea;
  widget = new BrowserWindow({
    title: 'Mosslight · Desktop terrarium', ...clampToWorkArea({ ...anchor, ...dim }, targetArea),
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
    focusable: false, show: false, alwaysOnTop: state.preferences.alwaysOnTop,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: true },
  });
  configureWindow(widget);
  widget.on('close', (event) => { if (!quitting) { event.preventDefault(); widget?.hide(); } });
  widget.on('moved', () => {
    if (positionSaveTimer !== undefined) clearTimeout(positionSaveTimer);
    positionSaveTimer = setTimeout(() => { positionSaveTimer = undefined; savePosition(); }, 250);
  });
  widget.once('ready-to-show', showWidget);
  void widget.loadURL('mosslight://app/index.html?mode=widget');
  applyPreferences();
}
function openWorkshop(): void {
  if (workshop && !workshop.isDestroyed()) { workshop.show(); if (workshop.isMinimized()) workshop.restore(); workshop.focus(); return; }
  const area = screen.getPrimaryDisplay().workArea;
  workshop = new BrowserWindow({
    title: 'Mosslight · Studio', width: Math.min(1180, area.width), height: Math.min(800, area.height),
    minWidth: Math.min(920, area.width), minHeight: Math.min(640, area.height),
    backgroundColor: '#f6f5ee', show: false, autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  configureWindow(workshop);
  workshop.removeMenu();
  workshop.once('ready-to-show', () => { workshop?.show(); });
  workshop.on('closed', () => { workshop = null; save(); });
  void workshop.loadURL('mosslight://app/index.html?mode=workshop');
}
function createTray(): void {
  // Original bitmap icon: an emerald glass jar, generated without external assets.
  const size = 32; const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const inside = x >= 7 && x <= 24 && y >= 5 && y <= 27;
    if (!inside) continue;
    const i = (y * size + x) * 4;
    const border = x < 9 || x > 22 || y < 8 || y > 25;
    pixels[i] = border ? 80 : 55; pixels[i + 1] = border ? 132 : 112; pixels[i + 2] = border ? 65 : 38; pixels[i + 3] = border ? 240 : 180;
  }
  tray = new Tray(nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: 1 }));
  tray.setToolTip('Mosslight · Desktop terrarium');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open studio', click: openWorkshop },
    { label: 'Show / find terrarium', click: showWidget },
    { label: 'Hide terrarium', click: () => widget?.hide() },
    { type: 'separator' },
    { label: 'Save and quit', click: () => app.quit() },
  ]));
  tray.on('double-click', openWorkshop);
}
function installIpc(): void {
  ipcMain.handle('terrarium:get', (event) => { validateSender(event); return snapshot(); });
  ipcMain.handle('terrarium:action', (event, action: unknown) => {
    validateSender(event);
    const validated = validateAction(action);
    const continuous = ['spray', 'spray-decoration', 'pour', 'scoop', 'pour-water', 'drain-water'].includes(validated.type);
    if (continuous) {
      if (suspensionReasons.size > 0) throw new Error('Tools are unavailable while the computer is asleep or locked.');
      const now = performance.now();
      const rate = strokeRates.get(event.sender);
      if (!rate || now - rate.start >= 1_000) strokeRates.set(event.sender, { start: now, count: 1 });
      else if (++rate.count > 20) throw new Error('Tool actions are too frequent. Please try again shortly.');
    }
    advanceOnline();
    // The model rejects malformed actions. No file paths or commands cross this API.
    state = applyAction(state, validated, Date.now());
    applyPreferences();
    // Coalesce continuous strokes; release explicitly flushes the last grains.
    if (!continuous || performance.now() - lastSave >= 1_000) save();
    broadcast(); return snapshot();
  });
  ipcMain.handle('terrarium:finish-interaction', (event) => {
    validateSender(event); advanceOnline(); save(); broadcast(); return snapshot();
  });
  ipcMain.on('terrarium:open', (event) => { try { validateSender(event); } catch { return; } openWorkshop(); });
  ipcMain.on('terrarium:hide', (event) => { try { validateSender(event); } catch { return; } widget?.hide(); });
  ipcMain.on('terrarium:passthrough', (event, ignore: unknown) => {
    try { validateSender(event); } catch { return; }
    if (event.sender === widget?.webContents && typeof ignore === 'boolean') widget.setIgnoreMouseEvents(ignore, { forward: true });
  });
  ipcMain.on('terrarium:move-widget', (event, dx: unknown, dy: unknown) => {
    try { validateSender(event); } catch { return; }
    if (!widget || widget.isDestroyed() || event.sender !== widget.webContents || suspensionReasons.size > 0 || !validWidgetDelta(dx, dy) || (dx === 0 && dy === 0)) return;
    const now = performance.now(), rate = moveRates.get(event.sender);
    if (!rate || now - rate.start >= 1_000) moveRates.set(event.sender, { start: now, count: 1 });
    else if (++rate.count > 60) return;
    const old = widget.getBounds(), proposed = { ...old, x: old.x + dx, y: old.y + (dy as number) };
    const area = screen.getDisplayMatching(proposed).workArea;
    widget.setBounds(moveWidgetWithinArea(old, dx, dy as number, area));
  });
  ipcMain.handle('terrarium:export', async (event): Promise<FileResult> => {
    validateSender(event);
    if (event.sender !== workshop?.webContents || dialogOpen) return { ok: false, message: 'Export from the studio.' };
    dialogOpen = true;
    try {
      const result = await dialog.showSaveDialog(workshop, { title: 'Export terrarium', defaultPath: 'Mosslight-terrarium.json', filters: [{ name: 'Mosslight save', extensions: ['json'] }] });
      if (result.canceled || !result.filePath) return { ok: false, message: 'Export canceled.' };
      advanceOnline(); writeSaveFile(resolve(result.filePath), state);
      return { ok: true, message: 'Terrarium exported. You can import it on another computer.' };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'Export failed.' }; }
    finally { dialogOpen = false; }
  });
  ipcMain.handle('terrarium:import', async (event): Promise<FileResult> => {
    validateSender(event);
    if (event.sender !== workshop?.webContents || dialogOpen) return { ok: false, message: 'Import from the studio.' };
    dialogOpen = true;
    try {
      const result = await dialog.showOpenDialog(workshop, { title: 'Import terrarium', properties: ['openFile'], filters: [{ name: 'Mosslight save', extensions: ['json'] }] });
      if (result.canceled || !result.filePaths[0]) return { ok: false, message: 'Import canceled.' };
      const imported = readSaveFile(resolve(result.filePaths[0]));
      const choice = await dialog.showMessageBox(workshop, { type: 'question', buttons: ['Cancel', 'Import'], defaultId: 0, cancelId: 0, message: 'Replace the current terrarium with this import?', detail: 'Your current terrarium will be backed up first. Device preferences will stay unchanged.' });
      if (choice.response !== 1) return { ok: false, message: 'Import canceled.' };
      advanceOnline();
      writeSaveFile(join(store.directory, `before-import-${Date.now()}.json`), state);
      // A shared/imported design starts from its saved ecological state, without
      // surprising offline catch-up or changing startup/system preferences.
      const importedAt = Date.now();
      const candidate = { ...imported, preferences: state.preferences, createdAt: Math.min(imported.createdAt, importedAt), updatedAt: importedAt };
      store.save(candidate); state = candidate; lastMonotonic = performance.now(); offlineHours = 0;
      if (suspensionReasons.size > 0) suspendAt = importedAt;
      broadcast(); return { ok: true, message: 'Imported. Your previous terrarium has been backed up.' };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'Import failed. Your original terrarium is unchanged.' }; }
    finally { dialogOpen = false; }
  });
}
function suspend(reason: 'sleep' | 'lock'): void {
  if (suspensionReasons.has(reason)) return;
  if (suspensionReasons.size === 0) { advanceOnline(); suspendAt = Date.now(); save(); }
  suspensionReasons.add(reason);
}
function resume(reason: 'sleep' | 'lock'): void {
  if (!suspensionReasons.delete(reason) || suspensionReasons.size > 0) return;
  const now = Date.now();
  const elapsed = Math.max(0, now - suspendAt);
  state = advanceSimulation(state, elapsed, 'offline', now);
  offlineHours = elapsed / 3_600_000;
  lastMonotonic = performance.now(); save(); broadcast();
}
async function start(): Promise<void> {
  store = new LocalStore(app.getPath('userData'));
  const loaded = store.load(); const now = Date.now(); storageStatus = loaded.message;
  state = loaded.state ?? createInitialState(now);
  if (loaded.state) {
    const elapsed = Math.max(0, now - state.updatedAt);
    offlineHours = elapsed / 3_600_000;
    state = advanceSimulation(state, elapsed, 'offline', now);
  }
  protocol.handle('mosslight', (request) => {
    const url = new URL(request.url);
    const names = new Map([['/index.html', 'index.html'], ['/app.js', 'app.js'], ['/styles.css', 'styles.css']]);
    const filename = names.get(url.pathname);
    if (request.method !== 'GET' || url.host !== 'app' || !filename) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(join(__dirname, 'renderer', filename)).toString());
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !['mosslight:', 'file:', 'devtools:'].includes(new URL(details.url).protocol) }));
  installIpc(); createWidget(); createTray();
  if (!loaded.state || process.argv.includes('--workshop')) openWorkshop();
  lastMonotonic = performance.now(); save();
  timer = setInterval(() => {
    if (suspensionReasons.size === 0) { advanceOnline(); if (performance.now() - lastSave >= 10_000) save(); broadcast(); }
  }, 1_000);
  powerMonitor.on('suspend', () => suspend('sleep')); powerMonitor.on('resume', () => resume('sleep'));
  powerMonitor.on('lock-screen', () => suspend('lock')); powerMonitor.on('unlock-screen', () => resume('lock'));
  screen.on('display-removed', rescueWidget); screen.on('display-metrics-changed', rescueWidget);
  app.on('activate', openWorkshop);
  app.on('second-instance', () => { showWidget(); openWorkshop(); });
}
app.on('window-all-closed', () => { /* Tray owns the application lifetime. */ });
app.on('before-quit', () => {
  quitting = true;
  if (timer) clearInterval(timer);
  if (positionSaveTimer !== undefined) clearTimeout(positionSaveTimer);
  if (state && store) { if (suspensionReasons.size === 0) advanceOnline(); save(); savePosition(); }
  tray?.destroy();
});
