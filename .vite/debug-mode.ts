import type { Plugin } from 'vite';

const DEBUG_MODULE = `\0debug-mode`;
const LOCAL_DEBUG_MODULE = `\0local-debug-mode`;

export default function debugMode(): Plugin {
  return {
    name: 'debug-mode',
    resolveId(id) {
      switch (id) {
        case '@glimmer/env':
          return DEBUG_MODULE;
        case '@glimmer/local-debug-flags':
          return LOCAL_DEBUG_MODULE;
      }
    },
    load(id) {
      switch (id) {
        case DEBUG_MODULE:
          return `export const DEBUG = true;`;
        case LOCAL_DEBUG_MODULE:
          return `export const LOCAL_DEBUG = true;`;
      }
    },
  };
}
