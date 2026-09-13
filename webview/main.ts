import { compressLabels } from './prefix';
import { truncateAndSet, drillDownTo, backOffOne } from './statemachine';

interface Entry {
  name: string;
  isDir: boolean;
}

interface VsCodeApi {
  postMessage(message: unknown): void;
  setState(state: unknown): void;
  getState(): unknown;
}

declare function acquireVsCodeApi(): VsCodeApi;

interface PersistedState {
  path: string[];
  expanded: string[];
}

const vscodeApi = acquireVsCodeApi();

let rootName = '';
let hasWorkspace = false;
let path: string[] = [];
let expanded = new Set<string>();
const dirCache = new Map<string, Entry[]>();
const pendingRequests = new Set<string>();
let pendingExpandTrigger: string | null = null;

function keyJoin(segments: string[]): string {
  return segments.join('/');
}

function persist(): void {
  const state: PersistedState = { path, expanded: [...expanded] };
  vscodeApi.setState(state);
}

function restoreState(): void {
  const s = vscodeApi.getState() as PersistedState | undefined;
  if (s) {
    path = Array.isArray(s.path) ? s.path : [];
    expanded = new Set(Array.isArray(s.expanded) ? s.expanded : []);
  }
}

function ensureLoaded(key: string): void {
  if (dirCache.has(key) || pendingRequests.has(key)) return;
  pendingRequests.add(key);
  vscodeApi.postMessage({ type: 'readDir', key });
}

function relativeSegments(basePath: string[], targetKey: string): string[] | null {
  const baseKey = keyJoin(basePath);
  if (targetKey === baseKey) return [];
  const prefix = baseKey ? baseKey + '/' : '';
  if (!targetKey.startsWith(prefix)) return null;
  const rest = targetKey.slice(prefix.length);
  return rest.length ? rest.split('/') : [];
}

function isBOverflowing(): boolean {
  const el = document.getElementById('b-content');
  if (!el) return false;
  return el.scrollHeight > el.clientHeight + 1;
}

function reloadEverythingNeeded(): void {
  ensureLoaded(keyJoin([]));
  for (let i = 1; i < path.length; i++) ensureLoaded(keyJoin(path.slice(0, i)));
  ensureLoaded(keyJoin(path));
  for (const k of expanded) ensureLoaded(k);
}

function onSelectRoot(): void {
  path = [];
  expanded = new Set();
  persist();
  ensureLoaded(keyJoin(path));
  render();
}

function onSelectAt(rowIndex: number, dirName: string): void {
  path = truncateAndSet(path, rowIndex, dirName);
  expanded = new Set();
  persist();
  ensureLoaded(keyJoin(path));
  render();
}

function onToggleExpand(key: string): void {
  if (expanded.has(key)) {
    expanded.delete(key);
    persist();
    render();
    if (!isBOverflowing()) tryBackOff();
    return;
  }
  expanded.add(key);
  persist();
  if (dirCache.has(key)) {
    render();
    checkOverflowAfterExpand(key);
  } else {
    pendingExpandTrigger = key;
    ensureLoaded(key);
    render();
  }
}

function checkOverflowAfterExpand(triggerKey: string): void {
  if (!isBOverflowing()) return;
  const rel = relativeSegments(path, triggerKey);
  if (rel === null) return;
  path = drillDownTo(path, rel);
  persist();
  render();
  // 只下钻一次：仍溢出就保留滚动条，不递归再下钻
}

function tryBackOff(): void {
  while (path.length > 1) {
    const candidate = backOffOne(path);
    const candidateKey = keyJoin(candidate);
    if (!dirCache.has(candidateKey)) break;
    const saved = path;
    path = candidate;
    render();
    if (isBOverflowing()) {
      path = saved;
      render();
      break;
    }
    persist();
  }
}

function onOpenFile(key: string): void {
  vscodeApi.postMessage({ type: 'open', key });
}

function ctxAttr(section: 'entry' | 'root', key: string, isDir: boolean): string {
  return JSON.stringify({ webviewSection: section, path: key, isDir });
}

