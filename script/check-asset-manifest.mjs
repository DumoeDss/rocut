#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(SCRIPT), "..");
const DEFAULT_MANIFEST = join(REPO_ROOT, "apps", "vite-example", "dist", "asset-manifest.json");
const WEB_PUBLIC_ROOT = join(REPO_ROOT, "apps", "web", "public");
// Deliberately independent of the Vite plugin's EDITOR_RUNTIME_ASSETS. If the
// producer drops or adds a copied path, this checker must not silently agree
// just because it consumed the producer's manifest as its own oracle.
const INDEPENDENT_COPIED_ALLOWLIST = [
	{ path: "fonts", kind: "directory" },
	{ path: "flags", kind: "directory" },
	{ path: "effects/preview.jpg", kind: "file" },
	{ path: "logos/opencut", kind: "directory" },
	{ path: "favicon.ico", kind: "file" },
	{ path: "workers/c4-worker-fixture.js", kind: "file" },
];
const REQUIRED_EMITTED = [
	"entry",
	"editor-wasm",
	"transcription-worker",
	"ort-sidecar",
];
const EXCLUSION_PROBES = [
	"shapes/circle.svg",
	"platform-guides/x.png",
	"open-graph/default.jpg",
	"landing-page-dark.png",
	"manifest.json",
];

function digest(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

function mimeMatches(actual, expected) {
	return expected.split("|").includes(actual);
}

function option(name, fallback) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : fallback;
}

function normalizedPublicBase(value) {
	const clean = `/${String(value || "/").replace(/^\/+|\/+$/g, "")}`;
	return clean === "/" ? "/" : `${clean}/`;
}

function summedBytes(files) {
	return files.reduce((sum, file) => sum + file.bytes, 0);
}

function duplicatePaths(files) {
	const seen = new Set();
	const duplicates = new Set();
	for (const file of files) {
		if (seen.has(file.path)) duplicates.add(file.path);
		seen.add(file.path);
	}
	return duplicates;
}

function compareCopiedPaths(actualPaths, expectedPaths, source) {
	const failures = [];
	for (const path of expectedPaths) {
		if (!actualPaths.has(path)) {
			failures.push({
				rule: `copied-${source}-missing`,
				path,
				why: `independent ${source} contains a copied path omitted by the manifest`,
			});
		}
	}
	for (const path of actualPaths) {
		if (!expectedPaths.has(path)) {
			failures.push({
				rule: `copied-${source}-unexpected`,
				path,
				why: `manifest contains a copied path absent from the independent ${source}`,
			});
		}
	}
	return failures;
}

function listFiles(root) {
	let stat;
	try {
		stat = statSync(root);
	} catch {
		return [];
	}
	if (!stat.isDirectory()) return [root];
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory() ? listFiles(join(root, entry.name)) : [join(root, entry.name)],
	);
}

function enumerateIndependentCopiedPaths(root) {
	const paths = new Set();
	const missing = [];
	for (const asset of INDEPENDENT_COPIED_ALLOWLIST) {
		const assetRoot = resolve(root, asset.path);
		const files =
			asset.kind === "directory"
				? listFiles(assetRoot)
				: existsSync(assetRoot)
					? [assetRoot]
					: [];
		if (files.length === 0) missing.push(asset.path);
		for (const file of files) {
			paths.add(relative(root, file).split("\\").join("/"));
		}
	}
	return { paths, missing };
}

