// Portable regressions against real bundled main and extracted renderer functions.
// Never starts Electron or writes product/user data.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const productRoot = resolve(import.meta.dirname, '../..');
assert(isAbsolute(productRoot));
assert(lstatSync(productRoot).isDirectory() && !lstatSync(productRoot).isSymbolicLink());
assert(isAbsolute(realpathSync(productRoot)));
const comparablePath = (path) => process.platform === 'win32' ? path.toLowerCase() : path;
function checkedSource(relativePath) {
  const path = join(productRoot, relativePath);
  const info = lstatSync(path);
  assert(info.isFile() && !info.isSymbolicLink());
  // Accept canonical ancestor aliases/casing, but no source-directory escape.
  assert.equal(comparablePath(realpathSync(path)), comparablePath(join(realpathSync(productRoot), relativePath)));
  return path;
}
const mainPath = checkedSource('src/desktop/main.ts');
const source = readFileSync(mainPath, 'utf8');
const require = createRequire(join(productRoot, 'package.json'));
const { build, transform } = require('esbuild');
const output = await build({ entryPoints: [mainPath], bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], write: false, logLevel: 'silent' });
const code = output.outputFiles[0].text;
const timerBody = source.match(/timer = setInterval\(\(\) => \{([\s\S]*?)\}, 1_000\);/)?.[1];
assert(timerBody, 'Locate the actual main timer; do not silently test a separate model');
console.log(JSON.stringify({ source: 'src/desktop/main.ts', sha256: createHash('sha256').update(source).digest('hex'), compiledInMemory: true, desktopProcessesStarted: 0, productFilesWritten: 0 }));

function sandbox(body) {
  let wall = 1_789_689_600_000;
  let mono = 0;
  const handlers = new Map();
  const fakeElectron = {
    app: { setName() {}, requestSingleInstanceLock() { return true; }, whenReady() { return new Promise(() => {}); }, on() {}, getVersion() { return '0.1.0'; } },
    protocol: { registerSchemesAsPrivileged() {} },
    screen: { getDisplayMatching() { return { workArea: { x: 0, y: 0, width: 1920, height: 1080 } }; } },
    ipcMain: { handle(name, fn) { handlers.set(name, fn); }, on(name, fn) { handlers.set(name, fn); } },
    dialog: { async showOpenDialog() { return { canceled: false, filePaths: [join(productRoot, 'memory-only-import.json')] }; }, async showMessageBox() { return { response: 1 }; } },
  };
  const forbiddenFs = new Proxy({}, {
    get(_target, name) {
      if (name === 'constants') return require('node:fs').constants;
      return () => { throw new Error(`Unexpected filesystem access in main sandbox: ${String(name)}`); };
    },
  });
  const context = {
    require(id) {
      if (id === 'electron') return fakeElectron;
      if (id === 'node:fs') return forbiddenFs;
      if (id === 'node:perf_hooks') return { performance: { now: () => mono } };
      if (['node:path', 'node:url', 'node:crypto'].includes(id)) return require(id);
      throw new Error(`Unexpected main bundle dependency: ${id}`);
    },
    console, __dirname: productRoot, process: { argv: [], platform: process.platform }, Buffer, URL, Response, crypto: globalThis.crypto,
    performance: { now: () => mono }, // The extracted source timer uses this imported identifier.
    Date: class extends Date { static now() { return wall; } },
    setInterval() { throw new Error('QA must not schedule a live application timer'); }, clearInterval() {},
    module: { exports: {} }, exports: {}, handlers,
    setClock: (nextWall, nextMono) => { wall = nextWall; mono = nextMono; },
  };
  runInNewContext(code + '\n' + `
    let saved = 0;
    state = createInitialState(Date.now());
    store = { save() { saved++; } };
    lastMonotonic = 0; lastSave = 0;
    globalThis.qaTick = () => { ${timerBody} };
    globalThis.qaDone = (async () => { ${body} })();
  `, context, { timeout: 5_000 });
  return context.qaDone;
}

