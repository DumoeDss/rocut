import { expect, test } from "bun:test";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { createHttpProgrammaticFrames } from "../../../vite-example/src/host/http-programmatic-frames";

const identity = {
	version: 1,
	profile: "hyperframes-graph-v1",
	id: "a".repeat(64),
} as const;
const pcmHeaders = {
	"content-type": "application/vnd.rocut.audio-pcm",
	"content-length": "16",
	"x-rocut-audio-version": "1",
	"x-rocut-sample-rate": "44100",
	"x-rocut-channels": "2",
	"x-rocut-frames": "2",
	"x-rocut-sample-origin": "0",
	"x-rocut-has-audio": "1",
	"x-rocut-audio-profile": identity.profile,
	"x-rocut-audio-identity": identity.id,
};

test("identity HTTP validates exact preflight objects and binds PCM headers to the request", async () => {
	let reply = (response: ServerResponse) => {
		response
			.writeHead(200, { "content-type": "application/json" })
			.end(JSON.stringify(identity));
	};
	const routes: string[] = [];
	const server = createServer((request, response) => {
		routes.push(request.url!);
		reply(response);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw Error("Missing test port");
	const provider = createHttpProgrammaticFrames({
		base: `http://127.0.0.1:${address.port}/api/`,
	});
	const signal = AbortSignal.timeout(5000);
	try {
		expect(await provider.getAudioIdentity!({ request: {}, signal })).toEqual(
			identity,
		);
		expect(routes[0]).toBe("/api/programmatic/audio/identity");
		for (const value of [
			null,
			[],
			{ ...identity, extra: true },
			{ ...identity, version: 2 },
			{ ...identity, profile: "legacy" },
			{ ...identity, id: "A".repeat(64) },
			{ ...identity, id: "a".repeat(63) },
		]) {
			reply = (response) => {
				response
					.writeHead(200, { "content-type": "application/json" })
					.end(JSON.stringify(value));
			};
			await expect(
				provider.getAudioIdentity!({ request: {}, signal }),
			).rejects.toThrow("Invalid native audio identity");
		}
		reply = (response) => {
			response
				.writeHead(503, { "content-type": "application/json" })
				.end(JSON.stringify({ error: "identity unavailable" }));
		};
		await expect(
			provider.getAudioIdentity!({ request: {}, signal }),
		).rejects.toThrow("identity unavailable");
		reply = (response) => {
			response.writeHead(200, pcmHeaders).end(Buffer.alloc(16));
		};
		const request = { expectedIdentity: identity };
		expect((await provider.renderAudio!({ request, signal })).identity).toEqual(
			identity,
		);
		expect(routes.at(-1)).toBe("/api/programmatic/audio");
		for (const change of [
			{ "x-rocut-audio-profile": "" },
			{ "x-rocut-audio-identity": "" },
			{ "x-rocut-audio-identity": "b".repeat(64) },
			{ "x-rocut-audio-profile": "other" },
		]) {
			reply = (response) => {
				response
					.writeHead(200, { ...pcmHeaders, ...change })
					.end(Buffer.alloc(16));
			};
			await expect(
				provider.renderAudio!({ request, signal }),
			).rejects.toThrow();
		}
		reply = (response) => {
			const headers = { ...pcmHeaders };
			delete (headers as Partial<typeof headers>)["x-rocut-audio-profile"];
			delete (headers as Partial<typeof headers>)["x-rocut-audio-identity"];
			response.writeHead(200, headers).end(Buffer.alloc(16));
		};
		await expect(provider.renderAudio!({ request, signal })).rejects.toThrow(
			"runtime identity changed",
		);
		expect(
			(await provider.renderAudio!({ request: {}, signal })).identity,
		).toBeUndefined();
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
