import { expect, test } from "bun:test";
import { ExportCancelledError } from "../export-cancellation";
import { ExportVp9QuantizerSource } from "../export-vp9-quantizer-source";
import {
	canvas,
	config,
	deferred,
	fakeVp9,
	options,
	tick,
	timing,
} from "./export-vp9-quantizer-fake";

test("explicit quantizer, original seconds, native output order and metadata survive", async () => {
	const fake = fakeVp9();
	const source = new ExportVp9QuantizerSource({
		options: options({ quantizer: 32 }),
		platform: fake.platform,
	});
	await source.add({ canvas, timing: timing(0.1234567) });
	await source.add({ canvas, timing: timing(0.2, false) });
	const metadata = {
		decoderConfig: { codec: config.codec, codedWidth: 16, codedHeight: 16 },
	};
	fake.output({
		timestamp: 200000,
		metadata: metadata,
		bytes: 4,
		type: "delta",
	});
	fake.output({ timestamp: 123456 });
	metadata.decoderConfig.codedWidth = 99;
	await source.close();
	expect(fake.submitted[0]).toEqual({
		timestamp: 123456,
		duration: 33333,
		options: { keyFrame: true, vp9: { quantizer: 32 } },
	});
	expect(
		fake.packets.map(({ packet }) => [
			packet.timestamp,
			packet.duration,
			packet.type,
		]),
	).toEqual([
		[0.2, 1 / 30, "delta"],
		[0.1234567, 1 / 30, "key"],
	]);
	expect(fake.packets[0].metadata?.decoderConfig?.codedWidth).toBe(16);
	expect(fake.control.framesClosed).toBe(2);
	expect(fake.control.sourceClosed).toBe(1);
	expect(fake.control.encoderClosed).toBe(1);
	await source.close();
	fake.error(Error("late"));
	fake.output({ timestamp: 200000 });
	expect(fake.control.sourceClosed).toBe(1);
});

test("dequeue and packet changes cannot unregister cancellation of pending flush", async () => {
	const fake = fakeVp9();
	const pending = deferred<void>();
	fake.control.flush = () => pending.promise;
	const source = new ExportVp9QuantizerSource({
		options: options(),
		platform: fake.platform,
	});
	await source.add({ canvas, timing: timing() });
	const closing = source.close();
	fake.dequeue();
	fake.output({ timestamp: 0 });
	await tick();
	source.cancel();
	await expect(closing).rejects.toBeInstanceOf(ExportCancelledError);
	pending.reject(Error("late flush failure"));
	await tick();
	expect(fake.control.sourceClosed).toBe(0);
});

test("never resolving capability probe settles on cancel and late support creates no encoder", async () => {
	const fake = fakeVp9();
	const pending = deferred<VideoEncoderSupport>();
	fake.control.probe = () => pending.promise;
	const source = new ExportVp9QuantizerSource({
		options: options(),
		platform: fake.platform,
	});
	const adding = source.add({ canvas, timing: timing() });
	const closing = source.close();
	const settled = Promise.allSettled([adding, closing]);
	source.cancel();
	for (const result of await settled) {
		expect(result.status).toBe("rejected");
		if (result.status === "rejected")
			expect(result.reason).toBeInstanceOf(ExportCancelledError);
	}
	pending.resolve({ supported: true, config });
	await tick();
	expect(fake.control.created).toBe(0);
});

test("close waits pending initialization and submission before flush", async () => {
	const fake = fakeVp9();
	const pending = deferred<VideoEncoderSupport>();
	fake.control.probe = () => pending.promise;
	fake.control.flush = async () => {
		fake.output({ timestamp: 0 });
	};
	const source = new ExportVp9QuantizerSource({
		options: options(),
		platform: fake.platform,
	});
	const adding = source.add({ canvas, timing: timing() });
	const closing = source.close();
	await expect(source.add({ canvas, timing: timing(1) })).rejects.toThrow(
		"closing",
	);
	pending.resolve({ supported: true, config });
	await adding;
	await closing;
	expect(fake.submitted).toHaveLength(1);
	expect(fake.control.sourceClosed).toBe(1);
});

test("first encode failure survives a failing owned frame close", async () => {
	const fake = fakeVp9();
	fake.control.encodeError = Error("first encode");
	fake.control.frameCloseError = Error("frame close");
	const source = new ExportVp9QuantizerSource({
		options: options(),
		platform: fake.platform,
	});
	await expect(source.add({ canvas, timing: timing() })).rejects.toThrow(
		"first encode",
	);
	await expect(source.close()).rejects.toThrow("first encode");
	expect(fake.control.framesClosed).toBe(1);
});

test("packet reservations wait for writes and cancellation discards unstarted writes", async () => {
	const fake = fakeVp9();
	const write = deferred<void>();
	fake.control.write = () => write.promise;
	const source = new ExportVp9QuantizerSource({
		options: options({ maxEncodeQueueSize: 1, maxPendingPackets: 2 }),
		platform: fake.platform,
	});
	await source.add({ canvas, timing: timing() });
	fake.output({ timestamp: 0 });
	await source.add({ canvas, timing: timing(1) });
	fake.output({ timestamp: 1000000 });
	const adding = source.add({ canvas, timing: timing(2) });
	await tick();
	expect(fake.submitted).toHaveLength(2);
	expect(fake.packets).toHaveLength(1);
	source.cancel();
	await expect(adding).rejects.toBeInstanceOf(ExportCancelledError);
	write.reject(Error("late writer failure"));
	await tick();
	expect(fake.packets).toHaveLength(1);
});

