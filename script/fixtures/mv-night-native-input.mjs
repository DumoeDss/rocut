import assert from "node:assert/strict";
import { readFile, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, join, resolve, relative } from "node:path";
export const nightHash = bytes => createHash("sha256").update(bytes).digest("hex");
export async function nightActual(path) {
    const stat = await lstat(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 16 * 1024 * 1024, "Actual bounded ordinary Night resource required: " + path);
    return readFile(path);
}
export async function nightInputs({ root, referenceRoot, mode, projectRoot, mincho700 }) {
    assert.ok(isAbsolute(root) && referenceRoot && isAbsolute(referenceRoot));
    assert.ok(["dedicated-native-fixtures", "actual-project-assets"].includes(mode));
    if (mode === "actual-project-assets") assert.ok(projectRoot && isAbsolute(projectRoot), "Explicit actual ROCUT_TEST_MV_PROJECT required; no fixture fallback");
    if (mode === "dedicated-native-fixtures") assert.ok(mincho700 && isAbsolute(mincho700), "Explicit pinned ROCUT_TEST_MV_MINCHO700 required; no weight substitution");
    const template = join(referenceRoot, "skills/vocaloid-style-mv/template");
    const ordinary = async (id, path, kind, mimeType, font) => {
        const bytes = await nightActual(path), sha256 = nightHash(bytes);
        return { resource: { id, kind, mimeType, byteLength: bytes.length, sha256, attachmentKey: "programmatic-sha256-" + sha256, ...(font ? { font } : {}) }, bytes: bytes.toString("base64") };
    };
    const source = async id => {
        const bytes = await nightActual(join(template, "engine", id));
        return { id, code: new TextDecoder("utf-8", { fatal: true }).decode(bytes), sha256: nightHash(bytes) };
    };
    const fontRoot = mode === "dedicated-native-fixtures" ? join(root, "apps/web/public/motion-text/fonts") : join(projectRoot, "engine/fonts");
    const fontDefinitions = mode === "dedicated-native-fixtures" ? [
        ["font/source/mincho800", join(fontRoot, "shippori-mincho-b1-extrabold.ttf"), "Shippori Mincho B1", 800, {}],
        ["font/source/mincho700", mincho700, "Shippori Mincho B1", 700, {}],
        ["font/source/dot400", join(fontRoot, "dot-gothic-16-regular.ttf"), "DotGothic16", 400, {}],
        ["font/source/noto-variable", join(fontRoot, "noto-serif-jp-variable.ttf"), "Noto Serif JP", 200, { wght: 200 }],
    ] : [
        ["font/source/mincho800", join(fontRoot, "ShipporiMinchoB1-ExtraBold.ttf"), "Shippori Mincho B1", 800, {}],
        ["font/source/mincho700", join(fontRoot, "ShipporiMinchoB1-Bold.ttf"), "Shippori Mincho B1", 700, {}],
        ["font/source/dot400", join(fontRoot, "DotGothic16-Regular.ttf"), "DotGothic16", 400, {}],
        ["font/source/noto-variable", join(fontRoot, "NotoSerifJP_wght_.ttf"), "Noto Serif JP", 200, { wght: 200 }],
    ];
    const fonts = await Promise.all(fontDefinitions.map(([id, path, family, weight, axes]) => ordinary(id, path, "font", "font/ttf", { family, weight, style: "normal", axes })));
    if (mode === "dedicated-native-fixtures") assert.equal(fonts.find(f => f.resource.id === "font/source/mincho700").resource.sha256, "d20f3981afb8bceda5fdf8f0fb29ba51eb21518644612ccd8a183e5bd433e25a", "True official static Mincho700 pin mismatch");
    const fontInstances = [
        { id: "font/mincho800", resourceId: "font/source/mincho800", weight: 800, axes: {} },
        { id: "font/mincho700", resourceId: "font/source/mincho700", weight: 700, axes: {} },
        { id: "font/dot400", resourceId: "font/source/dot400", weight: 400, axes: {} },
        ...[800, 700, 400].map(weight => ({ id: "font/noto" + weight, resourceId: "font/source/noto-variable", weight, axes: { wght: weight } })),
    ];
    const imageIds = ["assets/bg/bg_wetstreet.png", "assets/bg/bg_crossing_night.png", "assets/char/bust_sing.png", "assets/char/bust_calm.png", "assets/char/eyes_ecu.png", "assets/char/smile_dawn.png"];
    const images = mode === "actual-project-assets" ? await Promise.all(imageIds.map(id => ordinary(id, join(projectRoot, id), "image", "image/png"))) : [];
    const palettePath = "assets/style/palettes.json";
    const json = await nightActual(join(template, palettePath));
    const palettes = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json).replace(/^\uFEFF/, ""));
    assert.ok(Array.isArray(palettes.palettes));
    const lutImages = [];
    const lutBodies = [{ id: palettePath, kind: "analysis", mimeType: "application/json", bytes: json }];
    for (const palette of palettes.palettes) {
        for (const path of [palette.lut, palette.lut_duotone]) {
            assert.equal(typeof path, "string");
            const absolute = resolve(template, path), rel = relative(template, absolute);
            assert.ok(rel && !rel.startsWith("..") && !isAbsolute(rel));
            const bytes = await nightActual(absolute);
            lutImages.push({ path, resourceId: path, sha256: nightHash(bytes), bytes: bytes.toString("base64") });
            lutBodies.push({ id: path, kind: "image", mimeType: "image/png", bytes });
        }
    }
    let offset = 0;
    const byteLayout = lutBodies.map(({ id, bytes }) => { const part = { resourceId: id, offset, length: bytes.length }; offset += bytes.length; return part; });
    const resources = lutBodies.map(({ id, kind, mimeType, bytes }) => ({ id, kind, mimeType, byteLength: bytes.length, sha256: nightHash(bytes), attachmentKey: "programmatic-sha256-" + nightHash(bytes) }));
    return { mode, references: await Promise.all(["core/util.js", "core/draw.js", "scenes/night.js"].map(source)), main: await source("core/main.js"), gl: await source("core/gl.js"), fonts, fontInstances, images,
        lut: { palette: { resourceId: palettePath, bytes: json.toString("base64"), sha256: nightHash(json) }, images: lutImages,
            metadata: { settings: { paletteResource: palettePath, images: lutImages.map(({ path, resourceId }) => ({ path, resourceId })) }, resources, byteLayout } } };
}
