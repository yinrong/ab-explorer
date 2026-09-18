import { compressLabels } from './prefix';
import { visitIntensity } from './frequency';
import { truncateAndSet, drillDownTo, backOffOne, pathForReveal } from './statemachine';

interface Entry {
  name: string;
  isDir: boolean;
  gitDirty?: boolean;
  /** 最近 14 天内的 git 提交数——不论是在这个插件里点出来的，还是 AI/CLI 在
   *  VS Code 之外直接改代码提交的，都算进"这个目录最近有没有人在忙"。 */
  activityCount?: number;
}

interface Toggles {
  groupBox: boolean;
  freqColor: boolean;
  gitDirty: boolean;
}

const DEFAULT_TOGGLES: Toggles = { groupBox: true, freqColor: true, gitDirty: true };

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
let rootGitDirty = false;
let rootActivityCount = 0;
let path: string[] = [];
let expanded = new Set<string>();
let visitCounts: Record<string, number> = {};
let toggles: Toggles = { ...DEFAULT_TOGGLES };
let currentFile: string | null = null;
let pendingScrollToCurrentFile = false;
/** revealFile 有可能在 init 处理完之前就到——先记下来，init 里补跑一次。 */
let pendingRevealKey: string | null = null;
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

function recordVisit(key: string): void {
  visitCounts[key] = (visitCounts[key] ?? 0) + 1;
  vscodeApi.postMessage({ type: 'recordVisit', key });
}

/** 点击次数 + 最近 git 提交数，作为频率着色的统一热度——两种"访问"同等看待。 */
function combinedHeat(key: string, activityCount: number | undefined): number {
  return (visitCounts[key] ?? 0) + (activityCount ?? 0);
}

/** 扫一遍当前已知的所有目录（含 root），取热度最大值，用来把着色强度归一化。 */
function maxCombinedHeat(): number {
  let max = combinedHeat('', rootActivityCount);
  for (const [dirKey, entries] of dirCache) {
    for (const e of entries) {
      if (!e.isDir) continue;
      const key = dirKey ? `${dirKey}/${e.name}` : e.name;
      const heat = combinedHeat(key, e.activityCount);
      if (heat > max) max = heat;
    }
  }
  return max;
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
  recordVisit('');
  path = [];
  expanded = new Set();
  persist();
  ensureLoaded(keyJoin(path));
  render();
}

