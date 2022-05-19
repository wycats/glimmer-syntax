/// <reference types="node" />

import * as path from 'node:path';
import { searchForWorkspaceRoot } from 'vite';
import { defineConfig } from 'vitest/config';

import debugMode from './.vite/debug-mode.js';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@glimmer/syntax',
        replacement: path.resolve(process.cwd(), 'src', 'index.ts'),
      },
    ],
  },

  server: {
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
  },
  plugins: [debugMode()],

  test: {
    setupFiles: [path.resolve(process.cwd(), 'tests', 'framework', 'setup.ts')],
  },

  define: {
    'import.meta.vitest': false,
  },
});