const close = (actual, expected) => assert(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test('wake while locked never enables online time; final unlock settles exactly once at 1x', async () => {
  const result = await sandbox(`
    suspend('lock'); suspend('lock');
    setClock(Date.now() + 60_000, 60_000); suspend('sleep');
    setClock(Date.now() + 3_600_000, 3_660_000); resume('sleep');
    const before = state.ecology.simulatedDays;
    for (let i = 0; i < 60; i++) { setClock(Date.now() + 1_000, 3_660_000 + (i + 1) * 1_000); qaTick(); }
    const acceleratedWhileLocked = (state.ecology.simulatedDays - before) * 86_400;
    const remainingReason = suspensionReasons.has('lock');
    resume('lock'); const totalAfterUnlock = state.ecology.simulatedDays * 86_400;
    resume('lock'); resume('sleep'); const afterDuplicateResume = state.ecology.simulatedDays * 86_400;
    setClock(Date.now() + 1_000, 3_721_000); qaTick();
    return { acceleratedWhileLocked, remainingReason, totalAfterUnlock, afterDuplicateResume, onlineSecondsAfterUnlock: state.ecology.simulatedDays * 86_400 - totalAfterUnlock };
  `);
  console.log(JSON.stringify({ case: 'lock-sleep-wake-unlock', ...result }));
  assert.equal(result.remainingReason, true); close(result.acceleratedWhileLocked, 0);
  close(result.totalAfterUnlock, 3_720); close(result.afterDuplicateResume, 3_720); close(result.onlineSecondsAfterUnlock, 24);
});

test('unlock while sleeping stays suspended; paused lifecycle never advances ecology', async () => {
  const result = await sandbox(`
    suspend('sleep'); suspend('lock');
    setClock(Date.now() + 60_000, 60_000); resume('lock');
    const remainsSleeping = suspensionReasons.has('sleep'); advanceOnline();
    const beforeWake = state.ecology.simulatedDays; resume('sleep');
    const settledSeconds = state.ecology.simulatedDays * 86_400;
    state = createInitialState(Date.now()); state.paused = true;
    suspend('lock'); suspend('sleep'); setClock(Date.now() + 60_000, 120_000); resume('sleep'); resume('lock');
    return { remainsSleeping, beforeWake, settledSeconds, pausedDays: state.ecology.simulatedDays };
  `);
  console.log(JSON.stringify({ case: 'reverse-unlock-and-pause', ...result }));
  assert.equal(result.remainsSleeping, true); close(result.beforeWake, 0); close(result.settledSeconds, 60); close(result.pausedDays, 0);
});

test('wall-clock regression does not stop monotonic autosave cadence', async () => {
  const result = await sandbox(`
    setClock(Date.now() - 86_400_000, 0);
    for (let i = 0; i < 60; i++) { setClock(Date.now() + 1_000, (i + 1) * 1_000); qaTick(); }
    return { saves: saved, ecologicalSeconds: state.ecology.simulatedDays * 86_400 };
  `);
  console.log(JSON.stringify({ case: 'wall-clock-regression', ...result }));
  assert.equal(result.saves, 6); close(result.ecologicalSeconds, 1_440);
});

test('successful persistence retry clears current failure status', async () => {
  const result = await sandbox(`
    store = { save() { throw Error('simulated disk full'); } }; save(); const failed = storageStatus;
    store = { save() {} }; save(); return { failed, recovered: storageStatus };
  `);
  console.log(JSON.stringify({ case: 'save-retry', ...result }));
  assert.match(result.failed, /Save failed/); assert.equal(result.recovered, 'Saved locally · Available offline');
});

test('disk failures do not cause continuous tools to retry saving at pointer frequency', async () => {
  const result = await sandbox(`
    const frame = { url: 'mosslight://app/index.html?mode=widget' };
    const webContents = { mainFrame: frame, isLoading() { return false; }, send() {} };
    widget = { webContents, isDestroyed() { return false; } };
    lastPreferenceKey = JSON.stringify(state.preferences);
    store = { save() { saved++; throw Error('ENOSPC'); } };
    const event = { senderFrame: frame, sender: webContents };
    installIpc();
    for (let i = 0; i < 16; i++) {
      setClock(Date.now() + 50, 1000 + i * 50);
      handlers.get('terrarium:action')(event, {type:'pour',material:'soil',x:.4,amount:1});
    }
    const during = saved, status = storageStatus;
    handlers.get('terrarium:finish-interaction')(event);
    return {during, afterRelease:saved, status};
  `);
  assert.equal(result.during, 1); assert.equal(result.afterRelease, 2);
  assert.match(result.status, /Save failed/);
});

test('actual import IPC accepts a checksum-valid bottle from a clock 60 seconds ahead', async () => {
  const result = await sandbox(`
    const frame = { url: 'mosslight://app/index.html?mode=workshop' };
    const webContents = { mainFrame: frame, isLoading() { return false; }, send() {} };
    workshop = { webContents, isDestroyed() { return false; } };
    const imported = createInitialState(Date.now() + 60_000);
    readSaveFile = () => decodeSave(encodeSave(imported));
    writeSaveFile = () => {}; // Independent-before-import backup is memory-only here.
    let persisted = 0;
    store = { directory: __dirname, save(candidate) { validateState(candidate); persisted++; } };
    installIpc();
    const fileResult = await handlers.get('terrarium:import')({ senderFrame: frame, sender: webContents });
    return { fileResult, persisted, chronological: state.updatedAt >= state.createdAt, createdAt: state.createdAt, updatedAt: state.updatedAt };
  `);
  console.log(JSON.stringify({ case: 'future-source-import', ...result }));
  assert.equal(result.fileResult.ok, true, result.fileResult.message); assert.equal(result.persisted, 1); assert.equal(result.chronological, true);
});

test('an import committed during suspension only catches up time after that import', async () => {
  const result = await sandbox(`
    const frame = { url: 'mosslight://app/index.html?mode=workshop' };
    const webContents = { mainFrame: frame, isLoading() { return false; }, send() {} };
    workshop = { webContents, isDestroyed() { return false; } };
    suspend('lock'); setClock(Date.now() + 60_000, 60_000);
    const imported = createInitialState(Date.now());
    readSaveFile = () => decodeSave(encodeSave(imported)); writeSaveFile = () => {};
    store = {directory:__dirname, save() {}}; installIpc();
    const importedResult = await handlers.get('terrarium:import')({senderFrame:frame,sender:webContents});
    setClock(Date.now() + 60_000, 120_000); resume('lock');
    return {ok:importedResult.ok, seconds:state.ecology.simulatedDays * 86_400};
  `);
  assert.equal(result.ok, true); close(result.seconds, 60);
});

test('main revisions monotonically order get, broadcast and replies across two windows despite clock regression', async () => {
  const result = await sandbox(`
    const pushes = [];
    function fakeWindow(label) {
      const frame = { url: 'mosslight://app/index.html?mode=' + label };
      const webContents = { mainFrame: frame, isLoading() { return false; }, send(channel, value) { pushes.push({ label, revision:value.meta.revision, updatedAt:value.state.updatedAt }); } };
      return { webContents, isDestroyed() { return false; } };
    }
    widget = fakeWindow('widget'); workshop = fakeWindow('workshop');
    const event = { senderFrame:workshop.webContents.mainFrame, sender:workshop.webContents };
    installIpc(); const before = handlers.get('terrarium:get')(event);
    setClock(Date.now() - 60_000, 0); state = createInitialState(Date.now());
    state.name = 'new-bottle-after-clock-regression';
    broadcast(); const after = handlers.get('terrarium:get')(event);
    lastPreferenceKey = JSON.stringify(state.preferences);
    const actionReply = handlers.get('terrarium:action')(event, { type:'rename', name:'latest-action' });
    return { before:{revision:before.meta.revision,updatedAt:before.state.updatedAt}, pushes, after:{revision:after.meta.revision,updatedAt:after.state.updatedAt,name:after.state.name}, reply:{revision:actionReply.meta.revision,name:actionReply.state.name} };
  `);
  console.log(JSON.stringify({ case: 'main-revision-ordering', ...result }));
  assert(result.after.updatedAt < result.before.updatedAt);
  const revisions = [result.before.revision, ...result.pushes.slice(0, 2).map(value => value.revision), result.after.revision, ...result.pushes.slice(2).map(value => value.revision), result.reply.revision];
  assert(revisions.every(Number.isSafeInteger)); assert(revisions.every((value, i) => i === 0 || value > revisions[i - 1]));
  assert.equal(result.after.name, 'new-bottle-after-clock-regression'); assert.equal(result.reply.name, 'latest-action');
});

test('continuous tools coalesce writes, release flushes, and untrusted/locked/rate-limited actions cannot mutate terrain', async () => {
  const result = await sandbox(`
    const frame = { url: 'mosslight://app/index.html?mode=widget' };
    const webContents = { mainFrame: frame, isLoading() { return false; }, send() {} };
    widget = { webContents, isDestroyed() { return false; } };
    lastPreferenceKey = JSON.stringify(state.preferences);
    const event = { senderFrame: frame, sender: webContents };
    installIpc(); const action = handlers.get('terrarium:action');
    const count = () => state.terrain.columns.reduce((n, column) => n + column.length, 0);
    const initial = count();
    for (let i = 0; i < 10; i++) { setClock(Date.now() + 100, (i + 1) * 100); action(event, {type:'pour',material:'bark',x:.4,amount:2}); }
    const during = saved, grainsAdded = count() - initial;
    handlers.get('terrarium:finish-interaction')(event); const flushed = saved;
    const stranger = { senderFrame: frame, sender: { mainFrame: frame } };
    let rejected = 0;
    for (const channel of ['terrarium:action','terrarium:finish-interaction']) {
      try { handlers.get(channel)(stranger, {type:'pour',material:'soil',x:.5,amount:1}); } catch { rejected++; }
    }
    handlers.get('terrarium:open')(stranger); handlers.get('terrarium:hide')(stranger); handlers.get('terrarium:passthrough')(stranger, false);
    suspend('lock'); const lockedBefore = count(); let lockedRejected = false;
    try { action(event, {type:'pour',material:'soil',x:.5,amount:1}); } catch { lockedRejected = true; }
    const lockedUnchanged = count() === lockedBefore; resume('lock');
    setClock(Date.now() + 1000, 2000); let rateRejected = 0;
    for (let i = 0; i < 30; i++) { try { action(event, {type:'scoop',x:.5,amount:1}); } catch { rateRejected++; } }
    return {during, flushed, grainsAdded, rejected, lockedRejected, lockedUnchanged, rateRejected};
  `);
  assert.equal(result.during, 1); assert.equal(result.flushed, 2); assert.equal(result.grainsAdded, 20);
  assert.equal(result.rejected, 2); assert.equal(result.lockedRejected, true); assert.equal(result.lockedUnchanged, true);
  assert.equal(result.rateRejected, 10);
});

test('wood preset placement crosses real main IPC as one complete saved object', async () => {
  const result = await sandbox(`
    const frame = {url:'mosslight://app/index.html?mode=workshop'};
    const pushes=[];
    const webContents = {mainFrame:frame,isLoading(){return false;},send(channel,value){pushes.push(value.state.decorations.map(d=>({id:d.id,wood:d.wood})));}};
    workshop = {webContents,isDestroyed(){return false;}};
    lastPreferenceKey=JSON.stringify(state.preferences);
    const event={senderFrame:frame,sender:webContents};installIpc();
    const action=handlers.get('terrarium:action');
    const before=state.decorations.length;
    const reply=action(event,{type:'add-decoration',kind:'wood',woodPreset:'double-fork',x:.4,y:.5});
    const object=reply.state.decorations.at(-1), firstSaves=saved, firstPushes=pushes.length;
    const settled=JSON.stringify(state);let rejected=0;
    for(const invalid of [
      {type:'add-decoration',kind:'wood',woodPreset:'missing',x:.4,y:.5},
      {type:'add-decoration',kind:'stone',woodPreset:'single',x:.4,y:.5},
      {type:'add-decoration',kind:'wood',woodPreset:'single',x:.4,y:.5,extra:true}
    ]){try{action(event,invalid);}catch{rejected++;}}
    return {before,after:state.decorations.length,object,firstSaves,firstPushes,pushes,rejected,unchanged:JSON.stringify(state)===settled,finalSaves:saved};
  `);
  assert.equal(result.after,result.before+1);
  assert.equal(result.object.kind,'wood');assert.equal(result.object.wood.branches.length,2);
  assert.equal(Object.hasOwn(result.object,'woodPreset'),false);
  assert.equal(result.firstSaves,1);assert.equal(result.finalSaves,1);
  assert.equal(result.firstPushes,1);assert.equal(result.pushes.length,1);
  assert.equal(result.pushes[0].at(-1).wood.branches.length,2);
  assert.equal(result.rejected,3);assert.equal(result.unchanged,true);
});

test('v08 variant and pose IPC save complete changes, reject partial edits, and reset saves an empty bottle', async () => {
  const result = await sandbox(`
    const frame={url:'mosslight://app/index.html?mode=workshop'};
    const webContents={mainFrame:frame,isLoading(){return false;},send(){}};
    workshop={webContents,isDestroyed(){return false;}};
    lastPreferenceKey=JSON.stringify(state.preferences); installIpc();
    const event={senderFrame:frame,sender:webContents},action=handlers.get('terrarium:action');
    const snapshots=[];store={save(){saved++;snapshots.push(JSON.parse(JSON.stringify(state)));}};
    action(event,{type:'add-decoration',kind:'stone',variant:'flat',x:.4,y:.5});
    action(event,{type:'add-decoration',kind:'wood',woodPreset:'single',x:.5,y:.5});
    const wood=state.decorations.at(-1),originalForm=JSON.stringify(wood.wood);
    action(event,{type:'object-pose',id:wood.id,value:{angle:90,flipX:true}});
    const before=JSON.stringify(state),savesBefore=saved;let rejected=0;
    for(const bad of [
      {type:'add-decoration',kind:'stone',variant:'fallen',x:.4,y:.5},
      {type:'object-pose',id:wood.id,value:{angle:181,flipX:true}},
      {type:'object-pose',id:state.decorations[0].id,value:{angle:15,flipX:false}},
      {type:'object-pose',id:'missing',value:{angle:15,flipX:false}}
    ])try{action(event,bad);}catch{rejected++;}
    const invalidUnchanged=before===JSON.stringify(state)&&saved===savesBefore;
    const prefs=JSON.stringify(state.preferences); action(event,{type:'reset'});
    return {snapshots,saved,rejected,invalidUnchanged,originalForm,prefs,finalPrefs:JSON.stringify(state.preferences)};
  `);
  assert.equal(result.saved,4);assert.equal(result.rejected,4);assert.equal(result.invalidUnchanged,true);
  assert.equal(result.snapshots[0].decorations[0].variant,'flat');
  assert.equal(result.snapshots[1].decorations.at(-1).wood.bend,-.24);
  const posed=result.snapshots[2].decorations.at(-1);
  assert.equal(JSON.stringify(posed.wood),result.originalForm);assert.equal(posed.pose.angle,90);assert.equal(posed.pose.flipX,true);
  const empty=result.snapshots[3];assert.equal(empty.terrain.columns.length,48);
  assert(empty.terrain.columns.every(column=>column.length===0));
  assert.equal(empty.plants.length,0);assert.equal(empty.decorations.length,0);assert.equal(empty.pond,undefined);
  assert.equal(result.finalPrefs,result.prefs);
});

test('pond fill and drain use continuous write coalescing and flush only accepted bounded water', async () => {
  const result = await sandbox(`
    const frame = {url:'mosslight://app/index.html?mode=widget'};
    const webContents = {mainFrame:frame,isLoading(){return false;},send(){}};
    widget = {webContents,isDestroyed(){return false;}};
    lastPreferenceKey = JSON.stringify(state.preferences);
    const event = {senderFrame:frame,sender:webContents};
    installIpc(); const action = handlers.get('terrarium:action');
    const volume = () => state.pond?.depths.reduce((sum,n)=>sum+n,0) ?? 0;
    for(let i=0;i<10;i++){setClock(Date.now()+100,(i+1)*100);action(event,{type:'pour-water',x:.4,amount:16});}
    const during=saved,filled=volume();handlers.get('terrarium:finish-interaction')(event);const flushed=saved;
    for(let i=0;i<3;i++){setClock(Date.now()+100,1100+i*100);action(event,{type:'drain-water',x:.4,amount:8,radius:7});}
    const drained=volume(),drainDuring=saved;handlers.get('terrarium:finish-interaction')(event);
    const before=JSON.stringify(state);let invalid=0;
    for(const candidate of [{type:'pour-water',x:.4,amount:33},{type:'drain-water',x:NaN,amount:2}])try{action(event,candidate);}catch{invalid++;}
    return {during,filled,flushed,drained,drainDuring,final:saved,invalid,unchanged:before===JSON.stringify(state)};
  `);
  assert.equal(result.filled,160); assert(result.drained<result.filled);
  assert.equal(result.during,1);assert.equal(result.flushed,2);assert.equal(result.drainDuring,2);assert.equal(result.final,3);
  assert.equal(result.invalid,2);assert.equal(result.unchanged,true);
});

test('widget move IPC is widget-only, bounded, rate-limited and preserves terrain/preferences', async () => {
  const result = await sandbox(`
    const frame = { url: 'mosslight://app/index.html?mode=widget' };
    const webContents = { mainFrame: frame, isLoading() { return false; }, send() {} };
    let bounds = { x: 20, y: 30, width: 320, height: 400 }, changes = 0;
    widget = { webContents, isDestroyed() { return false; }, getBounds() { return {...bounds}; }, setBounds(value) { bounds = value; changes++; } };
    const otherFrame = { url:'mosslight://app/index.html?mode=workshop' }, other = { mainFrame:otherFrame };
    workshop = { webContents: other, isDestroyed() { return false; } };
    installIpc(); const move = handlers.get('terrarium:move-widget'), event = { senderFrame:frame, sender:webContents };
    const before = JSON.stringify(state);
    move({senderFrame:frame,sender:{mainFrame:frame}},10,10);
    move({senderFrame:otherFrame,sender:other},10,10);
    for (const bad of [NaN,Infinity,'20',{},513,.1]) { move(event,bad,0); move(event,0,bad); }
    const afterInvalid = changes;
    for(let i=0;i<65;i++)move(event,1,1);
    const limited = changes;
    suspensionReasons.add('lock');move(event,10,10);const locked=changes;suspensionReasons.clear();
    setClock(Date.now()+1000,1000);move(event,512,512);move(event,512,512);move(event,512,512);
    return {afterInvalid,limited,locked,changes,bounds,unchanged:before===JSON.stringify(state)};
  `);
  assert.equal(result.afterInvalid, 0); assert.equal(result.limited, 60); assert.equal(result.locked, 60); assert.equal(result.changes, 63);
  assert.deepEqual(JSON.parse(JSON.stringify(result.bounds)), { x: 1600, y: 680, width: 320, height: 400 }); assert.equal(result.unchanged, true);
});

test('actual renderer receive accepts newer revision with older clock and rejects delayed replies', async () => {
  const rendererPath = checkedSource('src/renderer/index.ts');
  const rendererSource = readFileSync(rendererPath, 'utf8');
  const ts = require('typescript');
  const ast = ts.createSourceFile(rendererPath, rendererSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const receiver = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'receive');
  assert(receiver, 'Extract the real receive function, not a replacement comparator');
  const visible = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'renderVisibleState');
  assert(visible, 'Extract the real snapshot rendering helper too');
  const receiverCode = (await transform(`${receiver.getText(ast)}\n${visible.getText(ast)}`, { loader:'ts', target:'es2022' })).code;
  const context = { document:{documentElement:{classList:{toggle(){}}}}, console };
  runInNewContext(`
    let snapshot = null; const isWidget = true; const scene = null; const selected = null; const entityEditor = null;
    let formDraft = null; let pendingGlassForm = null;
    const drafts = new Set();
    function text() {} function currentEntity() {} function select() {} function syncInput() {}
    function displayTerrariumName(name) { return name; } // Display-only adapter; real receive/revision logic is extracted below.
    function element() { return {}; } function hasLid() { return true; }
    ${receiverCode}
    const value = (revision, updatedAt, name) => ({ state:{updatedAt,name,paused:false,vacation:false,environment:{temperature:22},preferences:{reducedMotion:false}}, meta:{revision} });
    receive(value(100,2000,'old-bottle')); receive(value(101,1000,'imported-bottle'));
    const acceptedImported = snapshot.state.name;
    receive(value(99,3000,'delayed-old-reply')); const afterDelayed = snapshot.state.name;
    receive(value(102,1000,'latest-action')); const afterSameClock = snapshot.state.name;
    globalThis.result = { acceptedImported, afterDelayed, afterSameClock, finalRevision:snapshot.meta.revision };
  `, context, { timeout:5_000 });
  console.log(JSON.stringify({ case:'renderer-revision-ordering', sha256:createHash('sha256').update(rendererSource).digest('hex'), ...context.result }));
  assert.equal(context.result.acceptedImported, 'imported-bottle'); assert.equal(context.result.afterDelayed, 'imported-bottle');
  assert.equal(context.result.afterSameClock, 'latest-action'); assert.equal(context.result.finalRevision, 102);
});

