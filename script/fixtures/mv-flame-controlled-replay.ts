import type {
	MvRecipePlan,
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { ImagePreprocessOwner } from "../../packages/editor-classic/src/services/renderer/programmatic/image-preprocess-owner";
import { prepareImagePreprocessPatches } from "../../packages/editor-classic/src/services/renderer/programmatic/image-preprocess-patches";
import { imagePreprocessRasterBytes } from "../../packages/editor-classic/src/services/renderer/programmatic/image-preprocess-binding";
import type { ProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import {
	consumeMvNativeRasterTicket,
	prepareMvNativeRasterTicket,
} from "../../packages/editor-classic/src/services/renderer/programmatic/mv-native-admission";
import { MV_NATIVE_DOCUMENT } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-native-document";
import { nativeReplayDocument } from "./mv-native-replay-document";
import {
	MV_NATIVE_CONNECT,
	MV_NATIVE_PROTOCOL,
	isMvNativeEnvelope,
} from "../../packages/editor-classic/src/services/renderer/programmatic/mv-native-protocol";

/** TEST ONLY: deliberate native-plan corruption after real fresh admission.
 * A positive no-mutation control must match the public route exactly before
 * omitted-command controls can make claims. This fixture never changes the
 * production document, oracle or thresholds. The optional callback runs only
 * in the test parent over owned data; no code crosses the private MessagePort.
 * Production deliberately exposes no corresponding plan-injection entry.
 */
export async function controlledFlameReplay({
	mutate,
	commandBatchSize,
	...request
}: {
	source: ProgrammaticSource;
	frame: ProgrammaticFrame;
	resources: readonly ResolvedProgrammaticResource[];
	mutate?: (plan: MvRecipePlan) => void;
	commandBatchSize?: 1 | 64 | 4096;
}): Promise<ImageBitmap> {
	const replayDocument = nativeReplayDocument(
		MV_NATIVE_DOCUMENT,
		commandBatchSize,
	);
	const input = consumeMvNativeRasterTicket(
		await prepareMvNativeRasterTicket(request),
	);
	const owner = new ImagePreprocessOwner();
	const encoded = input.resources.reduce(
		(sum, item) => sum + item.body.byteLength,
		0,
	);
	const releasePreparation = owner.reserve(encoded * 2);
	let group: Awaited<ReturnType<typeof prepareImagePreprocessPatches>>;
	let releaseResidency: (() => void) | undefined;
	try {
		group = await prepareImagePreprocessPatches({
			input,
			owner,
			signal: new AbortController().signal,
		});
		input.preparedPatches = group.patches;
		input.rasterByteLimit = imagePreprocessRasterBytes({
			plan: input.frame.recipePlan,
			width: input.width,
			height: input.height,
		});
		const decoded = input.imageAdmissions.reduce(
			(sum, item) => sum + item.decodedBytes,
			0,
		);
		releasePreparation();
		releaseResidency = owner.reserve(
			encoded * 2 +
				decoded * 2 +
				input.rasterByteLimit +
				group.patches.reduce(
					(sum, patch) => sum + patch.envelope.byteLength * 3,
					0,
				),
		);
		mutate?.(input.frame.recipePlan);
	} catch (error) {
		if (typeof group! !== "undefined") group!.release();
		releaseResidency?.();
		owner.dispose();
		throw error;
	} finally {
		releasePreparation();
	}
	const requestId = crypto.randomUUID();
	return new Promise((resolve, reject) => {
		const iframe = document.createElement("iframe");
		iframe.sandbox.add("allow-scripts");
		iframe.hidden = true;
		const channel = new MessageChannel();
		let settled = false,
			connected = false,
			started = false,
			disposing = false;
		let disposeTimer: ReturnType<typeof setTimeout> | undefined;
		const remove = () => {
			clearTimeout(disposeTimer);
			channel.port1.close();
			channel.port2.close();
			iframe.onload = null;
			iframe.remove();
			releaseResidency?.();
			group.release();
			owner.dispose();
		};
		const cleanup = () => {
			if (disposing) return;
			disposing = true;
			clearTimeout(timer);
			if (!connected) {
				remove();
				return;
			}
			disposeTimer = setTimeout(remove, 250);
			try {
				channel.port1.postMessage({
					protocol: MV_NATIVE_PROTOCOL,
					requestId,
					type: "dispose",
				});
			} catch {
				remove();
			}
		};
		const fail = (error: unknown) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		};
		const timer = setTimeout(
			() => fail(Error("Controlled native replay timed out after 5000 ms")),
			5000,
		);
		channel.port1.onmessageerror = () =>
			fail(Error("Invalid controlled native transport"));
		channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
			const bitmap =
				data && typeof data === "object" ? Reflect.get(data, "bitmap") : null;
			if (
				disposing &&
				isMvNativeEnvelope(data, requestId) &&
				data.type === "disposed"
			) {
				if (bitmap instanceof ImageBitmap) bitmap.close();
				remove();
				return;
			}
			if (settled) {
				if (bitmap instanceof ImageBitmap) bitmap.close();
				return;
			}
			if (!isMvNativeEnvelope(data, requestId)) {
				if (bitmap instanceof ImageBitmap) bitmap.close();
				fail(Error("Invalid controlled native response identity"));
				return;
			}
			if (
				data.type === "ready" &&
				!started &&
				!(bitmap instanceof ImageBitmap)
			) {
				started = true;
				try {
					channel.port1.postMessage({
						protocol: MV_NATIVE_PROTOCOL,
						requestId,
						type: "render",
						input,
					});
				} catch (error) {
					fail(error);
				}
				return;
			}
			if (bitmap instanceof ImageBitmap) {
				if (
					!started ||
					data.type !== "rendered" ||
					bitmap.width !== input.width ||
					bitmap.height !== input.height
				) {
					bitmap.close();
					fail(Error("Invalid controlled native output"));
					return;
				}
				settled = true;
				cleanup();
				resolve(bitmap);
				return;
			}
			fail(
				Error(
					`Controlled native replay failed: ${String(Reflect.get(data, "error")).slice(0, 2000)}`,
				),
			);
		};
		iframe.onload = () => {
			if (settled || connected) return;
			connected = true;
			try {
				if (!iframe.contentWindow)
					throw Error("Missing controlled native iframe");
				iframe.contentWindow.postMessage(
					{ type: MV_NATIVE_CONNECT, requestId },
					"*",
					[channel.port2],
				);
			} catch (error) {
				fail(error);
			}
		};
		iframe.srcdoc = replayDocument;
		try {
			document.body.appendChild(iframe);
		} catch (error) {
			fail(error);
		}
	});
}
