import * as vscode from 'vscode';
import * as path from 'node:path';
import { readDir } from './fsops';
import { toKey } from './keys';
import { hasUncommittedChanges, invalidateGitStatus } from './gitstatus';

export interface Toggles {
  groupBox: boolean;
  freqColor: boolean;
  gitDirty: boolean;
}

const DEFAULT_TOGGLES: Toggles = { groupBox: true, freqColor: true, gitDirty: true };
const VISIT_COUNTS_KEY = 'abExplorer.visitCounts';
const TOGGLES_KEY = 'abExplorer.toggles';

/** ext→web 消息 */
type ExtToWeb =
  | {
      type: 'init';
      root: string | null;
      name?: string;
      rootGitDirty?: boolean;
      visitCounts?: Record<string, number>;
      toggles?: Toggles;
    }
  | { type: 'dir'; key: string; entries: { name: string; isDir: boolean; gitDirty?: boolean }[]; error?: string }
  | { type: 'invalidate'; key: string }
  | { type: 'reset' };

/** web→ext 消息 */
type WebToExt =
  | { type: 'ready' }
  | { type: 'readDir'; key: string }
  | { type: 'open'; key: string }
  | { type: 'recordVisit'; key: string }
  | { type: 'setToggle'; key: keyof Toggles; value: boolean };

export class AbExplorerViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'abExplorer.view';

  private view?: vscode.WebviewView;
  private watcher?: vscode.FileSystemWatcher;
  private root?: vscode.Uri;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: WebToExt) => this.handleMessage(msg));
    webviewView.onDidDispose(() => this.disposeWatcher());

    this.root = vscode.workspace.workspaceFolders?.[0]?.uri;
    this.setupWatcher();
  }

  public refresh(): void {
    this.post({ type: 'reset' });
  }

  public notifyChanged(key: string): void {
    const abs = this.resolveAbs(key);
    if (abs) invalidateGitStatus(abs.fsPath);
    this.post({ type: 'invalidate', key });
  }

  public resolveAbs(key: string): vscode.Uri | undefined {
    if (!this.root) return undefined;
    return key ? vscode.Uri.joinPath(this.root, ...key.split('/')) : this.root;
  }

  private disposeWatcher(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
  }

  private setupWatcher(): void {
    this.disposeWatcher();
    if (!this.root) return;
    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.root, '**/*'));
    const notify = (uri: vscode.Uri) => {
      const relDir = path.dirname(path.relative(this.root!.fsPath, uri.fsPath));
      this.notifyChanged(toKey(relDir));
    };
    this.watcher.onDidCreate(notify);
    this.watcher.onDidDelete(notify);
  }

  private post(message: ExtToWeb): void {
    this.view?.webview.postMessage(message);
  }

  private excludeGlobs(): string[] {
    const cfg = vscode.workspace.getConfiguration('files').get<Record<string, boolean>>('exclude') ?? {};
    return Object.entries(cfg)
      .filter(([, v]) => v)
      .map(([k]) => k);
  }

  private getToggles(): Toggles {
    return this.context.workspaceState.get<Toggles>(TOGGLES_KEY, DEFAULT_TOGGLES);
  }

  private getVisitCounts(): Record<string, number> {
    return this.context.workspaceState.get<Record<string, number>>(VISIT_COUNTS_KEY, {});
  }

  private async handleMessage(msg: WebToExt): Promise<void> {
    if (msg.type === 'ready') {
      if (!this.root) {
        this.post({ type: 'init', root: null });
        return;
      }
      this.post({
        type: 'init',
        root: '',
        name: path.basename(this.root.fsPath),
        rootGitDirty: await hasUncommittedChanges(this.root.fsPath),
        visitCounts: this.getVisitCounts(),
        toggles: this.getToggles(),
      });
      return;
    }

    if (msg.type === 'recordVisit') {
      const counts = this.getVisitCounts();
      counts[msg.key] = (counts[msg.key] ?? 0) + 1;
      await this.context.workspaceState.update(VISIT_COUNTS_KEY, counts);
      return;
    }

    if (msg.type === 'setToggle') {
      const toggles = this.getToggles();
      toggles[msg.key] = msg.value;
      await this.context.workspaceState.update(TOGGLES_KEY, toggles);
      return;
    }

    if (!this.root) return;

    if (msg.type === 'readDir') {
      const abs = this.resolveAbs(msg.key)!;
      try {
        const entries = await readDir(abs.fsPath, this.excludeGlobs());
        const withGitStatus = await Promise.all(
          entries.map(async (e) => {
            if (!e.isDir) return e;
            const gitDirty = await hasUncommittedChanges(path.join(abs.fsPath, e.name));
            return { ...e, gitDirty };
          }),
        );
        this.post({ type: 'dir', key: msg.key, entries: withGitStatus });
      } catch (e) {
        this.post({ type: 'dir', key: msg.key, entries: [], error: String(e) });
      }
      return;
    }

    if (msg.type === 'open') {
      const abs = this.resolveAbs(msg.key);
      if (abs) await vscode.commands.executeCommand('vscode.open', abs);
      return;
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'style.css'));
    const codiconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'codicon.css'));
    const nonce = String(Date.now()) + Math.random().toString(36).slice(2);
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${styleUri}">
<link rel="stylesheet" href="${codiconUri}">
</head>
<body>
<div id="app">
  <div id="a-toggles"></div>
  <div id="a-region"></div>
  <div id="b-content"></div>
</div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
