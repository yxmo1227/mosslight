// Development smoke tests only. Never use the user's browser profile or real save directory.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { lstat } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const environmentKeys = /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|APPDATA|LOCALAPPDATA|USERPROFILE|SYSTEMDRIVE|COMSPEC|NUMBER_OF_PROCESSORS)$/i;

function launchPlan({ executablePath, args, cwd, env, timeout = 45_000 }) {
  assert(typeof executablePath === 'string' && isAbsolute(executablePath) && !executablePath.includes('\0'), 'Electron executable must be an absolute path');
  assert(process.platform !== 'win32' || executablePath.toLowerCase().endsWith('.exe'), 'Electron must be an executable, not a shell script');
  assert(typeof cwd === 'string' && isAbsolute(cwd) && !cwd.includes('\0'), 'Working directory must be absolute');
  assert(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 120_000, 'Launch timeout must be bounded');
  assert(Array.isArray(args) && args.every(arg => typeof arg === 'string' && !arg.includes('\0')), 'Arguments must be a string array');
  const dataArgs = args.filter(arg => arg.startsWith('--mosslight-test-data='));
  assert.equal(dataArgs.length, 1, 'Exactly one isolated test data directory is required');
  const data = dataArgs[0].slice('--mosslight-test-data='.length);
  assert(isAbsolute(data) && /^mosslight-test-[\w-]+$/.test(basename(data)), 'An isolated mosslight-test-* directory is required');
  // Only the existing smoke arguments are accepted; callers cannot override debugger or sandbox flags.
  assert(args.length === new Set(args).size && args.includes('--workshop') && args.every(arg => [cwd, dataArgs[0], '--workshop'].includes(arg)), 'Unexpected smoke argument');
  assert(env && typeof env === 'object' && Object.entries(env).every(([key, value]) => environmentKeys.test(key) && typeof value === 'string' && !value.includes('\0')), 'Only the smoke environment whitelist is allowed');
  return {
    executablePath, data, timeout,
    args: ['--inspect=127.0.0.1:0', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', ...args],
    options: { cwd, env: { ...env }, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  };
}

function endpoint(value, kind) {
  const url = new URL(value);
  assert(url.protocol === 'ws:' && url.hostname === '127.0.0.1' && Number(url.port) > 0 && Number(url.port) <= 65535 && !url.username && !url.password && !url.search && !url.hash, 'Debugger endpoint must be literal IPv4 loopback');
  const id = '[a-fA-F0-9-]+';
  assert(new RegExp(kind === 'browser' ? `^/devtools/browser/${id}$` : `^/${id}$`).test(url.pathname), 'Unexpected debugger endpoint path');
  return url.href;
}

async function bounded(promise, timeout, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout);
    })]);
  } finally { clearTimeout(timer); }
}

async function beforeDeadline(promise, failure, deadline, label) {
  // The operation may already have started. Handle it even if the deadline expired
  // before this call; never create an unobserved race that rejects during cleanup.
  promise.catch(() => {});
  const time = deadline - Date.now();
  assert(time > 0, `${label} launch deadline exceeded`);
  return bounded(Promise.race([promise, failure]), time, label);
}

