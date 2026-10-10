import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { lutCompiledCheckpoint, LUT_FROZEN_RUST } from "./mv-lut-atlas-native-identities.mjs";
import { nightActual, nightHash } from "./mv-night-native-input.mjs";
export const NIGHT_FROZEN_RUST = [
    ...LUT_FROZEN_RUST,
    "rust/crates/editor-api/src/mv_reference_post.rs",
    ...["owner", "budget", "protocol", "transport", "fonts"].map(name => "rust/crates/editor-api/src/mv_night_" + name + ".rs"),
    "rust/wasm/src/mv_night_owner.rs",
    ...["", "_model", "_math", "_canvas", "_fonts", "_prepare", "_fall", "_count", "_hud", "_producer"].map(suffix => "rust/crates/editor-api/src/mv_recipe/wet_floor" + suffix + ".rs"),
    ...["", "_model", "_math", "_canvas", "_fonts", "_geometry", "_art", "_draw", "_producer"].map(suffix => "rust/crates/editor-api/src/mv_recipe/train" + suffix + ".rs"),
];
export async function nightCompiledCheckpoint(options) {
    const compiled = await lutCompiledCheckpoint(options);
    const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readFile(join(options.directory, "source-manifest.json"))));
    const currentNightSources = [];
    for (const path of NIGHT_FROZEN_RUST) {
        const entry = manifest.entries.find(e => e.path === path);
        assert.ok(entry, "Fresh compiled Night input absent: " + path);
        assert.equal(nightHash(await nightActual(join(options.root, path))), entry.sha256, "Frozen Night input changed: " + path);
        currentNightSources.push(entry);
    }
    assert.ok(manifest.entries.some(e => e.path === "rust/crates/editor-api/src/mv_recipe/mod.rs"), "Compiled scene registration absent");
    return { ...compiled, currentNightSources, scope: "Entire immutable compiled snapshot + explicitly frozen Night/LUT/original-post Rust leaves; not current shared registries/whole-worktree green" };
}
