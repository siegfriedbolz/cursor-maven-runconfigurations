// Copyright (c) 2026 Siegfried-Thor Bolz. SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import type { RunConfiguration } from './types';

/** Shared run configuration list; commit this file so teammates get the same definitions. */
export const RUN_CONFIG_FILE = 'maven-run-configurations.json';

const LEGACY_STORAGE_KEY_CONFIGS = 'mavenRunConfigs.runConfigurations.v1';
const STORAGE_KEY_SELECTED = 'mavenRunConfigs.selectedConfigurationId';

const FILE_VERSION = 1 as const;

type RunConfigsFileV1 = {
  version: typeof FILE_VERSION;
  configurations: RunConfiguration[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRunConfiguration(value: unknown): value is RunConfiguration {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.goals === 'string' &&
    typeof value.workingDirectory === 'string' &&
    typeof value.profiles === 'string' &&
    (value.javaHomeOverride === null ||
      value.javaHomeOverride === undefined ||
      typeof value.javaHomeOverride === 'string') &&
    (value.mavenHomeOverride === null ||
      value.mavenHomeOverride === undefined ||
      typeof value.mavenHomeOverride === 'string')
  );
}

function parseConfigurationsJson(text: string): RunConfiguration[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) {
    return parsed.filter(isRunConfiguration);
  }
  if (isRecord(parsed) && parsed.version === FILE_VERSION && Array.isArray(parsed.configurations)) {
    return parsed.configurations.filter(isRunConfiguration);
  }
  return [];
}

function serializeConfigurations(configs: RunConfiguration[]): string {
  const body: RunConfigsFileV1 = { version: FILE_VERSION, configurations: configs };
  return `${JSON.stringify(body, null, 2)}\n`;
}

export class RunConfigStorage implements vscode.Disposable {
  private configs: RunConfiguration[] = [];

  private watcher?: vscode.FileSystemWatcher;

  private onReload?: () => void | Promise<void>;

  constructor(private readonly context: vscode.ExtensionContext) {}

  dispose(): void {
    this.disposeWatcher();
  }

  private disposeWatcher(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
  }

  private getPrimaryFolder(): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.workspaceFolders?.[0];
  }

  getConfigFileUri(): vscode.Uri | undefined {
    const folder = this.getPrimaryFolder();
    if (!folder) {
      return undefined;
    }
    return vscode.Uri.joinPath(folder.uri, '.vscode', RUN_CONFIG_FILE);
  }

  getAll(): RunConfiguration[] {
    return this.configs;
  }

  getSelectedId(): string | undefined {
    return this.context.workspaceState.get<string>(STORAGE_KEY_SELECTED);
  }

  async setSelectedId(id: string | undefined): Promise<void> {
    await this.context.workspaceState.update(STORAGE_KEY_SELECTED, id);
  }

  /**
   * Load or migrate storage, then watch the config file for external edits (git pull, teammates).
   */
  async initialize(onReload?: () => void | Promise<void>): Promise<void> {
    this.onReload = onReload;
    this.disposeWatcher();

    const uri = this.getConfigFileUri();
    if (!uri) {
      this.configs = [];
      return;
    }

    await this.migrateFromWorkspaceStateIfNeeded(uri);
    await this.loadFromDisk(uri);
    this.registerWatcher(uri);
  }

  private async migrateFromWorkspaceStateIfNeeded(uri: vscode.Uri): Promise<void> {
    const legacy = this.context.workspaceState.get<unknown>(LEGACY_STORAGE_KEY_CONFIGS);
    if (!Array.isArray(legacy) || legacy.length === 0) {
      return;
    }
    let fileMissing = false;
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      fileMissing = true;
    }
    if (!fileMissing) {
      return;
    }
    const migrated = legacy.filter(isRunConfiguration);
    this.configs = migrated;
    await this.persistToDisk(uri);
    await this.context.workspaceState.update(LEGACY_STORAGE_KEY_CONFIGS, undefined);
  }

  private async loadFromDisk(uri: vscode.Uri): Promise<void> {
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      const text = new TextDecoder('utf-8').decode(raw);
      const parsed = parseConfigurationsJson(text);
      if (text.trim() && parsed.length === 0) {
        void vscode.window.showWarningMessage(
          `Maven Run Configs: "${RUN_CONFIG_FILE}" could not be parsed; using an empty list until the file is fixed.`
        );
      }
      this.configs = parsed;
    } catch (err) {
      if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') {
        this.configs = [];
        return;
      }
      void vscode.window.showErrorMessage(
        `Maven Run Configs: could not read "${RUN_CONFIG_FILE}": ${String(err)}`
      );
      this.configs = [];
    }
  }

  private registerWatcher(uri: vscode.Uri): void {
    const folder = this.getPrimaryFolder();
    if (!folder) {
      return;
    }
    const pattern = new vscode.RelativePattern(folder, `.vscode/${RUN_CONFIG_FILE}`);
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern, false, false, false);
    const reload = async () => {
      await this.loadFromDisk(uri);
      await Promise.resolve(this.onReload?.());
    };
    this.watcher.onDidChange(() => {
      void reload();
    });
    this.watcher.onDidCreate(() => {
      void reload();
    });
    this.watcher.onDidDelete(() => {
      this.configs = [];
      void Promise.resolve(this.onReload?.());
    });
  }

  private async ensureVscodeDirectory(workspaceRoot: vscode.Uri): Promise<void> {
    const vscodeDir = vscode.Uri.joinPath(workspaceRoot, '.vscode');
    try {
      await vscode.workspace.fs.stat(vscodeDir);
    } catch {
      await vscode.workspace.fs.createDirectory(vscodeDir);
    }
  }

  private async persistToDisk(uri: vscode.Uri): Promise<void> {
    const folder = this.getPrimaryFolder();
    if (!folder) {
      return;
    }
    await this.ensureVscodeDirectory(folder.uri);
    const data = new TextEncoder().encode(serializeConfigurations(this.configs));
    await vscode.workspace.fs.writeFile(uri, data);
  }

  private noWorkspaceMessage(): void {
    void vscode.window.showErrorMessage(
      'Maven Run Configs: open a folder in the workspace to save run configurations (.vscode/maven-run-configurations.json).'
    );
  }

  async upsert(config: RunConfiguration): Promise<RunConfiguration[]> {
    const uri = this.getConfigFileUri();
    if (!uri) {
      this.noWorkspaceMessage();
      return this.configs;
    }
    const all = [...this.configs];
    const idx = all.findIndex((c) => c.id === config.id);
    if (idx >= 0) {
      all[idx] = config;
    } else {
      all.push(config);
    }
    this.configs = all;
    try {
      await this.persistToDisk(uri);
    } catch (err) {
      void vscode.window.showErrorMessage(`Maven Run Configs: could not save: ${String(err)}`);
    }
    return this.configs;
  }

  async remove(id: string): Promise<RunConfiguration[]> {
    const uri = this.getConfigFileUri();
    if (!uri) {
      this.noWorkspaceMessage();
      return this.configs;
    }
    this.configs = this.configs.filter((c) => c.id !== id);
    try {
      await this.persistToDisk(uri);
    } catch (err) {
      void vscode.window.showErrorMessage(`Maven Run Configs: could not save: ${String(err)}`);
    }
    const selected = this.getSelectedId();
    if (selected === id) {
      await this.setSelectedId(this.configs[0]?.id);
    }
    return this.configs;
  }
}
