// Independent, explicitly invoked v0.2 QA. Never added to ordinary npm test.
// Runs the already-built Electron app with a unique harness-owned test directory.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir, lstat, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve, join, isAbsolute } from 'node:path';
import { launchElectron } from '../electron-harness.mjs';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|APPDATA|LOCALAPPDATA|USERPROFILE|SYSTEMDRIVE|COMSPEC|NUMBER_OF_PROCESSORS)$/i.test(key)));
const sleep = ms => new Promise(done => setTimeout(done, ms));
const shapes = ['round', 'square', 'cylinder', 'open-cylinder', 'open-cube', 'glass-box'];
const materials = ['soil', 'clay', 'gravel', 'coir', 'bark', 'charcoal'];
const count = state => state.terrain.columns.reduce((sum, column) => sum + column.length, 0);
const waterInventory = state => state.ecology.moisture + state.ecology.waterReserve + .08 * state.ecology.humidity;
async function checkedFile(relative) {
  const path = join(root, relative);
  assert(isAbsolute(path));
  assert((await lstat(path)).isFile() && !(await lstat(path)).isSymbolicLink());
  const compare = path => process.platform === 'win32' ? path.toLowerCase() : path;
  assert.equal(compare(await realpath(path)), compare(join(await realpath(root), relative)));
  return path;
}
async function point(canvas, green = false) {
  return canvas.evaluate((canvas, green) => {
    const rect = canvas.getBoundingClientRect();
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const location = (x, y) => ({ x: rect.left + x * rect.width / canvas.width, y: rect.top + y * rect.height / canvas.height });
    const isGreen = index => pixels[index + 3] > 220 && pixels[index + 1] > pixels[index] * 1.18 && pixels[index + 2] < pixels[index + 1] * .8;
    if (!green) {
      const x = Math.floor(canvas.width / 2);
      for (let y = Math.floor(canvas.height * .52); y < canvas.height * .9; y += 2) if (pixels[(y * canvas.width + x) * 4 + 3] >= 25) return location(x, y);
    }
    for (let y = 3; y < canvas.height - 3; y += 2) for (let x = 3; x < canvas.width - 3; x += 2) {
      if (!isGreen((y * canvas.width + x) * 4)) continue;
      let neighbors = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (isGreen(((y + dy) * canvas.width + x + dx) * 4)) neighbors++;
      if (neighbors >= 18) return location(x, y);
    }
    return null;
  }, green);
}

