// Copyright (c) 2026 Siegfried-Thor Bolz. SPDX-License-Identifier: MIT

export interface RunConfiguration {
  id: string;
  name: string;
  goals: string;
  workingDirectory: string;
  profiles: string;
  javaHomeOverride?: string | null;
  mavenHomeOverride?: string | null;
}