test("encoder dequeue releases queue capacity", async () => {
	const fake = fakeVp9();
	const source = new ExportVp9QuantizerSource({
		options: options({ maxEncodeQueueSize: 1 }),
		platform: fake.platform,
	});
	await source.initialize();
	fake.encoder.encodeQueueSize = 1;
	const adding = source.add({ canvas, timing: timing() });
	await tick();
	expect(fake.submitted).toHaveLength(0);
	fake.encoder.encodeQueueSize = 0;
	fake.dequeue();
	await adding;
	fake.output({ timestamp: 0 });
	await source.close();
});

test("close drains started writes and cancel settles a stalled drain", async () => {
	for (const cancel of [false, true]) {
		const fake = fakeVp9();
		const write = deferred<void>();
		fake.control.write = () => write.promise;
		const source = new ExportVp9QuantizerSource({
			options: options(),
			platform: fake.platform,
		});
		await source.add({ canvas, timing: timing() });
		fake.output({ timestamp: 0 });
		const closing = source.close();
		const settled = Promise.allSettled([closing]);
		await tick();
		expect(fake.control.sourceClosed).toBe(0);
		if (cancel) source.cancel();
		else write.resolve();
		const [result] = await settled;
		expect(result.status).toBe(cancel ? "rejected" : "fulfilled");
		expect(fake.control.sourceClosed).toBe(cancel ? 0 : 1);
		if (cancel) write.resolve();
		await tick();
	}
});

test("reservation boundary flushes retained outputs before next submission", async () => {
	const fake = fakeVp9();
	fake.control.flush = async () => {
		for (const frame of fake.submitted.slice(-1))
			fake.output({ timestamp: frame.timestamp });
	};
	const source = new ExportVp9QuantizerSource({
		options: options({ maxEncodeQueueSize: 1, maxPendingPackets: 1 }),
		platform: fake.platform,
	});
	await source.add({ canvas, timing: timing() });
	await source.add({ canvas, timing: timing(1) });
	await source.close();
	expect(fake.packets).toHaveLength(2);
});

test("byte overflow fails before packet submission and ignores late callbacks", async () => {
	const fake = fakeVp9();
	const source = new ExportVp9QuantizerSource({
		options: options({ maxPendingBytes: 3 }),
		platform: fake.platform,
	});
	await source.add({ canvas, timing: timing() });
	fake.output({ timestamp: 0, bytes: 4 });
	await expect(source.close()).rejects.toThrow("byte limit");
	fake.output({ timestamp: 0 });
	fake.error(Error("late"));
	expect(fake.packets).toHaveLength(0);
});

test("write failure stops queue and remains the first error", async () => {
	const fake = fakeVp9();
	fake.control.write = async () => {
		throw Error("mux write");
	};
	const source = new ExportVp9QuantizerSource({
		options: options(),
		platform: fake.platform,
	});
	await source.add({ canvas, timing: timing() });
	fake.output({ timestamp: 0 });
	await tick();
	await expect(source.close()).rejects.toThrow("mux write");
	expect(fake.control.sourceClosed).toBe(0);
});

test("a synchronous native error during flush observes its returned rejection", async () => {
	const fake = fakeVp9();
	const source = new ExportVp9QuantizerSource({
		options: options(),
		platform: fake.platform,
	});
	await source.initialize();
	fake.control.flush = () => {
		fake.error(Error("first native error"));
		return Promise.reject(Error("later flush rejection"));
	};
	await expect(source.close()).rejects.toThrow("first native error");
	await tick();
});

test("unknown and duplicate output timestamps fail", async () => {
	for (const duplicate of [false, true]) {
		const fake = fakeVp9();
		const source = new ExportVp9QuantizerSource({
			options: options(),
			platform: fake.platform,
		});
		await source.add({ canvas, timing: timing() });
		if (duplicate) fake.output({ timestamp: 0 });
		fake.output({ timestamp: duplicate ? 0 : 99 });
		await expect(source.close()).rejects.toThrow("unknown or duplicate");
	}
});

test("missing frame output, decoder metadata and requested keyframes fail", async () => {
	for (const mode of ["missing", "metadata", "keyframe"]) {
		const fake = fakeVp9();
		const source = new ExportVp9QuantizerSource({
			options: options(),
			platform: fake.platform,
		});
		await source.add({ canvas, timing: timing() });
		if (mode === "metadata") fake.output({ timestamp: 0, metadata: {} });
		if (mode === "keyframe")
			fake.output({ timestamp: 0, metadata: {}, bytes: 4, type: "delta" });
		await expect(source.close()).rejects.toThrow(
			mode === "missing"
				? "missing frame"
				: mode === "metadata"
					? "decoder metadata"
					: "keyframe",
		);
	}
});

test("capability must retain quantizer and alpha configuration", async () => {
	const fake = fakeVp9();
	fake.control.probe = async () => ({
		supported: true,
		config: { ...config, bitrateMode: "variable" },
	});
	const source = new ExportVp9QuantizerSource({
		options: options(),
		platform: fake.platform,
	});
	await expect(source.initialize()).rejects.toThrow("does not support");
	expect(fake.control.created).toBe(0);
});

test("quantizer and frame timing are explicitly validated", async () => {
	for (const quantizer of [-1, 64, 0.5, NaN])
		expect(
			() =>
				new ExportVp9QuantizerSource({
					options: options({ quantizer }),
					platform: fakeVp9().platform,
				}),
		).toThrow("integer");
	const fake = fakeVp9();
	const source = new ExportVp9QuantizerSource({
		options: options(),
		platform: fake.platform,
	});
	await source.add({ canvas, timing: timing(0.0000011) });
	await expect(
		source.add({ canvas, timing: timing(0.0000019) }),
	).rejects.toThrow("unique");
	expect(fake.control.framesClosed).toBe(1);
});
