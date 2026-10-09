import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { build, wasm, topLevelAwait } from "./browser-probe-toolchain.mjs";

/** Use one genuine initialized WASM in the entire browser module graph. */
export async function buildNativeAudioExportProbe(root, isolated, output, fixture = "native-audio-export-browser", { base = "/" } = {}) {
  const require = createRequire(join(root, "packages/editor-classic/package.json"));
  const entry = join(isolated, "opencut_wasm.js").replaceAll("\\", "/");
  await build({ root, base, configFile: false, logLevel: "error",
    plugins: [{ name: "native-audio-isolated-wasm", enforce: "pre",
      resolveId(id) { if (id === "opencut-wasm") return "\0native-audio-wasm"; },
      load(id) { if (id === "\0native-audio-wasm") return `import init from ${JSON.stringify(entry)}; await init(); export * from ${JSON.stringify(entry)};`; },
      generateBundle() {
        for (const id of this.getModuleIds()) if (/[/\\]node_modules[/\\]opencut-wasm[/\\]/.test(id))
          throw Error("Audio fixture resolved a shared stale WASM instead of its isolated build");
      },
    }, wasm(), topLevelAwait()],
    resolve: { alias: { mediabunny: join(dirname(require.resolve("mediabunny")), "../modules/src/index.js") } },
    build: { outDir: output, emptyOutDir: false, target: "esnext", reportCompressedSize: false,
      rollupOptions: { input: join(root, `script/fixtures/${fixture}.html`) } },
  });
}
