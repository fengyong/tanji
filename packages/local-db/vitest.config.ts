import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    server: {
      deps: {
        // node:sqlite 是 Node 22 内置模块,不能被 Vite 预打包
        external: ['node:sqlite'],
      },
    },
  },
});
