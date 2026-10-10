import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	blazeEditorDeadline as deadline,
	blazeEditorRedact as redact,
} from "./blaze-editor-lifecycle.mjs";

export async function bundleFlameWrapEditorHost({
	bun,
	workspace,
	pkg,
	root,
	creator,
	configPath,
	env,
}) {
	let child,
		stdout = "",
		stderr = "",
		failure;
	const logPath = join(root, "bundle.log");
	const receipt = {
		command: bun,
		code: null,
		signal: null,
		closeObserved: false,
		spawnError: null,
		forced: false,
		logPath,
		logWritten: false,
		sourceSnapshot: null,
		inputValidationFailure: null,
		inputValidationFailurePath: join(
			root,
			"bundle-input-validation-failure.json",
		),
		pinScope:
			"Reported same-buffer build inputs; not a transitive external/dynamic-import closure",
	};
	try {
		child = spawn(
			bun,
			[
				join(workspace, "script/fixtures/flame-wrap-editor-host-build.mjs"),
				workspace,
				pkg,
				root,
				creator,
				configPath,
			],
			{
				cwd: workspace,
				windowsHide: true,
				env,
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		child.stdout?.on("data", (bytes) => {
			stdout += bytes.toString();
		});
		child.stderr?.on("data", (bytes) => {
			stderr += bytes.toString();
		});
		const closed = new Promise((done) => {
			child.once("error", (error) => {
				receipt.spawnError = {
					code: error.code,
					message: redact(error.message),
				};
			});
			child.once("close", (code, signal) => {
				receipt.closeObserved = true;
				receipt.code = code;
				receipt.signal = signal;
				done({ code, signal });
			});
		});
		try {
			const result = await deadline(closed, 60000, "Private Host bundle");
			assert.equal(
				receipt.spawnError,
				null,
				JSON.stringify(receipt.spawnError),
			);
			assert.equal(result.signal, null, "Owned bundler terminated by signal");
			assert.equal(result.code, 0, redact(stderr));
			receipt.sourceSnapshot = JSON.parse(
				await readFile(join(root, "editor-closure.json"), "utf8"),
			);
		} finally {
			if (
				!receipt.closeObserved &&
				child.pid &&
				child.exitCode === null &&
				child.signalCode === null
			) {
				receipt.forced = true;
				child.kill();
				await deadline(closed, 10000, "Owned bundler close");
			}
		}
	} catch (error) {
		failure = error;
	} finally {
		try {
			const bytes = await readFile(receipt.inputValidationFailurePath);
			receipt.inputValidationFailure = JSON.parse(
				new TextDecoder("utf-8", { fatal: true }).decode(bytes),
			);
		} catch (error) {
			if (error.code !== "ENOENT") {
				receipt.inputValidationFailureReadError = {
					code: error.code ?? error.name,
					message: redact(error.message),
				};
				failure = failure
					? new AggregateError(
							[failure, error],
							"Private bundle and input-failure receipt read failed",
						)
					: error;
			}
		}
		try {
			await writeFile(logPath, redact(stdout + stderr), { flag: "wx" });
			receipt.logWritten = true;
		} catch (error) {
			failure = failure
				? new AggregateError(
						[failure, error],
						"Private bundle and log persistence failed",
					)
				: error;
		}
	}
	receipt.ok =
		!failure &&
		receipt.closeObserved &&
		receipt.code === 0 &&
		!receipt.signal &&
		receipt.logWritten;
	if (failure) {
		failure.bundleReceipt = receipt;
		throw failure;
	}
	return receipt;
}
