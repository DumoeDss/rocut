// Fixed Host-owned entry. Only captured trusted module bytes enter this process.
if (!process.send) throw Error("Liquid worker requires private IPC");
const bootstrapBytes = 256 * 1024 * 1024;
const dataPrefix = "data:text/javascript;base64,";
let stage = "discover",
	failed = false,
	busy = false,
	wasm,
	policy,
	policyJson,
	owner,
	frame,
	pending;
function shape(value, keys) {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.keys(value).length !== keys.length ||
		keys.some((key) => !Object.hasOwn(value, key))
	)
		throw Error("Invalid Liquid IPC shape");
	return value;
}
function text(value, maximum) {
	if (
		typeof value !== "string" ||
		value.length > maximum ||
		Buffer.byteLength(value, "utf8") > maximum
	)
		throw Error("Liquid IPC UTF-8 bound");
	return value;
}
function sameFrame(value) {
	shape(value, Object.keys(frame));
	return Object.keys(frame).every((key) => value[key] === frame[key]);
}
function stop() {
	if (failed) return;
	failed = true;
	process.send('{"version":1,"kind":"failure"}', () => process.exit(1));
}
function send(value, maximum, terminal = false) {
	text(value, maximum);
	process.send(value, (error) => {
		if (error || terminal) process.exit(1);
	});
}
async function initialize(request) {
	if (stage === "discover") {
		shape(request, ["version", "kind", "moduleUrl"]);
		if (
			request.version !== 1 ||
			request.kind !== "discover" ||
			!text(request.moduleUrl, bootstrapBytes).startsWith(dataPrefix)
		)
			throw Error("Invalid Liquid bootstrap");
		let moduleUrl = request.moduleUrl,
			blob;
		if (process.versions.bun) {
			const bytes = Buffer.from(moduleUrl.slice(dataPrefix.length), "base64");
			moduleUrl = blob = URL.createObjectURL(
				new Blob([bytes], { type: "text/javascript" }),
			);
		}
		try {
			wasm = await import(moduleUrl);
		} finally {
			if (blob) URL.revokeObjectURL(blob);
		}
		if (
			typeof wasm.evaluateLiquidObjectFrameJson !== "function" ||
			typeof wasm.liquidObjectTransportPolicyJson !== "function" ||
			typeof wasm.LiquidObjectTransportOwner !== "function"
		)
			throw Error("Missing opaque Rust Liquid owner exports");
		policyJson = text(wasm.liquidObjectTransportPolicyJson(), 65536);
		policy = JSON.parse(policyJson);
		if (
			policy.version !== 1 ||
			Object.entries(policy).some(
				([key, value]) =>
					key !== "version" && (!Number.isSafeInteger(value) || value <= 0),
			)
		)
			throw Error("Invalid Rust Liquid policy");
		stage = "activate";
		send(JSON.stringify({ version: 1, kind: "policy", policyJson }), 65536);
	} else {
		shape(request, ["version", "kind", "policyJson", "frameJson"]);
		if (
			request.version !== 1 ||
			request.kind !== "activate" ||
			request.policyJson !== policyJson
		)
			throw Error("Liquid policy identity mismatch");
		frame = JSON.parse(text(request.frameJson, policy.maxControlJsonBytes));
		owner = new wasm.LiquidObjectTransportOwner(request.frameJson);
		stage = "active";
		send('{"version":1,"kind":"ready"}', policy.maxControlJsonBytes);
	}
}
async function control(json, request) {
	text(json, policy.maxControlJsonBytes);
	const bound = request.identity?.frame ?? request.frame;
	if (!sameFrame(bound)) throw Error("Liquid control mapped frame mismatch");
	if (
		request.operation === "settle" &&
		(!pending?.actual ||
			request.identity.requestId !== pending.identity.requestId ||
			request.responseJsonBytes !== pending.actual.json ||
			request.responseEnvelopeBytes !== pending.actual.envelope)
	)
		throw Error("Liquid settle does not match actual reply bytes");
	const reply = text(await owner.command(json), policy.maxControlJsonBytes);
	const result = JSON.parse(reply);
	if (result.version !== 1 || typeof result.ok !== "boolean")
		throw Error("Malformed Rust control reply");
	if (result.ok && request.operation === "reserve")
		pending = { ...request, reservation: result.reservation };
	if (result.ok && ["settle", "dispose"].includes(request.operation))
		pending = undefined;
	if (!result.ok) failed = true;
	send(reply, policy.maxControlJsonBytes, !result.ok);
}
function reservedText({ value, kind }) {
	const key = `maxResponse${kind}Bytes`;
	return text(value, Math.min(policy[key], pending.reservation[key]));
}
async function evaluate(json, request) {
	text(json, policy.maxRequestEnvelopeBytes);
	shape(request, ["version", "identity", "payloadJson"]);
	shape(request.identity, ["frame", "requestId"]);
	if (
		request.version !== 1 ||
		!pending ||
		pending.actual ||
		!sameFrame(request.identity.frame) ||
		request.identity.requestId !== pending.identity.requestId
	)
		throw Error("Liquid evaluation lacks matching Rust reservation");
	const payload = text(request.payloadJson, policy.maxRequestJsonBytes);
	const parsed = shape(
		JSON.parse(payload),
		"version params positions time seed".split(" "),
	);
	if (
		parsed.version !== 1 ||
		parsed.time !== frame.time ||
		parsed.seed !== frame.seed ||
		!Array.isArray(parsed.positions) ||
		parsed.positions.length !== pending.vertices * 3 ||
		Buffer.byteLength(payload, "utf8") !== pending.requestJsonBytes ||
		Buffer.byteLength(json, "utf8") !== pending.requestEnvelopeBytes
	)
		throw Error("Liquid evaluation differs from reserved actual payload");
	const payloadJson = reservedText({
		value: await wasm.evaluateLiquidObjectFrameJson(payload),
		kind: "Json",
	});
	const envelope = JSON.stringify({
		version: 1,
		identity: request.identity,
		payloadJson,
	});
	reservedText({ value: envelope, kind: "Envelope" });
	pending.actual = {
		json: Buffer.byteLength(payloadJson, "utf8"),
		envelope: Buffer.byteLength(envelope, "utf8"),
	};
	send(envelope, policy.maxResponseEnvelopeBytes);
}
process.on("disconnect", () => process.exit(0));
process.on("message", (value) => {
	if (failed) return;
	if (busy) {
		stop();
		return;
	}
	busy = true;
	void (async () => {
		try {
			if (stage !== "active") await initialize(value);
			else {
				const json = text(
					value,
					Math.max(policy.maxRequestEnvelopeBytes, policy.maxControlJsonBytes),
				);
				const request = JSON.parse(json);
				if (Object.hasOwn(request, "operation")) await control(json, request);
				else await evaluate(json, request);
			}
		} catch {
			stop();
		} finally {
			busy = false;
		}
	})();
});
