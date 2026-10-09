import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const scaffold = process.env.ROCUT_TEST_REMOTION_SCAFFOLD;
const toolchainDirectory = process.env.ROCUT_TEST_ENGINE_TOOLCHAIN;
const styleToolchainDirectory = process.env.ROCUT_TEST_STYLE_TOOLCHAIN;
if (!scaffold || !toolchainDirectory || !styleToolchainDirectory) throw Error("Configure real scaffold/engine/style toolchain paths for preset staging tests");
const { stageRocutPreset } = await import(pathToFileURL(join(scaffold, "scripts/stage-rocut-preset.mjs")).href);
const { portableStyleLock } = await import(pathToFileURL(join(scaffold, "scripts/rocut-preset-build.mjs")).href);
const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, "rocut-preset-staging-test-"));
afterAll(async () => {
  if (dirname(root) !== parent || !basename(root).startsWith("rocut-preset-staging-test-")) throw Error("Unsafe preset test cleanup");
  await rm(root, { recursive: true, force: true });
});
const stage = (compositionId: string, suffix: string, inputProps: Record<string, unknown> = {}) => stageRocutPreset({
  compositionId, outputDirectory: join(root, suffix), inputProps, toolchainDirectory, styleToolchainDirectory,
});
describe("Creator native preset staging", () => {
  test("uses original dynamic metadata and complete Tailwind/asset source archive", async () => {
    const inputProps = { prompt: "1234567890", typingSpeedMs: 100, videoWidth: 800, videoHeight: 600 };
    const result = await stage("ClaudeTyper", "claude", inputProps);
    expect(result.specification.width).toBe(800); expect(result.specification.height).toBe(600);
    expect(result.specification.durationFrames).toBe(45);
    expect(result.specification.inputProps).toEqual(inputProps);
    expect(result.specification.entryFile).toBe("src/index.ts");
    expect(result.specification.files).toContain("src/compositions/vendored-wechat/assets/mxz-avatar.jpg");
    expect(result.specification.files).toContain("_preset/style-lock.json");
    const css = await readFile(join(result.specification.sourceDirectory, "src/compositions/vendored-wechat/index.css"), "utf8");
    expect(css).not.toContain("@import"); expect(css).toContain(".flex{");
    expect(css).toContain(".absolute{"); expect(css).toContain("--tw-");
    const before = await readFile(join(scaffold!, "src/compositions/vendored-wechat/assets/mxz-avatar.jpg"));
    const archived = await readFile(join(result.specification.sourceDirectory, "src/compositions/vendored-wechat/assets/mxz-avatar.jpg"));
    expect(archived).toEqual(before);
    expect(JSON.parse(await readFile(result.specFile, "utf8"))).toEqual(result.specification);
    expect(result.styles.outputSha256).toMatch(/^[a-f0-9]{64}$/);
    const originalCss = await readFile(join(scaffold!, "src/compositions/vendored-wechat/index.css"), "utf8");
    expect(originalCss.trim()).toBe('@import "tailwindcss";');
  });
  test("does not overwrite an existing authored project", async () => {
    const result = await stage("ProceduralFish", "fish");
    const before = await readFile(result.specFile);
    await expect(stage("RulerProgress", "fish")).rejects.toThrow("already exists");
    expect(await readFile(result.specFile)).toEqual(before);
  });
  test("rejects unregistered presets and relative destinations", async () => {
    await expect(stage("NotARegisteredPreset", "unknown")).rejects.toThrow("Unknown registered preset");
    await expect(stageRocutPreset({ compositionId: "ClaudeTyper", outputDirectory: "relative", toolchainDirectory, styleToolchainDirectory })).rejects.toThrow("absolute");
  });
  test("archives a portable lock without registry credentials or machine paths", async () => {
    const privateToolchain = join(root, "private-style-toolchain"); await mkdir(privateToolchain);
    const originalLockBytes = await readFile(join(styleToolchainDirectory!, "package-lock.json"));
    const lock = JSON.parse(originalLockBytes.toString("utf8"));
    lock.name = "lock-probe-secret";
    lock.packages[""].resolved = "file:C:/private-lock-probe-path";
    for (const [name, entry] of Object.entries(lock.packages) as [string, Record<string, unknown>][]) if (name) {
      entry.resolved = "https://lock-probe-user:lock-probe-secret@registry.invalid/package.tgz?token=lock-probe-token";
      entry.localPath = "C:\\private-lock-probe-path\\cache";
    }
    const privateBytes = Buffer.from(JSON.stringify(lock));
    await writeFile(join(privateToolchain, "package-lock.json"), privateBytes);
    await copyFile(join(styleToolchainDirectory!, "package.json"), join(privateToolchain, "package.json"));
    const dependencyLink = join(privateToolchain, "node_modules");
    await symlink(join(styleToolchainDirectory!, "node_modules"), dependencyLink, "junction");
    try {
      const result = await stageRocutPreset({ compositionId: "ClaudeTyper", outputDirectory: join(root, "portable-lock"),
        toolchainDirectory, styleToolchainDirectory: privateToolchain });
      const portableText = await readFile(join(result.specification.sourceDirectory, "_preset/style-lock.json"), "utf8");
      const provenanceText = await readFile(join(result.specification.sourceDirectory, "_preset/styles.json"), "utf8");
      for (const archived of [portableText, provenanceText]) {
        expect(archived).not.toMatch(/lock-probe|registry\.invalid|https?:|file:|C:|resolved|localPath/);
        expect(archived).not.toContain(privateToolchain); expect(archived).not.toContain(styleToolchainDirectory!);
      }
      const portable = JSON.parse(portableText);
      const rawHash = createHash("sha256").update(privateBytes).digest("hex");
      expect(portable.version).toBe(1); expect(portable.sourceLockSha256).toBe(rawHash);
      expect(JSON.parse(provenanceText).lockSha256).toBe(rawHash);
      expect(portable.packages.length).toBe(Object.keys(lock.packages).length - 1);
      expect(portable.packages.map((item: { path: string }) => item.path)).toEqual(Object.keys(lock.packages).filter(Boolean).sort());
      for (const item of portable.packages) {
        expect(Object.keys(item).sort()).toEqual(["integrity", "path", "version"]);
        expect(item.version).toBe(lock.packages[item.path].version); expect(item.integrity).toBe(lock.packages[item.path].integrity);
      }
      expect(await readFile(join(styleToolchainDirectory!, "package-lock.json"))).toEqual(originalLockBytes);
      const clean = await stage("ClaudeTyper", "portable-lock-clean");
      expect(result.styles.outputSha256).toBe(clean.styles.outputSha256);
      expect(await readFile(join(result.specification.sourceDirectory, "src/compositions/vendored-wechat/index.css")))
        .toEqual(await readFile(join(clean.specification.sourceDirectory, "src/compositions/vendored-wechat/index.css")));
    } finally { await unlink(dependencyLink); }
  });
  test("rejects local/traversing package paths and invalid registry identity", () => {
    const entry = { version: "4.3.3", integrity: "sha512-" + Buffer.alloc(64, 7).toString("base64") };
    const encode = (name: string, value: unknown) => Buffer.from(JSON.stringify({ packages: { [name]: value } }));
    for (const name of ["C:/private/package", "../node_modules/package", "node_modules/../private", "node_modules//package", "node_modules\\package"])
      expect(() => portableStyleLock(encode(name, entry))).toThrow("portable");
    for (const value of [null, { ...entry, version: "file:C:/private/package" }, { ...entry, integrity: "sha512-short" }, { ...entry, integrity: undefined }])
      expect(() => portableStyleLock(encode("node_modules/package", value))).toThrow("portable");
  });
});
