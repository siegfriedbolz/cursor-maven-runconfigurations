// Copyright (c) 2026 Siegfried-Thor Bolz. SPDX-License-Identifier: MIT

import * as vscode from 'vscode';

async function pickFolderAndUpdate(
  configKey: 'defaultJavaHome' | 'defaultMavenHome',
  openDialogTitle: string
): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: openDialogTitle,
  });
  const folder = picked?.[0];
  if (!folder) {
    return;
  }
  const config = vscode.workspace.getConfiguration('mavenRunConfigs');
  const inspection = config.inspect<string>(configKey);
  const target =
    inspection?.workspaceValue === undefined
      ? vscode.ConfigurationTarget.Global
      : vscode.ConfigurationTarget.Workspace;
  await config.update(configKey, folder.fsPath, target);
}

export function registerDefaultPathPickerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('mavenRunConfigs.pickDefaultJavaHome', () =>
      pickFolderAndUpdate('defaultJavaHome', 'Select JDK/JRE root (JAVA_HOME)')
    ),
    vscode.commands.registerCommand('mavenRunConfigs.pickDefaultMavenHome', () =>
      pickFolderAndUpdate('defaultMavenHome', 'Select Maven installation root')
    )
  );
}
