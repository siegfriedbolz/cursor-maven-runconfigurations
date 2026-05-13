// Copyright (c) 2026 Siegfried-Thor Bolz. SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import { openGlobalDefaultsPanel } from './globalDefaultsPanel';
import { registerDefaultPathPickerCommands } from './defaultPathPickers';
import { RunConfigStorage } from './runConfigStorage';
import { RunConfigViewProvider } from './runConfigProvider';
import { runMavenConfiguration } from './mavenTerminal';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  registerDefaultPathPickerCommands(context);

  const storage = new RunConfigStorage(context);

  const provider = new RunConfigViewProvider(
    context,
    storage,
    context.extensionUri,
    (config) => runMavenConfiguration(config)
  );

  await storage.initialize(() => {
    provider.refresh();
  });

  context.subscriptions.push(
    storage,
    vscode.window.registerWebviewViewProvider(RunConfigViewProvider.viewType, provider),
    vscode.commands.registerCommand('mavenRunConfigs.openExtensionSettings', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`);
    }),
    vscode.commands.registerCommand('mavenRunConfigs.openGlobalDefaultsPanel', () => {
      openGlobalDefaultsPanel(context.extensionUri);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      await storage.initialize(() => {
        provider.refresh();
      });
      provider.refresh();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('mavenRunConfigs')) {
        provider.refresh();
      }
    })
  );
}

/** No cleanup required; subscriptions are disposed by VS Code. */
export function deactivate(): void {
  return;
}
