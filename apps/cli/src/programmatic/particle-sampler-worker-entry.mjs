// Fixed host-owned process entry; Node and Bun use the same IPC wire.
if (!process.send) throw Error("Particle sampler requires private IPC");
function text(value, limit) {
	if (typeof value !== "string" || value.length > limit) return false;
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code >= 0xd800 && code <= 0xdbff) {
			const low = value.charCodeAt(++i);
			if (!(low >= 0xdc00 && low <= 0xdfff)) return false;
		} else if (code >= 0xdc00 && code <= 0xdfff) return false;
	}
	return Buffer.byteLength(value, "utf8") <= limit;
}

function compatible(value, base, narrow = false) {
	if (typeof base === "number")
		return (
			Number.isSafeInteger(value) &&
			value > 0 &&
			(narrow ? value <= base : value === base)
		);
	if (typeof base === "string") return value === base;
	if (!base || !value || typeof value !== "object" || Array.isArray(value))
		return false;
	const keys = Object.keys(base);
	return (
		Object.keys(value).length === keys.length &&
		keys.every(
			(key) =>
				Object.hasOwn(value, key) &&
				compatible(value[key], base[key], narrow || key === "hostDefaults"),
		)
	);
}
let failed = false,
	initializing = false,
	wasm,
	limits,
	publishedJson,
	published,
	lastId = 0,
	requests = 0;
function fail(code) {
	if (failed) return;
	failed = true;
	process.send({ version: 1, kind: "failure", code }, () => process.exit(1));
}
process.on("disconnect", () => process.exit(0));
process.on("message", (request) => {
	if (failed) return;
	if (!initializing) {
		initializing = true;
		void (async () => {
			try {
				if (
					!request ||
					Object.keys(request).length !== 3 ||
					request.version !== 1 ||
					request.kind !== "discover" ||
					typeof request.moduleUrl !== "string" ||
					(!request.moduleUrl.startsWith("data:text/javascript;base64,") &&
						new URL(request.moduleUrl).protocol !== "file:")
				)
					throw Error("Invalid initialization");
				let moduleUrl = request.moduleUrl;
				let ownedBlob;
				if (
					process.versions.bun &&
					moduleUrl.startsWith("data:text/javascript;base64,")
				) {
					ownedBlob = URL.createObjectURL(
						new Blob(
							[
								Buffer.from(
									moduleUrl.slice("data:text/javascript;base64,".length),
									"base64",
								),
							],
							{ type: "text/javascript" },
						),
					);
					moduleUrl = ownedBlob;
				}
				try {
					wasm = await import(moduleUrl);
				} finally {
					if (ownedBlob) URL.revokeObjectURL(ownedBlob);
				}
				if (
					typeof wasm.sampleParticleSurfaceJson !== "function" ||
					typeof wasm.particleTransportPolicyJson !== "function"
				)
					throw Error("Missing Rust surface export");
				publishedJson = wasm.particleTransportPolicyJson();
				if (!text(publishedJson, 65_536))
					throw Error("Invalid policy getter result");
				published = JSON.parse(publishedJson);
				process.send({ version: 1, kind: "policy", policyJson: publishedJson });
			} catch {
				fail("init");
			}
		})();
		return;
	}
	if (!limits) {
		try {
			if (
				!wasm ||
				!request ||
				Object.keys(request).length !== 4 ||
				request.version !== 1 ||
				request.kind !== "init" ||
				request.publishedPolicyJson !== publishedJson ||
				!text(request.policyJson, 65_536)
			)
				throw Error("Invalid policy activation");
			const effective = JSON.parse(request.policyJson);
			if (!compatible(effective, published))
				throw Error("Policy mismatch or widened limit");
			limits = effective.hostDefaults;
			process.send({ version: 1, kind: "ready" });
		} catch {
			fail("policy");
		}
		return;
	}
	if (
		!wasm ||
		!request ||
		typeof request !== "object" ||
		Array.isArray(request) ||
		Object.keys(request).length !== 4 ||
		request.version !== 1 ||
		request.operation !== "particleSurface" ||
		!Number.isSafeInteger(request.id) ||
		request.id <= lastId ||
		requests >= limits.maxRequestsPerFrame ||
		!text(JSON.stringify(request), limits.maxRequestEnvelopeBytes) ||
		!text(request.requestJson, limits.maxRequestJsonBytes)
	) {
		fail("request");
		return;
	}
	lastId = request.id;
	requests++;
	process.send({ version: 1, kind: "started", id: request.id });
	try {
		// Sync WASM cannot observe AbortSignal. Only host process termination can
		// guarantee interruption across the supported runtimes.
		const responseJson = wasm.sampleParticleSurfaceJson(request.requestJson);
		if (!text(responseJson, limits.maxResponseJsonBytes)) {
			fail("response");
			return;
		}
		const reply = { version: 1, kind: "result", id: request.id, responseJson };
		if (!text(JSON.stringify(reply), limits.maxResponseEnvelopeBytes)) {
			fail("responseEnvelope");
			return;
		}
		process.send(reply);
	} catch {
		fail("execution");
	}
});