test('decoration spray coalesces main saves and release flushes the latest single-target bounded dose', async () => {
  const result = await sandbox(`
    const frame = {url:'mosslight://app/index.html?mode=widget'};
    const webContents = {mainFrame:frame,isLoading(){return false;},send(){}};
    widget = {webContents,isDestroyed(){return false;}};
    state.paused = true;
    state.decorations = [
      {id:'wet-wood',kind:'wood',x:.4,y:.5,scale:1},
      {id:'dry-stone',kind:'stone',x:.6,y:.5,scale:1}
    ];
    state.plants = [{id:'moss',kind:'sheet-moss',x:.5,y:.5,scale:1,growth:.4,health:.9,ageDays:1,wetness:0}];
    const initialPlants = JSON.stringify(state.plants);
    const inventory = () => state.ecology.moisture + state.ecology.waterReserve + state.ecology.humidity * .08;
    const initialWater = inventory(); const writes = [];
    store = {save(){saved++;writes.push(JSON.parse(JSON.stringify(state)));}};
    lastPreferenceKey = JSON.stringify(state.preferences);
    const event = {senderFrame:frame,sender:webContents}; installIpc();
    const action = handlers.get('terrarium:action');
    for(let i=0;i<11;i++){setClock(Date.now()+100,(i+1)*100);action(event,{type:'spray-decoration',decorationId:'wet-wood',amount:.025});}
    const during = saved, beforeFlush = writes.at(-1).ecology.moisture + writes.at(-1).ecology.waterReserve + writes.at(-1).ecology.humidity * .08;
    handlers.get('terrarium:finish-interaction')(event);
    const beforeInvalid = JSON.stringify(state); let rejected = 0;
    for(const amount of [.025001, NaN])try{action(event,{type:'spray-decoration',decorationId:'wet-wood',amount});}catch{rejected++;}
    return {during,flushed:saved,added:inventory()-initialWater,beforeFlushAdded:beforeFlush-initialWater,
      wetness:state.decorations[0].condition.wetness,decay:state.decorations[0].condition.decay,
      otherHasCondition:Object.hasOwn(state.decorations[1],'condition'),plantsUnchanged:initialPlants===JSON.stringify(state.plants),
      latestPersisted:JSON.stringify(writes.at(-1))===JSON.stringify(state),rejected,invalidUnchanged:beforeInvalid===JSON.stringify(state)};
  `);
  assert.equal(result.during, 1); assert.equal(result.flushed, 2);
  close(result.beforeFlushAdded, .25); close(result.added, .275);
  assert(result.wetness > .99 && result.wetness <= 1); assert.equal(result.decay, 0);
  assert.equal(result.otherHasCondition, false); assert.equal(result.plantsUnchanged, true);
  assert.equal(result.latestPersisted, true); assert.equal(result.rejected, 2); assert.equal(result.invalidUnchanged, true);
});
