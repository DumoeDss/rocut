import type { IncomingMessage, ServerResponse } from "node:http";
import {
	MediaPreviewError,
	type createMediaPreviewService,
} from "./media-preview";

export async function handleMediaPreviewRoute({
	request,
	response,
	service,
	readBody,
}: {
	request: IncomingMessage;
	response: ServerResponse;
	service: ReturnType<typeof createMediaPreviewService>;
	readBody: () => Promise<unknown>;
}) {
	response.setHeader("cache-control", "no-store");
	const respond = (status: number, data: unknown) => {
		response.writeHead(status, { "content-type": "application/json" });
		response.end(JSON.stringify(data));
	};
	if (request.method === "GET") {
		respond(200, await service.capability());
		return;
	}
	if (request.method !== "POST") {
		respond(405, { error: "method-not-allowed" });
		return;
	}
	const controller = new AbortController();
	const abort = () =>
		controller.abort(Error("Media preview client disconnected"));
	response.once("close", abort);
	try {
		const input = await readBody();
		const png = await service.render({ input, signal: controller.signal });
		const sha =
			input && typeof input === "object" && "sourceSha256" in input
				? String(input.sourceSha256)
				: "";
		response.writeHead(200, {
			"content-type": "image/png",
			"content-length": png.byteLength,
			"x-rocut-preview-version": "1",
			"x-rocut-source-sha256": sha,
		});
		response.end(png);
	} catch (error) {
		if (controller.signal.aborted || response.destroyed) return;
		if (error instanceof MediaPreviewError) {
			respond(error.status, { error: error.message });
			return;
		}
		throw error;
	} finally {
		response.removeListener("close", abort);
	}
}