function renderARegion(container: HTMLElement): void {
  container.innerHTML = '';
  const rowCount = Math.max(1, path.length);
  for (let i = 0; i < rowCount; i++) {
    const parentKey = keyJoin(path.slice(0, i));
    const rowEl = document.createElement('div');
    rowEl.className = 'a-row';

    if (i === 0) {
      const rootTag = document.createElement('button');
      rootTag.type = 'button';
      rootTag.className = 'a-tag a-tag-root' + (path.length === 0 ? ' selected' : '');
      rootTag.textContent = rootName || '/';
      rootTag.title = rootName;
      rootTag.addEventListener('click', onSelectRoot);
      rowEl.appendChild(rootTag);
    }

    const children = dirCache.get(parentKey);
    if (children) {
      const dirNames = children.filter((e) => e.isDir).map((e) => e.name);
      const labeled = compressLabels(dirNames);
      for (const l of labeled) {
        const tagEl = document.createElement('button');
        tagEl.type = 'button';
        tagEl.className = 'a-tag' + (path[i] === l.name ? ' selected' : '');
        tagEl.textContent = l.label;
        tagEl.title = l.name;
        tagEl.addEventListener('click', () => onSelectAt(i, l.name));
        rowEl.appendChild(tagEl);
      }
    }
    container.appendChild(rowEl);
  }
}

function renderChildren(parentEl: HTMLElement, dirKey: string, depth: number): void {
  const entries = dirCache.get(dirKey);
  if (entries === undefined) {
    const loading = document.createElement('div');
    loading.className = 'b-loading';
    loading.style.paddingLeft = `${depth * 16 + 8}px`;
    loading.textContent = '加载中…';
    parentEl.appendChild(loading);
    return;
  }
  for (const entry of entries) {
    const childK = dirKey ? `${dirKey}/${entry.name}` : entry.name;
    const row = document.createElement('div');
    row.className = 'b-row';
    row.style.paddingLeft = `${depth * 16}px`;
    row.setAttribute('data-vscode-context', ctxAttr('entry', childK, entry.isDir));

    const twisty = document.createElement('span');
    twisty.className =
      'b-twisty codicon ' + (entry.isDir ? (expanded.has(childK) ? 'codicon-chevron-down' : 'codicon-chevron-right') : 'codicon-blank');
    row.appendChild(twisty);

    const icon = document.createElement('span');
    icon.className = 'b-icon codicon ' + (entry.isDir ? (expanded.has(childK) ? 'codicon-folder-opened' : 'codicon-folder') : 'codicon-file');
    row.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'b-label';
    label.textContent = entry.name;
    row.appendChild(label);

    row.addEventListener('click', () => {
      if (entry.isDir) onToggleExpand(childK);
      else onOpenFile(childK);
    });

    parentEl.appendChild(row);

    if (entry.isDir && expanded.has(childK)) {
      ensureLoaded(childK);
      const childContainer = document.createElement('div');
      childContainer.className = 'b-children';
      renderChildren(childContainer, childK, depth + 1);
      parentEl.appendChild(childContainer);
    }
  }
}

function renderBRegion(container: HTMLElement): void {
  container.innerHTML = '';
  const rootKey = keyJoin(path);
  container.setAttribute('data-vscode-context', ctxAttr('root', rootKey, true));
  ensureLoaded(rootKey);
  renderChildren(container, rootKey, 0);
}

function render(): void {
  const a = document.getElementById('a-region');
  const b = document.getElementById('b-content');
  if (!a || !b) return;
  if (!hasWorkspace) {
    a.innerHTML = '';
    b.textContent = '未打开任何文件夹。';
    return;
  }
  renderARegion(a);
  renderBRegion(b);
}

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as
    | { type: 'init'; root: string | null; name?: string }
    | { type: 'dir'; key: string; entries: Entry[] }
    | { type: 'invalidate'; key: string }
    | { type: 'reset' };

  switch (msg.type) {
    case 'init': {
      hasWorkspace = msg.root !== null;
      rootName = msg.name ?? '';
      restoreState();
      dirCache.clear();
      pendingRequests.clear();
      if (hasWorkspace) reloadEverythingNeeded();
      render();
      break;
    }
    case 'dir': {
      pendingRequests.delete(msg.key);
      dirCache.set(msg.key, msg.entries);
      render();
      if (pendingExpandTrigger === msg.key) {
        const trigger = pendingExpandTrigger;
        pendingExpandTrigger = null;
        checkOverflowAfterExpand(trigger);
      }
      break;
    }
    case 'invalidate': {
      if (dirCache.has(msg.key)) {
        dirCache.delete(msg.key);
        ensureLoaded(msg.key);
      }
      break;
    }
    case 'reset': {
      dirCache.clear();
      pendingRequests.clear();
      if (hasWorkspace) reloadEverythingNeeded();
      break;
    }
  }
});

window.addEventListener('resize', () => {
  render();
  if (!isBOverflowing()) tryBackOff();
});

vscodeApi.postMessage({ type: 'ready' });
