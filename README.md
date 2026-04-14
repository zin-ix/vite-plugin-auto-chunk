# vite-plugin-auto-chunk

A Vite plugin that **scans your actual `node_modules`** at build time, automatically splits any heavy packages into their own chunks, and hints at lazy-load opportunities in your router.

Works with **any framework** — Vue, React, Svelte, Solid, or plain JS/TS. No hardcoded package lists.

## Install

```bash
npm install -D vite-plugin-auto-chunk
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import autoChunk from 'vite-plugin-auto-chunk'

export default defineConfig({
  plugins: [
    autoChunk()
  ],
})
```

## Options

```ts
autoChunk({
  heavyThreshold: 100,      // KB - packages larger than this get their own chunk
  warnThreshold: 500,       // KB - warn in summary if chunk exceeds this
  extraVendors: ['my-lib'], // always split these regardless of size
  summary: true,            // print build summary table
  suppressAnnotations: true // suppress harmless annotation build warnings
})
```

## License

MIT
