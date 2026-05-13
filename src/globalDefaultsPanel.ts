// Copyright (c) 2026 Siegfried-Thor Bolz. SPDX-License-Identifier: MIT

import * as vscode from 'vscode';

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function resolveDefaultsUpdateTarget(): vscode.ConfigurationTarget {
  const cfg = vscode.workspace.getConfiguration('mavenRunConfigs');
  const java = cfg.inspect<string>('defaultJavaHome');
  const maven = cfg.inspect<string>('defaultMavenHome');
  if (java?.workspaceValue !== undefined || maven?.workspaceValue !== undefined) {
    return vscode.ConfigurationTarget.Workspace;
  }
  return vscode.ConfigurationTarget.Global;
}

function getPanelHtml(webview: vscode.Webview, nonce: string): string {
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
  <title>Default Java / Maven</title>
  <style nonce="${nonce}">
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); margin: 0; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    h1 { font-size: 1.1em; font-weight: 600; margin: 0 0 4px 0; }
    label { font-weight: 600; display: block; margin-bottom: 4px; }
    input[type="text"] { width: 100%; box-sizing: border-box; padding: 4px 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
    .row { display: flex; gap: 6px; align-items: center; }
    .row input { flex: 1; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; margin-top: 8px; align-items: center; }
    .actions-left { margin-right: auto; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .hint { font-size: calc(var(--vscode-font-size) - 1px); opacity: 0.85; }
    .hint ul { margin: 4px 0 0 0; padding-left: 1.2em; }
    .hint li { margin: 2px 0; }
  </style>
</head>
<body>
  <h1>Default Java / Maven paths</h1>
  <p class="hint">Same as run configuration overrides: type a path or use Browse. Values are stored in User or Workspace settings (same target for both).</p>
  <div>
    <label for="java">Maven Run Configs: Default Java Home (JAVA_HOME)</label>
    <div class="row">
      <input type="text" id="java" placeholder="Folder with bin/java (or bin\\java.exe on Windows)" />
      <button class="secondary" id="browse-java" type="button">Browse…</button>
    </div>
    <div class="hint"><strong>Typical JAVA_HOME roots:</strong>
      <ul>
        <li><strong>macOS:</strong> JDK bundle (e.g. <code>…/jdk-11.jdk</code>); <code>Contents/Home</code> is applied when needed.</li>
        <li><strong>Linux:</strong> e.g. <code>/usr/lib/jvm/java-17-openjdk-amd64</code> (directory that contains <code>bin/java</code>; names vary).</li>
        <li><strong>Windows:</strong> e.g. <code>C:\\Program Files\\Java\\jdk-17</code> or Adoptium <code>…\\jdk-17.x-hotspot</code> (root with <code>bin\\java.exe</code>, not only <code>bin</code>).</li>
      </ul>
    </div>
  </div>
  <div>
    <label for="maven">Maven Run Configs: Default Maven Home</label>
    <div class="row">
      <input type="text" id="maven" placeholder="…/apache-maven-3.9.6 (folder with bin/mvn)" />
      <button class="secondary" id="browse-maven" type="button">Browse…</button>
    </div>
    <div class="hint"><strong>Maven install root</strong> (same as <code>MAVEN_HOME</code>): directory that contains <code>bin/mvn</code> (or <code>bin\\mvn.cmd</code> on Windows)—usually the unpacked archive, e.g. <code>…/Tools/apache-maven-3.8.8</code>. Not the <code>bin</code> folder alone. The extension only resolves the path and checks for <code>mvn</code> there—<em>no</em> extra detection (unlike macOS <code>.jdk</code> → <code>Contents/Home</code> for Java).
      <ul>
        <li><strong>macOS / Linux:</strong> e.g. <code>~/Tools/apache-maven-3.8.8</code> or <code>/opt/apache-maven-3.9.6</code>.</li>
        <li><strong>Windows:</strong> e.g. <code>C:\\Tools\\apache-maven-3.9.6</code> (root with <code>bin\\mvn.cmd</code>).</li>
      </ul>
    </div>
  </div>
  <div class="actions">
    <button class="secondary actions-left" id="open-full" type="button">Open Settings UI…</button>
    <button class="secondary" id="cancel" type="button">Cancel</button>
    <button id="save" type="button">Save</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'init') {
        document.getElementById('java').value = msg.defaultJavaHome || '';
        document.getElementById('maven').value = msg.defaultMavenHome || '';
      }
      if (msg.type === 'browseResult' && msg.field && typeof msg.path === 'string') {
        if (msg.field === 'java') document.getElementById('java').value = msg.path;
        if (msg.field === 'maven') document.getElementById('maven').value = msg.path;
      }
    });

    document.getElementById('browse-java').addEventListener('click', () =>
      vscode.postMessage({ type: 'browse', field: 'java' }));
    document.getElementById('browse-maven').addEventListener('click', () =>
      vscode.postMessage({ type: 'browse', field: 'maven' }));

    document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
    document.getElementById('open-full').addEventListener('click', () => vscode.postMessage({ type: 'openFullSettings' }));

    document.getElementById('save').addEventListener('click', () => {
      vscode.postMessage({
        type: 'save',
        defaultJavaHome: document.getElementById('java').value.trim(),
        defaultMavenHome: document.getElementById('maven').value.trim(),
      });
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

type GlobalDefaultsMessage =
  | { type: 'ready' }
  | { type: 'browse'; field: 'java' | 'maven' }
  | { type: 'save'; defaultJavaHome: string; defaultMavenHome: string }
  | { type: 'cancel' }
  | { type: 'openFullSettings' };

async function handleGlobalDefaultsMessage(
  message: GlobalDefaultsMessage,
  panel: vscode.WebviewPanel
): Promise<void> {
  if (message.type === 'ready') {
    const cfg = vscode.workspace.getConfiguration('mavenRunConfigs');
    await panel.webview.postMessage({
      type: 'init',
      defaultJavaHome: cfg.get<string>('defaultJavaHome') ?? '',
      defaultMavenHome: cfg.get<string>('defaultMavenHome') ?? '',
    });
    return;
  }
  if (message.type === 'browse' && message.field) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: message.field === 'java' ? 'Select JDK/JRE root' : 'Select Maven installation root',
    });
    const path = picked?.[0]?.fsPath ?? '';
    await panel.webview.postMessage({ type: 'browseResult', field: message.field, path });
    return;
  }
  if (message.type === 'openFullSettings') {
    await vscode.commands.executeCommand('mavenRunConfigs.openExtensionSettings');
    return;
  }
  if (message.type === 'cancel') {
    panel.dispose();
    return;
  }
  if (message.type === 'save') {
    const target = resolveDefaultsUpdateTarget();
    const cfg = vscode.workspace.getConfiguration('mavenRunConfigs');
    await cfg.update('defaultJavaHome', message.defaultJavaHome, target);
    await cfg.update('defaultMavenHome', message.defaultMavenHome, target);
    panel.dispose();
  }
}

export function openGlobalDefaultsPanel(extensionUri: vscode.Uri, onClosed?: () => void): void {
  const panel = vscode.window.createWebviewPanel(
    'mavenRunConfigs.globalDefaults',
    'Maven Run Configs — Default paths',
    vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [extensionUri] }
  );

  const nonce = getNonce();
  panel.webview.html = getPanelHtml(panel.webview, nonce);

  const sub = panel.webview.onDidReceiveMessage((msg: GlobalDefaultsMessage) =>
    handleGlobalDefaultsMessage(msg, panel)
  );

  panel.onDidDispose(() => {
    sub.dispose();
    onClosed?.();
  });
}
