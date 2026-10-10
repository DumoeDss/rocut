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
      // The current private bundler build has no default init export and its
      // sync entry needs node:fs. Reuse the existing wasm()/TLA plugins: point
      // resolution at the real bundler entry so its relative binary import and
      // __wbindgen_start run exactly as generated.
      resolveId(id, importer) {
        if (id !== "opencut-wasm") return undefined;
        return this.resolve(entry, importer, { skipSelf: true }).then((resolved) => resolved?.id ?? entry);
      },
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
