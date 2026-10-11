import type { ServerResponse } from "node:http";
import { inspectProgrammaticAnimation } from "./animation-inspect";
import type { ProgrammaticResourceStore } from "./resources";

/** Host authenticates and bounds JSON before this read-only operation. */
export async function handleProgrammaticAnimationInspect(
	input: unknown,
	response: ServerResponse,
	context: ProgrammaticResourceStore,
	toolchainDirectory: string | undefined = process.env
		.ROCUT_ENGINE_TOOLCHAIN_DIR,
) {
	const controller = new AbortController();
	const close = () => {
		if (!response.writableEnded)
			controller.abort(Error("Animation inspection cancelled"));
	};
	response.once("close", close);
	const timer = setTimeout(
		() => controller.abort(Error("Animation inspection timed out")),
		15000,
	);
	try {
		if (
			input &&
			typeof input === "object" &&
			!Array.isArray(input) &&
			!Object.hasOwn(input, "toolchainDirectory")
		) {
			if (!toolchainDirectory)
				throw Error(
					"This host has no fixed animation inspection toolchain configured",
				);
			input = { ...input, toolchainDirectory };
		}
		const result = await inspectProgrammaticAnimation({
			...context,
			input,
			signal: controller.signal,
		});
		if (!response.destroyed) {
			response.writeHead(200, {
				"content-type": "application/json",
				"cache-control": "no-store",
			});
			response.end(JSON.stringify(result));
		}
	} catch (cause) {
		if (!response.destroyed) {
			response.writeHead(422, {
				"content-type": "application/json",
				"cache-control": "no-store",
			});
			response.end(
				JSON.stringify({
					error:
						cause instanceof Error
							? cause.message
							: "Animation inspection failed",
				}),
			);
		}
	} finally {
		clearTimeout(timer);
		response.off("close", close);
	}
}
