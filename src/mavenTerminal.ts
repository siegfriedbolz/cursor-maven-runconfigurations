// Copyright (c) 2026 Siegfried-Thor Bolz. SPDX-License-Identifier: MIT

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { RunConfiguration } from './types';

function getMavenExecutableName(): string {
  return process.platform === 'win32' ? 'mvn.cmd' : 'mvn';
}

function javaBinaryName(): string {
  return process.platform === 'win32' ? 'java.exe' : 'java';
}

/** Bash/zsh single-quoted string literal. */
function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * macOS .jdk bundles need JAVA_HOME at …/Contents/Home, not the .jdk root.
 */
function normalizeJavaHome(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }
  const resolved = path.resolve(trimmed);
  const binJava = path.join(resolved, 'bin', javaBinaryName());
  if (fs.existsSync(binJava)) {
    return resolved;
  }
  if (process.platform === 'darwin') {
    const contentsHome = path.join(resolved, 'Contents', 'Home');
    const macJava = path.join(contentsHome, 'bin', 'java');
    if (fs.existsSync(macJava)) {
      return contentsHome;
    }
  }
  return resolved;
}

function buildProfilesArg(profilesText: string): string {
  const trimmed = profilesText.trim();
  if (!trimmed) {
    return '';
  }
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const parts: string[] = [];
  for (const t of tokens) {
    if (t.startsWith('-') && t.length > 1) {
      parts.push(`!${t.slice(1)}`);
    } else if (t.length > 0) {
      parts.push(t);
    }
  }
  if (parts.length === 0) {
    return '';
  }
  return `-P ${parts.join(',')}`;
}

function resolveHomes(
  config: RunConfiguration,
  defaults: { java: string; maven: string }
): { javaHome: string; mavenHome: string } | undefined {
  const javaHome = (config.javaHomeOverride?.trim() || defaults.java.trim()) || '';
  const mavenHome = (config.mavenHomeOverride?.trim() || defaults.maven.trim()) || '';
  if (!javaHome || !mavenHome) {
    return undefined;
  }
  return { javaHome, mavenHome };
}

export function readDefaultHomes(): { java: string; maven: string } {
  const cfg = vscode.workspace.getConfiguration('mavenRunConfigs');
  return {
    java: (cfg.get<string>('defaultJavaHome') ?? '').trim(),
    maven: (cfg.get<string>('defaultMavenHome') ?? '').trim(),
  };
}

function buildGoalsShellSegment(config: RunConfiguration): string {
  const goals = config.goals.trim();
  const profileArg = buildProfilesArg(config.profiles);
  return [goals, profileArg].filter((s) => s.length > 0).join(' ');
}

/**
 * Multi-line script written to a temp file so the integrated terminal is not fed a huge
 * one-line `( export … )` command (zsh/Cursor often truncate or mangle that).
 */
function buildPosixRunScriptFileBody(
  javaHome: string,
  mavenHome: string,
  mavenBin: string,
  mvnPath: string,
  config: RunConfiguration
): string {
  const pathKey = 'PATH';
  const prevPath = process.env[pathKey] ?? '';
  const pathValue = `${mavenBin}${path.delimiter}${prevPath}`;
  const mvn = shSingleQuote(mvnPath);
  const javaExe = shSingleQuote(path.join(javaHome, 'bin', 'java'));
  const goalsSegment = buildGoalsShellSegment(config);
  const javaLine = shSingleQuote(`JAVA_HOME=${javaHome}`);
  const mavenScriptLine = shSingleQuote(`Maven script: ${mvnPath}`);
  const mavenHomeLine = shSingleQuote(`MAVEN_HOME/M2_HOME: ${mavenHome}`);

  return [
    '#!/bin/sh',
    `export JAVA_HOME=${shSingleQuote(javaHome)}`,
    `export MAVEN_HOME=${shSingleQuote(mavenHome)}`,
    `export M2_HOME=${shSingleQuote(mavenHome)}`,
    `export ${pathKey}=${shSingleQuote(pathValue)}`,
    `printf '%s\\n' '--- Maven Run Configs ---'`,
    `printf '%s\\n' ${javaLine}`,
    `printf '%s\\n' ${mavenScriptLine}`,
    `printf '%s\\n' ${mavenHomeLine}`,
    `${javaExe} -version 2>&1 | head -n 5`,
    `${mvn} -version 2>&1 | head -n 8`,
    `${mvn} ${goalsSegment}`,
  ].join('\n');
}

