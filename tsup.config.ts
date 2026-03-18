import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'function/blob-log-processor.ts'
  },
  format: ['cjs'],
  platform: 'node',
  target: 'node18',
  bundle: true,
  sourcemap: true,
  minify: false,
  clean: true,
  outDir: 'dist',
  dts: false,
  noExternal: [/@siteline\/core/, /@azure\/storage-blob/, /@azure\/identity/]
});
