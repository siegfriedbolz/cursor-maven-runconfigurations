// Copyright (c) 2026 Siegfried-Thor Bolz. SPDX-License-Identifier: MIT

import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { RunConfiguration } from './types';
import { RunConfigStorage } from './runConfigStorage';
import { readDefaultHomes } from './mavenTerminal';

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function getEditorHtml(webview: vscode.Webview, nonce: string): string {
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
  <title>Run Configuration</title>
  <style nonce="${nonce}">
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); margin: 0; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    label { font-weight: 600; display: block; margin-bottom: 4px; }
    input[type="text"] { width: 100%; box-sizing: border-box; padding: 4px 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
    .row { display: flex; gap: 6px; align-items: center; }
    .row input { flex: 1; }
    .defaults { font-size: calc(var(--vscode-font-size) - 1px); opacity: 0.85; padding: 6px 8px; background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 2px; }
    .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .hint { font-size: calc(var(--vscode-font-size) - 1px); opacity: 0.8; }
    .hint ul { margin: 4px 0 0 0; padding-left: 1.2em; }
    .hint li { margin: 2px 0; }
  </style>
</head>
<body>
  <div class="defaults" id="defaults"></div>
  <div>
    <label for="name">Name</label>
    <input type="text" id="name" />
  </div>
  <div>
    <label for="javaOverride">Java home override (optional)</label>
    <div class="row">
      <input type="text" id="javaOverride" placeholder="JAVA_HOME override (optional)" />
      <button class="secondary" id="browse-java" type="button">Browse…</button>
    </div>
    <div class="hint">Leave empty for the global default. Otherwise use the JDK root that contains <code>bin/java</code> (Linux/macOS) or <code>bin\\java.exe</code> (Windows)—e.g. macOS <code>jdk-11.jdk</code>, Linux <code>…/java-17-openjdk-amd64</code>, Windows <code>C:\\Program Files\\Java\\jdk-17</code>. On macOS, <code>Contents/Home</code> is resolved from <code>.jdk</code> bundles when needed.</div>
  </div>
  <div>
    <label for="mavenOverride">Maven home override (optional)</label>
    <div class="row">
      <input type="text" id="mavenOverride" placeholder="…/apache-maven-3.8.8 (install root)" />
      <button class="secondary" id="browse-maven" type="button">Browse…</button>
    </div>
    <div class="hint"><strong>Maven install root</strong> (<code>MAVEN_HOME</code>): folder with <code>bin/mvn</code> (macOS/Linux) or <code>bin\\mvn.cmd</code> (Windows)—typically the unpacked distribution (e.g. <code>…/Tools/apache-maven-3.8.8</code>). <em>No path rewriting</em> (only <code>path.resolve</code> + file check, unlike Java/macOS <code>.jdk</code>). Leave empty for the global default.
      <ul>
        <li><strong>macOS / Linux:</strong> e.g. <code>~/Development/Tools/apache-maven-3.8.8</code> or <code>/opt/apache-maven-3.9.6</code>.</li>
        <li><strong>Windows:</strong> e.g. <code>C:\\Tools\\apache-maven-3.9.6</code> (root with <code>bin\\mvn.cmd</code>).</li>
      </ul>
    </div>
  </div>
  <div>
    <label for="goals">Run (goals)</label>
    <input type="text" id="goals" placeholder="e.g. clean install" />
  </div>
  <div>
    <label for="cwd">Working directory</label>
    <div class="row">
      <input type="text" id="cwd" />
      <button class="secondary" id="browse-cwd" type="button">Browse…</button>
    </div>
  </div>
  <div>
    <label for="profiles">Profiles</label>
    <input type="text" id="profiles" placeholder="space-separated; use -name to disable" />
    <div class="hint">Separate with spaces. Prefix with - to disable a profile (maps to Maven !profile).</div>
  </div>
  <div class="actions">
    <button class="secondary" id="cancel" type="button">Cancel</button>
    <button id="save" type="button">Save</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let editingId = null;

    function setForm(payload) {
      const d = payload.defaults || {};
      document.getElementById('defaults').textContent =
        'Global defaults — Java: ' + (d.defaultJavaHome || '(not set)') + ' | Maven: ' + (d.defaultMavenHome || '(not set)');
      const existing = payload.existing;
      editingId = existing && existing.id ? existing.id : null;
      document.getElementById('name').value = existing ? existing.name : '';
      document.getElementById('javaOverride').value = existing && existing.javaHomeOverride ? existing.javaHomeOverride : '';
      document.getElementById('mavenOverride').value = existing && existing.mavenHomeOverride ? existing.mavenHomeOverride : '';
      document.getElementById('goals').value = existing ? existing.goals : '';
      document.getElementById('cwd').value = existing ? existing.workingDirectory : (payload.suggestedCwd || '');
      document.getElementById('profiles').value = existing ? existing.profiles : '';
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'init') {
        setForm(msg);
      }
      if (msg.type === 'browseResult' && msg.field && typeof msg.path === 'string') {
        const map = { javaOverride: 'javaOverride', mavenOverride: 'mavenOverride', cwd: 'cwd' };
        const id = map[msg.field];
        if (id) {
          document.getElementById(id).value = msg.path;
        }
      }
    });

    function browse(field) {
      vscode.postMessage({ type: 'browse', field });
    }
    document.getElementById('browse-java').addEventListener('click', () => browse('javaOverride'));
    document.getElementById('browse-maven').addEventListener('click', () => browse('mavenOverride'));
    document.getElementById('browse-cwd').addEventListener('click', () => browse('cwd'));

    document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));

    document.getElementById('save').addEventListener('click', () => {
      const name = document.getElementById('name').value.trim();
      const goals = document.getElementById('goals').value.trim();
      const cwd = document.getElementById('cwd').value.trim();
      const profiles = document.getElementById('profiles').value;
      const javaHomeOverride = document.getElementById('javaOverride').value.trim() || null;
      const mavenHomeOverride = document.getElementById('mavenOverride').value.trim() || null;
      vscode.postMessage({
        type: 'save',
        payload: {
          id: editingId,
          name,
          goals,
          workingDirectory: cwd,
          profiles,
          javaHomeOverride,
          mavenHomeOverride,
        },
      });
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

type EditorWebviewMessage = {
  type: string;
  field?: 'javaOverride' | 'mavenOverride' | 'cwd';
  path?: string;
  payload?: {
    id: string | null;
    name: string;
    goals: string;
    workingDirectory: string;
    profiles: string;
    javaHomeOverride: string | null;
    mavenHomeOverride: string | null;
  };
};

async function handleEditorWebviewMessage(
  message: EditorWebviewMessage,
  panel: vscode.WebviewPanel,
  storage: RunConfigStorage,
  existing: RunConfiguration | undefined,
  suggestedCwd: string
): Promise<void> {
  if (message.type === 'ready') {
    const defaults = readDefaultHomes();
    await panel.webview.postMessage({
      type: 'init',
      defaults: {
        defaultJavaHome: defaults.java,
        defaultMavenHome: defaults.maven,
      },
      existing,
      suggestedCwd,
    });
    return;
  }
  if (message.type === 'browse' && message.field) {
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select folder',
    });
    const picked = result?.[0]?.fsPath ?? '';
    await panel.webview.postMessage({ type: 'browseResult', field: message.field, path: picked });
    return;
  }
  if (message.type === 'cancel') {
    panel.dispose();
    return;
  }
  if (message.type === 'save' && message.payload) {
    const p = message.payload;
    if (!p.name) {
      await vscode.window.showErrorMessage('Name is required.');
      return;
    }
    if (!p.goals) {
      await vscode.window.showErrorMessage('Run (goals) is required.');
      return;
    }
    if (!p.workingDirectory) {
      await vscode.window.showErrorMessage('Working directory is required.');
      return;
    }
    const config: RunConfiguration = {
      id: p.id && p.id.length > 0 ? p.id : randomUUID(),
      name: p.name,
      goals: p.goals,
      workingDirectory: p.workingDirectory,
      profiles: p.profiles,
      javaHomeOverride: p.javaHomeOverride,
      mavenHomeOverride: p.mavenHomeOverride,
    };
    await storage.upsert(config);
    await storage.setSelectedId(config.id);
    panel.dispose();
  }
}

export function openRunConfigEditor(
  context: vscode.ExtensionContext,
  extensionUri: vscode.Uri,
  storage: RunConfigStorage,
  existing: RunConfiguration | undefined,
  onDone: () => void
): void {
  const panel = vscode.window.createWebviewPanel(
    'mavenRunConfigs.editor',
    existing ? 'Edit Run Configuration' : 'New Run Configuration',
    vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [extensionUri] }
  );

  const nonce = getNonce();
  panel.webview.html = getEditorHtml(panel.webview, nonce);

  const suggestedCwd =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

  panel.webview.onDidReceiveMessage(
    (message: EditorWebviewMessage) =>
      handleEditorWebviewMessage(message, panel, storage, existing, suggestedCwd),
    undefined,
    context.subscriptions
  );

  panel.onDidDispose(() => onDone(), null, context.subscriptions);
}