function onSelectAt(rowIndex: number, dirName: string): void {
  const key = keyJoin([...path.slice(0, rowIndex), dirName]);
  recordVisit(key);
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
  recordVisit(key);
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

/**
 * 编辑器切换活动文件时同步：文件不在当前 B 区子树下就把 path 收回根，
 * 展开从 B 区根到文件所在目录的每一级祖先，再走一次和手动展开一样的
 * 溢出检测（需要的话一次性下钻到文件所在目录，不需要就留在原模式）。
 */
function revealFile(fileKey: string): void {
  path = pathForReveal(path, fileKey);

  const rel = relativeSegments(path, fileKey);
  if (rel === null || rel.length === 0) return;

  const dirSegments = rel.slice(0, -1);
  let parentKey = keyJoin(path);
  for (const seg of dirSegments) {
    parentKey = parentKey ? `${parentKey}/${seg}` : seg;
    expanded.add(parentKey);
    ensureLoaded(parentKey);
  }

  currentFile = fileKey;
  pendingScrollToCurrentFile = true;
  persist();
  render();
  checkOverflowAfterExpand(parentKey);
}

function scrollToCurrentFile(): void {
  if (!currentFile) return;
  const el = document.querySelector('[data-current-file="true"]');
  if (el) {
    el.scrollIntoView({ block: 'nearest' });
    pendingScrollToCurrentFile = false;
  }
}

function onSetToggle(key: keyof Toggles, value: boolean): void {
  toggles = { ...toggles, [key]: value };
  vscodeApi.postMessage({ type: 'setToggle', key, value });
  render();
}

function ctxAttr(section: 'entry' | 'root', key: string, isDir: boolean): string {
  return JSON.stringify({ webviewSection: section, path: key, isDir });
}

function applyFreqColor(el: HTMLElement, key: string, activityCount: number | undefined, globalMax: number): void {
  if (!toggles.freqColor) {
    el.style.removeProperty('--freq');
    return;
  }
  const intensity = visitIntensity(combinedHeat(key, activityCount), globalMax);
  el.style.setProperty('--freq', String(intensity));
}

function prependDirtyDot(el: HTMLElement): void {
  const dot = document.createElement('span');
  dot.className = 'dirty-icon codicon codicon-source-control';
  dot.title = '有未提交的 git 改动';
  el.insertBefore(dot, el.firstChild);
}

function renderToggles(container: HTMLElement): void {
  container.innerHTML = '';
  const items: { key: keyof Toggles; label: string }[] = [
    { key: 'groupBox', label: '分组框' },
    { key: 'freqColor', label: '频率着色' },
    { key: 'gitDirty', label: 'Git 改动' },
  ];
  for (const item of items) {
    const label = document.createElement('label');
    label.className = 'toggle-item';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = toggles[item.key];
    input.addEventListener('change', () => onSetToggle(item.key, input.checked));
    label.appendChild(input);
    label.appendChild(document.createTextNode(item.label));
    container.appendChild(label);
  }
}

function renderARegion(container: HTMLElement): void {
  container.innerHTML = '';
  const globalMax = maxCombinedHeat();
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
      rootTag.setAttribute('data-vscode-context', ctxAttr('root', '', true));
      applyFreqColor(rootTag, '', rootActivityCount, globalMax);
      if (toggles.gitDirty && rootGitDirty) prependDirtyDot(rootTag);
      rootTag.addEventListener('click', onSelectRoot);
      rowEl.appendChild(rootTag);
    }

    const children = dirCache.get(parentKey);
    if (children) {
      const dirEntries = new Map(children.filter((e) => e.isDir).map((e) => [e.name, e]));
      const labeled = compressLabels([...dirEntries.keys()]);
      let groupOpen: HTMLElement | null = null;
      for (const l of labeled) {
        const key = keyJoin([...path.slice(0, i), l.name]);
        const tagEl = document.createElement('button');
        tagEl.type = 'button';
        tagEl.className = 'a-tag' + (path[i] === l.name ? ' selected' : '');
        tagEl.textContent = l.label;
        tagEl.title = l.name;
        tagEl.setAttribute('data-vscode-context', ctxAttr('entry', key, true));
        applyFreqColor(tagEl, key, dirEntries.get(l.name)?.activityCount, globalMax);
        if (toggles.gitDirty && dirEntries.get(l.name)?.gitDirty) prependDirtyDot(tagEl);
        tagEl.addEventListener('click', () => onSelectAt(i, l.name));

        if (toggles.groupBox && l.groupSize >= 3) {
          if (l.isGroupStart) {
            groupOpen = document.createElement('span');
            groupOpen.className = 'a-tag-group';
            rowEl.appendChild(groupOpen);
          }
          (groupOpen ?? rowEl).appendChild(tagEl);
        } else {
          groupOpen = null;
          rowEl.appendChild(tagEl);
        }
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
    row.className = 'b-row' + (childK === currentFile ? ' current-file' : '');
    row.style.paddingLeft = `${depth * 16}px`;
    row.setAttribute('data-vscode-context', ctxAttr('entry', childK, entry.isDir));
    if (childK === currentFile) row.setAttribute('data-current-file', 'true');

    const twisty = document.createElement('span');
    twisty.className =
      'b-twisty codicon ' + (entry.isDir ? (expanded.has(childK) ? 'codicon-chevron-down' : 'codicon-chevron-right') : 'codicon-blank');
    row.appendChild(twisty);

    const icon = document.createElement('span');
    icon.className = 'b-icon codicon ' + (entry.isDir ? (expanded.has(childK) ? 'codicon-folder-opened' : 'codicon-folder') : 'codicon-file');
    row.appendChild(icon);

    if (entry.isDir && toggles.gitDirty && entry.gitDirty) {
      const dot = document.createElement('span');
      dot.className = 'dirty-icon codicon codicon-source-control';
      dot.title = '有未提交的 git 改动';
      row.appendChild(dot);
    }

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
  const toggleBar = document.getElementById('a-toggles');
  const a = document.getElementById('a-region');
  const b = document.getElementById('b-content');
  if (!toggleBar || !a || !b) return;
  if (!hasWorkspace) {
    toggleBar.innerHTML = '';
    a.innerHTML = '';
    b.textContent = '未打开任何文件夹。';
    return;
  }
  renderToggles(toggleBar);
  renderARegion(a);
  renderBRegion(b);
  if (pendingScrollToCurrentFile) scrollToCurrentFile();
}

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as
    | {
        type: 'init';
        root: string | null;
        name?: string;
        rootGitDirty?: boolean;
        rootActivityCount?: number;
        visitCounts?: Record<string, number>;
        toggles?: Toggles;
      }
    | { type: 'dir'; key: string; entries: Entry[] }
    | { type: 'invalidate'; key: string }
    | { type: 'reset' }
    | { type: 'revealFile'; key: string };

  switch (msg.type) {
    case 'init': {
      hasWorkspace = msg.root !== null;
      rootName = msg.name ?? '';
      rootGitDirty = msg.rootGitDirty ?? false;
      rootActivityCount = msg.rootActivityCount ?? 0;
      visitCounts = msg.visitCounts ?? {};
      toggles = msg.toggles ?? { ...DEFAULT_TOGGLES };
      restoreState();
      dirCache.clear();
      pendingRequests.clear();
      if (hasWorkspace) reloadEverythingNeeded();
      render();
      if (hasWorkspace && pendingRevealKey) {
        const key = pendingRevealKey;
        pendingRevealKey = null;
        revealFile(key);
      }
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
    case 'revealFile': {
      if (hasWorkspace) revealFile(msg.key);
      else pendingRevealKey = msg.key;
      break;
    }
  }
});

window.addEventListener('resize', () => {
  render();
  if (!isBOverflowing()) tryBackOff();
});

vscodeApi.postMessage({ type: 'ready' });
