// Copyright (c) 2026 Siegfried-Thor Bolz. SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import type { RunConfiguration } from './types';
import { RunConfigStorage } from './runConfigStorage';
import { openRunConfigEditor } from './editRunConfigPanel';

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function getMainHtml(webview: vscode.Webview, extensionUri: vscode.Uri, nonce: string): string {
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Run Configurations</title>
  <style nonce="${nonce}">
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); margin: 0; padding: 8px; display: flex; flex-direction: column; gap: 8px; height: 100%; box-sizing: border-box; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 10px; border-radius: 2px; cursor: pointer; font-size: var(--vscode-font-size); }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    button:disabled { opacity: 0.5; cursor: default; }
    .list { flex: 1; min-height: 80px; border: 1px solid var(--vscode-panel-border); border-radius: 2px; overflow: auto; }
    .item { padding: 6px 8px; cursor: pointer; border-bottom: 1px solid var(--vscode-panel-border); }
    .item:last-child { border-bottom: none; }
    .item.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .item:hover:not(.selected) { background: var(--vscode-list-hoverBackground); }
    .hint { opacity: 0.8; font-size: calc(var(--vscode-font-size) - 1px); }
  </style>
</head>
<body>
  <div class="toolbar">
    <button class="secondary" id="btn-settings" title="Default Java / Maven paths (text + Browse)">Settings</button>
    <button id="btn-add" title="Add run configuration">+</button>
    <button class="secondary" id="btn-remove" title="Remove selected">−</button>
    <button id="btn-run" title="Run selected configuration">Run</button>
  </div>
  <div class="hint" id="hint">Configurations live in <code>.vscode/maven-run-configurations.json</code> (commit to share). Select one, then Run.</div>
  <div class="list" id="list" role="listbox"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let configs = [];
    let selectedId = undefined;

    function render() {
      const list = document.getElementById('list');
      list.innerHTML = '';
      configs.forEach((c) => {
        const el = document.createElement('div');
        el.className = 'item' + (c.id === selectedId ? ' selected' : '');
        el.textContent = c.name;
        el.setAttribute('role', 'option');
        el.addEventListener('click', () => {
          selectedId = c.id;
          vscode.postMessage({ type: 'select', id: c.id });
          render();
        });
        el.addEventListener('dblclick', () => {
          vscode.postMessage({ type: 'edit', id: c.id });
        });
        list.appendChild(el);
      });
      const hasSel = !!selectedId && configs.some((c) => c.id === selectedId);
      document.getElementById('btn-remove').disabled = !hasSel;
      document.getElementById('btn-run').disabled = !hasSel;
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'state') {
        configs = msg.configs || [];
        selectedId = msg.selectedId;
        render();
      }
    });

    document.getElementById('btn-settings').addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
    document.getElementById('btn-add').addEventListener('click', () => vscode.postMessage({ type: 'add' }));
    document.getElementById('btn-remove').addEventListener('click', () => vscode.postMessage({ type: 'delete', id: selectedId }));
    document.getElementById('btn-run').addEventListener('click', () => vscode.postMessage({ type: 'run', id: selectedId }));

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

export class RunConfigViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'mavenRunConfigs.main';

  private view?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly storage: RunConfigStorage,
    private readonly extensionUri: vscode.Uri,
    private readonly onRun: (config: RunConfiguration) => void | Promise<void>
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    const nonce = getNonce();
    webviewView.webview.html = getMainHtml(webviewView.webview, this.extensionUri, nonce);

    webviewView.webview.onDidReceiveMessage(async (message: { type: string; id?: string }) => {
      switch (message.type) {
        case 'ready':
          await this.postState();
          break;
        case 'select':
          if (message.id) {
            await this.storage.setSelectedId(message.id);
            await this.postState();
          }
          break;
        case 'openSettings':
          await vscode.commands.executeCommand('mavenRunConfigs.openGlobalDefaultsPanel');
          break;
        case 'add':
          openRunConfigEditor(this.context, this.extensionUri, this.storage, undefined, () => {
            void this.postState();
          });
          break;
        case 'edit': {
          const id = message.id;
          if (!id) {
            break;
          }
          const cfg = this.storage.getAll().find((c) => c.id === id);
          if (cfg) {
            openRunConfigEditor(this.context, this.extensionUri, this.storage, cfg, () => {
              void this.postState();
            });
          }
          break;
        }
        case 'delete': {
          const id = message.id;
          if (!id) {
            await vscode.window.showWarningMessage('No run configuration selected.');
            break;
          }
          const cfg = this.storage.getAll().find((c) => c.id === id);
          const answer = await vscode.window.showWarningMessage(
            `Delete run configuration "${cfg?.name ?? id}"?`,
            { modal: true },
            'Delete'
          );
          if (answer === 'Delete') {
            await this.storage.remove(id);
            await this.postState();
          }
          break;
        }
        case 'run': {
          const rid = message.id;
          if (!rid) {
            await vscode.window.showWarningMessage('No run configuration selected.');
            break;
          }
          const runCfg = this.storage.getAll().find((c) => c.id === rid);
          if (runCfg) {
            await Promise.resolve(this.onRun(runCfg));
          }
          break;
        }
        default:
          break;
      }
    });
  }

  async postState(): Promise<void> {
    if (!this.view) {
      return;
    }
    const configs = this.storage.getAll();
    let selectedId = this.storage.getSelectedId();
    if (selectedId && !configs.some((c) => c.id === selectedId)) {
      selectedId = configs[0]?.id;
      await this.storage.setSelectedId(selectedId);
    }
    if (!selectedId && configs.length > 0) {
      selectedId = configs[0].id;
      await this.storage.setSelectedId(selectedId);
    }
    await this.view.webview.postMessage({
      type: 'state',
      configs,
      selectedId,
    });
  }

  refresh(): void {
    void this.postState();
  }
}
