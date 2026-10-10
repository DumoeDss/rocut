import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const validHash = (value) =>
	typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);

// Read-only: never refresh expected pins, build, or copy source contents.
export async function validateFlameWrapEditorBuild(buildReceipt, pkg) {
	const receipt = {
		build: null,
		validation: {
			ok: false,
			buildReceiptPath: buildReceipt,
			buildReceiptSha256: null,
			wasm: null,
			files: [],
			issues: [],
		},
	};
	const validation = receipt.validation;
	const issue = (path, expected, actual, reason) =>
		validation.issues.push({ path, expected, actual, reason });
	let build;
	try {
		const bytes = await readFile(buildReceipt);
		validation.buildReceiptSha256 = sha(bytes);
		build = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
		receipt.build = build;
	} catch (error) {
		issue(
			String(buildReceipt),
			"Readable strict UTF-8 JSON build receipt",
			error.code ?? error.name,
			"receipt-read-or-parse",
		);
	}
	if (!build || typeof build !== "object" || Array.isArray(build)) {
		issue("build", "object", build ?? null, "schema");
		build = {};
	}
	for (const field of ["ok", "inputsUnchanged"])
		if (build[field] !== true)
			issue(`build.${field}`, true, build[field] ?? null, "build-not-admitted");
	if (!validHash(build.wasmSha256))
		issue(
			"build.wasmSha256",
			"64 hexadecimal SHA256 characters",
			build.wasmSha256 ?? null,
			"schema",
		);
	if (typeof pkg !== "string" || !isAbsolute(pkg))
		issue("pkg", "absolute package directory", pkg ?? null, "schema");
	const inspect = async (path, expected, scope) => {
		const file = {
			path,
			scope,
			expected: expected ?? null,
			actual: null,
			bytes: null,
			ok: false,
		};
		if (typeof path !== "string" || !isAbsolute(path)) {
			issue(String(path), "absolute file path", path ?? null, "schema");
			return file;
		}
		try {
			const bytes = await readFile(path);
			file.actual = sha(bytes);
			file.bytes = bytes.length;
			file.ok = validHash(expected) && file.actual === expected.toLowerCase();
			if (!file.ok)
				issue(
					path,
					expected ?? null,
					file.actual,
					"sha256-drift-or-invalid-pin",
				);
		} catch (error) {
			issue(
				path,
				expected ?? null,
				null,
				error.code === "ENOENT"
					? "missing"
					: `unreadable:${error.code ?? error.name}`,
			);
		}
		return file;
	};
	if (typeof pkg === "string" && isAbsolute(pkg))
		validation.wasm = await inspect(
			join(pkg, "opencut_wasm_bg.wasm"),
			build.wasmSha256,
			"wasm-same-read-buffer",
		);
	for (const scope of ["frozen", "textModules"]) {
		if (!Array.isArray(build[scope])) {
			issue(
				`build.${scope}`,
				"array of path/SHA256 pins",
				build[scope] ?? null,
				"schema",
			);
			continue;
		}
		if (!build[scope].length)
			issue(`build.${scope}`, "nonempty frozen input evidence", [], "schema");
		for (const [index, file] of build[scope].entries()) {
			if (!file || typeof file !== "object" || Array.isArray(file)) {
				issue(
					`build.${scope}[${index}]`,
					"path/SHA256 pin object",
					file ?? null,
					"schema",
				);
				continue;
			}
			if (!validHash(file.sha256))
				issue(
					`build.${scope}[${index}].sha256`,
					"64 hexadecimal SHA256 characters",
					file.sha256 ?? null,
					"schema",
				);
			// Older receipts may use root-relative frozen paths; the receipt root,
			// never the caller cwd, supplies that explicitly recorded base.
			const path =
				typeof file.path === "string" &&
				!isAbsolute(file.path) &&
				typeof build.root === "string" &&
				isAbsolute(build.root)
					? resolve(build.root, file.path)
					: file.path;
			validation.files.push(await inspect(path, file.sha256, scope));
		}
	}
	validation.ok = validation.issues.length === 0;
	if (!validation.ok) {
		const error = new Error(
			`FlameWrap editor build preflight rejected ${validation.issues.length} issue(s)`,
		);
		error.code = "FLAME_WRAP_EDITOR_BUILD_PREFLIGHT";
		error.receipt = receipt;
		throw error;
	}
	return receipt;
}
