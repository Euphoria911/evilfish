// Loads the v4 userscript in a vm with stubbed browser globals; returns window.__evilfish.T helpers.
const fs = require('fs');
const vm = require('vm');

function stubEl() {
  const el = {
    style: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, offsetWidth: 322, offsetHeight: 200, isConnected: true, id: '', title: '', textContent: '', value: '', children: [],
    addEventListener() {}, appendChild() {}, remove() {}, contains: () => false,
    querySelector: () => stubEl(), querySelectorAll: () => [],
    set innerHTML(v) {}, get innerHTML() { return ''; }, setAttribute() {}, getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
  };
  return el;
}

function load(file, extra = {}) {
  const board = extra.board; delete extra.board;       // optional fake <wc-chess-board> (with a .game) for clock/game-API tests
  const src = fs.readFileSync(file, 'utf8');
  const win = { __EF_TEST: true, addEventListener() {}, innerHeight: 800, innerWidth: 1400 };
  const sandbox = Object.assign({
    console: { log() {}, error: console.error, warn() {} },
    window: win,
    document: { createElement: stubEl, createElementNS: stubEl, body: { appendChild() {} }, head: { appendChild() {} }, getElementById: () => null, activeElement: null,
                querySelector: sel => (board && /wc-chess-board/.test(sel) ? board : null), querySelectorAll: () => [], addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout, clearTimeout, setInterval: () => 0, queueMicrotask, performance,
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ position: 'relative' }),
    navigator: { deviceMemory: 8 }, crypto: globalThis.crypto,
    URL, Blob, Uint8Array, JSON, Math, Number, Object, Array, Set, Map, WeakSet, String, Promise, Error, Response: globalThis.Response,
  }, extra);
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: file });
  return { T: win.__evilfish.T, ef: win.__evilfish, sandbox };
}
module.exports = { load };
