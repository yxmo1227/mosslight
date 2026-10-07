// Offline, ephemeral renderer fixture using the real schema-2 action reducer.
// Actual pointer hold/move/release is tested. DOM cancellation/blur injection
// checks listeners, not native OS forwarding, focus or drag-region behavior.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '../..');
const candidates = [process.env.MOSSLIGHT_CHROMIUM, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
const executablePath = candidates.find(path => path && existsSync(path));
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
const evidence = await mkdtemp(join(tmpdir(), 'mosslight-test-renderer-'));
console.log(`Renderer evidence: ${evidence}`);
const [bundle, coreBundle, html, css] = await Promise.all([
  build({ entryPoints: [join(root, 'src/renderer/index.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'chrome130' }),
  build({ entryPoints: [join(root, 'src/core/simulation.ts')], bundle: true, write: false, format: 'esm', platform: 'node', target: 'node22' }),
  readFile(join(root, 'src/renderer/index.html'), 'utf8'), readFile(join(root, 'src/renderer/styles.css'), 'utf8')
]);
const { createInitialState, applyAction } = await import(`data:text/javascript;base64,${Buffer.from(coreBundle.outputFiles[0].text).toString('base64')}`);
let state = createInitialState(Date.now());
let clock = Date.now(), revision = 0, flushes = 0, hostDelay = 0, pendingHost = 0, maxPendingHost = 0;
const actions = [], passthrough = [], errors = [], tests = [];
const context = await browser.newContext({ viewport: { width: 1100, height: 780 }, deviceScaleFactor: 1 });
const snapshot = () => ({ state: structuredClone(state), meta: { revision: ++revision, version: '0.8.0-renderer-test', platform: 'test', storageStatus: 'In-memory test state (not a user save)', offlineHours: 0 } });
async function routeAssets(route) {
  const url = new URL(route.request().url());
  if (url.origin !== 'http://mosslight.test') return route.abort('blockedbyclient');
  const response = url.pathname === '/index.html' ? { body: html, contentType: 'text/html; charset=utf-8' } : url.pathname === '/styles.css' ? { body: css, contentType: 'text/css' } : url.pathname === '/app.js' ? { body: bundle.outputFiles[0].text, contentType: 'text/javascript' } : null;
  if (response) await route.fulfill(response); else await route.abort();
}
await context.route('**/*', routeAssets);
await context.exposeBinding('fixtureGet', () => snapshot());
await context.exposeBinding('fixtureInfo', () => ({ actions: actions.length, flushes, pendingHost }));
await context.exposeBinding('fixtureDispatch', async (_source, action) => {
  actions.push(structuredClone(action)); pendingHost++; maxPendingHost = Math.max(maxPendingHost, pendingHost);
  try {
    if (hostDelay) await new Promise(done => setTimeout(done, hostDelay));
    clock = Math.max(clock + 1, Date.now()); state = applyAction(state, action, clock); return snapshot();
  } finally { pendingHost--; }
});
await context.exposeBinding('fixtureFinish', () => { flushes++; return snapshot(); });
await context.exposeBinding('fixturePassthrough', (_source, ignore) => passthrough.push(ignore));
await context.addInitScript(() => {
  let subscriber;
  // Assert the actual drawing path, not only a renderer label. This fixture
  // deliberately denies WebGL so a hidden fallback or retained 3D path fails.
  window.fixtureWebGLRequests = [];
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
    if (/webgl|experimental-webgl/i.test(kind)) { window.fixtureWebGLRequests.push(kind); return null; }
    return getContext.call(this, kind, ...args);
  };
  window.fixturePixels = canvas => {
    const copy = document.createElement('canvas'); copy.width = canvas.width; copy.height = canvas.height;
    const ctx = copy.getContext('2d', { willReadFrequently: true }); ctx.drawImage(canvas, 0, 0);
    return ctx.getImageData(0, 0, copy.width, copy.height).data;
  };
  window.fixturePush = value => subscriber?.(value);
  window.terrarium = {
    getSnapshot: () => window.fixtureGet(),
    dispatch: async action => { const result = await window.fixtureDispatch(action); subscriber?.(result); return result; },
    finishInteraction: () => window.fixtureFinish(),
    subscribe: listener => { subscriber = listener; return () => { subscriber = null; }; },
    openWorkshop: () => { window.fixtureOpened = (window.fixtureOpened || 0) + 1; }, hideWidget: () => { window.fixtureHidden = true; },
    setWidgetPassthrough: ignore => { void window.fixturePassthrough(ignore); },
    moveWidget: (dx, dy) => { (window.fixtureMoves ??= []).push({ dx, dy }); },
    exportSave: async () => ({ ok: true, message: 'Test export; no user file is written' }), importSave: async () => ({ ok: false, message: 'Test import cancelled' })
  };
});
const pause = milliseconds => new Promise(done => setTimeout(done, milliseconds));
// Playwright's waitForFunction tests a returned Promise for truthiness before it
// resolves; an async false predicate can therefore finish without polling again.
// Await each sample explicitly so IPC latency cannot turn a gate into a no-op.
async function waitCondition(page, predicate, arg) {
  const deadline = Date.now() + 15000;
  do { if (await page.evaluate(predicate, arg)) return; await pause(30); } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for fixture condition: ${predicate.toString()}`);
}
async function settled(page) { await page.evaluate(() => new Promise(done => requestAnimationFrame(done))); await waitCondition(page, async () => (await window.fixtureInfo()).pendingHost === 0); await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))); }
async function canvasPoint(canvas, leaf = false) {
  return canvas.evaluate((canvas, leaf) => {
    const pixels = window.fixturePixels(canvas); const rect = canvas.getBoundingClientRect();
    if (!leaf) {
      const x = Math.floor(canvas.width / 2);
      for (let y = Math.floor(canvas.height * .52); y < canvas.height * .9; y += 2) if (pixels[(y * canvas.width + x) * 4 + 3] >= 25) return { x: rect.left + x * rect.width / canvas.width, y: rect.top + y * rect.height / canvas.height };
    }
    const isGreen = index => pixels[index + 3] > 220 && pixels[index + 1] > pixels[index] * 1.18 && pixels[index + 2] < pixels[index + 1] * .8;
    for (let y = 3; y < canvas.height - 3; y += 2) for (let x = 3; x < canvas.width - 3; x += 2) {
      const i = (y * canvas.width + x) * 4;
      if (!isGreen(i)) continue;
      let neighbors = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (isGreen(((y + dy) * canvas.width + x + dx) * 4)) neighbors++;
      if (neighbors >= 18) return { x: rect.left + x * rect.width / canvas.width, y: rect.top + y * rect.height / canvas.height };
    }
    return null;
  }, leaf);
}
async function waitFlush(page, before) { await waitCondition(page, async before => (await window.fixtureInfo()).flushes > before, before); await settled(page); }
async function hold(page, point, milliseconds = 410, delta = 0, captureName = null) {
  const before = flushes; await page.mouse.move(point.x, point.y); await page.mouse.down();
  if (delta) await page.mouse.move(point.x + delta, point.y + 2, { steps: 8 });
  await pause(milliseconds);
  if (captureName) await page.screenshot({ path: join(evidence, captureName) });
  await page.mouse.up(); await waitFlush(page, before);
  const count = actions.length; await pause(280); assert.equal(actions.length, count, 'Release must stop future doses');
}
try {
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://mosslight.test/index.html?mode=workshop'); await page.locator('#loading').waitFor({ state: 'hidden' }); await settled(page);
  const backClock = snapshot(); backClock.state.name = 'New revision survives clock rollback'; backClock.state.updatedAt -= 1000; backClock.state.createdAt = Math.min(backClock.state.createdAt, backClock.state.updatedAt);
  await page.evaluate(value => window.fixturePush(value), backClock); assert.equal(await page.locator('#bottle-name').inputValue(), backClock.state.name);
  await page.evaluate(value => window.fixturePush(value), { ...backClock, state: { ...backClock.state, name: 'An old revision cannot overwrite', updatedAt: Date.now() + 100000 }, meta: { ...backClock.meta, revision: backClock.meta.revision - 1 } });
  assert.equal(await page.locator('#bottle-name').inputValue(), backClock.state.name); tests.push('revision-order-clock-rollback');
  await page.locator('[data-command=starter]').click(); await waitCondition(page, async () => (await window.terrarium.getSnapshot()).state.plants.length === 4);
  assert.equal(state.schemaVersion, 2); assert.equal(state.decorations.length, 2); assert.equal(state.terrain.columns.length, 48); tests.push('schema2-starter');
  await page.locator('#bottle-name').fill('<img src=x onerror=alert(1)>');
  await page.evaluate(value => window.fixturePush(value), { ...snapshot(), state: { ...state, name: 'A snapshot must not overwrite the draft' } });
  assert.equal(await page.locator('#bottle-name').inputValue(), '<img src=x onerror=alert(1)>');
  await page.locator('#bottle-name').press('Enter'); await waitCondition(page, async () => (await window.terrarium.getSnapshot()).state.name.includes('<img')); assert.equal(await page.locator('img').count(), 0);
  await page.locator('#bottle-name').fill('A forest after rain'); await page.locator('#bottle-name').press('Enter'); await settled(page); tests.push('draft-preservation-name-text-only');
  assert.equal(await page.locator('#panel-build input[type=range]:not([data-glass-ring]):not([data-glass-height])').count(), 0); assert.equal(await page.locator('.material-palette [data-material]').count(), 7);
  const canvas = page.locator('#workshop-canvas');
  assert(await canvas.evaluate(canvas => canvas.dataset.renderer === 'canvas2d' && Number(canvas.dataset.triangles) === 0), 'Workshop must render using the Canvas 2D backend without triangles');
  assert.deepEqual(await page.evaluate(() => window.fixtureWebGLRequests), [], 'The app must not request WebGL');
  const paper = await page.locator('.observatory').evaluate(e => ({ stage: getComputedStyle(e.querySelector('.stage')).backgroundColor, observatory: getComputedStyle(e).backgroundImage }));
  assert.equal(paper.stage, 'rgba(0, 0, 0, 0)'); assert(paper.observatory.includes('250, 249, 242'), JSON.stringify(paper)); tests.push('warm-paper-studio');
  for (const shape of ['round', 'square', 'cylinder', 'open-cylinder', 'open-cube', 'glass-box', 'cat']) {
    await page.locator(`[data-shape="${shape}"]`).click(); await waitCondition(page, async shape => (await window.terrarium.getSnapshot()).state.bottle === shape, shape); await settled(page);
    assert(await canvasPoint(canvas), `${shape}: visible bottle must exist`); await page.screenshot({ path: join(evidence, `shape-${shape}.png`) });
    if (shape.startsWith('open-')) { await page.locator('[data-tab=care]').click(); assert(await page.locator('#lid-switch').isDisabled()); await page.locator('[data-tab=build]').click(); }
  }
  tests.push('seven-canvas2d-shapes-fit-open-no-lid'); console.log('Renderer: seven-shape Canvas 2D drawing checks complete');
  await page.locator('[data-shape=glass-box]').click(); await settled(page); await page.locator('#glass-form-controls').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-sculpt-ring]').count(), 6);
  const middle = page.locator('[data-sculpt-ring=middle][data-sculpt-side=right]'); await middle.waitFor({ state: 'visible' });
  const handle = await middle.boundingBox(); const shapeBefore = state.glassForm?.sides?.right.middle.width ?? state.glassForm?.middle ?? 1, heightBefore = state.glassForm?.sides?.right.middle.height ?? 285 / 510;
  const leftBefore = structuredClone(state.glassForm?.sides?.left);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2 + 22, handle.y + handle.height / 2 - 12, { steps: 6 });
  assert.equal(state.glassForm?.sides?.right.middle.width ?? state.glassForm?.middle ?? 1, shapeBefore, 'Shape dragging previews locally without writing on every movement');
  await page.mouse.up(); await settled(page); assert(state.glassForm.sides.right.middle.width > shapeBefore, 'Direct contour handle drag must commit the wider ring'); assert(state.glassForm.sides.right.middle.height > heightBefore, 'Vertical handle movement must raise the actual control');
  if (leftBefore) assert.deepEqual(state.glassForm.sides.left, leftBefore, 'Independent right-side editing must preserve the left wall');
  const committedShape = structuredClone(state.glassForm); const commitsBeforeCancel = actions.filter(action => action.type === 'glass-form').length;
  const cancelHandle = await middle.boundingBox(); await page.mouse.move(cancelHandle.x + 15, cancelHandle.y + 15); await page.mouse.down(); await page.mouse.move(cancelHandle.x - 20, cancelHandle.y + 15, { steps: 4 });
  await middle.dispatchEvent('pointercancel', { pointerId: 1 }); await page.mouse.up(); await settled(page);
  assert.deepEqual(state.glassForm, committedShape); assert.equal(actions.filter(action => action.type === 'glass-form').length, commitsBeforeCancel, 'Cancelled shape previews must never commit');
  await page.locator('#glass-facets').focus();
  const escapeHandle = await middle.boundingBox(); await page.mouse.move(escapeHandle.x + 15, escapeHandle.y + 15); await page.mouse.down(); await page.mouse.move(escapeHandle.x - 20, escapeHandle.y + 15, { steps: 4 });
  await page.keyboard.press('Escape'); await page.mouse.up(); await settled(page);
  assert.deepEqual(state.glassForm, committedShape); assert.equal(actions.filter(action => action.type === 'glass-form').length, commitsBeforeCancel, 'Escape from a mouse drag must cancel regardless of prior focus');
  hostDelay = 180;
  await page.locator('#glass-lower').evaluate(input => { input.value = '.66'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('#glass-facets').selectOption('7');
  await waitCondition(page, async () => (await window.terrarium.getSnapshot()).state.glassForm?.facets === 7); hostDelay = 0;
  await settled(page); assert.equal(state.glassForm.sides.right.lower.width, .66, 'A queued facet change must preserve the just-edited width'); assert.equal(state.glassForm.facets, 7);
  await middle.focus(); await middle.press('Home'); await settled(page); assert.deepEqual(state.glassForm.sides.right.middle, { width: .4, height: .4 });
  await middle.press('End'); await settled(page); assert.deepEqual(state.glassForm.sides.right.middle, { width: 1.35, height: .7 });
  await page.locator('#glass-linked').check(); await middle.press('ArrowLeft'); await settled(page); assert.deepEqual(state.glassForm.sides.right.middle, state.glassForm.sides.left.middle, 'Linked edits must update both controls'); await page.locator('#glass-linked').uncheck();
  const leftUpper = page.locator('[data-sculpt-ring=upper][data-sculpt-side=left]'), rightUpperBefore = structuredClone(state.glassForm.sides.right.upper);
  await leftUpper.press('ArrowUp'); await settled(page); assert(state.glassForm.sides.left.upper.height > rightUpperBefore.height); assert.deepEqual(state.glassForm.sides.right.upper, rightUpperBefore);
  await page.locator('#glass-facets').selectOption('13'); await settled(page); assert.equal(state.glassForm.facets, 13); tests.push('six-independent-xy-handles-linked-mode-odd-seven-thirteen');
  await page.screenshot({ path: join(evidence, 'shape-direct-sculpt.png') }); tests.push('shape-direct-drag-preview-commit-cancel-sliders-keyboard');
  await page.locator('[data-tab=care]').click(); assert(await page.locator('#glass-sculpt-handles').isHidden()); await page.locator('[data-tab=build]').click();
  await page.locator('[data-shape=round]').click(); await settled(page); let point = await canvasPoint(canvas); assert(point);
  const oldColumns = structuredClone(state.terrain.columns);
  await page.locator('[data-material=coir]').click(); await hold(page, { x: point.x - 60, y: point.y }, 810, 19, 'workshop-pour-hold.png');
  assert.notDeepEqual(state.terrain.columns, oldColumns); assert(state.terrain.columns.some(column => column.includes('coir'))); assert(new Set(state.terrain.columns.map(column => column.length)).size > 1);
  await page.locator('[data-material=bark]').click(); await hold(page, { x: point.x - 42, y: point.y }, 410); assert(state.terrain.columns.some(column => column.includes('bark'))); tests.push('material-palette-pointer-hold-move-pour'); console.log('Renderer: pointer pour checks complete');
  assert(actions.filter(action => action.type === 'pour').every(action => action.amount === 16), 'Held pouring must use the v0.6 faster dose');
  const countBeforeScoop = state.terrain.columns.reduce((sum, column) => sum + column.length, 0);
  await page.locator('#scoop-tool').click(); await page.locator('#scoop-brush-controls').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-scoop-radius="4"]').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-scoop-radius="7"]').click(); await hold(page, { x: point.x - 42, y: point.y }, 410); assert(state.terrain.columns.reduce((sum, column) => sum + column.length, 0) < countBeforeScoop);
  assert(actions.filter(action => action.type === 'scoop').every(action => action.amount === 24 && action.radius === 7));
  for (const radius of [2, 4]) { await page.locator(`[data-scoop-radius="${radius}"]`).click(); assert.equal(await page.locator(`[data-scoop-radius="${radius}"]`).getAttribute('aria-pressed'), 'true'); }
  tests.push('pointer-scoop-valley-brush-radius');
  await page.locator('#workshop-tool-hud [data-exit-tool]').click(); await page.locator('[data-tab=care]').click(); await settled(page);
  const leaf = await canvasPoint(canvas, true); assert(leaf); await page.mouse.click(leaf.x, leaf.y); assert(await page.locator('#selection-bar').isVisible(), 'The target pixel must hit an actual selectable object');
  const targetName = await page.locator('#selection-name').textContent();
  const targetKinds = { 'Cushion moss': 'cushion-moss', 'Sheet moss': 'sheet-moss', 'Miniature fern': 'fern', 'Fittonia': 'fittonia' };
  assert(targetKinds[targetName], 'Target must be a plant, not a material highlight'); const targetId = state.plants.find(plant => plant.kind === targetKinds[targetName]).id;
  await page.locator('#water-button').click(); const beforeGrowth = new Map(state.plants.map(plant => [plant.id, plant.growth])); const beforeSpray = actions.length;
  await hold(page, leaf, 660, 0, 'workshop-spray-hold.png'); const sprays = actions.slice(beforeSpray).filter(action => action.type === 'spray'); assert(sprays.length >= 2); assert(sprays.some(action => action.plantId));
  assert(state.plants.some(plant => plant.wetness > 0 && plant.growth > beforeGrowth.get(plant.id))); tests.push('targeted-spray-wetness-growth-release'); console.log('Renderer: targeted spray checks complete');
  // Separate the cone-targeting case from wetness saturation in the preceding
  // hold. A GPU screenshot can extend the actual held duration on a slow host.
  state = { ...state, plants: state.plants.map(plant => plant.id === targetId ? { ...plant, wetness: .2 } : plant) };
  await page.evaluate(value => window.fixturePush(value), snapshot()); await settled(page);
  assert(await page.locator('#workshop-tool-hud').isHidden(), 'Releasing the mister must put it down automatically'); const aboveLeaf = { x: leaf.x, y: leaf.y - 35 }; await page.mouse.click(aboveLeaf.x, aboveLeaf.y);
  assert(await page.locator('#selection-bar').isHidden(), 'Above-leaf source must not directly hit an object'); await page.locator('#water-button').click();
  const coneBefore = actions.length; const coneWetness = state.plants.find(plant => plant.id === targetId).wetness;
  await hold(page, aboveLeaf, 410, 0, 'workshop-spray-above-leaf.png');
  assert(actions.slice(coneBefore).some(action => action.type === 'spray' && action.plantId === targetId), 'Downward visible spray cone must target the leaf below the pointer');
  assert(state.plants.find(plant => plant.id === targetId).wetness > coneWetness); tests.push('spray-cone-above-leaf');
  const beforeBlankPlants = state.plants.map(({ id, wetness, growth }) => ({ id, wetness, growth })); const blankBefore = actions.length;
  await page.locator('#water-button').click();
  await hold(page, { x: point.x, y: leaf.y - 125 }, 290);
  const blankSprays = actions.slice(blankBefore).filter(action => action.type === 'spray'); assert(blankSprays.length > 0); assert(blankSprays.every(action => action.plantId === null), 'Blank spray cone must not target a distant plant');
  assert.deepEqual(state.plants.map(({ id, wetness, growth }) => ({ id, wetness, growth })), beforeBlankPlants);
  await page.locator('#water-button').click(); const canvasBounds = await canvas.boundingBox(); const outsideBefore = actions.length; await page.mouse.move(canvasBounds.x + 2, canvasBounds.y + canvasBounds.height * .4); await page.mouse.down(); await pause(290); await page.mouse.up(); await pause(280);
  assert.equal(actions.length, outsideBefore, 'Bottle-external hold must not send a dose'); assert.deepEqual(state.plants.map(({ id, wetness, growth }) => ({ id, wetness, growth })), beforeBlankPlants); tests.push('spray-blank-and-outside-no-plant-change');
  await page.locator('#water-button').click(); hostDelay = 350; const slowBefore = actions.length; await hold(page, leaf, 790); hostDelay = 0; assert(actions.length - slowBefore <= 3); assert.equal(maxPendingHost, 1); tests.push('slow-host-one-pending-no-backlog');
  for (const stopEvent of ['pointercancel', 'lostpointercapture', 'blur']) {
    if (await page.locator('#workshop-tool-hud').isHidden()) await page.locator('#water-button').click();
    const before = flushes; await page.mouse.move(leaf.x, leaf.y); await page.mouse.down(); await pause(155);
    await canvas.evaluate((canvas, stopEvent) => { if (stopEvent === 'blur') window.dispatchEvent(new Event('blur')); else canvas.dispatchEvent(new PointerEvent(stopEvent, { bubbles: true, pointerId: 1 })); }, stopEvent);
    await waitFlush(page, before); const stopped = actions.length; await pause(290); assert.equal(actions.length, stopped, `${stopEvent} must stop doses`); await page.mouse.up(); tests.push(`pointer-hold-dom-${stopEvent}-stop`);
  }
  await page.locator('#water-button').click(); await page.keyboard.press('Escape'); assert(await page.locator('#workshop-tool-hud').isHidden()); tests.push('escape-tool-exit');
  await page.locator('#light').evaluate(input => { input.value = '72'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  await waitCondition(page, async () => (await window.terrarium.getSnapshot()).state.environment.light === .72); await page.locator('#lid-switch').click();
  await page.locator('[data-tab=time]').click(); await page.locator('[data-speed="5"]').click(); await page.locator('#vacation-switch').click(); await waitCondition(page, async () => (await window.terrarium.getSnapshot()).state.vacation);
  assert.equal(state.paused, false); assert.equal(state.speed, 5); tests.push('climate-speed-vacation-retained');
  await page.locator('[data-tab=build]').click(); await canvas.focus(); await canvas.press('Enter'); await page.locator('#selection-bar').waitFor({ state: 'visible' });
  const firstX = state.plants[0].x; await canvas.press('ArrowRight'); await waitCondition(page, async x => (await window.terrarium.getSnapshot()).state.plants[0].x > x, firstX); await canvas.press('Escape'); tests.push('keyboard-placement-retained');
  await page.locator('[data-tab=settings]').click(); await page.locator('#panel-settings [data-command=reset]').click(); await page.locator('#confirm-cancel').click(); assert(state.plants.length > 0); tests.push('reset-cancel-retained');
  // The following rich fixture is disposable browser state, never a normal save.
  const retainedForest = structuredClone(state);
  await page.locator('[data-tab=build]').click();
  state = { ...state, bottle: 'open-cylinder', closed: false, plants: [], decorations: [], pond: { depths: Array(48).fill(0) }, terrain: { columns: Array.from({ length: 48 }, (_, i) => Array(Math.round(12 + Math.abs(i - 23.5) * .55)).fill('soil')) } };
  await page.evaluate(value => window.fixturePush(value), snapshot()); await settled(page); await pause(250);
  const basinPoint = await canvasPoint(canvas); assert(basinPoint); const dryEcology = structuredClone(state.ecology);
  await page.locator('[data-material=water]').click(); const beforePondActions = actions.length;
  await hold(page, basinPoint, 560, 0, 'workshop-pond-fill.png');
  const filledWater = state.pond.depths.reduce((sum, depth) => sum + depth, 0); assert(filledWater > 0); assert.deepEqual(state.ecology, dryEcology);
  assert(actions.slice(beforePondActions).every(action => action.type === 'pour-water' && action.amount === 16));
  assert(state.pond.depths.every((depth, i) => depth + state.terrain.columns[i].length <= 112));
  await page.locator('#drain-tool').click(); await hold(page, basinPoint, 280);
  assert(state.pond.depths.reduce((sum, depth) => sum + depth, 0) < filledWater); assert.deepEqual(state.ecology, dryEcology); tests.push('seventh-material-pond-fill-drain-separated-from-mist');
  await page.locator('#workshop-tool-hud [data-exit-tool]').click();
  await canvas.evaluate(canvas => { window.fixtureSupportPixels = window.fixturePixels(canvas).slice(); });
  const revealCatalog = async selector => {
    const group = await page.locator(selector).evaluate(button => button.closest('.catalog-group-choices')?.id);
    if (group && await page.locator(`#${group}`).isHidden()) await page.locator(`#${group}-toggle`).click();
  };
  const catalogPlace = async (selector, point) => {
    const before = state.plants.length + state.decorations.length;
    await revealCatalog(selector);
    await page.locator(selector).click(); assert.equal(state.plants.length + state.decorations.length, before, 'Catalog click only arms placement');
    const rect = await canvas.boundingBox(); await page.mouse.click(point?.x ?? rect.x + rect.width * .5, point?.y ?? rect.y + rect.height * .65);
  };
  await page.locator('#stump-variants-toggle').click();
  await catalogPlace('[data-decoration=stump][data-variant=upright]'); await waitCondition(page, async () => (await window.terrarium.getSnapshot()).state.decorations.some(item => item.kind === 'stump')); await settled(page); await pause(250);
  const stump = state.decorations.find(item => item.kind === 'stump');
  const addedTop = async () => canvas.evaluate(canvas => {
    const pixels = window.fixturePixels(canvas), before = window.fixtureSupportPixels, rect = canvas.getBoundingClientRect(); let low = canvas.width, high = 0;
    const changed = (x, y) => { const i = (y * canvas.width + x) * 4; return pixels[i + 3] > 220 && Math.abs(pixels[i] - before[i]) + Math.abs(pixels[i + 1] - before[i + 1]) + Math.abs(pixels[i + 2] - before[i + 2]) > 45; };
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (changed(x, y)) { low = Math.min(low, x); high = Math.max(high, x); }
    // A fork can have a genuine transparent gap at its bounding-box midpoint.
    // Search occupied columns closest to that midpoint, retaining the same
    // opacity, color-difference and four-pixel interior requirements.
    const middle = (low + high) / 2;
    const columns = Array.from({ length: Math.max(0, high - low + 1) }, (_, i) => low + i).sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle));
    for (const x of columns) for (let y = 0; y < canvas.height - 4; y++) if (changed(x, y) && changed(x, y + 1) && changed(x, y + 2) && changed(x, y + 3)) return { x: rect.left + x * rect.width / canvas.width, y: rect.top + (y + 3) * rect.height / canvas.height };
    return null;
  });
  const stumpTop = await addedTop(); assert(stumpTop, 'New stump must have a visibly opaque support surface');
  const catalogDrop = async (selector, target) => { await revealCatalog(selector); const rect = await canvas.boundingBox(); await page.locator(selector).dragTo(canvas, { targetPosition: { x: target.x - rect.x, y: target.y - rect.y } }); await settled(page); await pause(250); };
  await canvas.evaluate(canvas => { window.fixtureSupportPixels = window.fixturePixels(canvas).slice(); });
  await page.locator('#wood-presets-toggle').click();
  await catalogDrop('[data-wood-preset="fork"]', stumpTop);
  const stackedWood = state.decorations.find(item => item.kind === 'wood'); assert(stackedWood); assert.equal(stackedWood.support?.parentId, stump.id, 'Catalog wood dropped on the stump must attach to its actual visible top');
  assert.equal(stackedWood.wood.branches.length, 1, 'The fork palette tile must commit its actual authored branch form');
  await page.screenshot({ path: join(evidence, 'workshop-fork-on-stump.png') });
  const woodTop = await addedTop(); assert(woodTop); await catalogDrop('[data-plant=cushion-moss]', woodTop);
  const attachedMoss = state.plants.find(item => item.kind === 'cushion-moss'); assert(attachedMoss); assert.equal(attachedMoss.support?.parentId, stackedWood.id, 'Moss dropped on wood must retain a local support attachment');
  const mossPixels = async () => canvas.evaluate(canvas => {
    const pixels = window.fixturePixels(canvas); let total = 0, weightedX = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) { const i = (y * canvas.width + x) * 4; if (pixels[i + 3] > 220 && pixels[i + 1] > pixels[i] * 1.18 && pixels[i + 2] < pixels[i + 1] * .8) { total++; weightedX += x; } }
    return { total, x: weightedX / total };
  });
  const mossBeforeKey = await mossPixels(); assert(mossBeforeKey.total > 40, 'Attached moss must have visible opaque foliage');
  const localBeforeKey = attachedMoss.support.x, groundBeforeKey = attachedMoss.x;
  await canvas.focus(); await canvas.press('ArrowRight');
  await waitCondition(page, async ({ id, before }) => (await window.terrarium.getSnapshot()).state.plants.find(item => item.id === id).support.x > before, { id: attachedMoss.id, before: localBeforeKey });
  await settled(page); await pause(250);
  const movedMoss = state.plants.find(item => item.id === attachedMoss.id), mossAfterKey = await mossPixels();
  assert.equal(movedMoss.support.parentId, stackedWood.id); assert(Math.abs(movedMoss.support.x - localBeforeKey - .015) < 1e-10); assert(Math.abs(movedMoss.x - groundBeforeKey - .015) < 1e-10);
  assert(mossAfterKey.x > mossBeforeKey.x + .1, `Attached foliage must visibly move right, not only update its ground fallback: ${JSON.stringify({ before: mossBeforeKey, after: mossAfterKey })}`);
  tests.push('attached-moss-arrow-right-updates-local-root-and-visible-position');
  for (const kind of ['amber-mushroom', 'ivory-mushroom']) { await catalogPlace(`[data-plant="${kind}"]`); await waitCondition(page, async kind => (await window.terrarium.getSnapshot()).state.plants.some(item => item.kind === kind), kind); }
  await settled(page); await pause(250); await page.screenshot({ path: join(evidence, 'workshop-stump-wood-moss-mushrooms-pond.png') });
  tests.push('catalog-stump-wood-stack-moss-attachment-two-mushrooms');
  const paletteHash = async selector => page.locator(selector).evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let value = 2166136261;
    for (const byte of pixels) value = Math.imul(value ^ byte, 16777619); return value >>> 0;
  });
  const woodHashes = [];
  for (const preset of ['single', 'fork', 'double-fork', 'branched']) woodHashes.push(await paletteHash(`canvas[data-wood-preset-preview="${preset}"]`));
  assert.equal(new Set(woodHashes).size, 4, 'All four wood tiles must show different authored silhouettes');
  await catalogPlace('[data-wood-preset="single"]'); await settled(page); await pause(250);
  const posedWood = state.decorations.at(-1); assert.equal(posedWood.kind, 'wood'); const authoredForm = structuredClone(posedWood.wood);
  await canvas.evaluate(canvas => { window.fixturePosePixels = window.fixturePixels(canvas).slice(); });
  await page.locator('#wood-rotate-right').click(); await waitCondition(page, async id => (await window.terrarium.getSnapshot()).state.decorations.find(item => item.id === id).pose?.angle === 15, posedWood.id);
  await page.locator('#wood-flip').click(); await waitCondition(page, async id => (await window.terrarium.getSnapshot()).state.decorations.find(item => item.id === id).pose?.flipX === true, posedWood.id);
  await settled(page); await pause(250); assert.deepEqual(state.decorations.find(item => item.id === posedWood.id).wood, authoredForm);
  const posePixels = await canvas.evaluate(canvas => { const after = window.fixturePixels(canvas), before = window.fixturePosePixels; let changed = 0; for (let i = 0; i < after.length; i += 4) if (Math.abs(after[i] - before[i]) + Math.abs(after[i+1] - before[i+1]) + Math.abs(after[i+2] - before[i+2]) > 30) changed++; return changed; });
  assert(posePixels > 100, 'Rotation/flip must visibly change full wood pixels, not just editor labels');
  assert.equal(await page.locator('#wood-flip').getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: join(evidence, 'workshop-v08-pose-controls.png') }); tests.push('v08-four-distinct-wood-tiles-full-rotation-flip-preserves-form');
  if (await page.locator('#stone-variants-toggle').getAttribute('aria-expanded') !== 'true') await page.locator('#stone-variants-toggle').click();
  const stoneHashes = [];
  for (const variant of ['boulder', 'flat', 'spire', 'pebbles']) {
    stoneHashes.push(await paletteHash(`canvas[data-object-preview=stone][data-variant="${variant}"]`));
    const count = state.decorations.length; await catalogPlace(`[data-decoration=stone][data-variant="${variant}"]`); await waitCondition(page, async count => (await window.terrarium.getSnapshot()).state.decorations.length > count, count);
    assert.equal(state.decorations.at(-1).variant, variant);
  }
  assert.equal(new Set(stoneHashes).size, 4);
  await page.locator('#stone-variants').scrollIntoViewIfNeeded(); await page.screenshot({ path: join(evidence, 'workshop-v08-stone-palette.png') });
  if (await page.locator('#stump-variants-toggle').getAttribute('aria-expanded') !== 'true') await page.locator('#stump-variants-toggle').click();
  assert.notEqual(await paletteHash('canvas[data-object-preview=stump][data-variant=upright]'), await paletteHash('canvas[data-object-preview=stump][data-variant=fallen]'));
  await catalogPlace('[data-decoration=stump][data-variant=fallen]'); await waitCondition(page, async () => (await window.terrarium.getSnapshot()).state.decorations.some(item => item.variant === 'fallen'));
  for (const kind of ['pavilion', 'statue', 'traveler', 'cottage', 'lantern', 'steps']) {
    const count = state.decorations.length; await catalogPlace(`[data-decoration="${kind}"]`); await waitCondition(page, async count => (await window.terrarium.getSnapshot()).state.decorations.length > count, count); assert.equal(state.decorations.at(-1).kind, kind);
  }
  await settled(page); await pause(250); await page.screenshot({ path: join(evidence, 'workshop-v08-props-palette.png') });
  assert.equal(await page.locator('[data-decoration="path"]').count(), 0, 'Crossing path is retired from new placement');
  state = applyAction(state, { type: 'add-decoration', kind: 'path', x: .5, y: .5 }, ++clock);
  await page.evaluate(value => window.fixturePush(value), snapshot()); await settled(page);
  assert.equal(state.decorations.at(-1).kind, 'path', 'Legacy path remains valid and renderable');
  tests.push('four-stones-two-trunks-six-visible-legacy-decorations-and-retired-path');
  const resetPreferences = structuredClone(state.preferences);
  await page.locator('[data-tab=settings]').click(); await page.locator('#panel-settings [data-command=reset]').click();
  await page.locator('#confirm-accept').click(); await waitCondition(page, async () => (await window.terrarium.getSnapshot()).state.decorations.length === 0);
  assert.equal(state.plants.length, 0); assert.equal(state.terrain.columns.length, 48); assert(state.terrain.columns.every(column => column.length === 0)); assert(state.pond === undefined || state.pond.depths.length === 48 && state.pond.depths.every(depth => depth === 0)); assert.deepEqual(state.preferences, resetPreferences);
  tests.push('v08-confirmed-reset-empty-terrain-plants-props-water-preferences-retained');
  state = retainedForest; await page.evaluate(value => window.fixturePush(value), snapshot()); await settled(page); await pause(250);
  await page.locator('[data-tab=build]').click(); await settled(page); await pause(350); await page.screenshot({ path: join(evidence, 'workshop.png') }); console.log('Renderer: workshop controls complete');
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  const softwareCopy = await page.evaluate(() => [...document.querySelectorAll('body, [aria-label], [title]')].map(node => `${node === document.body ? node.textContent : ''} ${node.getAttribute('aria-label') ?? ''} ${node.getAttribute('title') ?? ''}`).join('\n'));
  assert(!/\p{Script=Han}/u.test(softwareCopy), 'All interface copy and accessible labels must be English'); tests.push('english-interface-copy-and-accessibility');
  const widget = await context.newPage(); widget.on('pageerror', error => errors.push(error.message)); await widget.setViewportSize({ width: 320, height: 400 });
  await widget.goto('http://mosslight.test/index.html?mode=widget'); await widget.locator('#loading').waitFor({ state: 'hidden' }); await settled(widget); const widgetCanvas = widget.locator('#widget-canvas'); point = await canvasPoint(widgetCanvas); assert(point);
  await widget.mouse.move(1, 1); await widget.waitForFunction(() => !document.getElementById('widget').classList.contains('hit'));
  await widget.evaluate(point => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1, bubbles: true })); document.dispatchEvent(new MouseEvent('mousemove', { clientX: point.x, clientY: point.y, bubbles: true })); }, point);
  assert(await widget.locator('#widget').evaluate(element => element.classList.contains('hit'))); tests.push('widget-geometry-rapid-final-move');
  assert.equal(await widget.locator('.widget-handle, #widget-management, #widget-tool-hud').count(), 0, 'The old three-dot handle, management menu and put-down HUD are removed');
  const populated = structuredClone(state);
  const beforeEmptyBuild = Number(await widgetCanvas.getAttribute('data-terrain-builds'));
  state = { ...state, plants: [], decorations: [], terrain: { columns: state.terrain.columns.map(() => []) } };
  await widget.evaluate(value => window.fixturePush(value), snapshot()); await settled(widget);
  await widget.waitForFunction(before => Number(document.querySelector('#widget-canvas').dataset.terrainBuilds) > before, beforeEmptyBuild);
  const clearPoint = await widgetCanvas.evaluate(canvas => { const r = canvas.getBoundingClientRect(); return { x: r.left + r.width * .5, y: r.top + r.height * .42 }; });
  await widget.mouse.move(clearPoint.x, clearPoint.y); assert(await widget.locator('#widget').evaluate(node => node.classList.contains('hit')), 'Transparent glass must intercept mouse input even without terrain or plants');
  await widget.mouse.click(clearPoint.x, clearPoint.y); await widget.locator('#widget-quick').waitFor({ state: 'visible' });
  assert.equal(await widget.evaluate(() => window.fixtureOpened || 0), 0);
  await widget.mouse.click(clearPoint.x, clearPoint.y, { button: 'right' }); assert.equal(await widget.evaluate(() => window.fixtureOpened), 1, 'Right-click on empty glass opens the studio directly');
  assert(await widget.locator('#widget-quick').isHidden()); tests.push('empty-transparent-glass-left-care-right-direct-studio');
  const beforeRestoredBuild = Number(await widgetCanvas.getAttribute('data-terrain-builds'));
  state = { ...populated, plants: populated.plants.map(plant => ({ ...plant, wetness: 0 })) };
  await widget.evaluate(value => window.fixturePush(value), snapshot()); await settled(widget);
  await widget.waitForFunction(before => Number(document.querySelector('#widget-canvas').dataset.terrainBuilds) > before, beforeRestoredBuild);
  point = await canvasPoint(widgetCanvas); assert(point);
  await widget.mouse.click(point.x, point.y); await widget.locator('#widget-quick').waitFor({ state: 'visible' }); assert.equal(await widget.evaluate(() => window.fixtureOpened || 0), 1);
  const quickStyles = await widget.locator('#widget-quick button').evaluateAll(buttons => buttons.map(button => { const style = getComputedStyle(button); return { text: button.textContent.trim(), label: button.getAttribute('aria-label'), background: style.backgroundColor, image: style.backgroundImage, border: style.borderWidth, shadow: style.boxShadow }; }));
  assert(quickStyles.every(style => style.text === '' && style.label && style.background === 'rgba(0, 0, 0, 0)' && style.image === 'none' && style.border === '0px' && style.shadow === 'none'), 'Quick care is transparent artwork only, with accessible names');
  tests.push('quick-care-transparent-icon-only-accessible');
  // Identify the real leaf before the deliberate yellow sunlight overlay changes
  // its color. Keep the strict green/opaque neighbourhood gate unchanged; the
  // later targeted dose separately proves this coordinate still hits a plant.
  const widgetLeaf = await canvasPoint(widgetCanvas, true); assert(widgetLeaf);
  await widgetCanvas.evaluate(canvas => { window.fixtureSunPixels = window.fixturePixels(canvas).slice(); });
  await widget.screenshot({ path: join(evidence, 'widget-before-sun.png'), omitBackground: true });
  await widget.locator('[data-widget-control=sun]').click(); await waitCondition(widget, async () => (await window.terrarium.getSnapshot()).state.care.sunlight > .9); await settled(widget); tests.push('widget-left-click-sun-not-editor');
  // The beam fades in over 240 ms; two animation frames only prove dispatch,
  // not a visible presentation. Keep the pixel threshold and wait for the effect.
  await widget.waitForFunction(() => {
    const canvas = document.querySelector('#widget-canvas'), after = window.fixturePixels(canvas), before = window.fixtureSunPixels;
    let changed = 0;
    for (let i = 0; i < after.length; i += 4) if (Math.abs(after[i] - before[i]) + Math.abs(after[i + 1] - before[i + 1]) + Math.abs(after[i + 2] - before[i + 2]) + Math.abs(after[i + 3] - before[i + 3]) > 8) changed++;
    return changed > 100;
  }, undefined, { timeout: 1500 });
  const sunChangedPixels = await widgetCanvas.evaluate(canvas => { const after = window.fixturePixels(canvas); const before = window.fixtureSunPixels; let changed = 0; for (let i = 0; i < after.length; i += 4) if (Math.abs(after[i] - before[i]) + Math.abs(after[i + 1] - before[i + 1]) + Math.abs(after[i + 2] - before[i + 2]) + Math.abs(after[i + 3] - before[i + 3]) > 8) changed++; delete window.fixtureSunPixels; return changed; });
  assert(sunChangedPixels > 100, 'Temporary sunlight must remain visibly rendered after lowering warmth'); await widget.screenshot({ path: join(evidence, 'widget-after-sun.png'), omitBackground: true }); tests.push('widget-sunlight-visible-before-after');
  const sprayShortcut = widget.locator('[data-widget-control=spray]');
  const openQuick = async () => { if (await widget.locator('#widget-quick').isHidden()) { await widget.mouse.click(clearPoint.x, clearPoint.y); await widget.locator('#widget-quick').waitFor({ state: 'visible' }); } };
  const armSpray = async () => { await openQuick(); const before = actions.length; await sprayShortcut.click(); await pause(170); assert.equal(actions.length, before, 'Picking up the mister must not dispatch a spray dose'); assert.equal(await sprayShortcut.getAttribute('aria-pressed'), 'true'); };
  const pressSpray = async () => { await armSpray(); await widget.mouse.move(widgetLeaf.x, widgetLeaf.y); await widget.mouse.down(); };
  const beforeIconSpray = actions.length, iconFlush = flushes; await pressSpray(); await pause(290);
  assert(actions.slice(beforeIconSpray).some(action => action.type === 'spray' && action.plantId), 'After arming, holding over a real plant must dispatch targeted mist');
  assert.equal(await sprayShortcut.getAttribute('aria-pressed'), 'true');
  await widget.mouse.move(widgetLeaf.x + 4, widgetLeaf.y + 2, { steps: 4 }); await pause(230);
  await widget.screenshot({ path: join(evidence, 'widget-spray-hold.png'), omitBackground: true }); await widget.mouse.up(); await waitFlush(widget, iconFlush);
  assert(await widget.locator('#cursor-tool').isHidden()); assert(await widget.locator('#widget-quick').isHidden()); assert.equal(await sprayShortcut.getAttribute('aria-pressed'), 'false');
  const afterIconSpray = actions.length; await pause(280); assert.equal(actions.length, afterIconSpray); assert(state.plants.some(plant => plant.wetness > 0));
  assert(actions.slice(beforeIconSpray).filter(action => action.type === 'spray').every(action => action.amount === .012)); tests.push('widget-click-icon-arms-without-dose-then-bottle-hold-release-disarms');
  const outsideBeforeFlush = flushes; await pressSpray(); await pause(155); await widget.mouse.move(1, 1);
  assert(await widget.locator('#widget').evaluate(element => element.classList.contains('hit')), 'Held pointer capture must remain interactive outside the bottle');
  await widget.mouse.up(); await waitFlush(widget, outsideBeforeFlush);
  assert(await widget.locator('#cursor-tool').isHidden()); assert(await widget.locator('#widget').evaluate(element => !element.classList.contains('hit')), 'Release at transparent pixels must restore passthrough without another mousemove');
  assert.equal(passthrough.at(-1), true); const outsideStopped = actions.length; await pause(280); assert.equal(actions.length, outsideStopped); tests.push('widget-release-outside-ends-tool-immediate-passthrough');
  for (const cancellation of ['pointercancel', 'lostpointercapture', 'blur']) {
    const beforeFlush = flushes; await pressSpray(); await pause(170);
    if (cancellation === 'blur') await widget.evaluate(() => window.dispatchEvent(new Event('blur')));
    else await widgetCanvas.dispatchEvent(cancellation, { pointerId: 1 });
    await waitFlush(widget, beforeFlush); const count = actions.length; await pause(280); assert.equal(actions.length, count); await widget.mouse.up(); assert(await widget.locator('#cursor-tool').isHidden()); tests.push(`widget-held-bottle-${cancellation}-ends-tool`);
  }
  await armSpray(); await widgetCanvas.focus(); const keyboardFlush = flushes; await widget.keyboard.down('Space'); await pause(270); await widget.keyboard.up('Space'); await waitFlush(widget, keyboardFlush);
  assert(await widget.locator('#cursor-tool').isHidden()); tests.push('widget-keyboard-hold-release-mist');
  const heldRightOpened = await widget.evaluate(() => window.fixtureOpened || 0), heldRightFlush = flushes; await pressSpray(); await widget.mouse.move(clearPoint.x, clearPoint.y); await pause(150);
  await widget.mouse.click(clearPoint.x, clearPoint.y, { button: 'right' }); await waitFlush(widget, heldRightFlush); await widget.mouse.up();
  assert.equal(await widget.evaluate(() => window.fixtureOpened), heldRightOpened + 1, 'Right-click over glass must open the studio even while the bottle owns spray pointer capture'); assert(await widget.locator('#cursor-tool').isHidden()); tests.push('widget-held-spray-right-click-direct-studio');
  const openedBefore = await widget.evaluate(() => window.fixtureOpened || 0); await widget.mouse.click(clearPoint.x, clearPoint.y, { button: 'right' }); assert.equal(await widget.evaluate(() => window.fixtureOpened), openedBefore + 1); assert(await widget.locator('#widget-quick').isHidden()); tests.push('widget-right-click-direct-studio');
  const movesBefore = await widget.evaluate(() => window.fixtureMoves?.length ?? 0); await widget.mouse.move(clearPoint.x, clearPoint.y); await widget.mouse.down(); await widget.mouse.move(clearPoint.x + 27, clearPoint.y + 13, { steps: 5 }); await widget.mouse.up();
  await pause(65);
  const moves = await widget.evaluate(before => (window.fixtureMoves ?? []).slice(before), movesBefore); assert(moves.length > 0); assert(moves.every(move => Number.isInteger(move.dx) && Number.isInteger(move.dy))); assert.equal(moves.reduce((sum, move) => sum + move.dx, 0), 27); assert.equal(moves.reduce((sum, move) => sum + move.dy, 0), 13); assert(await widget.locator('#widget-quick').isHidden(), 'Dragging must not also activate click-to-care'); tests.push('widget-body-drag-screen-deltas-no-care-click');
  for (const [width, height] of [[240, 300], [320, 400], [400, 500]]) {
    await widget.setViewportSize({ width, height }); await settled(widget); assert(await canvasPoint(widgetCanvas));
    await widget.mouse.move(1, 1); await widget.screenshot({ path: join(evidence, `widget-${width}.png`), omitBackground: true });
    const bottlePoint = await canvasPoint(widgetCanvas); await widget.mouse.click(bottlePoint.x, bottlePoint.y); await widget.locator('#widget-quick').waitFor({ state: 'visible' });
    const iconBounds = await widget.locator('#widget-quick button').evaluateAll(buttons => buttons.map(button => { const icon = button.querySelector('canvas'); const bounds = button.getBoundingClientRect(); const image = icon.getBoundingClientRect(); return { contained: image.left >= bounds.left && image.right <= bounds.right && image.top >= bounds.top && image.bottom <= bounds.bottom, position: getComputedStyle(icon).position }; }));
    assert(iconBounds.every(icon => icon.contained && icon.position === 'static'), `${width}: quick icons must flow inside separate buttons`);
    await widget.screenshot({ path: join(evidence, `widget-quick-${width}.png`), omitBackground: true }); await widget.mouse.click(bottlePoint.x, bottlePoint.y);
  }
  tests.push('widget-three-sizes-adaptive'); assert(passthrough.includes(true) && passthrough.includes(false)); assert.equal(errors.length, 0, errors.join('\n'));
  for (const target of [page, widget]) assert.deepEqual(await target.evaluate(() => window.fixtureWebGLRequests), []);
  tests.push('no-webgl-context-request');
  const missingBridge = await browser.newContext(); await missingBridge.route('**/*', routeAssets); const unavailable = await missingBridge.newPage(); await unavailable.goto('http://mosslight.test/index.html');
  await unavailable.locator('#desktop-required').waitFor({ state: 'visible' }); assert(await unavailable.locator('#workshop').isHidden()); await missingBridge.close(); tests.push('no-bridge-honest-message');
  const result = { status: 'pass', evidence, tests, actions: actions.length, flushes, maxPendingHost, pageErrors: errors, nativeOSVerified: false };
  await writeFile(join(evidence, 'renderer-result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(join(evidence, 'renderer-failure.json'), JSON.stringify({ status: 'fail', error: error instanceof Error ? error.stack : String(error), tests, actions, state, pageErrors: errors }, null, 2));
  throw error;
} finally { await context.close(); await browser.close(); }