function validateManifest(manifest, expectations = {}) {
	const failures = [];
	if (expectations.marker && manifest.build?.marker !== expectations.marker) {
		failures.push({
			rule: "stale-build-marker",
			path: "build.marker",
			why: `expected ${expectations.marker}, recorded ${manifest.build?.marker ?? "<missing>"}`,
		});
	}
	if (
		expectations.publicBase &&
		normalizedPublicBase(manifest.build?.base) !== normalizedPublicBase(expectations.publicBase)
	) {
		failures.push({
			rule: "wrong-public-base",
			path: "build.base",
			why: `expected ${normalizedPublicBase(expectations.publicBase)}, recorded ${manifest.build?.base ?? "<missing>"}`,
		});
	}
	if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
		failures.push({ rule: "empty-copied-inventory", path: "files" });
		return failures;
	}
	if (!Array.isArray(manifest.requiredCategories) || manifest.requiredCategories.length === 0) {
		failures.push({ rule: "empty-required-categories", path: "requiredCategories" });
	}
	const categories = new Set(manifest.files.map((file) => file.category));
	for (const category of manifest.requiredCategories ?? []) {
		if (!categories.has(category)) {
			failures.push({ rule: "missing-category", path: category });
		}
	}
	for (const file of manifest.files) {
		if (!file.path || file.path.startsWith("/")) {
			failures.push({ rule: "non-logical-path", path: file.path || "<empty>" });
		}
		for (const field of ["category", "expectedMime", "sourcePath", "requiredBy", "sha256"]) {
			if (!file[field]) failures.push({ rule: `missing-field:${field}`, path: file.path });
		}
		if (!Number.isInteger(file.bytes) || file.bytes <= 0) {
			failures.push({ rule: "invalid-byte-length", path: file.path });
		}
	}
	for (const path of duplicatePaths(manifest.files)) {
		failures.push({
			rule: "duplicate-copied-path",
			path,
			why: "copied logical paths must occur exactly once",
		});
	}
	if (manifest.fileCount !== manifest.files.length) {
		failures.push({
			rule: "copied-file-count-mismatch",
			path: "fileCount",
			why: `recorded ${manifest.fileCount ?? "<missing>"}, enumerated ${manifest.files.length}`,
		});
	}
	const copiedBytes = summedBytes(manifest.files);
	if (manifest.totalBytes !== copiedBytes) {
		failures.push({
			rule: "copied-total-bytes-mismatch",
			path: "totalBytes",
			why: `recorded ${manifest.totalBytes ?? "<missing>"}, summed ${copiedBytes}`,
		});
	}
	const copiedPaths = new Set(manifest.files.map((file) => file.path));
	if (expectations.allowlistPaths) {
		failures.push(...compareCopiedPaths(copiedPaths, expectations.allowlistPaths, "allowlist"));
	}
	if (expectations.outputPaths) {
		failures.push(...compareCopiedPaths(copiedPaths, expectations.outputPaths, "output"));
	}
	if (!manifest.emitted?.files?.length) {
		failures.push({ rule: "empty-emitted-graph", path: "emitted.files" });
	} else {
		const classifications = new Set(
			manifest.emitted.files.map((file) => file.classification),
		);
		for (const layer of REQUIRED_EMITTED) {
			if (!classifications.has(layer)) {
				failures.push({ rule: "missing-emitted-layer", path: layer });
			}
		}
		for (const file of manifest.emitted.files) {
			if (!file.path || file.path.startsWith("/")) {
				failures.push({ rule: "non-logical-emitted-path", path: file.path || "<empty>" });
			}
			for (const field of ["kind", "classification", "expectedMime", "sha256"]) {
				if (!file[field]) failures.push({ rule: `missing-emitted-field:${field}`, path: file.path });
			}
			if (!Number.isInteger(file.bytes) || file.bytes <= 0) {
				failures.push({ rule: "invalid-emitted-byte-length", path: file.path });
			}
		}
		for (const path of duplicatePaths(manifest.emitted.files)) {
			failures.push({
				rule: "duplicate-emitted-path",
				path,
				why: "emitted logical paths must occur exactly once",
			});
		}
		if (manifest.emitted.fileCount !== manifest.emitted.files.length) {
			failures.push({
				rule: "emitted-file-count-mismatch",
				path: "emitted.fileCount",
				why: `recorded ${manifest.emitted.fileCount ?? "<missing>"}, enumerated ${manifest.emitted.files.length}`,
			});
		}
		const emittedBytes = summedBytes(manifest.emitted.files);
		if (manifest.emitted.totalBytes !== emittedBytes) {
			failures.push({
				rule: "emitted-total-bytes-mismatch",
				path: "emitted.totalBytes",
				why: `recorded ${manifest.emitted.totalBytes ?? "<missing>"}, summed ${emittedBytes}`,
			});
		}
	}
	return failures;
}

function validateResponse(file, result) {
	if (result.status !== 200) {
		return { rule: "missing-file", path: file.path, why: `status ${result.status}` };
	}
	if (result.contentType === "text/html" && file.expectedMime !== "text/html") {
		return { rule: "html-fallback", path: file.path, why: "served HTML instead of the asset" };
	}
	if (!mimeMatches(result.contentType, file.expectedMime)) {
		return {
			rule: "wrong-mime",
			path: file.path,
			why: `expected ${file.expectedMime}, served ${result.contentType || "<missing>"}`,
		};
	}
	if (result.bytes.byteLength !== file.bytes) {
		return {
			rule: "wrong-byte-length",
			path: file.path,
			why: `expected ${file.bytes}, served ${result.bytes.byteLength}`,
		};
	}
	const actualHash = digest(result.bytes);
	if (actualHash !== file.sha256) {
		return {
			rule: "wrong-sha256",
			path: file.path,
			why: `expected ${file.sha256}, served ${actualHash}`,
		};
	}
	return null;
}

