import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://mosstask.vercel.app',
  output: 'static',
  compressHTML: true,
});