test('independent v1 original checksum and exact Buffer preservation before repeated v2 saves', async () => {
  const compile = async relative => {
    const output = await build({ entryPoints: [await checkedFile(relative)], bundle: true, platform: 'node', format: 'esm', target: 'node22', write: false, logLevel: 'silent' });
    return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
  };
  const [{ createInitialState, applyAction }, { LocalStore, decodeSave, encodeSave }] = await Promise.all([compile('src/core/simulation.ts'), compile('src/desktop/storage.ts')]);
  const data = await mkdtemp(join(tmpdir(), 'mosslight-test-v02-qa-v1-'));
  const store = new LocalStore(data);
  const { terrain, care, ...base } = applyAction(createInitialState(1000), { type:'starter' }, 1000);
  const legacy = name => {
    const state = { ...base, schemaVersion:1, name, plants:base.plants.map(({ wetness, ...plant }) => plant), layers:[{ material:'gravel', depth:.16 },{ material:'clay', depth:.1 },{ material:'soil', depth:.28 }] };
    return Buffer.from(JSON.stringify({ format:'mosslight', version:1, checksum:createHash('sha256').update(JSON.stringify(state)).digest('hex'), state }, null, 4).replaceAll('\n', '\r\n') + '\r\n\t ');
  };
  const primary = legacy('旧瓶 · 林间雨后🌿'), backup = legacy('更早的一瓶 · 保留我');
  await writeFile(store.primary, primary); await writeFile(store.backup, backup);
  const bad = JSON.parse(primary); bad.state.name = 'tampered-before-migration'; assert.throws(() => decodeSave(JSON.stringify(bad)), /校验/);
  const hostile = JSON.parse(primary); hostile.state.environment.temperature = 999;
  hostile.checksum = createHash('sha256').update(JSON.stringify(hostile.state)).digest('hex'); assert.throws(() => decodeSave(JSON.stringify(hostile)));
  const state = store.load().state; assert(state); assert.equal(state.schemaVersion, 2);
  // Preservation has already completed at load, before any schema-2 save.
  const originals = (await readdir(data)).filter(name => name.startsWith('terrarium.v1-original-')); assert.equal(originals.length, 2);
  const before = await Promise.all(originals.map(name => readFile(join(data, name))));
  assert(before.some(bytes => bytes.equals(primary))); assert(before.some(bytes => bytes.equals(backup)));
  for (let index = 0; index < 4; index++) store.save(state);
  for (let index = 0; index < originals.length; index++) assert((await readFile(join(data, originals[index]))).equals(before[index]));
  assert.equal(JSON.parse(await readFile(store.primary, 'utf8')).version, 2); assert.deepEqual(decodeSave(encodeSave(state)), state);
  console.log(JSON.stringify({ kind:'independent-v1-bytes', data, copies:originals.length, primarySha256:createHash('sha256').update(primary).digest('hex'), backupSha256:createHash('sha256').update(backup).digest('hex'), saves:4, preservedBeforeV2Write:true }));
});

