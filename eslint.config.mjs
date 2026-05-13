// Copyright (c) 2026 Siegfried-Thor Bolz. SPDX-License-Identifier: MIT

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const tsconfigRootDir =
  import.meta.dirname === undefined
    ? dirname(fileURLToPath(import.meta.url))
    : import.meta.dirname;

export default defineConfig(
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', '**/*.map', '.vscode-test/**', '*.vsix'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-debugger': 'error',
      'prefer-const': 'warn',
      'no-var': 'error',
    },
  }
);
