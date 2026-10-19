import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

import { downloadBuffer } from "../../export";
import { downloadBlob } from "../browser";

function createResources() {
	let created = 0;
	let revoked = 0;
	return {
		resources: {
			createObjectUrl: () => ({
				resourceId: `download-url-${++created}`,
				url: `blob:download-${created}`,
				revoke: () => {
					revoked += 1;
				},
			}),
		},
		created: () => created,
		revoked: () => revoked,
	};
}

const nativeSetTimeout = globalThis.setTimeout;

function installDownloadTimer() {
	const deferred: { delay: number | undefined; run: () => void }[] = [];
	spyOn(globalThis, "setTimeout").mockImplementation(
		(handler, delay, ...args) => {
			deferred.push({ delay, run: () => handler(...args) });
			return nativeSetTimeout(() => {}, 0);
		},
	);
	return deferred;
}

function installDocument({
	clickError,
	removeError,
}: {
	clickError?: unknown;
	removeError?: unknown;
} = {}) {
	let appendCalls = 0;
	let removeCalls = 0;
	const anchor = {
		href: "",
		download: "",
		parentNode: null as unknown,
		click: () => {
			if (clickError !== undefined) throw clickError;
		},
	};
	const body = {
		appendChild: () => {
			appendCalls += 1;
			anchor.parentNode = body;
		},
		removeChild: () => {
			removeCalls += 1;
			if (removeError !== undefined) throw removeError;
			anchor.parentNode = null;
		},
	};
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: {
			body,
			createElement: () => anchor,
		},
	});
	return {
		appendCalls: () => appendCalls,
		removeCalls: () => removeCalls,
	};
}

const documentDescriptor = Object.getOwnPropertyDescriptor(
	globalThis,
	"document",
);

afterEach(() => {
	mock.restore();
	if (documentDescriptor) {
		Object.defineProperty(globalThis, "document", documentDescriptor);
	} else {
		Reflect.deleteProperty(globalThis, "document");
	}
});

describe("transient download object-URL ownership", () => {
	test("export retains its URL through asynchronous download handoff then releases it", async () => {
		const fixture = createResources();
		const dom = installDocument();
		const deferred = installDownloadTimer();
		downloadBlob({
			blob: new Blob(["utility"]),
			filename: "utility.bin",
			resources: fixture.resources,
		});
		downloadBuffer({
			buffer: Uint8Array.of(1).buffer,
			filename: "export.bin",
			mimeType: "application/octet-stream",
			resources: fixture.resources,
		});
		expect(fixture.created()).toBe(2);
		expect(fixture.revoked()).toBe(1);
		expect(dom.appendCalls()).toBe(2);
		expect(dom.removeCalls()).toBe(2);
		await new Promise<void>((resolve) => nativeSetTimeout(resolve, 0));
		expect(fixture.revoked()).toBe(1);
		expect(deferred).toHaveLength(1);
		expect(deferred[0]?.delay).toBe(60_000);
		deferred[0]?.run();
		expect(fixture.revoked()).toBe(2);
	});

	test("a click error still removes the utility anchor and revokes its URL", () => {
		const clickError = new Error("click failed");
		const fixture = createResources();
		const dom = installDocument({ clickError });
		expect(() =>
			downloadBlob({
				blob: new Blob(["utility-error"]),
				filename: "utility-error.bin",
				resources: fixture.resources,
			}),
		).toThrow(clickError);
		expect(dom.removeCalls()).toBe(1);
		expect(fixture.revoked()).toBe(1);
	});

	test("a failed export click revokes immediately, but removal failure preserves a started download", () => {
		const deferred = installDownloadTimer();
		const cancellation = new DOMException("download cancelled", "AbortError");
		const cancelledFixture = createResources();
		installDocument({ clickError: cancellation });
		expect(() =>
			downloadBuffer({
				buffer: Uint8Array.of(2).buffer,
				filename: "cancelled.bin",
				mimeType: "application/octet-stream",
				resources: cancelledFixture.resources,
			}),
		).toThrow(cancellation);
		expect(cancelledFixture.revoked()).toBe(1);
		expect(deferred).toHaveLength(0);

		const removeError = new Error("remove failed");
		const removeFixture = createResources();
		installDocument({ removeError });
		expect(() =>
			downloadBuffer({
				buffer: Uint8Array.of(3).buffer,
				filename: "remove-error.bin",
				mimeType: "application/octet-stream",
				resources: removeFixture.resources,
			}),
		).toThrow(removeError);
		expect(removeFixture.revoked()).toBe(0);
		expect(deferred).toHaveLength(1);
		deferred[0]?.run();
		expect(removeFixture.revoked()).toBe(1);
	});
});