test('independent v0.2 actual Electron pointer, menus, terrain, pause and restart', { timeout: 150_000 }, async t => {
  const data = await mkdtemp(join(tmpdir(), 'mosslight-test-v02-qa-'));
  const evidence = join(data, 'evidence'); await mkdir(evidence);
  const hashes = {};
  for (const relative of ['src/desktop/main.ts', 'src/desktop/storage.ts', 'src/desktop/preload.ts', 'src/core/terrain.ts', 'src/renderer/index.ts', 'src/renderer/scene.ts', 'src/renderer/scene-terrain.ts', 'src/renderer/index.html', 'src/renderer/styles.css', 'src/renderer/stroke-controller.ts', 'dist/main.cjs', 'dist/preload.cjs', 'dist/renderer/app.js']) hashes[relative] = createHash('sha256').update(await readFile(await checkedFile(relative))).digest('hex');
  // Independently rebuild only in memory with the actual build.mjs options.
  for (const [entry, out, platform, format, target] of [
    ['src/desktop/main.ts', 'dist/main.cjs', 'node', 'cjs', 'node22'],
    ['src/desktop/preload.ts', 'dist/preload.cjs', 'node', 'cjs', 'node22'],
    ['src/renderer/index.ts', 'dist/renderer/app.js', 'browser', 'iife', 'chrome130'],
  ]) {
    const result = await build({ entryPoints:[await checkedFile(entry)], outfile:await checkedFile(out), bundle:true, platform, format, target, ...(platform === 'node' ? { external:['electron'] } : {}), sourcemap:false, write:false, logLevel:'silent' });
    assert((await readFile(await checkedFile(out))).equals(Buffer.from(result.outputFiles[0].contents)), `${out} must exactly match current sources compiled independently in memory`);
  }
  for (const filename of ['index.html', 'styles.css']) assert((await readFile(await checkedFile(`src/renderer/${filename}`))).equals(await readFile(await checkedFile(`dist/renderer/${filename}`))));
  console.log(JSON.stringify({ kind:'independent-current-source-dist-byte-match', files:5, filesWritten:0 }));
  console.log(JSON.stringify({ kind: 'v02-independent-qa', data, evidence, hashes, realUserDataUsed: false, nativeOsInputClaimed: false }));
  let app; const errors = [];
  const get = page => page.evaluate(() => window.terrarium.getSnapshot());
  async function launch() {
    app = await launchElectron({ executablePath: require('electron'), args: [root, `--mosslight-test-data=${data}`, '--workshop'], cwd: root, env, timeout: 40_000 });
    const listen = page => page.on('pageerror', error => errors.push(error.message));
    app.on('window', listen); app.windows().forEach(listen);
    const deadline = Date.now() + 20_000;
    while (!app.windows().some(page => page.url().includes('mode=workshop')) && Date.now() < deadline) await sleep(100);
    const page = app.windows().find(page => page.url().includes('mode=workshop')); assert(page);
    page.setDefaultTimeout(15_000); await page.locator('#workshop').waitFor({ state: 'visible' });
    return page;
  }
  async function hold(page, at, delta = 0, screenshot) {
    await page.mouse.move(at.x, at.y); await page.mouse.down();
    if (delta) await page.mouse.move(at.x + delta, at.y + 2, { steps: 8 });
    await sleep(450);
    if (screenshot) await page.screenshot({ path: join(evidence, screenshot), omitBackground: true });
    await page.mouse.up(); await sleep(250);
  }
  try {
    let page = await launch();
    await t.test('empty launch and starter, six shapes and distinct visible material icons', async () => {
      assert.equal((await get(page)).state.plants.length, 0);
      await page.screenshot({ path:join(evidence, 'empty-launch.png') });
      await page.locator('[data-command=starter]').click();
      if (await page.locator('#confirm-dialog').isVisible()) await page.locator('#confirm-accept').click();
      await page.waitForFunction(async () => (await window.terrarium.getSnapshot()).state.plants.length === 4);
      for (const shape of shapes) {
        await page.locator(`[data-shape="${shape}"]`).click();
        await page.waitForFunction(async shape => (await window.terrarium.getSnapshot()).state.bottle === shape, shape);
        await sleep(100); assert(await point(page.locator('#workshop-canvas')));
        if (shape.startsWith('open-')) assert.equal((await get(page)).state.closed, false);
        await page.screenshot({ path: join(evidence, `shape-${shape}.png`) });
        if (shape === 'glass-box') {
          await page.locator('[data-tab=care]').click(); await page.locator('#lid-switch').click();
          await page.waitForFunction(async () => (await window.terrarium.getSnapshot()).state.closed);
          await sleep(750); await page.screenshot({ path:join(evidence, 'glass-cover-closed.png') });
          await page.locator('[data-tab=build]').click();
        }
      }
      const icons = await page.locator('.material-palette canvas').evaluateAll(canvases => canvases.map(canvas => canvas.toDataURL()));
      assert.equal(icons.length, 6); assert.equal(new Set(icons).size, 6);
    });
    await t.test('real host pour order, local relief and shovel; release prevents future doses', async () => {
      await page.locator('[data-shape=round]').click(); await sleep(100);
      const at = await point(page.locator('#workshop-canvas')); assert(at);
      const before = count((await get(page)).state);
      for (const material of materials) {
        const previous = (await get(page)).state;
        await page.locator(`[data-material="${material}"]`).click();
        await hold(page, { x: at.x - 50, y: at.y }, material === 'coir' ? 18 : 0, material === 'coir' ? 'pour-holding.png' : undefined);
        const next = (await get(page)).state; const added = count(next) - count(previous); assert(added > 0, `${material} actually adds grains`);
        next.terrain.columns.forEach((column, index) => {
          const old = previous.terrain.columns[index]; assert.deepEqual(column.slice(0, old.length), old, 'Every existing column remains an ordered prefix');
          assert(column.slice(old.length).every(grain => grain === material), `All newly added grains are ${material}`);
        });
        console.log(JSON.stringify({ kind:'independent-material-deposit', material, added }));
      }
      let state = (await get(page)).state; assert(count(state) > before);
      assert(new Set(state.terrain.columns.map(column => column.length)).size > 1);
      const released = JSON.stringify(state.terrain); await sleep(500); assert.equal(JSON.stringify((await get(page)).state.terrain), released);
      const deposited = count(state); await page.locator('#scoop-tool').click(); await hold(page, { x: at.x - 50, y: at.y }, 0, 'shovel-holding.png');
      const sculpted = (await get(page)).state; assert(count(sculpted) < deposited);
      const dug = [];
      sculpted.terrain.columns.forEach((column, index) => {
        const old = state.terrain.columns[index]; assert.deepEqual(column, old.slice(0, column.length), 'Shovel removes only the top');
        if (column.length < old.length) dug.push(index); else assert.deepEqual(column, old);
      });
      assert(dug.length > 0 && dug.length <= 3 && Math.max(...dug) - Math.min(...dug) <= 2, 'Shovel changes a bounded local valley, not the whole base');
      assert.deepEqual(sculpted.terrain.columns[0], state.terrain.columns[0]); assert.deepEqual(sculpted.terrain.columns[47], state.terrain.columns[47]);
      await page.locator('#workshop-tool-hud [data-exit-tool]').click();
      await page.screenshot({ path: join(evidence, 'workshop-sculpted.png') });
    });
    await t.test('visible held moving spray and DOM cancel/lost-capture/blur stop at real IPC', async () => {
      await page.locator('[data-tab=care]').click();
      const leaf = await point(page.locator('#workshop-canvas'), true); assert(leaf);
      const before = (await get(page)).state; await page.locator('#water-button').click();
      await page.mouse.move(leaf.x, leaf.y); await page.mouse.down(); await sleep(250);
      assert(await page.locator('#cursor-tool.spraying').isVisible());
      await page.mouse.move(leaf.x + 4, leaf.y + 2, { steps: 4 }); await sleep(150);
      await page.screenshot({ path: join(evidence, 'spray-holding.png') });
      await page.mouse.up(); await sleep(250);
      assert(!(await page.locator('#cursor-tool').evaluate(element => element.classList.contains('spraying'))));
      const after = (await get(page)).state;
      assert(after.ecology.moisture > before.ecology.moisture); assert(after.plants.some(plant => plant.wetness > 0));
      await page.evaluate(() => window.terrarium.dispatch({ type:'pause', paused:true }));
      try {
      for (const event of ['pointercancel', 'lostpointercapture', 'blur']) {
        if (await page.locator('#workshop-tool-hud').isHidden()) await page.locator('#water-button').click();
        await page.mouse.move(leaf.x, leaf.y); await page.mouse.down(); await sleep(155);
        await page.evaluate(event => event === 'blur' ? window.dispatchEvent(new Event(event)) : document.querySelector('#workshop-canvas').dispatchEvent(new PointerEvent(event, { pointerId: 1, bubbles: true })), event);
        assert(!(await page.locator('#cursor-tool').evaluate(element => element.classList.contains('spraying'))));
        // Do not send pointerup before proving this event stopped a still-held dose.
        await sleep(100); const water = waterInventory((await get(page)).state); assert(water < 2, 'Fixture is unsaturated, so a leaked dose cannot be hidden');
        await sleep(350); assert.equal(waterInventory((await get(page)).state), water, `${event} must not deliver queued water while mouse remains down`);
        await page.mouse.up();
      }
      } finally { await page.mouse.up(); await page.evaluate(() => window.terrarium.dispatch({ type:'pause', paused:false })); }
    });
    await t.test('spray from empty air above foliage wets a cone target; outside bottle never doses', async () => {
      if (await page.locator('#workshop-tool-hud').isVisible()) await page.locator('#workshop-tool-hud [data-exit-tool]').click();
      const leaf = await point(page.locator('#workshop-canvas'), true); assert(leaf);
      const above = { x:leaf.x, y:leaf.y - 35 };
      await page.mouse.click(above.x, above.y); assert(await page.locator('#selection-bar').isHidden(), 'Source is empty air, not a directly selectable sprite pixel');
      const before = (await get(page)).state;
      await page.locator('#water-button').click(); await hold(page, above, 0, 'spray-above-foliage.png');
      const after = (await get(page)).state;
      assert(after.plants.some(plant => plant.wetness > before.plants.find(old => old.id === plant.id).wetness + .000001), 'Downward mist must wet a plant even when source pixel is empty');
      const water = after.ecology.moisture; await hold(page, { x:2,y:2 });
      assert((await get(page)).state.ecology.moisture <= water + .000001, 'Outside-bottle pointer cannot issue a dose');
      await page.locator('#workshop-tool-hud [data-exit-tool]').click();
    });
    await t.test('widget left quick/right management, temp and three sizes; quick canvases fit buttons', async () => {
      const widget = app.windows().find(page => page.url().includes('mode=widget')); assert(widget);
      await page.locator('[data-tab=settings]').click();
      for (const size of ['small', 'medium', 'large']) {
        await page.locator('#widget-size').selectOption(size); await sleep(200);
        const at = await point(widget.locator('#widget-canvas')); assert(at);
        await widget.mouse.click(at.x, at.y); await widget.locator('#widget-quick').waitFor({ state: 'visible' });
        assert(await widget.locator('#widget-management').isHidden());
        const rects = await widget.locator('#widget-quick button').evaluateAll(buttons => buttons.map(button => { const b = button.getBoundingClientRect(), c = button.querySelector('canvas').getBoundingClientRect(); return { b: { x:b.x,y:b.y,right:b.right,bottom:b.bottom }, c: {x:c.x,y:c.y,right:c.right,bottom:c.bottom} }; }));
        for (const { b, c } of rects) assert(c.x >= b.x && c.y >= b.y && c.right <= b.right && c.bottom <= b.bottom);
        await widget.screenshot({ path: join(evidence, `widget-quick-${size}.png`), omitBackground: true });
        await widget.mouse.click(at.x, at.y, { button: 'right' }); await widget.locator('#widget-management').waitFor({ state: 'visible' });
        await widget.locator('[data-temperature="26"]').click();
        await page.waitForFunction(async () => (await window.terrarium.getSnapshot()).state.environment.temperature === 26);
        await widget.screenshot({ path: join(evidence, `widget-management-${size}.png`), omitBackground: true });
        await widget.locator('#widget-menu-close').click();
      }
      const native = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => ({ url: win.webContents.getURL(), focusable: win.isFocusable(), top: win.isAlwaysOnTop(), security: win.webContents.getLastWebPreferences() })));
      assert(native.every(win => win.security.sandbox && win.security.contextIsolation && !win.security.nodeIntegration));
      assert.equal(native.find(win => win.url.includes('mode=widget')).focusable, false);
      console.log(JSON.stringify({ kind:'native-properties', windows: native.map(({ security, ...window }) => window) }));
    });
    await t.test('widget quick care never opens hidden editor; actual held spray shows and stops', async () => {
      const widget = app.windows().find(page => page.url().includes('mode=widget')); assert(widget);
      widget.setDefaultTimeout(15_000);
      await app.evaluate(({ BrowserWindow }) => { const windows = BrowserWindow.getAllWindows().filter(win => win.webContents.getURL().includes('mode=workshop')); if (windows.length !== 1) throw Error('Expected unique harness workshop'); windows[0].hide(); });
      try {
      const workshopVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('mode=workshop')).isVisible());
      const at = await point(widget.locator('#widget-canvas')); assert(at);
      await widget.mouse.click(at.x, at.y); await widget.locator('#widget-quick').waitFor({ state:'visible' }); assert.equal(await workshopVisible(), false);
      await widget.locator('[data-widget-control=sun]').click();
      await widget.waitForFunction(async () => (await window.terrarium.getSnapshot()).state.care.sunlight > 0); assert.equal(await workshopVisible(), false);
      // Sunlight deliberately leaves the quick menu open so spray is the next action.
      await widget.locator('#widget-quick').waitFor({ state:'visible' });
      await widget.locator('[data-widget-control=spray]').click();
      const before = (await get(widget)).state.ecology.moisture;
      await widget.mouse.move(at.x, at.y); await widget.mouse.down(); await sleep(180); await widget.mouse.move(at.x + 6, at.y + 2, { steps:3 }); await sleep(150);
      assert(await widget.locator('#cursor-tool.spraying').isVisible());
      await widget.screenshot({ path:join(evidence, 'widget-spray-holding.png'), omitBackground:true });
      await widget.mouse.up(); await sleep(250);
      assert((await get(widget)).state.ecology.moisture > before);
      assert(!(await widget.locator('#cursor-tool').evaluate(element => element.classList.contains('spraying')))); assert.equal(await workshopVisible(), false);
      // Instrument only this harness-owned instance, preserving the real native call.
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('mode=widget'));
        win.qaIgnoreCalls = []; const original = win.setIgnoreMouseEvents;
        win.setIgnoreMouseEvents = function(ignore, options) { win.qaIgnoreCalls.push({ ignore, options }); return original.call(this, ignore, options); };
      });
      await widget.mouse.move(at.x, at.y); await widget.mouse.down(); await sleep(155); await widget.mouse.move(1, 1);
      assert(await widget.locator('#widget').evaluate(element => element.classList.contains('hit')), 'Outside held pointer capture remains interactive');
      await widget.mouse.up();
      await widget.waitForFunction(() => !document.querySelector('#widget').classList.contains('hit'));
      await sleep(100);
      const nativeIgnore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('mode=widget')).qaIgnoreCalls.at(-1));
      assert.equal(nativeIgnore.ignore, true); assert.equal(nativeIgnore.options.forward, true);
      console.log(JSON.stringify({ kind:'outside-release-no-further-move', nativeCall:nativeIgnore, nativeOsForwardingClaimed:false }));
      await widget.locator('#widget-tool-hud [data-exit-tool]').click();
      } finally {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('mode=workshop')).show());
      }
    });
    let expected;
    await t.test('pause persists ecology, custom name and exact ordered terrain across restart', async () => {
      await page.locator('[data-tab=time]').click(); await page.locator('#pause-switch').click();
      await page.waitForFunction(async () => (await window.terrarium.getSnapshot()).state.paused);
      await page.locator('#bottle-name').fill('QA隔离 · 手作山谷'); await page.locator('#bottle-name').press('Enter');
      await page.waitForFunction(async () => (await window.terrarium.getSnapshot()).state.name === 'QA隔离 · 手作山谷');
      await page.evaluate(() => window.terrarium.finishInteraction()); expected = (await get(page)).state;
      await sleep(1200); assert.equal((await get(page)).state.ecology.simulatedDays, expected.ecology.simulatedDays);
      await app.close(); app = undefined; page = await launch();
      const state = (await get(page)).state;
      assert.equal(state.name, expected.name); assert.equal(state.paused, true);
      assert.equal(state.ecology.simulatedDays, expected.ecology.simulatedDays);
      assert.deepEqual(state.terrain, expected.terrain); assert.equal(state.environment.temperature, 26);
      await page.screenshot({ path: join(evidence, 'restart-paused.png') });
    });
    assert.deepEqual(errors, []);
    for (const [relative, expectedHash] of Object.entries(hashes)) assert.equal(createHash('sha256').update(await readFile(await checkedFile(relative))).digest('hex'), expectedHash, `${relative} changed during QA; this run cannot bind the final revision`);
    await app.close(); app = undefined;
    console.log(JSON.stringify({ kind: 'v02-independent-result', evidence, pageErrors: errors, closedCleanly: true }));
  } finally { if (app) await app.close(); }
});
