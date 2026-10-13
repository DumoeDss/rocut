import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProgrammaticResource } from "@opencut/editor-contracts";
import {
	CompositionProductionError,
	type CompositionProductionRegistry,
} from "./composition-production";
import { NativeExportError } from "./host-export-native";
import { NATIVE_EXPORT_ARTIFACT_LIMIT } from "./native-export-readback";
import { validateResources } from "./programmatic/resources";

async function body(request: IncomingMessage, limit: number) {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += bytes.length;
		if (size > limit)
			throw new CompositionProductionError(
				"composition-production-request-too-large",
			);
		chunks.push(bytes);
	}
	return Buffer.concat(chunks);
}
async function json(request: IncomingMessage) {
	return JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(
			await body(request, 4 * 1024 * 1024),
		),
	);
}
/** The caller has already authenticated the Host token path. No arbitrary filesystem inputs. */
export async function handleCompositionProductionRoute(args: {
	request: IncomingMessage;
	response: ServerResponse;
	route: readonly string[];
	url: URL;
	registry: CompositionProductionRegistry;
	respond(status: number, value: unknown): void;
}) {
	const { request, response, route, url, registry, respond } = args;
	try {
		if (
			request.method === "POST" &&
			route.length === 2 &&
			route[1] === "probe"
		) {
			const input: unknown = await json(request);
			if (
				!input ||
				typeof input !== "object" ||
				Array.isArray(input) ||
				Object.keys(input).some((key) => !["request", "engine"].includes(key))
			)
				throw new CompositionProductionError(
					"composition-production-probe-invalid",
				);
			respond(200, await registry.probe(input));
			return;
		}
		if (
			request.method === "POST" &&
			route.length === 3 &&
			route[1] === "resources"
		) {
			const descriptor = request.headers["x-resource-descriptor"];
			if (
				typeof descriptor !== "string" ||
				descriptor.length > 8192 ||
				!/^[A-Za-z0-9_-]+$/.test(descriptor)
			)
				throw new CompositionProductionError(
					"composition-production-resource-descriptor-invalid",
				);
			const resource: unknown = JSON.parse(
				new TextDecoder("utf-8", { fatal: true }).decode(
					Buffer.from(descriptor, "base64url"),
				),
			);
			validateResources([resource]);
			const validated = resource as ProgrammaticResource;
			if (validated.attachmentKey !== route[2])
				throw new CompositionProductionError(
					"composition-production-resource-key-conflict",
				);
			respond(
				200,
				await registry.stage(
					validated,
					await body(request, validated.byteLength),
				),
			);
			return;
		}
		if (request.method === "POST" && route.length === 1) {
			respond(202, await registry.start(await json(request)));
			return;
		}
		if (
			request.method === "GET" &&
			route.length === 3 &&
			route[1] === "request"
		) {
			const observed = await registry.request(decodeURIComponent(route[2]));
			respond(
				observed ? 200 : 404,
				observed ?? { code: "composition-production-missing" },
			);
			return;
		}
		if (!/^[a-f0-9]{64}$/.test(route[1] ?? ""))
			throw new CompositionProductionError(
				"composition-production-request-id-invalid",
			);
		if (request.method === "GET" && route.length === 2) {
			const observed = await registry.observe(route[1]);
			respond(
				observed ? 200 : 404,
				observed ?? { code: "composition-production-missing" },
			);
			return;
		}
		if (
			request.method === "GET" &&
			route.length === 3 &&
			["manifest", "artifact"].includes(route[2])
		) {
			if (url.search)
				throw new CompositionProductionError(
					"composition-production-readback-query-not-allowed",
				);
			const result =
				route[2] === "manifest"
					? await registry.manifest(route[1])
					: await registry.artifact(route[1]);
			response.writeHead(200, {
				"content-type": result.mime,
				"content-length": result.bytes.byteLength,
				"x-content-sha256": result.sha256,
				"cache-control": "no-store",
				"x-content-type-options": "nosniff",
			});
			response.end(result.bytes);
			return;
		}
		if (
			route.length === 5 &&
			route[2] === "exports" &&
			request.method === "POST"
		) {
			const registryExport = await registry.exportRegistry(route[1]);
			const token = request.headers["x-native-export-token"];
			const owner = typeof token === "string" ? token : undefined;
			let result;
			if (route[4] === "progress")
				result = await registryExport.report(route[3], owner, {
					kind: "running",
					progress: (await json(request)).progress,
				});
			else if (route[4] === "result") {
				const failure = url.searchParams.get("error");
				result =
					failure === null
						? await registryExport.complete(
								route[3],
								owner,
								await body(request, NATIVE_EXPORT_ARTIFACT_LIMIT),
							)
						: await registryExport.report(
								route[3],
								owner,
								url.searchParams.get("terminated") === "true"
									? { kind: "cancelConfirmed" }
									: { kind: "failed", error: failure },
							);
			} else if (route[4] === "cancel")
				result = await registryExport.cancel(route[3]);
			else {
				respond(404, { code: "unknown-composition-production-route" });
				return;
			}
			respond(
				result ? 200 : 404,
				result ?? { code: "composition-production-export-missing" },
			);
			return;
		}
		respond(404, { code: "unknown-composition-production-route" });
	} catch (error) {
		if (
			error instanceof CompositionProductionError ||
			error instanceof NativeExportError
		) {
			respond(409, { code: error.code, error: error.message });
			return;
		}
		respond(400, { code: "composition-production-invalid-input" });
	}
}
