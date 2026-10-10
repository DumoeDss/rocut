import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateFlameWrapEditorBuild } from "./flame-wrap-editor-preflight.mjs";
import { blazeEditorRedact as redact } from "./blaze-editor-lifecycle.mjs";

export async function prepareFlameWrapEditorInputs({
	pkg,
	creator,
	buildReceipt,
	stage,
	root,
	entryFile,
	workspace,
}) {
	let preflight;
	try {
		preflight = await validateFlameWrapEditorBuild(buildReceipt, pkg);
		const pinned = [];
		const files = [
			entryFile,
			buildReceipt,
			creator,
			join(dirname(creator), "spatial.mjs"),
			fileURLToPath(import.meta.url),
			...[
				"flame-wrap-editor-host.mjs",
				"flame-wrap-editor-host-build.mjs",
				"flame-wrap-editor-checks.mjs",
				"flame-wrap-editor-controls.mjs",
				"flame-wrap-editor-capture.mjs",
				"flame-wrap-presentation-observer.mjs",
				"flame-wrap-editor-browser.mjs",
				"flame-wrap-editor-preflight.mjs",
				"flame-wrap-editor-bundle.mjs",
				"flame-wrap-editor-request.mjs",
				"private-effect-inputs.mjs",
				...(stage !== "ui-only"
					? [
							"flame-wrap-editor-export.mjs",
							"flame-wrap-export-metrics.mjs",
							"flame-wrap-editor-export-state.mjs",
							"flame-wrap-editor-export-decode.mjs",
							"flame-wrap-editor-export-references.mjs",
						]
					: []),
				"blaze-editor-control.mjs",
				"blaze-editor-lifecycle.mjs",
				"blaze-editor-contract.mjs",
			].map((name) => join(workspace, "script/fixtures", name)),
		];
		for (const file of new Set(files)) {
			const bytes = await readFile(file);
			pinned.push({
				path: file,
				sha256: createHash("sha256").update(bytes).digest("hex"),
			});
		}
		return { build: preflight.build, validation: preflight.validation, pinned };
	} catch (error) {
		try {
			await writeFile(
				join(root, "evidence.json"),
				JSON.stringify(
					{
						ok: false,
						root,
						stage,
						code: error.code,
						failure: redact(error.stack ?? error),
						preflight: error.receipt ?? preflight,
						browserRun: false,
						hostRun: false,
						finishedAt: new Date().toISOString(),
					},
					null,
					2,
				),
				{ flag: "wx" },
			);
		} catch (writeError) {
			error.evidenceWriteError = {
				code: writeError.code,
				message: redact(writeError.message),
			};
		}
		throw error;
	}
}
