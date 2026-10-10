import assert from "node:assert/strict";
import { bits, sampleReference, semantics } from "./animation-scalar-reference.mjs";

function envelope(value) {
	assert(value && Number.isFinite(value.min) && Number.isFinite(value.max));
	assert(value.min <= value.max);
}

function errorCheck(result, expected) {
	assert.equal(result.status, "error");
	assert.equal(result.error.code, expected.code);
	assert.equal(typeof result.error.path, "string");
	for (const key of ["sampleIndex", "keyIndex"]) if (key in expected) assert.equal(result.error[key], expected[key]);
	assert(!("values" in result), "Failed item exposed partial values");
	return { status: "error", code: result.error.code, path: result.error.path };
}

function sampleCheck(result, item) {
	assert.equal(result.status, "values");
	assert.equal(result.values.length, item.times.length);
	const parity = item.times.map((time, index) => {
		const expected = sampleReference(item, time), actual = result.values[index];
		assert(Number.isFinite(actual));
		const expectedBits = bits(expected), actualBits = bits(actual);
		assert.equal(actualBits, expectedBits, `${item.id} sample ${index}: ${actual} != ${expected}`);
		return { index, timeBits: bits(time), expectedBits, actualBits, equal: true };
	});
	return { status: "values", samples: parity.length, bitParity: parity };
}

function inspectionCheck(result, item, expected) {
	if (expected.status === "error") return errorCheck(result, expected);
	assert.equal(result.status, expected.status);
	assert.deepEqual(result.domain, item.domain);
	assert.equal(result.visitedNodes, expected.visitedNodes);
	assert.equal(result.budget.requestedNodes, item.budget.maxNodes);
	assert(Number.isInteger(result.budget.effectiveNodes) && result.budget.effectiveNodes >= 0);
	assert(result.budget.effectiveNodes <= result.budget.requestedNodes);
	assert(result.visitedNodes <= result.budget.effectiveNodes);
	if (result.status === "unresolved") {
		assert.equal(result.reason.code, expected.code);
		assert(!("values" in result)); assert(!("displayed" in result));
		assert(Number.isFinite(result.unprovenDomain.start) && Number.isFinite(result.unprovenDomain.end));
		assert(result.unprovenDomain.start >= item.domain.start && result.unprovenDomain.end <= item.domain.end);
		assert(result.unprovenDomain.start <= result.unprovenDomain.end);
		return { status: result.status, visitedNodes: result.visitedNodes, reason: result.reason.code };
	}
	if (result.status === "violation") {
		assert.equal(result.reason.code, expected.code);
		assert(Number.isFinite(result.time) && result.time >= item.domain.start && result.time <= item.domain.end);
		let sampled, arithmeticFailure = false;
		try { sampled = sampleReference(item, result.time); }
		catch (error) { assert.equal(error.code, "non-finite-arithmetic"); arithmeticFailure = true; }
		if (arithmeticFailure) assert(!("value" in result));
		else {
			assert.equal(bits(result.value), bits(sampled));
			const displayed = sampled * item.bounds.displayMultiplier;
			if (result.reason.code === "outside-bounds") {
				assert(Number.isFinite(displayed));
				assert((item.bounds.min !== undefined && displayed < item.bounds.min)
					|| (item.bounds.max !== undefined && displayed > item.bounds.max));
			} else assert(!Number.isFinite(displayed));
		}
		return { status: result.status, reason: result.reason.code, witnessTimeBits: bits(result.time),
			...(arithmeticFailure ? { arithmeticFailure: true } : { witnessValueBits: bits(sampled) }) };
	}
	assert.equal(result.certificateVersion, 1); assert.equal(result.numericSemantics, semantics);
	envelope(result.values); envelope(result.displayed);
	if (item.bounds.min !== undefined) assert(result.displayed.min >= item.bounds.min);
	if (item.bounds.max !== undefined) assert(result.displayed.max <= item.bounds.max);
	const times = [item.domain.start, item.domain.end, (item.domain.start + item.domain.end) / 2,
		...item.channel.keys.map(key => key.time)].filter(time => time >= item.domain.start && time <= item.domain.end);
	for (const time of times) {
		const value = sampleReference(item, time), displayed = value * item.bounds.displayMultiplier;
		assert(value >= result.values.min && value <= result.values.max);
		assert(displayed >= result.displayed.min && displayed <= result.displayed.max);
	}
	return { status: "safe", visitedNodes: result.visitedNodes, independentlyCheckedPoints: times.length };
}

export function checkResponse(spec, responseText) {
	assert.equal(typeof responseText, "string");
	assert(Buffer.byteLength(responseText, "utf8") <= 4 * 1024 * 1024);
	const output = JSON.parse(responseText);
	assert.equal(output.version, 1); assert(!("ok" in output));
	if (spec.expected.kind === "request-error") {
		assert.equal(output.kind, "request-error"); assert.equal(output.error.code, spec.expected.code);
		assert(!("results" in output));
		return { status: "request-error", code: output.error.code, path: output.error.path };
	}
	const input = JSON.parse(spec.input);
	assert.equal(output.kind, "batch-result"); assert.equal(output.numericSemantics, semantics);
	assert.equal(output.results.length, input.items.length);
	let visited = 0;
	const rows = output.results.map((result, index) => {
		const item = input.items[index]; assert.equal(result.id, item.id);
		const expected = spec.expected.items?.[index];
		let checked;
		if (spec.api === "inspect") {
			if (expected.status !== "error") assert.equal(result.budget.effectiveNodes, Math.min(item.budget.maxNodes, input.budget.maxNodes - visited));
			checked = inspectionCheck(result, item, expected);
			visited += result.visitedNodes ?? 0;
		} else checked = expected?.status === "error" ? errorCheck(result, expected) : sampleCheck(result, item);
		return { id: item.id, ...checked };
	});
	if (spec.api === "inspect") {
		assert.equal(visited, spec.expected.visitedNodes);
		assert.deepEqual(output.budget, { maxNodes: input.budget.maxNodes, visitedNodes: visited });
	} else assert(!("budget" in output));
	return { status: "batch-result", results: rows, ...(spec.api === "inspect" ? { visitedNodes: visited } : {}) };
}