function fixtureManifest() {
	const bytes = Buffer.from("fixture");
	const categories = ["fonts", "flags", "effects", "branding", "favicon", "worker-fixture"];
	const manifest = {
		requiredCategories: categories,
		files: categories.map((category) => ({
			path: `${category}/fixture.bin`,
			category,
			expectedMime: "application/octet-stream",
			bytes: bytes.byteLength,
			sha256: digest(bytes),
			sourcePath: `fixture/${category}.bin`,
			requiredBy: "negative control",
		})),
		emitted: {
			files: REQUIRED_EMITTED.map((classification) => ({
				path: `${classification}.bin`,
				kind: "asset",
				classification,
				expectedMime: "application/octet-stream",
				bytes: bytes.byteLength,
				sha256: digest(bytes),
			})),
		},
	};
	refreshFixtureTotals(manifest);
	return manifest;
}

function refreshFixtureTotals(manifest) {
	manifest.fileCount = manifest.files.length;
	manifest.totalBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
	manifest.emitted.fileCount = manifest.emitted.files.length;
	manifest.emitted.totalBytes = manifest.emitted.files.reduce(
		(sum, file) => sum + file.bytes,
		0,
	);
}

function runFixture(name) {
	const manifest = fixtureManifest();
	manifest.build = { marker: "fixture-marker", base: "/fixture/" };
	const file = manifest.files[0];
	const allowlistPaths = new Set(manifest.files.map((entry) => entry.path));
	const outputPaths = new Set(allowlistPaths);
	let failures = [];
	if (name === "valid-manifest") {
		failures = validateManifest(manifest, { allowlistPaths, outputPaths });
		if (failures.length === 0) {
			console.log("valid manifest passed");
			process.exit(0);
		}
	} else if (name === "html-fallback") {
		failures = [validateResponse(file, { status: 200, contentType: "text/html", bytes: Buffer.from("fixture") })];
	} else if (name === "wrong-hash") {
		const altered = Buffer.from("altered");
		const sameLength = Buffer.concat([altered, Buffer.alloc(Math.max(0, file.bytes - altered.byteLength))]).subarray(0, file.bytes);
		failures = [validateResponse(file, { status: 200, contentType: file.expectedMime, bytes: sameLength })];
	} else if (name === "missing-file") {
		failures = [validateResponse(file, { status: 404, contentType: "text/html", bytes: Buffer.alloc(0) })];
	} else if (name === "truncated-category") {
		manifest.files = manifest.files.filter((entry) => entry.category !== "effects");
		failures = validateManifest(manifest);
	} else if (name === "single-item-deletion") {
		const secondFont = { ...file, path: "fonts/second.bin" };
		manifest.files.push(secondFont);
		allowlistPaths.add(secondFont.path);
		outputPaths.add(secondFont.path);
		manifest.files = manifest.files.filter((entry) => entry.path !== file.path);
		refreshFixtureTotals(manifest);
		failures = validateManifest(manifest, { allowlistPaths, outputPaths });
	} else if (name === "duplicate-logical-path") {
		manifest.files.push({ ...file });
		refreshFixtureTotals(manifest);
		failures = validateManifest(manifest, { allowlistPaths, outputPaths });
	} else if (name === "duplicate-emitted-path") {
		manifest.emitted.files.push({ ...manifest.emitted.files[0] });
		refreshFixtureTotals(manifest);
		failures = validateManifest(manifest, { allowlistPaths, outputPaths });
	} else if (name === "stale-copied-count") {
		manifest.fileCount += 1;
		failures = validateManifest(manifest, { allowlistPaths, outputPaths });
	} else if (name === "stale-copied-bytes") {
		manifest.totalBytes += 1;
		failures = validateManifest(manifest, { allowlistPaths, outputPaths });
	} else if (name === "stale-emitted-count") {
		manifest.emitted.fileCount += 1;
		failures = validateManifest(manifest, { allowlistPaths, outputPaths });
	} else if (name === "stale-emitted-bytes") {
		manifest.emitted.totalBytes += 1;
		failures = validateManifest(manifest, { allowlistPaths, outputPaths });
	} else if (name === "allowlist-mismatch") {
		allowlistPaths.add("fonts/independent-extra.bin");
		failures = validateManifest(manifest, { allowlistPaths, outputPaths });
	} else if (name === "output-mismatch") {
		outputPaths.delete(file.path);
		failures = validateManifest(manifest, { allowlistPaths, outputPaths });
	} else if (name === "empty-emitted") {
		manifest.emitted.files = [];
		failures = validateManifest(manifest);
	} else if (name === "stale-marker") {
		failures = validateManifest(manifest, { marker: "fresh-marker" });
	} else if (name === "wrong-base") {
		failures = validateManifest(manifest, { publicBase: "/fresh-base/" });
	} else if (name === "served-manifest-mismatch") {
		failures = [
			validateServedManifest({
				localBytes: Buffer.from("local-manifest"),
				servedBytes: Buffer.from("stale-manifest"),
			}),
		];
	} else {
		console.error(`unknown negative fixture: ${name}`);
		process.exit(2);
	}
	const failure = failures.find(Boolean);
	if (!failure) {
		console.log(`fixture unexpectedly passed: ${name}`);
		process.exit(0);
	}
	console.error(`[${failure.rule}] ${failure.path}: ${failure.why ?? name}`);
	process.exit(1);
}