function inspectorClient(url, Socket = WebSocket) {
  const socket = new Socket(endpoint(url, 'node'));
  const pending = new Map();
  let nextId = 0;
  let resolveOpen, rejectOpen, resolveContext, rejectContext, contextId;
  const ready = new Promise((done, fail) => { resolveOpen = done; rejectOpen = fail; });
  const context = new Promise((done, fail) => { resolveContext = done; rejectContext = fail; });
  // A process can exit before the caller reaches the connection wait.
  ready.catch(() => {});
  context.catch(() => {});
  function fail(error) {
    rejectOpen(error);
    rejectContext(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }
  socket.addEventListener('open', () => resolveOpen());
  socket.addEventListener('error', () => fail(new Error('Node inspector connection failed')));
  socket.addEventListener('close', () => fail(new Error('Node inspector disconnected')));
  socket.addEventListener('message', event => {
    try {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.executionContextCreated' && message.params.context.auxData?.isDefault) {
        contextId = message.params.context.id;
        resolveContext(contextId);
      }
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
      else request.resolve(message.result);
    } catch (error) { fail(error); socket.close(); }
  });
  return {
    ready, context,
    async send(method, params = {}, timeout = 10_000) {
      assert.equal(socket.readyState, 1, 'Node inspector is not connected');
      const id = ++nextId;
      let timer;
      try {
        return await new Promise((done, reject) => {
          const settle = fn => value => { clearTimeout(timer); pending.delete(id); fn(value); };
          pending.set(id, { method, resolve: settle(done), reject: settle(reject) });
          timer = setTimeout(() => pending.get(id)?.reject(new Error(`${method} timed out after ${timeout}ms`)), timeout);
          try { socket.send(JSON.stringify({ id, method, params })); }
          catch (error) { pending.get(id)?.reject(error); }
        });
      } finally { clearTimeout(timer); pending.delete(id); }
    },
    async evaluate(fn, timeout = 10_000) {
      assert.equal(typeof fn, 'function', 'Main evaluation requires a trusted test function');
      const response = await this.send('Runtime.evaluate', {
        expression: `(${fn.toString()})(require('electron'))`, contextId,
        includeCommandLineAPI: true, awaitPromise: true, returnByValue: true,
      }, timeout);
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      assert(!response.result.objectId && !response.result.unserializableValue, 'Main evaluation result must be JSON-serializable');
      return response.result.value;
    },
    close() { fail(new Error('Node inspector closed')); socket.close(); },
  };
}

