import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { PROGRAMMATIC_SANDBOX_DOCUMENT } from "./sandbox-document";

test("resource measurement releases all decoded images before publishing facts and never allocates render scratch", async () => {
	// Inspect the actual fixed Worker embedded in the sandbox document, not a
	// reconstructed measurement implementation. This is lifecycle, not pixels.
	const encoded = PROGRAMMATIC_SANDBOX_DOCUMENT.match(
		/new Blob\(\[("(?:[^"\\]|\\.)*")\]/,
	)?.[1];
	if (!encoded) throw Error("Missing fixed sandbox Worker");
	const events: string[] = [];
	let decoded = 0,
		live = 0;
	const resource = (id: string) => ({
		id,
		kind: "image",
		mimeType: "image/png",
		byteLength: 1,
		sha256: "a".repeat(64),
		attachmentKey: `programmatic-sha256-${"a".repeat(64)}`,
	});
	const resources = [resource("cover.png"), resource("unused.png")].map(
		(resource) => ({ resource, body: new ArrayBuffer(1) }),
	);
	const onmessage = runInNewContext(`${JSON.parse(encoded)}\n;onmessage`, {
		ArrayBuffer,
		Blob,
		self: {},
		OffscreenCanvas: class {
			width: number;
			height: number;
			constructor(width: number, height: number) {
				expect([width, height]).toEqual([1, 1]);
				this.width = width;
				this.height = height;
				events.push("font-metrics-canvas");
			}
			getContext() {
				return {};
			}
		},
		createImageBitmap: async () => {
			const id = ++decoded;
			live++;
			return {
				width: 2,
				height: 2,
				close() {
					live--;
					events.push(`close-${id}`);
				},
			};
		},
		postMessage(message: unknown) {
			expect(live).toBe(0);
			if (message && typeof message === "object" && "sandboxStage" in message) {
				expect(message).toEqual({ sandboxStage: "worker-started" });
				return;
			}
			expect(message).toMatchObject({
				fontMetrics: [],
				imageDimensions: resources.map(({ resource }) => ({
					resource,
					width: 2,
					height: 2,
				})),
			});
			events.push("publish-facts");
		},
	});
	await onmessage({
		data: {
			operation: "measure-resources",
			source: {
				width: 2800,
				height: 2800,
				resources: resources.map((r) => r.resource),
			},
			resources,
			frame: {
				imageDecodeLimits: {
					maxDimension: 8192,
					maxDecodedBytes: 128 * 1024 * 1024,
				},
				imageDimensionRequests: resources.map(({ resource }) => ({ resource })),
			},
			imageAdmissions: resources.map(({ resource }) => ({
				resource,
				width: 2,
				height: 2,
				decodedBytes: 16,
			})),
		},
	});
	expect(decoded).toBe(2);
	expect(events).toEqual([
		"font-metrics-canvas",
		"close-1",
		"close-2",
		"publish-facts",
	]);
});
