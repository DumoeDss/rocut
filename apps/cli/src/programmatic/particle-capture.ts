import { createHash, randomUUID } from "node:crypto";
import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import type { ParticleIdentity } from "./particle-protocol";

const hash = (value: string | Uint8Array) =>
	createHash("sha256").update(value).digest("hex");

function canonical(value: unknown, depth = 0): unknown {
	if (depth > 32)
		throw Error("Particle capture identity exceeds its nesting bound");
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return value;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index++)
			if (!Object.hasOwn(value, index))
				throw Error("Particle capture identity contains a sparse array");
		return value.map((item) => canonical(item, depth + 1));
	}
	if (
		value &&
		typeof value === "object" &&
		[Object.prototype, null].includes(Object.getPrototypeOf(value))
	) {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [
					key,
					canonical((value as Record<string, unknown>)[key], depth + 1),
				]),
		);
	}
	throw Error("Particle capture identity must contain only complete JSON data");
}

/** Caller has already admitted the C1 archive and loaded verified attachments.
 * Bind the exact code/resource bytes and entire Rust publication, not a second
 * host-side calculation of time, frame number, seed or geometry. */
export function createParticleCaptureIdentity(options: {
	session: string;
	code: string;
	resources: readonly ResolvedProgrammaticResource[];
	archiveIdentityHash: string;
	frame: unknown;
}): ParticleIdentity {
	if (!options.session || !/^[a-f0-9]{64}$/.test(options.archiveIdentityHash))
		throw Error("Particle capture requires an admitted archive identity");
	const seen = new Set<string>();
	const resources = options.resources
		.map(({ resource, body }) => {
			if (
				seen.has(resource.id) ||
				body.byteLength !== resource.byteLength ||
				hash(new Uint8Array(body)) !== resource.sha256
			)
				throw Error(
					"Particle capture resource identity changed after verification",
				);
			seen.add(resource.id);
			return { ...resource };
		})
		.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	return Object.freeze({
		sessionId: options.session,
		captureId: randomUUID(),
		sourceId: hash(
			JSON.stringify(
				canonical({
					codeSha256: hash(options.code),
					resources,
					archiveIdentityHash: options.archiveIdentityHash,
				}),
			),
		),
		frameId: hash(JSON.stringify(canonical(options.frame))),
	});
}

/** Recheck immediately before serializing the page expression, with no await in
 * between. Store implementations may retain mutable resource buffers while the
 * private sampler is starting; the initial grant must never follow new bytes. */
export function assertParticleCaptureSnapshot(
	expected: ParticleIdentity,
	options: Parameters<typeof createParticleCaptureIdentity>[0],
): void {
	const actual = createParticleCaptureIdentity(options);
	if (
		actual.sessionId !== expected.sessionId ||
		actual.sourceId !== expected.sourceId ||
		actual.frameId !== expected.frameId
	)
		throw Error(
			"Particle capture source or Rust frame changed before page serialization",
		);
}

export function raceParticleCapture<T>(
	work: Promise<T>,
	failures: readonly Promise<never>[],
): Promise<T> {
	return Promise.race([work, ...failures]);
}

/** Never let a failed cleanup skip another owner or replace the primary cause.
 * The browser is closed only after page and broker cleanup have been awaited. */
export async function withHtmlCaptureCleanup<T>(options: {
	run(): Promise<T>;
	cleanupPage(): Promise<void>;
	disposeBrokers: readonly (() => Promise<void>)[];
	closeBrowser(): Promise<void>;
}): Promise<T> {
	let result!: T;
	let primary: unknown;
	let failed = false;
	try {
		result = await options.run();
	} catch (error) {
		failed = true;
		primary = error;
	}
	const cleanup: unknown[] = [];
	try {
		await options.cleanupPage();
	} catch (error) {
		cleanup.push(error);
	}
	const brokers = await Promise.allSettled(
		options.disposeBrokers.map((dispose) => Promise.resolve().then(dispose)),
	);
	for (const outcome of brokers)
		if (outcome.status === "rejected") cleanup.push(outcome.reason);
	try {
		await options.closeBrowser();
	} catch (error) {
		cleanup.push(error);
	}
	if (failed) {
		if (cleanup.length)
			throw new AggregateError(
				[primary, ...cleanup],
				"HTML capture and cleanup failed",
				{ cause: primary },
			);
		throw primary;
	}
	if (cleanup.length === 1) throw cleanup[0];
	if (cleanup.length)
		throw new AggregateError(cleanup, "HTML capture cleanup failed");
	return result;
}