export async function launchElectron(options) {
  const plan = launchPlan(options);
  const [executable, workingDirectory, testDirectory] = await Promise.all([
    lstat(plan.executablePath), lstat(plan.options.cwd), lstat(plan.data),
  ]);
  assert(executable.isFile() && !executable.isSymbolicLink(), 'Electron executable must be a regular file');
  assert(workingDirectory.isDirectory() && !workingDirectory.isSymbolicLink(), 'Working directory must be a regular directory');
  assert(testDirectory.isDirectory() && !testDirectory.isSymbolicLink(), 'Test data must be a regular directory');
  const child = spawn(plan.executablePath, plan.args, plan.options);
  const deadline = Date.now() + plan.timeout;
  let browser, inspector, closePromise, stopped = false, shuttingDown = false, stderrTail = '', exitStatus = null;
  let resolveExit, rejectFailure, resolveEndpoints, rejectEndpoints;
  const exit = new Promise(done => { resolveExit = done; });
  const failure = new Promise((_, fail) => { rejectFailure = fail; });
  const endpoints = new Promise((done, fail) => { resolveEndpoints = done; rejectEndpoints = fail; });
  failure.catch(() => {}); endpoints.catch(() => {});
  const addresses = {};
  child.stdout.resume();
  child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk.toString()).slice(-8_192); });
  const lines = createInterface({ input: child.stderr });
  lines.on('line', line => {
    if (line.includes('Waiting for the debugger to disconnect')) inspector?.close();
    const match = /^(Debugger|DevTools) listening on (ws:\/\/\S+)\s*$/.exec(line);
    if (!match) return;
    const kind = match[1] === 'Debugger' ? 'node' : 'browser';
    try {
      addresses[kind] = endpoint(match[2], kind);
      if (addresses.node && addresses.browser) resolveEndpoints(addresses);
    } catch (error) { rejectEndpoints(error); }
  });
  child.once('error', error => {
    rejectFailure(error);
    if (!child.pid) { stopped = true; resolveExit({ error }); }
  });
  child.once('exit', (code, signal) => {
    exitStatus = { code, signal }; stopped = true; resolveExit(exitStatus);
    rejectFailure(new Error(`Electron exited (code=${code}, signal=${signal})`));
    inspector?.close();
  });
  const remaining = () => {
    const time = deadline - Date.now();
    assert(time > 0, 'Electron launch deadline exceeded');
    return time;
  };
  const duringLaunch = (promise, label) => beforeDeadline(promise, failure, deadline, label);
  // No process-name matching, tree-kill command, or save deletion: only our ChildProcess is owned.
  const killOwned = () => { if (!stopped && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); };
  const onInterrupt = () => { void close().finally(() => process.exit(130)).catch(() => {}); };
  const onTerminate = () => { void close().finally(() => process.exit(143)).catch(() => {}); };
  process.once('exit', killOwned);
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);

  async function cleanup(graceful) {
    shuttingDown = true;
    let forced = false;
    try {
      if (graceful && !stopped && inspector) {
        // Acknowledge the request before disconnecting; Node otherwise waits for its debugger on exit.
        await inspector.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); }, 3_000).catch(() => {});
      }
      inspector?.close();
      const disconnected = browser ? bounded(browser.close(), 3_000, 'CDP disconnect').catch(() => {}) : Promise.resolve();
      if (!stopped && graceful) await bounded(exit, 10_000, 'Electron graceful exit').catch(() => {});
      if (!stopped) { forced = true; killOwned(); }
      const result = await bounded(exit, 3_000, 'Electron child exit');
      await disconnected;
      if (graceful) assert(!forced && result.code === 0, `Electron did not exit cleanly (${JSON.stringify(result)})`);
    } finally {
      lines.close(); child.stdout.destroy(); child.stderr.destroy();
      if (stopped) process.removeListener('exit', killOwned);
      process.removeListener('SIGINT', onInterrupt);
      process.removeListener('SIGTERM', onTerminate);
    }
  }
  function close() { return closePromise ??= cleanup(true); }
  try {
    const addresses = await duringLaunch(endpoints, 'Electron debugger endpoints');
    inspector = inspectorClient(addresses.node);
    await duringLaunch(inspector.ready, 'Node inspector connection');
    await duringLaunch(inspector.send('Runtime.enable', {}, remaining()), 'Node inspector initialization');
    await duringLaunch(inspector.context, 'Node default execution context');
    const connecting = chromium.connectOverCDP(addresses.browser, { timeout: remaining() }).then(async connected => {
      if (shuttingDown) { await connected.close(); return connected; }
      browser = connected;
      return connected;
    });
    await duringLaunch(connecting, 'Chromium CDP connection');
    const application = new EventEmitter();
    for (const context of browser.contexts()) {
      context.setDefaultTimeout(30_000);
      context.on('page', page => application.emit('window', page));
    }
    application.windows = () => browser.contexts().flatMap(context => context.pages());
    application.evaluate = fn => {
      assert(!shuttingDown && !stopped, 'Electron application is closed');
      return Promise.race([inspector.evaluate(fn), failure]);
    };
    application.close = close;
    // Bounded diagnostics from this isolated owned child, never the user's app.
    application.diagnostics = () => ({ stopped, exitStatus, stderrTail });
    return application;
  } catch (error) {
    try { await cleanup(false); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Electron launch and cleanup failed'); }
    throw new Error(`Electron smoke launch failed: ${error.message}${stderrTail ? `\n${stderrTail}` : ''}`, { cause: error });
  }
}

