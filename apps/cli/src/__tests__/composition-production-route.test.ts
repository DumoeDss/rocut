import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { relative, resolve } from "node:path";
import { InMemoryProjectStore } from "@opencut/editor-ports/in-memory";
import {
	createCompositionProductionRegistry,
	CompositionProductionError,
} from "../composition-production";
import { handleCompositionProductionRoute } from "../composition-production-route";
import { describeResource } from "../programmatic/resource-bytes";
import { resourceDigest } from "../programmatic/resources";

const executable = process.env.ROCUT_COMPOSITION_KERNEL_BINARY;
async function fixture(
	run: (base: string, writes: () => number) => Promise<void>,
) {
	const root = await mkdtemp("C:/tmps/rocut-composition-route-");
	const store = new InMemoryProjectStore();
	let writes = 0;
	store.save = async () => {
		writes++;
		throw Error("Timeline writes forbidden");
	};
	const registry = createCompositionProductionRegistry({
		projectDir: root,
		context: { store, projectId: "existing-project" },
		enqueue: async (task) => task(),
		kernel: (input) => {
			const result = spawnSync(executable!, [], {
				input: JSON.stringify({ kernel: "composition", input }),
				encoding: "utf8",
				timeout: 5000,
				windowsHide: true,
			});
			if (result.status !== 0) throw Error("Native test kernel failed");
			const parsed = JSON.parse(result.stdout);
			if (parsed.status === "rejected")
				throw new CompositionProductionError(
					parsed.error.code,
					parsed.error.message,
				);
			return parsed;
		},
	});
	const server = http.createServer((request, response) => {
		const url = new URL(request.url!, "http://127.0.0.1");
		void handleCompositionProductionRoute({
			request,
			response,
			url,
			route: url.pathname.split("/").filter(Boolean),
			registry,
			respond: (status, value) => {
				response.writeHead(status, { "content-type": "application/json" });
				response.end(JSON.stringify(value));
			},
		});
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	try {
		await run(
			`http://127.0.0.1:${(server.address() as AddressInfo).port}/composition-productions`,
			() => writes,
		);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((done) => server.close(() => done()));
		const target = resolve(root);
		if (
			!relative(resolve("C:/tmps"), target).startsWith(
				"rocut-composition-route-",
			)
		)
			throw Error("Unsafe cleanup");
		await rm(target, { recursive: true, force: true });
	}
}
test.skipIf(!executable)(
	"binary CAS stage is idempotent and rejects descriptor/path/size mismatch",
	async () =>
		fixture(async (base, writes) => {
			const bytes = new TextEncoder().encode(
				"<!doctype html><html>Fixed</html>",
			);
			const resource = describeResource(
				{ id: "fixed.html", kind: "document", mimeType: "text/html" },
				bytes.length,
				resourceDigest(bytes.buffer),
			);
			const headers = {
				"x-resource-descriptor": Buffer.from(JSON.stringify(resource)).toString(
					"base64url",
				),
			};
			const path = `${base}/resources/${resource.attachmentKey}`;
			expect(
				await (
					await fetch(path, { method: "POST", headers, body: bytes })
				).json(),
			).toMatchObject({ reused: false });
			expect(
				await (
					await fetch(path, { method: "POST", headers, body: bytes })
				).json(),
			).toMatchObject({ reused: true });
			expect(
				(
					await fetch(`${base}/resources/wrong-key`, {
						method: "POST",
						headers,
						body: bytes,
					})
				).status,
			).toBe(409);
			expect(
				(
					await fetch(path, {
						method: "POST",
						headers,
						body: new Uint8Array(bytes.length + 1),
					})
				).status,
			).toBe(409);
			expect(
				(
					await fetch(path, {
						method: "POST",
						headers,
						body: new Uint8Array(bytes.length),
					})
				).status,
			).toBe(400);
			expect(writes()).toBe(0);
		}),
);
test.skipIf(!executable)(
	"probe is read-only and start refuses without explicit isolated surface",
	async () =>
		fixture(async (base, writes) => {
			const request = {
				schemaVersion: 1,
				idempotencyKey: "fixed/key",
				archive: {
					manifestSha256: "a".repeat(64),
					source: {
						version: 1,
						runtime: "html-document",
						code: "<html>fixed</html>",
						width: 64,
						height: 32,
						frameRate: { numerator: 30, denominator: 1 },
						durationFrames: 30,
						seed: 0,
					},
				},
				options: { format: "mp4", quality: "high" },
			};
			const probe = await fetch(`${base}/probe`, {
				method: "POST",
				body: JSON.stringify({ request }),
			});
			expect(probe.status).toBe(200);
			expect(await probe.json()).toMatchObject({
				available: false,
				record: {
					phase: "reserved",
					requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
				},
			});
			expect(
				(await fetch(base, { method: "POST", body: JSON.stringify(request) }))
					.status,
			).toBe(409);
			expect(
				(
					await fetch(
						`${base}/request/${encodeURIComponent(request.idempotencyKey)}`,
					)
				).status,
			).toBe(404);
			expect(writes()).toBe(0);
		}),
);
test.skipIf(!executable)(
	"route rejects malformed UTF-8, free paths and artifact queries",
	async () =>
		fixture(async (base) => {
			expect(
				(
					await fetch(`${base}/probe`, {
						method: "POST",
						body: Buffer.from([0xff]),
					})
				).status,
			).toBe(400);
			expect(
				(
					await fetch(`${base}/probe`, {
						method: "POST",
						body: JSON.stringify({ sourceDirectory: "C:/user" }),
					})
				).status,
			).toBe(409);
			expect(
				(await fetch(`${base}/${"a".repeat(64)}/artifact?path=C:/user`)).status,
			).toBe(409);
		}),
);
