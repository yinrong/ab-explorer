import * as vscode from 'vscode';
import { createFile, createFolder, renameEntry } from './fsops';
import { baseNameOf, parentKeyOf } from './keys';
import { AbExplorerViewProvider } from './provider';

interface EntryContext {
  webviewSection: 'entry' | 'root';
  path: string;
  isDir: boolean;
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new AbExplorerViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AbExplorerViewProvider.viewType, provider),
  );

  function dirKeyFor(ctx: EntryContext): string {
    return ctx.isDir ? ctx.path : parentKeyOf(ctx.path);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('abExplorer.refresh', () => provider.refresh()),

    vscode.commands.registerCommand('abExplorer.newFile', async (ctx: EntryContext) => {
      const dirKey = dirKeyFor(ctx);
      const dirUri = provider.resolveAbs(dirKey);
      if (!dirUri) return;
      const name = await vscode.window.showInputBox({ prompt: '新文件名', validateInput: requireNonEmpty });
      if (!name) return;
      try {
        await createFile(vscode.Uri.joinPath(dirUri, name).fsPath);
        provider.notifyChanged(dirKey);
      } catch (e) {
        vscode.window.showErrorMessage(`新建文件失败：${e}`);
      }
    }),

    vscode.commands.registerCommand('abExplorer.newFolder', async (ctx: EntryContext) => {
      const dirKey = dirKeyFor(ctx);
      const dirUri = provider.resolveAbs(dirKey);
      if (!dirUri) return;
      const name = await vscode.window.showInputBox({ prompt: '新文件夹名', validateInput: requireNonEmpty });
      if (!name) return;
      try {
        await createFolder(vscode.Uri.joinPath(dirUri, name).fsPath);
        provider.notifyChanged(dirKey);
      } catch (e) {
        vscode.window.showErrorMessage(`新建文件夹失败：${e}`);
      }
    }),

    vscode.commands.registerCommand('abExplorer.rename', async (ctx: EntryContext) => {
      const uri = provider.resolveAbs(ctx.path);
      if (!uri) return;
      const oldName = baseNameOf(ctx.path);
      const newName = await vscode.window.showInputBox({
        prompt: '重命名为',
        value: oldName,
        validateInput: requireNonEmpty,
      });
      if (!newName || newName === oldName) return;
      const parentKey = parentKeyOf(ctx.path);
      const parentUri = provider.resolveAbs(parentKey);
      if (!parentUri) return;
      try {
        await renameEntry(uri.fsPath, vscode.Uri.joinPath(parentUri, newName).fsPath);
        provider.notifyChanged(parentKey);
      } catch (e) {
        vscode.window.showErrorMessage(`重命名失败：${e}`);
      }
    }),

    vscode.commands.registerCommand('abExplorer.delete', async (ctx: EntryContext) => {
      const uri = provider.resolveAbs(ctx.path);
      if (!uri) return;
      const confirm = await vscode.window.showWarningMessage(
        `删除“${baseNameOf(ctx.path)}”？将移入回收站。`,
        { modal: true },
        '删除',
      );
      if (confirm !== '删除') return;
      try {
        await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true });
        provider.notifyChanged(parentKeyOf(ctx.path));
      } catch (e) {
        vscode.window.showErrorMessage(`删除失败：${e}`);
      }
    }),

    vscode.commands.registerCommand('abExplorer.revealInOS', async (ctx: EntryContext) => {
      const uri = provider.resolveAbs(ctx.path);
      if (uri) await vscode.commands.executeCommand('revealFileInOS', uri);
    }),

    vscode.commands.registerCommand('abExplorer.copyPath', async (ctx: EntryContext) => {
      const uri = provider.resolveAbs(ctx.path);
      if (uri) await vscode.env.clipboard.writeText(uri.fsPath);
    }),
  );
}

function requireNonEmpty(value: string): string | undefined {
  return value.trim().length === 0 ? '名称不能为空' : undefined;
}

export function deactivate(): void {}
