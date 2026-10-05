import { expect, test } from "bun:test";
import { CliRequestError, request } from "../host-request";

for (const fixture of [
	{
		route: "motion-text/catalog",
		status: 401,
		code: "authentication-required",
	},
	{ route: "motion-text/catalog", status: 403, code: "forbidden" },
	{ route: "motion-text/catalog", status: 503, code: "unavailable" },
	{
		route: "motion-text/sequences/missing/mutations",
		status: 404,
		code: "motion-text-sequence-not-found",
	},
	{ route: "context", status: 404, code: "not-found" },
]) {
	test(
		fixture.status +
			" " +
			fixture.route +
			" is not misdiagnosed as an old plugin",
		async () => {
			const response = { code: fixture.code, message: "specific host refusal" };
			const server = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				fetch: () => Response.json(response, { status: fixture.status }),
			});
			try {
				try {
					await request(
						{ port: server.port!, token: "test-token" },
						"GET",
						fixture.route,
					);
					throw Error("expected refusal");
				} catch (error) {
					expect(error).toBeInstanceOf(CliRequestError);
					if (!(error instanceof CliRequestError)) throw error;
					expect(error.status).toBe(fixture.status);
					expect(error.response).toEqual(response);
					expect(error.message).toContain("specific host refusal");
					expect(error.message).not.toContain("Upgrade");
				}
			} finally {
				server.stop(true);
			}
		},
	);
}

test("non-JSON success remains a protocol error, never upgrade advice or leaked HTML", async () => {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => new Response("<html>unexpected document</html>"),
	});
	try {
		await expect(
			request(
				{ port: server.port!, token: "test-token" },
				"GET",
				"motion-text/catalog",
			),
		).rejects.toMatchObject({
			status: 200,
			response: { code: "invalid-host-response" },
		});
	} finally {
		server.stop(true);
	}
});
