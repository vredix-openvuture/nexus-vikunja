/* Bundles src/ into the single main.js Obsidian loads. CommonJS throughout;
   `obsidian` is provided by the app at runtime. */
import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: { main: 'src/main.js' },
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2018',
  outdir: '.',
  external: ['obsidian'],
  logLevel: 'info',
});
