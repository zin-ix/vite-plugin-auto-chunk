// src/index.ts
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";
var ECOSYSTEM_GROUPS = {
  "vendor-vue": ["vue", "vue-router", "pinia", "@vueuse", "@vue/"],
  "vendor-react": ["react", "react-dom", "react-router", "react-query", "zustand", "jotai", "recoil"],
  "vendor-svelte": ["svelte", "@sveltejs"],
  "vendor-solid": ["solid-js", "@solidjs"]
};
function getDirSize(dirPath) {
  let total = 0;
  try {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      const full = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        total += getDirSize(full);
      } else if (entry.isFile()) {
        try {
          total += statSync(full).size;
        } catch {
        }
      }
    }
  } catch {
  }
  return total;
}
function measureNodeModules(root) {
  const sizes = /* @__PURE__ */ new Map();
  const nmPath = resolve(root, "node_modules");
  if (!existsSync(nmPath)) return sizes;
  try {
    for (const entry of readdirSync(nmPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith("@")) {
        const scopePath = join(nmPath, entry.name);
        try {
          for (const scoped of readdirSync(scopePath, { withFileTypes: true })) {
            if (!scoped.isDirectory()) continue;
            const pkgName = `${entry.name}/${scoped.name}`;
            const pkgPath = join(scopePath, scoped.name);
            const pkgJsonPath = join(pkgPath, "package.json");
            if (existsSync(pkgJsonPath)) {
              sizes.set(pkgName, getDirSize(pkgPath));
            }
          }
        } catch {
        }
      } else {
        const pkgPath = join(nmPath, entry.name);
        const pkgJsonPath = join(pkgPath, "package.json");
        if (existsSync(pkgJsonPath)) {
          sizes.set(entry.name, getDirSize(pkgPath));
        }
      }
    }
  } catch {
  }
  return sizes;
}
function buildUserChunkMap(manualChunks) {
  const map = /* @__PURE__ */ new Map();
  if (!manualChunks) return map;
  for (const [chunkName, pkgs] of Object.entries(manualChunks)) {
    for (const pkg of pkgs) {
      map.set(pkg, chunkName);
    }
  }
  return map;
}
function buildChunkMap(root, heavyThresholdKB, extraVendors) {
  const chunkMap = /* @__PURE__ */ new Map();
  const sizes = measureNodeModules(root);
  for (const [pkg, bytes] of sizes.entries()) {
    const kb = bytes / 1024;
    if (extraVendors.some((e) => pkg === e || pkg.startsWith(e + "/"))) {
      const safeName = pkg.replace("@", "").replace("/", "-");
      chunkMap.set(pkg, `vendor-${safeName}`);
      continue;
    }
    let grouped = false;
    for (const [group, prefixes] of Object.entries(ECOSYSTEM_GROUPS)) {
      if (prefixes.some((p) => pkg === p || pkg.startsWith(p))) {
        chunkMap.set(pkg, group);
        grouped = true;
        break;
      }
    }
    if (grouped) continue;
    if (kb >= heavyThresholdKB) {
      const safeName = pkg.replace("@", "").replace("/", "-");
      chunkMap.set(pkg, `vendor-${safeName}`);
    }
  }
  return chunkMap;
}
function resolveChunk(id, autoMap, userMap) {
  if (!id.includes("node_modules")) return void 0;
  const nmIndex = id.lastIndexOf("node_modules/");
  const afterNm = id.slice(nmIndex + "node_modules/".length);
  const pkg = afterNm.startsWith("@") ? afterNm.split("/").slice(0, 2).join("/") : afterNm.split("/")[0];
  if (userMap.has(pkg)) {
    return userMap.get(pkg);
  }
  if (autoMap.has(pkg)) {
    return autoMap.get(pkg);
  }
  for (const [key, chunk] of autoMap.entries()) {
    const isMatch = pkg === key || pkg.startsWith(key + "/");
    if (isMatch) return chunk;
  }
  return "vendor-misc";
}
function detectStaticRoutes(root) {
  const candidates = [
    "src/router/index.ts",
    "src/router/index.js",
    "src/router.ts",
    "src/router.js",
    "src/routes/index.ts",
    "src/routes/index.js"
  ];
  for (const rel of candidates) {
    const file = resolve(root, rel);
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf8");
    const total = (content.match(/component:/g) ?? []).length;
    const lazy = (content.match(/component:\s*\(\)\s*=>/g) ?? []).length;
    const staticCount = total - lazy;
    if (staticCount > 0) {
      return [
        `${staticCount} of ${total} route(s) use static imports in ${rel}.`,
        `Convert to lazy: component: () => import('./YourView.vue')`
      ];
    }
  }
  return [];
}
function formatKB(bytes) {
  return (bytes / 1024).toFixed(1) + " kB";
}
function autoChunk(options = {}) {
  const {
    heavyThreshold = 100,
    warnThreshold = 500,
    extraVendors = [],
    summary = true,
    suppressAnnotations = true,
    manualChunks: userManualChunks
  } = options;
  let projectRoot = process.cwd();
  let autoMap = /* @__PURE__ */ new Map();
  let userMap = /* @__PURE__ */ new Map();
  const chunkSizes = {};
  return {
    name: "vite-plugin-auto-chunk",
    enforce: "pre",
    configResolved(config) {
      projectRoot = config.root;
    },
    config(existingConfig) {
      const output = existingConfig.build?.rollupOptions?.output;
      const hasManualChunks = output && !Array.isArray(output) && typeof output === "object" && "manualChunks" in output;
      const userChunksFromVite = hasManualChunks && typeof output.manualChunks === "object" ? output.manualChunks : void 0;
      userMap = buildUserChunkMap(userChunksFromVite || userManualChunks);
      autoMap = buildChunkMap(projectRoot, heavyThreshold, extraVendors);
      const mergedManualChunks = (id) => resolveChunk(id, autoMap, userMap);
      return {
        build: {
          chunkSizeWarningLimit: warnThreshold,
          rollupOptions: {
            output: {
              manualChunks: mergedManualChunks
            }
          }
        }
      };
    },
    buildStart() {
      const hints = detectStaticRoutes(projectRoot);
      if (hints.length) {
        console.log("[auto-chunk] Lazy-load hint:");
        hints.forEach((h) => console.log(" ", h));
        console.log();
      }
    },
    onLog(level, log) {
      if (suppressAnnotations && level === "warn" && typeof log.message === "string" && log.message.includes("annotation") && log.message.includes("cannot interpret")) {
        return false;
      }
    },
    generateBundle(_opts, bundle) {
      if (!summary) return;
      for (const [name, chunk] of Object.entries(bundle)) {
        const c = chunk;
        if (c.type === "chunk" && typeof c.code === "string") {
          chunkSizes[name] = Buffer.byteLength(c.code, "utf8");
        }
      }
    },
    closeBundle() {
      if (!summary || !Object.keys(chunkSizes).length) return;
      const sorted = Object.entries(chunkSizes).sort((a, b) => b[1] - a[1]);
      const total = sorted.reduce((s, [, n]) => s + n, 0);
      const over = sorted.filter(([, n]) => n > warnThreshold * 1024);
      console.log("\n+------------------------------------------+------------+");
      console.log("|        auto-chunk - build summary        |            |");
      console.log("+------------------------------------------+------------+");
      console.log("| Chunk                                    | Size       |");
      console.log("+------------------------------------------+------------+");
      for (const [name, size] of sorted.slice(0, 15)) {
        const flag = size > warnThreshold * 1024 ? "! " : "  ";
        console.log(`| ${flag}${name.padEnd(40).slice(0, 40)}| ${formatKB(size).padEnd(10)} |`);
      }
      if (sorted.length > 15) {
        console.log(`|   ... ${sorted.length - 15} more chunks                      |            |`);
      }
      console.log("+------------------------------------------+------------+");
      console.log(`| Total                                    | ${formatKB(total).padEnd(10)} |`);
      console.log(`| Over limit chunks: ${String(over.length).padEnd(15)}           |`);
      console.log("+------------------------------------------+------------+\n");
    }
  };
}
var index_default = autoChunk;
export {
  autoChunk,
  index_default as default
};
