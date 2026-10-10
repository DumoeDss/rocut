import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { validateInkExportVideoSize } from "./mv-ink-export-video-policy.mjs";

export function validateInkExportSavedStat(info) {
	assert(info.isFile(), "Ink saved download must be a regular file");
	validateInkExportVideoSize(info.size);
}
async function savedIdentity(file) {
	const info = await lstat(file);
	validateInkExportSavedStat(info);
	const hash = createHash("sha256");
	let header = Buffer.alloc(0),
		byteLength = 0;
	const handle = await open(file, "r");
	try {
		const opened = await handle.stat();
		assert(
			opened.isFile() &&
				opened.dev === info.dev &&
				opened.ino === info.ino &&
				opened.size === info.size,
			"Ink saved file changed before stream read",
		);
		for await (const chunk of handle.createReadStream({ autoClose: false })) {
			byteLength += chunk.length;
			validateInkExportVideoSize(byteLength);
			hash.update(chunk);
			if (header.length < 4)
				header = Buffer.concat([header, chunk.subarray(0, 4 - header.length)]);
		}
		const after = await lstat(file),
			final = await handle.stat();
		for (const observed of [after, final])
			assert(
				observed.isFile() &&
					observed.dev === info.dev &&
					observed.ino === info.ino &&
					observed.size === info.size &&
					observed.mtimeMs === info.mtimeMs &&
					observed.ctimeMs === info.ctimeMs,
				"Ink saved file changed during stream hash",
			);
		assert.equal(byteLength, info.size, "Ink saved stream length mismatch");
	} finally {
		await handle.close();
	}
	assert.deepEqual(
		header,
		Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
		"Saved Ink download must be WebM/EBML",
	);
	return { byteLength, sha256: hash.digest("hex") };
}
function metadataValid(metadata) {
	assert(metadata && typeof metadata === "object" && !Array.isArray(metadata));
	assert.deepEqual(Object.keys(metadata).sort(), [
		"byteLength",
		"fileName",
		"mimeType",
		"sha256",
		"transport",
	]);
	assert.equal(metadata.fileName, "ink.webm");
	assert.equal(metadata.mimeType, "video/webm");
	assert.equal(metadata.transport, "blob-download");
	validateInkExportVideoSize(metadata.byteLength);
	assert(/^[a-f0-9]{64}$/.test(metadata.sha256));
}

/** Pre-attach before navigation. done resolves only after one saveAs AND the
 * browser metadata ack match; failures reject both paths, never JSON media.
 */
export async function attachInkExportVideoDownload({
	page,
	directory,
	signal,
	clock = { setTimeout, clearTimeout },
}) {
	assert(isAbsolute(directory));
	signal?.throwIfAborted();
	const file = join(directory, "ink.webm"),
		state = {
			downloadCount: 0,
			acknowledged: false,
			completed: false,
			error: null,
		};
	let resolveSaved, rejectSaved, resolveDone, rejectDone;
	const saved = new Promise((resolve, reject) => {
		resolveSaved = resolve;
		rejectSaved = reject;
	});
	const done = new Promise((resolve, reject) => {
		resolveDone = resolve;
		rejectDone = reject;
	});
	saved.catch(() => {});
	done.catch(() => {});
	let timer;
	const fail = (error) => {
		const failure = error instanceof Error ? error : Error(String(error));
		state.error ??= failure.message.slice(0, 4000);
		clock.clearTimeout(timer);
		rejectSaved(failure);
		rejectDone(failure);
	};
	const startDeadline = () => {
		if (timer === undefined && !state.error && !state.completed)
			timer = clock.setTimeout(
				() => fail(Error("Ink binary download/ack timed out after60000ms")),
				60000,
			);
	};
	const onClose = () => {
		if (!state.completed)
			fail(Error("Ink download page closed before verified acknowledgement"));
	};
	const onAbort = () =>
		fail(signal?.reason ?? Error("Ink binary download cancelled"));
	const onDownload = (download) => {
		startDeadline();
		state.downloadCount++;
		if (
			state.downloadCount !== 1 ||
			download.suggestedFilename() !== "ink.webm"
		) {
			fail(Error("Duplicate or unsolicited Ink export download"));
			return;
		}
		void (async () => {
			try {
				try {
					await lstat(file);
					throw Error("Ink output path already exists");
				} catch (error) {
					if (
						!(
							error &&
							typeof error === "object" &&
							Reflect.get(error, "code") === "ENOENT"
						)
					)
						throw error;
				}
				await download.saveAs(file);
				resolveSaved(await savedIdentity(file));
			} catch (error) {
				fail(error);
			}
		})();
	};
	page.on("download", onDownload);
	page.on("close", onClose);
	signal?.addEventListener("abort", onAbort, { once: true });
	try {
		await page.exposeFunction("__acceptInkExportDownload", async (metadata) => {
			startDeadline();
			try {
				if (state.acknowledged || state.error)
					throw Error(state.error ?? "Duplicate Ink download acknowledgement");
				state.acknowledged = true;
				metadataValid(metadata);
				const identity = await saved;
				if (state.error) throw Error(state.error);
				assert.equal(identity.byteLength, metadata.byteLength);
				assert.equal(identity.sha256, metadata.sha256);
				state.completed = true;
				clock.clearTimeout(timer);
				const result = { file, metadata, ...identity };
				resolveDone(result);
			} catch (error) {
				fail(error);
				throw error;
			}
		});
	} catch (error) {
		fail(error);
		page.off("download", onDownload);
		page.off("close", onClose);
		signal?.removeEventListener("abort", onAbort);
		throw error;
	}
	const dispose = () => {
		if (!state.completed && !state.error)
			fail(Error("Ink download listener disposed before completion"));
		clock.clearTimeout(timer);
		page.off("download", onDownload);
		page.off("close", onClose);
		signal?.removeEventListener("abort", onAbort);
	};
	return { file, state, done, dispose };
}
