import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { launchElectron } from './electron-harness.mjs';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const data = await mkdtemp(join(tmpdir(), 'mosslight-test-smoke-'));
const artifacts = resolve(process.env.MOSSLIGHT_EVIDENCE_DIR || join(data, 'evidence'));
assert(isAbsolute(artifacts)); await mkdir(artifacts, { recursive: true });
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|APPDATA|LOCALAPPDATA|USERPROFILE|SYSTEMDRIVE|COMSPEC|NUMBER_OF_PROCESSORS)$/i.test(key)));
const executablePath = process.env.MOSSLIGHT_TEST_EXECUTABLE || require('electron');
const args = [...(process.env.MOSSLIGHT_TEST_EXECUTABLE ? [] : [root]), `--mosslight-test-data=${data}`, '--workshop'];
const shapes = ['round', 'square', 'cylinder', 'open-cylinder', 'open-cube', 'glass-box', 'cat'];
const materials = ['soil', 'clay', 'gravel', 'coir', 'bark', 'charcoal'];
const plantNames = { 'Cushion moss': 'cushion-moss', 'Sheet moss': 'sheet-moss', 'Miniature fern': 'fern', 'Fittonia': 'fittonia' };
const originalTests = ['empty-first-launch', 'starter-ui', 'bottle-switch', 'watering-ui', 'lid-ui', 'speed-ui', 'pause-ui', 'rename-ui', 'sandboxed-windows', 'nonfocusable-widget', 'always-on-top', 'invalid-action-rejection', 'network-denied', 'save-restart', 'offline-eight-hours'];
const uncovered = [
  'Native OS file-picker, overwrite/cancel dialogs (file paths/confirmation are stubbed only in our test child for real IPC/storage checks)',
  'Native OS click-through, window dragging, physical lock/sleep, multi-monitor/DPI, macOS and installer lifecycle',
  'Real DOM pointercancel/lostpointercapture and native blur/visibility interruption; mouse release and Escape are exercised',
  'Power-loss/disk/permission faults, long-running ecology and final packaged candidate (separate owner verification)',
];
const errors = [], tests = [], details = {}, screenshotEvidence = [];
const lifecycle = [];
const saveFile = join(data, 'terrarium.json');
let application, page, widget, offlineDeltaDays;
const delay = ms => new Promise(done => setTimeout(done, ms));
const stateOf = target => target.evaluate(async () => (await window.terrarium.getSnapshot()).state);
const grains = terrain => terrain.columns.reduce((sum, column) => sum + column.length, 0);
const materialCount = (terrain, material, from = 0, to = 48) => terrain.columns.slice(from, to).reduce((sum, column) => sum + column.filter(value => value === material).length, 0);
const waterTotal = state => state.ecology.moisture + state.ecology.waterReserve + state.ecology.humidity * .08
  + ((state.pond?.depths.reduce((sum, depth) => sum + depth, 0) ?? 0) - (state.pond?.exchange ?? 0)) / 480;
const plantProgress = state => state.plants.map(({ id, growth, health, ageDays }) => ({ id, growth, health, ageDays }));
const mark = (name, detail) => { assert(!tests.includes(name), `Duplicate check: ${name}`); tests.push(name); if (detail !== undefined) details[name] = detail; console.log(`PASS ${name}`); };

function assertSchema2(state) {
  assert.equal(state.schemaVersion, 2); assert.equal(state.terrain.columns.length, 48);
  assert(state.terrain.columns.every(column => Array.isArray(column) && column.length <= 112 && column.every(value => materials.includes(value))));
  for (const value of [state.care.sunlight, state.ecology.moisture, state.ecology.humidity, state.ecology.waterReserve, ...state.plants.flatMap(plant => [plant.wetness, plant.growth, plant.health])]) assert(Number.isFinite(value) && value >= 0 && value <= 1, `Care/ecology bound: ${value}`);
  assert(Number.isFinite(state.ecology.simulatedDays) && state.ecology.simulatedDays >= 0);
}
async function waitState(target, predicate, arg) {
  const until = Date.now() + 8_000;
  while (Date.now() < until) { const state = await stateOf(target); if (predicate(state, arg)) return state; await delay(50); }
  throw new Error(`State condition timed out: ${predicate.toString().slice(0, 180)}`);
}
async function paint(target) { await target.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))); }
async function capture(target, name, options = {}) {
  const before = await stateOf(target), startedAt = Date.now(), path = join(artifacts, name), statePath = `${path}.state.json`;
  await target.screenshot({ ...options, path });
  const after = await stateOf(target), finishedAt = Date.now();
  // A held tool can advance while the screenshot is captured; retain both snapshots.
  await writeFile(statePath, JSON.stringify({ image: path, page: target.url(), startedAt, finishedAt, before, after }, null, 2));
  screenshotEvidence.push({ image: path, state: statePath, startedAt, finishedAt });
}
async function readSaved(path = saveFile) {
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.format, 'mosslight'); assert.equal(saved.version, 2); assertSchema2(saved.state);
  assert.equal(saved.checksum, createHash('sha256').update(JSON.stringify(saved.state)).digest('hex'));
  return saved;
}
async function waitSavedTerrain(terrain) {
  const until = Date.now() + 4_000; let lastError;
  while (Date.now() < until) {
    try { const saved = await readSaved(); assert.deepEqual(saved.state.terrain, terrain); return; }
    catch (error) { lastError = error; await delay(75); }
  }
  throw new Error(`Release must flush terrain to the isolated save: ${lastError?.message}`);
}
async function launch() {
  application = await launchElectron({ executablePath, args, cwd: root, env: environment, timeout: 45_000 });
  const listen = candidate => { candidate.on('pageerror', error => errors.push(error.message)); candidate.on('crash',()=>lifecycle.push({event:'renderer-crash',url:candidate.url(),at:Date.now()}));candidate.on('close',()=>lifecycle.push({event:'page-closed',url:candidate.url(),at:Date.now()})); };
  application.on('window', listen); for (const candidate of application.windows()) listen(candidate);
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    page = application.windows().find(candidate => candidate.url().includes('mode=workshop'));
    widget = application.windows().find(candidate => candidate.url().includes('mode=widget'));
    if (page && widget) break; await delay(100);
  }
  assert(page && widget, 'Workshop and widget windows must exist');
  await application.evaluate(({app,BrowserWindow})=>{
    globalThis.__smokeLifecycle=[];
    app.on('render-process-gone',(_event,contents,info)=>globalThis.__smokeLifecycle.push({event:'render-process-gone',url:contents.getURL(),info}));
    app.on('child-process-gone',(_event,info)=>globalThis.__smokeLifecycle.push({event:'child-process-gone',info}));
    for(const win of BrowserWindow.getAllWindows()) {
      const url=win.webContents.getURL();win.setTitle(`Mosslight ${app.getVersion()} · Isolated verification`);
      win.on('unresponsive',()=>globalThis.__smokeLifecycle.push({event:'unresponsive',url}));
      win.on('closed',()=>globalThis.__smokeLifecycle.push({event:'native-window-closed',url}));
    }
  });
  for (const target of [page, widget]) await target.waitForFunction(() => typeof window.terrarium?.finishInteraction === 'function', undefined, { timeout: 20_000 });
  await page.locator('#workshop').waitFor({ state: 'visible' }); await widget.locator('#widget').waitFor({ state: 'visible' });
  return page;
}
async function workshopVisible() {
  return application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('mode=workshop'))?.isVisible() ?? false);
}
// Visible pixels and DOM bounds, not renderer-private globals or stale fixed window coordinates.
async function bottlePoints(target, id) {
  await paint(target);
  return target.locator(id).evaluate(canvas => {
    const rect = canvas.getBoundingClientRect(), width = canvas.width, height = canvas.height;
    const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    const client = (x, y) => ({ x: rect.left + x * rect.width / width, y: rect.top + y * rect.height / height });
    for (const fraction of [.68, .75, .82]) {
      const y = Math.floor(height * fraction); let left = -1, right = -1;
      for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4 + 3] >= 25) { if (left < 0) left = x; right = x; }
      if (right - left > width * .2) return { middle: client((left + right) / 2, y), left: client(left + (right - left) * .23, height * .55), right: client(left + (right - left) * .77, height * .55) };
    }
    throw new Error('No painted bottle body found');
  });
}
async function leafPoints(target, id) {
  await paint(target);
  return target.locator(id).evaluate(canvas => {
    const rect = canvas.getBoundingClientRect(), width = canvas.width, height = canvas.height;
    const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data, found = [];
    for (let y = Math.floor(height * .3); y < height * .95; y += 2) for (let x = Math.floor(width * .08); x < width * .92; x += 2) {
      const i = (y * width + x) * 4, point = { x: rect.left + (x + .5) * rect.width / width, y: rect.top + (y + .5) * rect.height / height };
      if (pixels[i + 3] > 220 && pixels[i + 1] > pixels[i] * 1.18 && pixels[i + 2] < pixels[i + 1] * .8 && document.elementFromPoint(point.x, point.y) === canvas && found.every(old => Math.hypot(old.x - point.x, old.y - point.y) > 7)) found.push(point);
    }
    // Include low moss and opposite-side leaves, not only the first tall plant.
    return found.length <= 60 ? found : Array.from({ length: 60 }, (_, index) => found[Math.floor(index * (found.length - 1) / 59)]);
  });
}
async function selectLeaf(target, aboveOffsetCss = 0) {
  const candidates = await leafPoints(target, '#workshop-canvas'); assert(candidates.length, 'Plants must have visible opaque green leaves');
  for (const point of candidates) {
    await target.mouse.click(point.x, point.y);
    if (!await target.locator('#selection-bar').isVisible()) continue;
    const kind = plantNames[await target.locator('#selection-name').textContent()]; if (!kind) continue;
    const plant = (await stateOf(target)).plants.find(value => value.kind === kind && value.wetness < .85);
    if (!plant) continue;
    const sprayPoint = { x: point.x, y: point.y - aboveOffsetCss };
    if (aboveOffsetCss) {
      if (!await target.locator('#workshop-canvas').evaluate((canvas, point) => document.elementFromPoint(point.x, point.y) === canvas, sprayPoint)) continue;
      await target.mouse.click(sprayPoint.x, sprayPoint.y);
      // Pale/translucent foliage can extend beyond the opaque green pixels.
      // Search another leaf rather than accepting a directly hit "above" point.
      if (await target.locator('#selection-bar').isVisible()) continue;
    }
    return { point, plant, sprayPoint };
  }
  throw new Error('Real canvas click did not select an available plant');
}
async function stopAndSettle(target, effect) {
  await target.mouse.up();
  await target.waitForFunction(effect => !document.getElementById('cursor-tool').classList.contains(effect), effect, { timeout: 8_000 });
  await delay(200); // The last already-accepted dose may still be finishing.
  const stopped = await stateOf(target); await delay(400); // More than three 125ms intervals.
  const later = await stateOf(target);
  assert.equal(await target.locator('#cursor-tool').evaluate((element, effect) => element.classList.contains(effect), effect), false, 'The tool effect must stay stopped throughout the release interval');
  assert.deepEqual(later.terrain, stopped.terrain, 'Terrain must stop changing after mouse release');
  if (effect === 'spraying') {
    assert(waterTotal(later) <= waterTotal(stopped) + 1e-12, 'Released spray must not add water, even if leaf wetness is saturated');
    for (const plant of later.plants) assert(plant.wetness <= stopped.plants.find(value => value.id === plant.id).wetness, 'Released spray must not keep wetting any plant');
    if (stopped.paused) {
      assert.equal(waterTotal(later), waterTotal(stopped), 'Paused release must preserve the exact stored water total');
      assert.deepEqual(later.ecology, stopped.ecology, 'Paused release must not advance ecology');
      assert.deepEqual(plantProgress(later), plantProgress(stopped), 'Paused release must not grow, heal or age plants');
    }
  }
  await waitSavedTerrain(later.terrain); return later;
}
async function writeDocument(path, saved) {
  assert(path.startsWith(`${data}\\`) || path.startsWith(`${data}/`), 'Only this run\'s isolated files may be changed');
  saved.checksum = createHash('sha256').update(JSON.stringify(saved.state)).digest('hex'); await writeFile(path, JSON.stringify(saved));
}