function buildWindowsRunCommands(javaHome: string, mavenHome: string, mavenBin: string, mvnPath: string, config: RunConfiguration): string {
  const pathKey = 'Path';
  const prevPath = process.env[pathKey] ?? process.env.PATH ?? '';
  const pathValue = `${mavenBin}${path.delimiter}${prevPath}`;
  const javaExe = path.join(javaHome, 'bin', 'java.exe');
  const goalsSegment = buildGoalsShellSegment(config);
  const jh = javaHome.replace(/"/g, '""');
  const mh = mavenHome.replace(/"/g, '""');
  const pv = pathValue.replace(/"/g, '""');
  const mvnEsc = mvnPath.replace(/"/g, '""');
  const javaEsc = javaExe.replace(/"/g, '""');
  /** Run inside `cmd /c` so `setlocal` / `endlocal` do not permanently change the parent shell (e.g. PowerShell). */
  return [
    'cmd.exe /d /s /c',
    `"@echo off & setlocal & set \\"JAVA_HOME=${jh}\\" & set \\"MAVEN_HOME=${mh}\\" & set \\"M2_HOME=${mh}\\" & set \\"${pathKey}=${pv}\\" & echo --- Maven Run Configs --- & echo JAVA_HOME=%JAVA_HOME% & echo Maven: ${mvnEsc} & echo MAVEN_HOME=%MAVEN_HOME% & \\"${javaEsc}\\" -version & \\"${mvnEsc}\\" -version & \\"${mvnEsc}\\" ${goalsSegment} & endlocal"`,
  ].join(' ');
}

export async function runMavenConfiguration(config: RunConfiguration): Promise<void> {
  const defaults = readDefaultHomes();
  const homes = resolveHomes(config, defaults);
  const cwd = config.workingDirectory.trim() || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

  const showMissingHomes = async (): Promise<void> => {
    const msg =
      'Java and Maven paths are required. Set them in extension settings (Maven Run Configs: default Java/Maven home) or as overrides on this run configuration, then try Run again.';
    const t = vscode.window.createTerminal({ name: `Maven: ${config.name}` });
    t.show(true);
    t.sendText(
      `echo 'Maven Run Configs: missing Java and/or Maven path. Use the panel Settings button or edit this run configuration, then Run again.'`,
      true
    );
    await vscode.window.showErrorMessage(msg, 'Open Settings').then((choice) => {
      if (choice === 'Open Settings') {
        void vscode.commands.executeCommand('mavenRunConfigs.openGlobalDefaultsPanel');
      }
    });
  };

  if (!homes) {
    await showMissingHomes();
    return;
  }

  if (!cwd) {
    await vscode.window.showErrorMessage('Working directory is empty. Set it on the run configuration.');
    return;
  }
  if (!fs.existsSync(cwd)) {
    await vscode.window.showErrorMessage(`Working directory does not exist: ${cwd}`);
    return;
  }

  const javaHome = normalizeJavaHome(homes.javaHome);
  const javaBin = path.join(javaHome, 'bin', javaBinaryName());
  if (!fs.existsSync(javaBin)) {
    await vscode.window.showErrorMessage(
      `Java executable not found at "${javaBin}". On macOS, set JAVA_HOME to the JDK folder that contains bin/java (often …/jdk-11.jdk/Contents/Home).`
    );
    return;
  }

  const mavenHome = path.resolve(homes.mavenHome.trim());
  const mavenBin = path.join(mavenHome, 'bin');
  const mvnPath = path.join(mavenBin, getMavenExecutableName());
  if (!fs.existsSync(mvnPath)) {
    await vscode.window.showErrorMessage(
      `Maven executable not found at: ${mvnPath}. Set Maven home to the unpacked distribution root (folder with bin/mvn or bin/mvn.cmd), not the bin folder alone.`
    );
    return;
  }

  const terminal = vscode.window.createTerminal({
    name: `Maven: ${config.name}`,
    cwd,
  });
  terminal.show(true);

  if (process.platform === 'win32') {
    terminal.sendText(buildWindowsRunCommands(javaHome, mavenHome, mavenBin, mvnPath, config), true);
    return;
  }

  const body = buildPosixRunScriptFileBody(javaHome, mavenHome, mavenBin, mvnPath, config);
  const scriptPath = path.join(os.tmpdir(), `vscode-maven-run-${randomUUID()}.sh`);
  try {
    fs.writeFileSync(scriptPath, body, { encoding: 'utf8', mode: 0o600 });
  } catch (e) {
    await vscode.window.showErrorMessage(`Maven Run Configs: could not write temp script: ${String(e)}`);
    return;
  }
  const q = shSingleQuote(scriptPath);
  terminal.sendText(`sh ${q}; rm -f ${q}`, true);
}