function runNegativeControl() {
	const fixtures = [
		["html-fallback", "html-fallback"],
		["wrong-hash", "wrong-sha256"],
		["missing-file", "missing-file"],
		["truncated-category", "missing-category"],
		["single-item-deletion", "copied-allowlist-missing"],
		["duplicate-logical-path", "duplicate-copied-path"],
		["duplicate-emitted-path", "duplicate-emitted-path"],
		["stale-copied-count", "copied-file-count-mismatch"],
		["stale-copied-bytes", "copied-total-bytes-mismatch"],
		["stale-emitted-count", "emitted-file-count-mismatch"],
		["stale-emitted-bytes", "emitted-total-bytes-mismatch"],
		["allowlist-mismatch", "copied-allowlist-missing"],
		["output-mismatch", "copied-output-unexpected"],
		["empty-emitted", "empty-emitted-graph"],
		["stale-marker", "stale-build-marker"],
		["wrong-base", "wrong-public-base"],
		["served-manifest-mismatch", "served-manifest-mismatch"],
	];
	console.log("check-asset-manifest: negative control");
	const positive = spawnSync(process.execPath, [SCRIPT, "--fixture", "valid-manifest"], {
		encoding: "utf8",
	});
	let failed = positive.status !== 0;
	console.log(`  ${positive.status === 0 ? "PASS" : "FAIL"} valid-manifest: legal manifest passes`);
	for (const [name, rule] of fixtures) {
		const result = spawnSync(process.execPath, [SCRIPT, "--fixture", name], {
			encoding: "utf8",
		});
		const output = `${result.stdout}${result.stderr}`;
		const passed = result.status !== 0 && output.includes(`[${rule}]`);
		console.log(`  ${passed ? "PASS" : "FAIL"} ${name}: non-zero and named ${rule}`);
		failed ||= !passed;
	}
	if (failed) process.exit(1);
	console.log("negative control clean — corrupt/fallback/truncated fixtures all fail closed.");
}

async function fetchAsset(base, path) {
	const url = new URL(path, base);
	const response = await fetch(url, { redirect: "manual" });
	return {
		url: url.toString(),
		status: response.status,
		contentType: (response.headers.get("content-type") ?? "").split(";", 1)[0].trim(),
		bytes: Buffer.from(await response.arrayBuffer()),
	};
}

function validateServedManifest({ localBytes, servedBytes }) {
	if (
		localBytes.byteLength !== servedBytes.byteLength ||
		digest(localBytes) !== digest(servedBytes)
	) {
		return {
			rule: "served-manifest-mismatch",
			path: "asset-manifest.json",
			why: `local ${localBytes.byteLength}/${digest(localBytes)}, served ${servedBytes.byteLength}/${digest(servedBytes)}`,
		};
	}
	return null;
}