try {
  await launch(); let state = await stateOf(page); assertSchema2(state);
  for (const target of [page, widget]) await target.waitForFunction(() => document.querySelector('canvas[data-renderer="canvas2d"]'), undefined, { timeout: 20_000 });
  mark('canvas2d-both-windows');
  const paper = await page.locator('.observatory').evaluate(e => ({ stage: getComputedStyle(e.querySelector('.stage')).backgroundColor, observatory: getComputedStyle(e).backgroundImage }));
  assert.equal(paper.stage, 'rgba(0, 0, 0, 0)'); assert(paper.observatory.includes('250, 249, 242'));
  mark('warm-paper-studio');
  assert.equal(state.plants.length, 0, 'First launch must be empty'); assert.equal(state.preferences.alwaysOnTop, true); mark('empty-first-launch');
  assert.equal(state.name, 'My Little Forest');
  for (const target of [page, widget]) {
    const labels = await target.evaluate(() => ({ lang:document.documentElement.lang, copy:document.body.innerText + Array.from(document.querySelectorAll('[aria-label],[title]')).map(e => (e.getAttribute('aria-label') || '') + (e.getAttribute('title') || '')).join(' ') }));
    assert.equal(labels.lang, 'en'); assert(!/\p{Script=Han}/u.test(labels.copy), labels.copy);
  }
  mark('english-first-launch');
  // Observe the real Electron passthrough call. CDP clicks alone bypass OS hit routing.
  await application.evaluate(({BrowserWindow}) => {
    const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=widget'));
    const original=win.setIgnoreMouseEvents.bind(win); globalThis.__smokeIgnore=[];
    win.setIgnoreMouseEvents=(ignore,options)=>{globalThis.__smokeIgnore.push(ignore);original(ignore,options);};
    BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=workshop')).hide();
  });
  const blankGlass = await widget.locator('#widget-canvas').evaluate(canvas=>{const r=canvas.getBoundingClientRect();return{x:r.x+r.width*.5,y:r.y+r.height*.45};});
  await widget.mouse.move(2,2); await delay(80); await widget.mouse.move(blankGlass.x,blankGlass.y); await delay(100);
  const blankHost = await application.evaluate(()=>globalThis.__smokeIgnore.at(-1));
  assert.equal(blankHost,false,'Transparent blank glass must intercept clicks in native Electron');
  await widget.mouse.click(blankGlass.x,blankGlass.y);await widget.locator('#widget-quick').waitFor({state:'visible'});
  assert.equal(await workshopVisible(),false);mark('blank-glass-native-hit-routing');
  await widget.mouse.click(blankGlass.x,blankGlass.y,{button:'right'});await page.waitForFunction(()=>!document.hidden);
  assert.equal(await workshopVisible(),true);mark('blank-glass-right-direct-studio');
  await page.locator('[data-command="starter"]').first().click();
  if (await page.locator('#confirm-dialog').isVisible()) await page.locator('#confirm-accept').click();
  state = await waitState(page, state => state.plants.length === 4); assert.equal(state.decorations.length, 2); mark('starter-ui');
  await page.locator('[data-shape="square"]').click(); await waitState(page, state => state.bottle === 'square'); mark('bottle-switch');
  const { point: leaf, plant, sprayPoint: aboveLeaf } = await selectLeaf(page, 12);
  assert.equal(await page.locator('#selection-bar').isVisible(), false, 'The above-leaf spray point must not directly select any plant');
  await page.locator('[data-tab="care"]').click(); const beforeSpray = await stateOf(page), waterBefore = beforeSpray.ecology.moisture;
  await page.locator('#water-button').click();
  assert.equal((await stateOf(page)).plants.find(value => value.id === plant.id).wetness, beforeSpray.plants.find(value => value.id === plant.id).wetness, 'Tool selection must not spray a dose');
  await page.mouse.move(aboveLeaf.x, aboveLeaf.y); await page.locator('#cursor-tool').waitFor({ state: 'visible' });
  const initialCursor = await page.locator('#cursor-tool').evaluate(element => element.style.left); await page.mouse.down();
  try {
    await page.waitForFunction(() => document.getElementById('cursor-tool').classList.contains('spraying'));
    await waitState(page, (state, before) => state.plants.find(plant => plant.id === before.id).wetness > before.wetness + .1, plant);
    await page.mouse.move(aboveLeaf.x + 10, aboveLeaf.y + 2, { steps: 4 });
    assert.notEqual(await page.locator('#cursor-tool').evaluate(element => element.style.left), initialCursor, 'Visible spray bottle follows the cursor');
    await page.mouse.move(aboveLeaf.x, aboveLeaf.y, { steps: 4 });
    state = await waitState(page, (state, before) => state.plants.find(plant => plant.id === before.id).wetness > before.wetness + .2, plant);
    const cared = state.plants.find(value => value.id === plant.id);
    assert(cared.growth > plant.growth + .001, 'Targeted spray must give meaningful immediate growth, not just an online tick');
    assert(state.ecology.moisture > waterBefore, 'Real held spraying must add water'); assertSchema2(state);
    await capture(page, 'spray-holding.png');
    mark('watering-ui'); mark('spray-target-feedback', { plantId: plant.id, wetnessGain: cared.wetness - plant.wetness, growthGain: cared.growth - plant.growth });
    mark('spray-from-above-leaf', { plantId: plant.id, leaf, pointer: aboveLeaf, offsetCssPixels: 12, directPlantClick: false });
  } finally { await stopAndSettle(page, 'spraying'); }
  mark('spray-release-stop'); assert(await page.locator('#workshop-tool-hud').isHidden());
  await page.locator('#lid-switch').click(); await waitState(page, state => !state.closed); mark('lid-ui');

  // Hide OUR native editor so a regression that opens it on left click cannot pass unnoticed.
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('mode=workshop')).hide(); });
  assert.equal(await workshopVisible(), false); const widgetBody = blankGlass;
  await widget.mouse.click(widgetBody.x, widgetBody.y); await widget.locator('#widget-quick').waitFor({ state: 'visible' });
  assert.equal(await widget.locator('#widget-management,#widget-tool-hud,#widget-drag-handle').count(), 0); assert.equal(await workshopVisible(), false); mark('widget-left-quickdock');
  const quickStyles = await widget.locator('#widget-quick button').evaluateAll(buttons => buttons.map(button => {
    const css = getComputedStyle(button), canvas = button.querySelector('canvas');
    return { text: button.textContent.trim(), label: button.getAttribute('aria-label'), background: css.backgroundColor, image: css.backgroundImage, border: css.borderTopWidth, shadow: css.boxShadow, artwork: Boolean(canvas && canvas.width && canvas.height) };
  }));
  assert.equal(quickStyles.length, 2);
  assert(quickStyles.every(style => !style.text && style.label && style.artwork && style.background === 'rgba(0, 0, 0, 0)' && style.image === 'none' && style.border === '0px' && style.shadow === 'none'), JSON.stringify(quickStyles));
  mark('transparent-icon-only-quick-tools', quickStyles);
  const climateBefore = (await stateOf(widget)).environment;
  const pixelsBeforeSun=await widget.locator('#widget-canvas').evaluate(c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data));
  await widget.locator('[data-widget-control="sun"]').click(); state = await waitState(widget, state => state.care.sunlight > .9);
  assert.deepEqual(state.environment, climateBefore, 'Sunlight boost must not rewrite the permanent climate');
  await delay(400);
  const beamPixels=await widget.locator('#widget-canvas').evaluate((c,before)=>{const after=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let visible=0;for(let i=0;i<after.length;i+=4)if(after[i]>before[i]+8&&after[i]>after[i+2]+10)visible++;return visible;},pixelsBeforeSun);
  assert(beamPixels>500,`Sunlight must visibly warm a substantial patch, found ${beamPixels} pixels`);
  await capture(widget, 'widget-quickdock.png', { omitBackground: true }); mark('widget-sunlight-transient',{beamPixels});
  if(!await widget.locator('#widget-quick').isVisible())await widget.mouse.click(widgetBody.x,widgetBody.y);
  const sprayIcon=await widget.locator('[data-widget-control="spray"]').boundingBox();assert(sprayIcon);
  const widgetLeaves = await leafPoints(widget, '#widget-canvas');
  const widgetLeaf = widgetLeaves.sort((a, b) => plant.x < .5 ? b.x - a.x : a.x - b.x)[0]; assert(widgetLeaf, 'Widget must show a target leaf');
  const widgetBefore = await stateOf(widget); await widget.mouse.click(sprayIcon.x+sprayIcon.width/2,sprayIcon.y+sprayIcon.height/2); await delay(260);
  assert(waterTotal(await stateOf(widget)) <= waterTotal(widgetBefore) + 1e-12, 'Picking up the mister must not water');
  assert.equal(await widget.locator('[data-widget-control=spray]').getAttribute('aria-pressed'),'true'); mark('widget-icon-click-arms-without-water');
  await widget.mouse.move(widgetLeaf.x,widgetLeaf.y); await widget.mouse.down();
  try {
    await waitState(widget,(state,before)=>waterTotal(state)>before,waterTotal(widgetBefore));
    mark('widget-separate-bottle-hold-water');
    await widget.mouse.move(widgetLeaf.x,widgetLeaf.y,{steps:4});
    state = await waitState(widget, (state, before) => state.plants.some(plant => plant.wetness > before.find(value => value.id === plant.id).wetness + .08), widgetBefore.plants);
    assert(waterTotal(state) > waterTotal(widgetBefore)); assertSchema2(state);
    await widget.mouse.move(widgetLeaf.x + 1, widgetLeaf.y + 1, { steps: 2 });
    await capture(widget, 'widget-spray-holding.png', { omitBackground: true });
  } finally { await widget.mouse.move(2,2); await stopAndSettle(widget, 'spraying'); }
  assert.equal(await widget.locator('#cursor-tool').isVisible(),false);assert.equal(await widget.locator('[data-widget-control="spray"]').getAttribute('aria-pressed'),'false');mark('widget-spray-hold-release-entire-flow');
  await widget.mouse.click(widgetBody.x, widgetBody.y, { button: 'right' }); await page.waitForFunction(() => !document.hidden);
  assert.equal(await widget.locator('#widget-quick').isVisible(), false);assert.equal(await workshopVisible(), true); mark('widget-open-workshop');
  await page.locator('[data-tab="care"]').click();await page.locator('#temperature').fill('26');await page.locator('#temperature').dispatchEvent('input');await page.locator('#temperature').dispatchEvent('change');
  await waitState(page,state=>state.environment.temperature===26);mark('studio-temperature-ui');

  await page.locator('[data-tab="build"]').click(); assert.equal(await page.locator('[data-shape]').count(), 7);
  for (const shape of shapes) {
    await page.locator(`[data-shape="${shape}"]`).click(); state = await waitState(page, (state, shape) => state.bottle === shape, shape);
    assert.equal(await page.locator(`[data-shape="${shape}"]`).getAttribute('aria-pressed'), 'true');
    if (shape.startsWith('open-')) {
      assert.equal(state.closed, false); assert.equal(await page.locator('#lid-switch').isDisabled(), true);
      const body = (await bottlePoints(widget, '#widget-canvas')).middle;
      await widget.mouse.click(body.x, body.y, { button: 'right' }); assert.equal(await workshopVisible(),true);
      assert.equal(await page.locator('#lid-switch').isDisabled(), true);
    } else assert.equal(await page.locator('#lid-switch').isDisabled(), false);
    await paint(page); await capture(page, `shape-${shape}.png`);
  }
  mark('bottle-seven-shapes'); mark('open-containers-no-lid');
  await page.locator('[data-shape="glass-box"]').click(); await waitState(page, state => state.bottle === 'glass-box');
  await page.locator('#glass-form-controls').waitFor({ state: 'visible' });
  await page.locator('#glass-middle').focus(); await page.keyboard.press('ArrowRight');
  state = await waitState(page, state => state.glassForm?.sides?.right.middle.width > 1);
  await page.locator('#glass-facets').selectOption('10'); await waitState(page, state => state.glassForm?.facets === 10);
  await paint(page);
  const handle = await page.locator('[data-sculpt-ring="upper"][data-sculpt-side="right"]').boundingBox(); assert(handle, 'Projected upper shaping handle must exist');
  const beforeShape = structuredClone((await stateOf(page)).glassForm);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  try { await page.mouse.move(handle.x + handle.width / 2 + 28, handle.y + handle.height / 2, { steps: 8 }); await paint(page); }
  finally { await page.mouse.up(); }
  state = await waitState(page, (state, previous) => state.glassForm?.sides?.right.upper.width !== previous.sides?.right.upper.width, beforeShape);
  assert(state.glassForm.sides.right.upper.width >= .4 && state.glassForm.sides.right.upper.width <= 1.35);
  assert.deepEqual(state.glassForm.sides.left, beforeShape.sides.left, 'One-sided edit must not modify the opposite side');
  const formAfterDrag = structuredClone(state.glassForm);
  await capture(page, 'sculpted-glass.png');
  // Cancel a second physical mouse drag: no shape state may be committed.
  const cancelHandle = await page.locator('[data-sculpt-ring="lower"][data-sculpt-side="right"]').boundingBox(); assert(cancelHandle);
  await page.mouse.move(cancelHandle.x + cancelHandle.width / 2, cancelHandle.y + cancelHandle.height / 2); await page.mouse.down();
  try { await page.mouse.move(cancelHandle.x + cancelHandle.width / 2 - 20, cancelHandle.y + cancelHandle.height / 2, { steps: 5 }); await page.keyboard.press('Escape'); }
  finally { await page.mouse.up(); }
  await paint(page); assert.deepEqual((await stateOf(page)).glassForm, formAfterDrag, 'Cancelled shape preview must not persist');
  mark('sculpt-drag-slider-facets-cancel', formAfterDrag);
  await page.locator('[data-tab="care"]').click();
  if (!(await stateOf(page)).closed) { await page.locator('#lid-switch').click(); await waitState(page, state => state.closed); }
  await paint(page); await capture(page, 'glass-cover-closed.png');
  await page.locator('#lid-switch').click(); await waitState(page, state => !state.closed); mark('glass-cover-ui');
  await page.locator('[data-tab="build"]').click(); await page.locator('[data-shape="square"]').click(); await waitState(page, state => state.bottle === 'square');
  const icons = await page.locator('.material-palette button').evaluateAll(buttons => buttons.map(button => {
    const canvas = button.querySelector('canvas'), pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return { material: button.dataset.material, label: button.textContent.trim(), painted: pixels.some((value, index) => index % 4 === 3 && value > 0), image: canvas.toDataURL() };
  }));
  assert.deepEqual(icons.map(icon => icon.material), [...materials,'water']); assert(icons.every(icon => icon.label && icon.painted)); assert.equal(new Set(icons.map(icon => icon.image)).size, 7); mark('material-icon-palette');
  const pourDetails = [];
  const materialBaseline = structuredClone((await stateOf(page)).terrain);
  for (const material of materials) {
    if (pourDetails.length) {
      // Independent finite-capacity fixtures: a slow previous screenshot or host
      // must not leave the next material trying to sculpt a completely full jar.
      // Only OUR closed test child's checksummed terrain is restored; its other
      // state, including the custom glass form and plants, stays intact.
      await application.close(); application = null;
      const fixture = await readSaved(); fixture.state.terrain = structuredClone(materialBaseline);
      fixture.state.updatedAt = Date.now(); await writeDocument(saveFile, fixture);
      await launch(); await paint(page);
      assert.deepEqual((await stateOf(page)).terrain, materialBaseline);
    }
    await page.locator(`[data-material="${material}"]`).click(); assert.equal(await page.locator(`[data-material="${material}"]`).getAttribute('aria-pressed'), 'true');
    const points = await bottlePoints(page, '#workshop-canvas'), before = (await stateOf(page)).terrain;
    await page.mouse.move(points.left.x, points.left.y); await page.mouse.down();
    try {
      await page.waitForFunction(() => document.getElementById('cursor-tool').classList.contains('pouring'));
      const left = await waitState(page, (state, input) => state.terrain.columns.slice(0, 24).flat().filter(value => value === input.material).length >= input.count + 6, { material, count: materialCount(before, material, 0, 24) });
      assert.equal(materialCount(left.terrain, material, 24), materialCount(before, material, 24), 'Left pointer must not pour into distant right columns');
      await page.mouse.move(points.right.x, points.right.y, { steps: 12 });
      state = await waitState(page, (state, input) => state.terrain.columns.slice(24).flat().filter(value => value === input.material).length >= input.count + 6, { material, count: materialCount(before, material, 24) });
      assert(grains(state.terrain) >= grains(before) + 12, 'Holding must emit multiple doses at both positions');
      for (let index = 0; index < 48; index++) assert.deepEqual(state.terrain.columns[index].slice(0, before.columns[index].length), before.columns[index], 'Pour must preserve every existing bottom-to-top material prefix');
      assert(new Set(state.terrain.columns.map(column => column.length)).size > 1, 'Pouring must create non-flat terrain'); assertSchema2(state);
    } finally { state = await stopAndSettle(page, 'pouring'); }
    // Screenshots can take seconds on a busy desktop. Capture a completed stroke,
    // never keep pouring merely because evidence capture has not returned yet.
    await capture(page, `pour-${material}-released.png`);
    pourDetails.push({ material, added: materialCount(state.terrain, material) - materialCount(before, material), heights: state.terrain.columns.map(column => column.length) });
  }
  await page.locator('#workshop-tool-hud [data-exit-tool]').click(); mark('material-pour-six', pourDetails); mark('pointer-move-terrain'); mark('pour-release-stop');
  const beforeScoop = (await stateOf(page)).terrain, scoopPoint = (await bottlePoints(page, '#workshop-canvas')).left;
  await page.locator('#scoop-tool').click();
  for (const radius of ['2', '7', '4']) { await page.locator(`[data-scoop-radius="${radius}"]`).click(); assert.equal(await page.locator(`[data-scoop-radius="${radius}"]`).getAttribute('aria-pressed'), 'true'); }
  mark('scoop-three-brush-sizes');
  await page.mouse.move(scoopPoint.x, scoopPoint.y); await page.mouse.down();
  try {
    state = await waitState(page, (state, count) => state.terrain.columns.flat().length <= count - 6, grains(beforeScoop));
    assert.deepEqual(state.terrain.columns.slice(24), beforeScoop.columns.slice(24), 'Local scoop must not excavate the other side');
    await capture(page, 'scoop-holding.png');
  } finally { state = await stopAndSettle(page, 'scooping'); }
  const changedScoopColumns = state.terrain.columns.filter((column, index) => column.length < beforeScoop.columns[index].length).length;
  assert(changedScoopColumns >= 5, 'Default scoop must remove a broad patch, not carve one column');
  mark('scoop-release-stop', { removed: grains(beforeScoop) - grains(state.terrain), changedColumns: changedScoopColumns }); await page.locator('#workshop-tool-hud [data-exit-tool]').click();
  await page.locator('[data-material="soil"]').click(); const escapePoint = (await bottlePoints(page, '#workshop-canvas')).right;
  await page.mouse.move(escapePoint.x, escapePoint.y); const beforeEscape = grains((await stateOf(page)).terrain); await page.mouse.down();
  try {
    await waitState(page, (state, count) => state.terrain.columns.flat().length > count, beforeEscape);
    await page.keyboard.press('Escape'); await page.locator('#cursor-tool').waitFor({ state: 'hidden' });
    await delay(200); const stopped = (await stateOf(page)).terrain; await delay(400);
    assert.deepEqual((await stateOf(page)).terrain, stopped, 'Escape while held must stop pouring');
  } finally { await page.mouse.up(); }
  mark('stroke-escape-stop');

  await page.locator('[data-tab="time"]').click(); await page.locator('[data-speed="5"]').click(); await waitState(page, state => state.speed === 5); mark('speed-ui');
  await page.locator('#pause-switch').click(); await waitState(page, state => state.paused);
  const paused = await stateOf(page); await delay(1200); assert.equal((await stateOf(page)).ecology.simulatedDays, paused.ecology.simulatedDays); mark('pause-ui');
  const pausedLeaf = await selectLeaf(page); await page.locator('[data-tab="care"]').click(); await page.locator('#water-button').click();
  const pausedBeforeSpray = await stateOf(page);
  await page.mouse.move(pausedLeaf.point.x, pausedLeaf.point.y); await page.mouse.down();
  try {
    state = await waitState(page, (state, before) => state.plants.find(plant => plant.id === before.id).wetness > before.wetness + .05, pausedLeaf.plant);
    assert.equal(state.plants.find(plant => plant.id === pausedLeaf.plant.id).growth, pausedLeaf.plant.growth);
    assert.equal(state.plants.find(plant => plant.id === pausedLeaf.plant.id).ageDays, pausedLeaf.plant.ageDays);
    assert.deepEqual(plantProgress(state), plantProgress(pausedBeforeSpray), 'Paused held spraying must not grow, heal or age any plant');
    assert.equal(state.ecology.simulatedDays, paused.ecology.simulatedDays); assertSchema2(state);
  } finally { state = await stopAndSettle(page, 'spraying'); }
  const stoppedWetness = state.plants.find(plant => plant.id === pausedLeaf.plant.id).wetness;
  const pausedStopped = state; await delay(400); state = await stateOf(page);
  assert(state.plants.find(plant => plant.id === pausedLeaf.plant.id).wetness <= stoppedWetness, 'Released spray must not keep wetting leaves');
  assert.equal(waterTotal(state), waterTotal(pausedStopped), 'The extra paused release observation must detect continued doses even at full wetness');
  assert.deepEqual(state.ecology, pausedStopped.ecology); assert.deepEqual(plantProgress(state), plantProgress(pausedBeforeSpray)); mark('paused-spray-no-growth');
  assert(await page.locator('#workshop-tool-hud').isHidden()); await page.locator('[data-tab="time"]').click(); await page.locator('#pause-switch').click(); await waitState(page, state => !state.paused);
  await page.locator('[data-tab="build"]').click(); await page.locator('#bottle-name').fill('雨后的玻璃森林'); await page.locator('#bottle-name').press('Enter');
  await waitState(page, state => state.name === '雨后的玻璃森林'); mark('rename-ui');

  // Native file-pickers are NOT claimed tested. Only our own child's dialog methods
  // return this run's paths; UI confirmation, real Electron IPC and storage still run.
  await page.locator('[data-tab="settings"]').click(); const beforeCancel = await stateOf(page);
  await page.locator('#panel-settings [data-command="import"]').click(); await page.locator('#confirm-dialog').waitFor({ state: 'visible' });
  await page.locator('#confirm-cancel').click(); await page.locator('#confirm-dialog').waitFor({ state: 'hidden' });
  state = await stateOf(page); assert.equal(state.name, beforeCancel.name); assert.deepEqual(state.terrain, beforeCancel.terrain); mark('import-confirm-cancel');
  await application.evaluate(({ app, dialog }) => {
    globalThis.__mosslightSmokeDialogs = { showSaveDialog: dialog.showSaveDialog, showOpenDialog: dialog.showOpenDialog, showMessageBox: dialog.showMessageBox };
    const directory = app.getPath('userData'); if (!directory.includes('mosslight-test-smoke-')) throw new Error('Not an isolated smoke child');
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: `${directory}/smoke-export.json` });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [`${directory}/smoke-import.json`] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  try {
    await page.locator('#panel-settings [data-command="export"]').click(); await page.waitForFunction(() => document.getElementById('toast').textContent.includes('exported'));
    const exported = await readSaved(join(data, 'smoke-export.json')), beforeImport = await stateOf(page), previousFiles = new Set(await readdir(data));
    const imported = structuredClone(exported); imported.state.name = '独立导入的森林';
    imported.state.preferences = { ...beforeImport.preferences, alwaysOnTop: false, launchAtLogin: true, widgetSize: 'small' };
    imported.state.updatedAt = Date.now() - 72 * 3_600_000; imported.state.createdAt = Math.min(imported.state.createdAt, imported.state.updatedAt);
    await writeDocument(join(data, 'smoke-import.json'), imported);
    await page.locator('#panel-settings [data-command="import"]').click(); await page.locator('#confirm-dialog').waitFor({ state: 'visible' }); await page.locator('#confirm-accept').click();
    state = await waitState(page, state => state.name === '独立导入的森林');
    assert.deepEqual(state.terrain, imported.state.terrain); assert.deepEqual(state.preferences, beforeImport.preferences, 'Imported files must not change this computer\'s preferences');
    assert.deepEqual(state.glassForm, imported.state.glassForm, 'Custom shape must survive checksummed export/import');
    assert(state.ecology.simulatedDays - imported.state.ecology.simulatedDays < .1, 'Import must not catch up 72 offline hours');
    const backups = (await readdir(data)).filter(file => file.startsWith('before-import-') && !previousFiles.has(file)); assert.equal(backups.length, 1);
    const backup = await readSaved(join(data, backups[0])); assert.equal(backup.state.name, beforeImport.name); assert.deepEqual(backup.state.terrain, beforeImport.terrain); mark('schema2-export-import-ipc-dialog-fixture');
    imported.checksum = '0'.repeat(64); await writeFile(join(data, 'smoke-import.json'), JSON.stringify(imported)); const beforeInvalidImport = await stateOf(page);
    await page.locator('#panel-settings [data-command="import"]').click(); await page.locator('#confirm-dialog').waitFor({ state: 'visible' }); await page.locator('#confirm-accept').click();
    await page.waitForFunction(() => document.getElementById('toast').getAttribute('role') === 'alert' && document.getElementById('toast').textContent.includes('checksum'));
    state = await stateOf(page); assert.equal(state.name, beforeInvalidImport.name); assert.deepEqual(state.terrain, beforeInvalidImport.terrain); mark('invalid-import-preserves-forest');
  } finally { await application.evaluate(({ dialog }) => { Object.assign(dialog, globalThis.__mosslightSmokeDialogs); delete globalThis.__mosslightSmokeDialogs; }); }
  await page.locator('[data-tab="build"]').click(); await page.locator('#bottle-name').fill('雨后的玻璃森林'); await page.locator('#bottle-name').press('Enter'); await waitState(page, state => state.name === '雨后的玻璃森林');
  await capture(page, 'workshop.png'); await capture(widget, 'widget.png', { omitBackground: true });
  const native = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => ({ url: win.webContents.getURL(), focusable: win.isFocusable(), top: win.isAlwaysOnTop(), preferences: { sandbox: win.webContents.getLastWebPreferences().sandbox, contextIsolation: win.webContents.getLastWebPreferences().contextIsolation, nodeIntegration: win.webContents.getLastWebPreferences().nodeIntegration } })));
  const widgetNative = native.find(win => win.url.includes('mode=widget')); assert(widgetNative); assert.equal(widgetNative.focusable, false); mark('nonfocusable-widget');
  assert.equal(widgetNative.top, true, JSON.stringify({ native, preferences: (await stateOf(page)).preferences })); mark('always-on-top');
  assert(native.every(win => win.preferences.sandbox && win.preferences.contextIsolation && !win.preferences.nodeIntegration)); mark('sandboxed-windows');
  const beforeInvalid = (await stateOf(page)).name;
  assert(await page.evaluate(async () => { try { await window.terrarium.dispatch({ type: 'rename', name: '' }); return false; } catch { return true; } })); assert.equal((await stateOf(page)).name, beforeInvalid); mark('invalid-action-rejection');
  assert(await page.evaluate(async () => { try { await fetch('https://example.com'); return false; } catch { return true; } })); mark('network-denied');
  await application.close(); application = null;
  const saved = await readSaved(); assert.equal(saved.state.name, '雨后的玻璃森林');
  const persistedTerrain = structuredClone(saved.state.terrain), persistedCare = structuredClone(saved.state.care), persistedForm = structuredClone(saved.state.glassForm);
  assert(persistedForm && persistedForm.facets === 10);
  assert(new Set(persistedTerrain.columns.map(column => column.length)).size > 1);
  assert(persistedCare.sunlight > 0 && saved.state.plants.some(plant => plant.wetness > 0), 'Schema-2 care must actually be present in the save');
  // Simulate eight offline hours ONLY in our temporary checksum-valid save.
  saved.state.updatedAt = Date.now() - 8 * 3_600_000; saved.state.createdAt = Math.min(saved.state.createdAt, saved.state.updatedAt);
  const beforeOffline = saved.state.ecology.simulatedDays; await writeDocument(saveFile, saved);
  await launch(); const resumed = await stateOf(page); assertSchema2(resumed);
  assert.equal(resumed.name, '雨后的玻璃森林'); assert.equal(resumed.plants.length, 4); assert.equal(resumed.speed, 5);
  assert.deepEqual(resumed.terrain, persistedTerrain, 'Restart/offline care must not flatten or reorder terrain'); mark('save-restart');
  assert.deepEqual(resumed.glassForm, persistedForm); mark('sculpted-form-save-restart');
  offlineDeltaDays = resumed.ecology.simulatedDays - beforeOffline;
  assert(offlineDeltaDays >= 8 / 24 && offlineDeltaDays < 8 / 24 + .1, `Offline time must be 1x even with online 5x preference (delta=${offlineDeltaDays})`); mark('offline-eight-hours');
  assert(resumed.care.sunlight < 1e-10 && resumed.plants.every(plant => plant.wetness < 1e-10), 'Temporary sunlight/leaf wetness must expire over eight real offline hours');
  mark('schema2-terrain-care-persistence', { columns: 48, grains: grains(persistedTerrain), savedSunlight: persistedCare.sunlight, resumedSunlight: resumed.care.sunlight });
  assert(resumed.plants.every(plant => plant.ecology), 'Production elapsed time initializes v09 lifecycle');
  const preV09 = await readSaved(join(data, 'terrarium.before-v0.9-primary.json'));
  assert(preV09.state.plants.every(plant => plant.ecology === undefined));
  assert(preV09.state.decorations.every(item => item.colonization === undefined && item.condition?.mold === undefined));
  assert(preV09.state.pond?.exchange === undefined);
  mark('v09-lifecycle-save-restart-and-compatible-original');
  // Start exactly on the former ceiling in OUR checksum-valid paused fixture,
  // then cross it through the real material tool and persist through another launch.
  await application.close(); application = null;
  const atOldCeiling = await readSaved();
  atOldCeiling.state.paused = true; atOldCeiling.state.bottle = 'round';
  delete atOldCeiling.state.glassForm; delete atOldCeiling.state.pond;
  for (const item of [...atOldCeiling.state.plants,...atOldCeiling.state.decorations]) delete item.support;
  // Construct the explicitly historical pre-v0.5 fixture in this isolated child.
  // Natural v0.9 time now adds lifecycle/wood condition fields; leaving them here
  // would correctly prevent an old-compatible backup and test the wrong story.
  for (const plant of atOldCeiling.state.plants) delete plant.ecology;
  for (const object of atOldCeiling.state.decorations) { delete object.condition; delete object.colonization; }
  atOldCeiling.state.terrain = { columns: Array.from({ length: 48 }, () => Array.from({ length: 40 }, () => 'soil')) };
  atOldCeiling.state.updatedAt = Date.now();
  await writeDocument(saveFile, atOldCeiling);
  await launch(); await paint(page);
  assert.deepEqual((await stateOf(page)).terrain, atOldCeiling.state.terrain, 'Existing 40-layer landscapes must not be rescaled');
  await page.locator('[data-material="coir"]').click();
  const tallPoint = (await bottlePoints(page, '#workshop-canvas')).middle;
  await page.mouse.move(tallPoint.x, tallPoint.y); await page.mouse.down();
  try {
    await waitState(page, state => Math.max(...state.terrain.columns.map(column => column.length)) >= 45);
    await capture(page, 'soil-above-old-ceiling.png');
  } finally { state = await stopAndSettle(page, 'pouring'); }
  for (const column of state.terrain.columns) assert.deepEqual(column.slice(0, 40), Array(40).fill('soil'));
  assertSchema2(state); mark('pour-past-40-without-rescaling', { maximum: Math.max(...state.terrain.columns.map(column => column.length)) });
  const tallerTerrain = structuredClone(state.terrain);
  const oldRestore = JSON.parse(await readFile(join(data, 'terrarium.before-v0.5-primary.json'), 'utf8'));
  assert.equal(oldRestore.checksum, createHash('sha256').update(JSON.stringify(oldRestore.state)).digest('hex'));
  assert(oldRestore.state.terrain.columns.every(column => column.length <= 40));
  mark('pre-v05-compatible-save-preserved');
  await application.close(); application = null; await launch();
  assert.deepEqual((await stateOf(page)).terrain, tallerTerrain); mark('tall-terrain-save-restart');
  // v0.6 feature fixture is isolated, checksum-valid, paused and shallow enough
  // to show a pond and a support stack. This never changes the user's save.
  await application.close(); application = null;
  const pondFixture = await readSaved(); pondFixture.state.bottle = 'open-cylinder';
  pondFixture.state.terrain = { columns: Array.from({length:48},(_,i)=>Array(Math.abs(i-24)<9?10:25).fill('soil')) };
  pondFixture.state.updatedAt = Date.now(); await writeDocument(saveFile,pondFixture); await launch();
  const catalogPlace = async selector => {
    const before = await stateOf(page), target = (await bottlePoints(page,'#workshop-canvas')).middle;
    const group = await page.locator(selector).evaluate(button => button.closest('.catalog-group-choices')?.id);
    if (group && await page.locator(`#${group}`).isHidden()) await page.locator(`#${group}-toggle`).click();
    await page.locator(selector).click();
    const armed = await stateOf(page); assert.equal(armed.plants.length, before.plants.length); assert.equal(armed.decorations.length, before.decorations.length, 'Catalog click must not add an item');
    await page.mouse.click(target.x,target.y);
  };
  for (const kind of ['amber-mushroom','ivory-mushroom']) { await catalogPlace(`[data-plant="${kind}"]`); await waitState(page,(s,k)=>s.plants.some(p=>p.kind===k),kind); }
  await page.locator('#stump-variants-toggle').click();
  await page.evaluate(()=>window.terrarium.finishInteraction());
  const beforeVariant = await readSaved();
  await catalogPlace('[data-decoration="stump"][data-variant="upright"]'); state=await waitState(page,s=>s.decorations.some(d=>d.kind==='stump'));
  // v0.9 elapsed ecology now creates earlier-reader recovery points before
  // these later variant tools. All fixed originals must remain immutable.
  const firstV07Bytes = await readFile(join(data,'terrarium.before-v0.7-primary.json'));
  const firstV08Bytes = await readFile(join(data,'terrarium.before-v0.8-primary.json'));
  assert.deepEqual(firstV07Bytes,firstV08Bytes,'Both gates preserve the same first-extension original');
  const firstV08 = await readSaved(join(data,'terrarium.before-v0.8-primary.json'));
  const withoutTimestamp = ({updatedAt,...value})=>value;
  assert.deepEqual(withoutTimestamp(firstV08.state),withoutTimestamp(preV09.state),'Earlier gates preserve the same pre-ecology original, not a later fixture');
  assert(firstV08.state.decorations.every(item=>item.variant===undefined&&item.pose===undefined&&item.wood?.bend===undefined));
  mark('v08-variant-preserves-existing-pre-ecology-original');
  assert.equal(state.plants.length,6); assert.equal(state.decorations.length,3); mark('fungi-stump-catalog-ui');
  const pondEcology=structuredClone(state.ecology), pondPoint=(await bottlePoints(page,'#workshop-canvas')).middle;
  await page.locator('[data-material="water"]').click(); await page.mouse.move(pondPoint.x,pondPoint.y); await page.mouse.down();
  try { state=await waitState(page,s=>(s.pond?.depths.reduce((a,b)=>a+b,0)??0)>=96); await capture(page,'pond-filling.png'); }
  finally { await page.mouse.up(); await page.evaluate(()=>window.terrarium.finishInteraction()); }
  await delay(200); state=await stateOf(page); const filledVolume=state.pond.depths.reduce((a,b)=>a+b,0);
  assert(filledVolume>=96); assert.deepEqual(state.ecology,pondEcology,'Paused pond placement stores water without advancing ecological exchange');
  assert(state.pond.depths.slice(0,15).every(n=>n===0)&&state.pond.depths.slice(33).every(n=>n===0),'Low valley holds water below its enclosing banks');
  await page.locator('#drain-tool').click(); await page.mouse.move(pondPoint.x,pondPoint.y); await page.mouse.down();
  try { state=await waitState(page,(s,n)=>s.pond.depths.reduce((a,b)=>a+b,0)<n,filledVolume); }
  finally { await page.mouse.up(); await page.evaluate(()=>window.terrarium.finishInteraction()); }
  await page.keyboard.press('Escape'); mark('pond-fill-drain-ui-no-care',{filledVolume,drainedVolume:state.pond.depths.reduce((a,b)=>a+b,0)});
  state=await stateOf(page); const stone=state.decorations.find(d=>d.kind==='stone'),wood=state.decorations.find(d=>d.kind==='wood'),stump=state.decorations.find(d=>d.kind==='stump'),moss=state.plants.find(p=>p.kind==='sheet-moss');
  for(const action of [
    {type:'move-decoration',id:wood.id,x:.5,y:.4,support:{parentId:stone.id,x:.5}},
    {type:'move-decoration',id:stump.id,x:.5,y:.4,support:{parentId:wood.id,x:.5}},
    {type:'move-plant',id:moss.id,x:.5,y:.4,support:{parentId:stump.id,x:.5}},
  ]) await page.evaluate(action=>window.terrarium.dispatch(action),action);
  const attached=await stateOf(page);
  await page.evaluate(action=>window.terrarium.dispatch(action),{type:'move-decoration',id:stone.id,x:stone.x+.05,y:stone.y});
  state=await stateOf(page);
  for(const id of [wood.id,stump.id,moss.id]) { const old=[...attached.plants,...attached.decorations].find(p=>p.id===id),next=[...state.plants,...state.decorations].find(p=>p.id===id); assert.deepEqual(next.support,old.support); assert(Math.abs(next.x-old.x-.05)<1e-9); }
  assert(await page.evaluate(async action=>{try{await window.terrarium.dispatch(action);return false;}catch{return true;}},{type:'move-decoration',id:stone.id,x:stone.x,y:stone.y,support:{parentId:stump.id,x:.5}}));
  mark('support-stack-ipc-parent-follow-cycle-rejection');
  await page.locator('[data-shape="glass-box"]').click(); await waitState(page,s=>s.bottle==='glass-box');
  assert.equal(await page.locator('[data-sculpt-side]').count(),6);
  await page.locator('#glass-side').selectOption('left');
  await page.locator('#glass-upper-height').fill('1.06'); await page.locator('#glass-upper-height').dispatchEvent('change');
  state=await waitState(page,s=>s.glassForm?.sides?.left.upper.height===1.06);
  assert.equal(state.glassForm.sides.right.upper.height,1);
  for(const facets of [7,13]) { await page.locator('#glass-facets').selectOption(String(facets));await waitState(page,(s,n)=>s.glassForm.facets===n,facets); }
  await page.locator('#glass-linked').check(); await page.locator('#glass-middle').fill('1.12'); await page.locator('#glass-middle').dispatchEvent('change');
  state=await waitState(page,s=>s.glassForm?.sides?.right.middle.width===1.12);
  assert.deepEqual(state.glassForm.sides.left.middle,state.glassForm.sides.right.middle); mark('six-asymmetric-linked-controls-7-13-ui');
  await page.evaluate(()=>window.terrarium.finishInteraction()); await capture(page,'v06-pond-stack-sculpt.png');
  const extensionSave=await stateOf(page); await application.close(); application=null; await launch();
  state=await stateOf(page); for(const key of ['pond','glassForm','terrain']) assert.deepEqual(state[key],extensionSave[key]);
  for(const key of ['plants','decorations']) assert.deepEqual(state[key].map(({id,kind,x,y,support})=>({id,kind,x,y,support})),extensionSave[key].map(({id,kind,x,y,support})=>({id,kind,x,y,support})));
  const preV06=await readSaved(join(data,'terrarium.before-v0.6-primary.json'));
  assert(!preV06.state.pond&&!preV06.state.glassForm?.sides); assert(preV06.state.plants.every(p=>!p.support&&!p.kind.endsWith('mushroom'))); assert(preV06.state.decorations.every(p=>!p.support&&p.kind!=='stump'));
  mark('v06-extensions-save-restart-compatible-restore');
  // Final runtime persistence coverage for v0.7. Real catalog/slider gestures are
  // independently exercised too; here every new action crosses packaged IPC.
  assert(state.paused, 'The structural restart fixture must stay ecologically paused');
  for (const [index, item] of state.plants.entries()) await page.evaluate(action => window.terrarium.dispatch(action), { type: 'resize-plant', id: item.id, scale: .65 + index * .1 });
  for (const [index, item] of state.decorations.entries()) await page.evaluate(action => window.terrarium.dispatch(action), { type: 'resize-decoration', id: item.id, scale: .7 + index * .15 });
  const beforeForm = await stateOf(page);
  const woodForm = { length: 1.4, angle: -58, branches: [{ at: .25, length: .4, angle: -55 }, { at: .55, length: .65, angle: 70 }, { at: .8, length: .3, angle: -40 }] };
  await page.evaluate(action => window.terrarium.dispatch(action), { type: 'wood-form', id: wood.id, value: woodForm });
  await page.evaluate(action => window.terrarium.dispatch(action), { type: 'spray-decoration', decorationId: stump.id, amount: .024 });
  await page.evaluate(() => window.terrarium.finishInteraction());
  const structure = await stateOf(page), structureAt = Date.now();
  assert.deepEqual(structure.decorations.find(item => item.id === wood.id).wood, woodForm);
  assert(structure.decorations.find(item => item.id === stump.id).condition.wetness > 0);
  assert.deepEqual(structure.decorations.map(item => item.support), beforeForm.decorations.map(item => item.support));
  mark('v07-validated-resize-branch-mist-actions');
  const preV07 = await readSaved(join(data, 'terrarium.before-v0.7-primary.json'));
  assert(preV07.state.decorations.every(item => item.wood === undefined && item.condition === undefined));
  for (const key of ['terrain', 'pond', 'glassForm']) assert.deepEqual(preV07.state[key], preV09.state[key]);
  assert.deepEqual(await readFile(join(data,'terrarium.before-v0.7-primary.json')),firstV07Bytes,'Later v0.7 edits cannot replace an earlier recovery point');
  assert.deepEqual(await readFile(join(data,'terrarium.before-v0.8-primary.json')),firstV08Bytes,'Later pond/wood edits cannot replace a v0.8 recovery point');
  mark('v07-before-extension-compatible-restore');
  await capture(page, 'v07-custom-branch-stack.png');
  await application.close(); application = null; await launch();
  state = await stateOf(page);
  for (const key of ['terrain', 'pond', 'glassForm']) assert.deepEqual(state[key], structure[key]);
  const structuralPlant = ({ wetness, ...item }) => item;
  const structuralObject = item => item.condition ? { ...item, condition: { decay: item.condition.decay } } : item;
  assert.deepEqual(state.plants.map(structuralPlant), structure.plants.map(structuralPlant));
  assert.deepEqual(state.decorations.map(structuralObject), structure.decorations.map(structuralObject));
  const elapsed = Date.now() - structureAt + 2000;
  for (const item of state.decorations) {
    const old = structure.decorations.find(previous => previous.id === item.id);
    if (!old.condition) continue;
    assert(item.condition.wetness <= old.condition.wetness + 1e-12);
    assert(item.condition.wetness >= old.condition.wetness * Math.pow(2, -elapsed / 90000) - 1e-12, 'Restart must dry naturally, not reset object wetness');
  }
  mark('v07-custom-structure-save-restart-with-optical-drying');
  // Catalog v0.10: actual packaged DOM, IPC and disk round-trip in this isolated
  // disposable profile. Never reset or advance a normal user's terrarium.
  await page.evaluate(async () => {
    await window.terrarium.dispatch({ type: 'reset' });
    await window.terrarium.dispatch({ type: 'pause', paused: true });
    await window.terrarium.dispatch({ type: 'bottle', shape: 'open-cylinder' });
  });
  await page.locator('[data-tab="build"]').click();
  const groups = { moss: 4, greenery: 4, mushrooms: 4, companions: 6, buildings: 4, lights: 2, stairs: 2, wonders: 4 };
  for (const [id, count] of Object.entries(groups)) {
    const choices = page.locator(`#${id}-choices`), toggle = page.locator(`#${id}-choices-toggle`);
    if (await choices.isHidden()) await toggle.click();
    assert.equal(await choices.locator('button[data-plant],button[data-decoration]').count(), count);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  }
  assert.equal(await page.locator('[data-decoration="path"]').count(), 0);
  mark('v010-eight-expandable-groups-correct-counts-retired-path-hidden');
  const rectangle = await page.locator('#workshop-canvas').boundingBox(); assert(rectangle);
  const airy = { x: rectangle.x + rectangle.width * .5, y: rectangle.y + rectangle.height * .44 };
  for (const kind of ['fairy', 'sun', 'moon', 'star']) {
    const before = (await stateOf(page)).decorations.length;
    await page.locator(`[data-decoration="${kind}"]`).click();
    assert.equal((await stateOf(page)).decorations.length, before, 'Floating palette pick is not placement');
    await page.mouse.click(airy.x, airy.y);
    state = await waitState(page, (s, kind) => s.decorations.some(d => d.kind === kind), kind);
    const item = state.decorations.find(d => d.kind === kind); assert(!item.support); assert(item.y < .7);
    await page.locator('#workshop-canvas').press('ArrowUp');
    state = await waitState(page, (s, previous) => s.decorations.find(d => d.id === previous.id).y < previous.y, item);
    const lifted = state.decorations.find(d => d.id === item.id); assert(!lifted.support);
    await page.evaluate(action => window.terrarium.dispatch(action), { type: 'resize-decoration', id: item.id, scale: .7 });
    await assert.rejects(page.evaluate(action => window.terrarium.dispatch(action), { type: 'add-plant', kind: 'star-moss', x: .5, y: .5, support: { parentId: item.id, x: .5 } }));
  }
  mark('v010-floating-pick-place-arrow-resize-and-support-rejection');
  for (const kind of ['star-moss', 'fern-moss', 'creeping-fig', 'oxalis', 'scarlet-mushroom', 'violet-mushroom']) {
    await catalogPlace(`[data-plant="${kind}"]`); await waitState(page, (s, kind) => s.plants.some(p => p.kind === kind), kind);
  }
  for (const kind of ['gardener', 'reader', 'cat', 'dog', 'mushroom-house', 'treehouse', 'arc-lamp', 'slender-steps']) {
    await catalogPlace(`[data-decoration="${kind}"]`); await waitState(page, (s, kind) => s.decorations.some(d => d.kind === kind), kind);
  }
  for (const woodPreset of ['double-fork', 'branched']) await page.evaluate(action => window.terrarium.dispatch(action), { type: 'add-decoration', kind: 'wood', x: .5, y: .5, woodPreset });
  await page.evaluate(() => window.terrarium.finishInteraction());
  const expanded = await stateOf(page), airborne = expanded.decorations.filter(d => ['fairy', 'sun', 'moon', 'star'].includes(d.kind));
  assert.deepEqual(expanded.decorations.filter(d => d.kind === 'wood').map(d => d.wood.tone), ['birch', 'charred']);
  const preservedV09 = await readSaved(join(data, 'terrarium.before-v0.10-primary.json'));
  assert(preservedV09.state.plants.every(p => ['cushion-moss', 'sheet-moss', 'fern', 'fittonia', 'amber-mushroom', 'ivory-mushroom'].includes(p.kind)));
  assert(preservedV09.state.decorations.every(d => !d.wood?.tone && !['fairy', 'sun', 'moon', 'star'].includes(d.kind)));
  mark('v010-new-plants-props-tones-cross-real-ipc-and-preserve-v09');
  await application.close(); application = null; await launch();
  state = await stateOf(page);
  assert.deepEqual(state.decorations, expanded.decorations); assert.deepEqual(state.plants, expanded.plants);
  await page.evaluate(() => window.terrarium.dispatch({ type: 'pour', material: 'soil', x: .5, amount: 32 }));
  state = await stateOf(page);
  assert.deepEqual(state.decorations.filter(d => ['fairy', 'sun', 'moon', 'star'].includes(d.kind)), airborne);
  await capture(page, 'v010-expanded-collection.png');
  mark('v010-expanded-collection-restart-and-terrain-independent-floating');
  assert.equal(errors.length, 0, errors.join('\n')); assert(originalTests.every(name => tests.includes(name)), 'All original 15 checks must remain');
  await application.close(); application = null;
  const result = { status: 'pass', executable: executablePath, tests, originalTestsPreserved: originalTests, details, offlineDeltaDays, artifacts, data, pageErrors: errors, screenshotEvidence, uncovered };
  await writeFile(join(artifacts, 'smoke-result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const hostLifecycle=application?await application.evaluate(()=>globalThis.__smokeLifecycle).catch(error=>({unavailable:error.message})):null;
  const result = { status: 'fail', executable: executablePath, tests, details, error: error.stack || String(error), artifacts, data, pageErrors: errors, lifecycle, hostLifecycle, child:application?.diagnostics(), screenshotEvidence, uncovered };
  for (const [target, name] of [[page, 'failure-workshop.png'], [widget, 'failure-widget.png']]) if (target && !target.isClosed()) await target.screenshot({ path: join(artifacts, name), timeout: 5_000, omitBackground: name.includes('widget') }).catch(() => {});
  await writeFile(join(artifacts, 'smoke-result.json'), JSON.stringify(result, null, 2)); console.error(JSON.stringify(result, null, 2)); throw error;
} finally { if (application) await application.close(); }