// Focused regression checks stay in this allowed file. Imports by smoke do not register tests.
// Run without launching any UI: node --test scripts/electron-harness.mjs
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { test } = await import('node:test');
  const cwd = resolve(import.meta.dirname, '..');
  const valid = { executablePath: resolve(cwd, 'electron.exe'), cwd, env: { PATH: 'test-path' }, args: [cwd, `--mosslight-test-data=${resolve(cwd, 'mosslight-test-unit')}`, '--workshop'] };
  test('launch uses literal argv, shell:false, a copied whitelist, and ephemeral loopback ports', () => {
    const plan = launchPlan(valid);
    assert.equal(plan.options.shell, false);
    assert.deepEqual(plan.args.slice(3), valid.args);
    assert.equal(plan.executablePath, valid.executablePath);
    assert.notEqual(plan.options.env, valid.env);
    assert.deepEqual(plan.options.env, valid.env);
    assert(plan.args.includes('--inspect=127.0.0.1:0') && plan.args.includes('--remote-debugging-port=0'));
    assert(!plan.args.includes('--no-sandbox'));
  });
  test('rejects relative executables, real save paths, sandbox/debugger overrides, unsafe environment, and unbounded timeouts', () => {
    for (const overrides of [
      { executablePath: 'electron.exe' },
      { args: [`--mosslight-test-data=${resolve(cwd, 'real-save')}`, '--workshop'] },
      { args: [...valid.args, '--no-sandbox'] },
      { args: [...valid.args, '--remote-debugging-port=9222'] },
      { env: { NODE_OPTIONS: '--require untrusted' } },
      { timeout: 0 },
    ]) assert.throws(() => launchPlan({ ...valid, ...overrides }));
  });
  test('debugger URLs reject remote, wildcard, credentialed, non-WebSocket, and malformed endpoints', () => {
    assert.equal(endpoint('ws://127.0.0.1:12345/devtools/browser/abcd-1234', 'browser'), 'ws://127.0.0.1:12345/devtools/browser/abcd-1234');
    for (const url of ['ws://localhost:12345/abcd', 'ws://0.0.0.0:12345/abcd', 'ws://192.0.2.1:12345/abcd', 'ws://user@127.0.0.1:12345/abcd', 'http://127.0.0.1:12345/abcd', 'ws://127.0.0.1:0/abcd', 'ws://127.0.0.1:12345/abcd?secret=x', 'ws://127.0.0.1:12345/unexpected']) assert.throws(() => endpoint(url, 'node'));
  });
  test('bounded waits fail instead of hanging', async () => {
    await assert.rejects(bounded(new Promise(() => {}), 10, 'fixture'), /fixture timed out/);
    assert.equal(await bounded(Promise.resolve('ready'), 100, 'fixture'), 'ready');
  });
  test('expired launch deadlines handle late operation failures during cleanup', async () => {
    let rejectOperation, rejectFailure;
    const operation = new Promise((_, fail) => { rejectOperation = fail; });
    const failure = new Promise((_, fail) => { rejectFailure = fail; });
    failure.catch(() => {});
    await assert.rejects(beforeDeadline(operation, failure, Date.now() - 1, 'fixture'), /launch deadline exceeded/);
    rejectOperation(new Error('late connection failure'));
    rejectFailure(new Error('child exited during cleanup'));
    // node:test fails the test if either rejection escapes its handler.
    await new Promise(done => setImmediate(done));
  });
  class FakeSocket extends EventTarget {
    readyState = 1;
    messages = [];
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(value) { this.messages.push(JSON.parse(value)); }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
    reply(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
  }
  test('inspector requests time out and reject on disconnect', async () => {
    let socket;
    class Socket extends FakeSocket { constructor() { super(); socket = this; } }
    const client = inspectorClient('ws://127.0.0.1:12345/abcd-1234', Socket);
    await client.ready;
    await assert.rejects(client.send('Runtime.enable', {}, 10), /timed out/);
    const request = client.send('Runtime.enable');
    client.close();
    await assert.rejects(request, /closed/);
  });
  test('inspector disconnect rejects default-context discovery immediately', async () => {
    const client = inspectorClient('ws://127.0.0.1:12345/abcd-1234', FakeSocket);
    await client.ready;
    client.close();
    await assert.rejects(client.context, /closed/);
  });
  test('main evaluation preserves includeCommandLineAPI and reports exceptions', async () => {
    let socket;
    class Socket extends FakeSocket { constructor() { super(); socket = this; } }
    const client = inspectorClient('ws://127.0.0.1:12345/abcd-1234', Socket);
    await client.ready;
    socket.reply({ method: 'Runtime.executionContextCreated', params: { context: { id: 7, auxData: { isDefault: true } } } });
    assert.equal(await client.context, 7);
    const value = client.evaluate(({ app }) => app.getName());
    const request = socket.messages.at(-1);
    assert.equal(request.params.contextId, 7);
    assert(request.params.includeCommandLineAPI && request.params.returnByValue && request.params.awaitPromise);
    socket.reply({ id: request.id, result: { result: { type: 'string', value: 'Mosslight' } } });
    assert.equal(await value, 'Mosslight');
    const bad = client.evaluate(() => { throw new Error('fixture error'); });
    socket.reply({ id: socket.messages.at(-1).id, result: { exceptionDetails: { text: 'Uncaught', exception: { description: 'fixture error' } } } });
    await assert.rejects(bad, /fixture error/);
    client.close();
  });
}