async function runCheck() {
	const manifestPath = resolve(REPO_ROOT, option("--manifest", DEFAULT_MANIFEST));
	if (!existsSync(manifestPath)) {
		console.error(`check-asset-manifest: no manifest at ${manifestPath}`);
		process.exit(2);
	}
	const positionalBase = process.argv[2]?.startsWith("http") ? process.argv[2] : undefined;
	const base = new URL(option("--base", positionalBase ?? "http://127.0.0.1:4173/"));
	if (!base.pathname.endsWith("/")) base.pathname += "/";
	const marker = option("--marker");
	const publicBase = option("--public-base", base.pathname);
	const localManifestBytes = readFileSync(manifestPath);
	const manifest = JSON.parse(localManifestBytes.toString("utf8"));
	const allowlistInventory = enumerateIndependentCopiedPaths(WEB_PUBLIC_ROOT);
	const outputInventory = enumerateIndependentCopiedPaths(dirname(manifestPath));
	const failures = validateManifest(manifest, {
		marker,
		publicBase,
		allowlistPaths: allowlistInventory.paths,
		outputPaths: outputInventory.paths,
	});
	for (const path of allowlistInventory.missing) {
		failures.push({
			rule: "empty-independent-allowlist-entry",
			path,
			why: "the independent source allowlist matched no file",
		});
	}

	try {
		const probe = await fetch(base, { redirect: "manual" });
		if (!probe.ok) throw new Error(`status ${probe.status}`);
	} catch (error) {
		console.error(`check-asset-manifest: no preview server at ${base} — ${error.message}`);
		process.exit(2);
	}
	const servedManifest = await fetchAsset(base, "asset-manifest.json");
	if (servedManifest.status !== 200) {
		failures.push({
			rule: "served-manifest-missing",
			path: "asset-manifest.json",
			why: `status ${servedManifest.status}`,
		});
	} else {
		const mismatch = validateServedManifest({
			localBytes: localManifestBytes,
			servedBytes: servedManifest.bytes,
		});
		if (mismatch) failures.push(mismatch);
	}

	const fetched = new Map();
	for (let index = 0; index < manifest.files.length; index += 24) {
		const batch = manifest.files.slice(index, index + 24);
		const results = await Promise.all(batch.map((file) => fetchAsset(base, file.path)));
		for (let offset = 0; offset < batch.length; offset += 1) {
			const file = batch[offset];
			const result = results[offset];
			fetched.set(file.path, result.bytes);
			const failure = validateResponse(file, result);
			if (failure) failures.push(failure);
		}
	}

	const leaked = [];
	for (const path of EXCLUSION_PROBES) {
		const result = await fetchAsset(base, path);
		if (result.status === 200 && result.contentType !== "text/html") {
			leaked.push({ path, contentType: result.contentType, bytes: result.bytes.byteLength });
		}
	}

	const atlasBytes = fetched.get("fonts/font-atlas.json");
	let atlas;
	try {
		atlas = JSON.parse(atlasBytes?.toString("utf8") ?? "");
		if (!atlas.fonts || Object.keys(atlas.fonts).length === 0) throw new Error("fonts is empty");
	} catch (error) {
		failures.push({ rule: "invalid-font-atlas", path: "fonts/font-atlas.json", why: error.message });
	}
	if (atlas?.fonts) {
		const chunks = new Set(Object.values(atlas.fonts).map((font) => font.ch));
		for (const chunk of chunks) {
			const path = `fonts/font-chunk-${chunk}.avif`;
			if (!fetched.has(path)) failures.push({ rule: "missing-atlas-chunk", path });
		}
	}

	try {
		const { loadImage } = await import("@napi-rs/canvas");
		const decodePaths = manifest.files
			.filter((file) =>
				(file.category === "fonts" && file.path.endsWith(".avif")) ||
				file.path === "effects/preview.jpg",
			)
			.map((file) => file.path);
		for (const path of decodePaths) {
			try {
				const image = await loadImage(fetched.get(path));
				if (image.width <= 0 || image.height <= 0) throw new Error("zero dimensions");
			} catch (error) {
				failures.push({ rule: "image-decode", path, why: error.message });
			}
		}
	} catch (error) {
		failures.push({ rule: "image-decoder-unavailable", path: "@napi-rs/canvas", why: error.message });
	}

	console.log(`check-asset-manifest: ${manifest.files.length} copied entries against ${base}`);
	console.log(`  manifest: ${manifestPath}`);
	console.log(`  marker: ${manifest.build?.marker ?? "<missing>"}; public base: ${manifest.build?.base ?? "<missing>"}`);
	console.log(`  ${failures.length === 0 ? "PASS" : "FAIL"} MIME + bytes + SHA-256 + category/graph completeness`);
	console.log(`  ${leaked.length === 0 ? "PASS" : "FAIL"} excluded paths remain absent below the tested base`);
	console.log(
		`  totals: ${manifest.fileCount} copied / ${manifest.totalBytes} bytes; ` +
			`${manifest.emitted.fileCount} emitted / ${manifest.emitted.totalBytes} bytes`,
	);
	if (failures.length) {
		for (const failure of failures) {
			console.error(`  [${failure.rule}] ${failure.path}: ${failure.why ?? "invalid inventory"}`);
		}
	}
	if (leaked.length) {
		for (const leak of leaked) console.error(`  [excluded-path-leak] ${leak.path}`);
	}
	if (failures.length || leaked.length) process.exit(1);
	console.log("clean");
}

const fixtureIndex = process.argv.indexOf("--fixture");
if (fixtureIndex >= 0) runFixture(process.argv[fixtureIndex + 1]);
else if (process.argv.includes("--negative-control")) runNegativeControl();
else await runCheck();
