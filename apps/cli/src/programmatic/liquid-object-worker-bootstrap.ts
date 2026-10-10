import { createHash } from "node:crypto";
import { validateParticleBootstrapTimeout } from "./particle-sampler-worker-bootstrap";
import type { spawnLiquidObjectProcess } from "./liquid-object-worker-process";

function deadline<T>({
	work,
	milliseconds,
}: {
	work: Promise<T>;
	milliseconds: number;
}): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(Error("Liquid process deadline exceeded")),
			milliseconds,
		);
		work.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(reason) => {
				clearTimeout(timer);
				reject(reason);
			},
		);
	});
}
/** The explicit pre-policy watchdog is Host infrastructure, not a Rust business limit. */
export async function bootstrapLiquidObjectProcess({
	spawned,
	frameJson,
	bootstrapTimeoutMs,
	signal,
}: {
	spawned: ReturnType<typeof spawnLiquidObjectProcess>;
	frameJson: string;
	bootstrapTimeoutMs: number;
	signal: AbortSignal;
}) {
	let rejectAbort!: (reason: Error) => void;
	const aborted = new Promise<never>((_, reject) => {
		rejectAbort = reject;
	});
	void aborted.catch(() => {});
	const abort = () => {
		rejectAbort(spawned.fail(Error("Liquid capture aborted")));
		void spawned.terminate().catch(() => {});
	};
	signal.addEventListener("abort", abort, { once: true });
	let terminationTimeoutMs = bootstrapTimeoutMs;
	try {
		validateParticleBootstrapTimeout(bootstrapTimeoutMs);
		signal.throwIfAborted();
		const published = await deadline({
			work: Promise.race([spawned.discover(), aborted]),
			milliseconds: bootstrapTimeoutMs,
		});
		terminationTimeoutMs = published.policy.terminationTimeoutMs;
		await deadline({
			work: Promise.race([
				spawned.activate({ frameJson, policyJson: published.policyJson }),
				aborted,
			]),
			milliseconds: published.policy.initTimeoutMs,
		});
		const terminate = async () => {
			clearTimeout(frameTimer);
			try {
				await deadline({
					work: spawned.terminate(),
					milliseconds: terminationTimeoutMs,
				});
			} finally {
				signal.removeEventListener("abort", abort);
			}
		};
		const frameTimer = setTimeout(() => {
			spawned.fail(Error("Liquid worker whole-frame timeout"));
			void terminate().catch(() => {});
		}, published.policy.frameTimeoutMs);
		const evaluationService = Object.freeze({
			async evaluate(envelope: string, requestSignal: AbortSignal) {
				const cancel = () => {
					spawned.fail(Error("Liquid evaluation aborted"));
					void spawned.terminate().catch(() => {});
				};
				requestSignal.addEventListener("abort", cancel, { once: true });
				try {
					requestSignal.throwIfAborted();
					return await deadline({
						work: spawned.evaluate(envelope),
						milliseconds: published.policy.requestTimeoutMs,
					});
				} catch (error) {
					spawned.fail(error);
					await terminate();
					throw error;
				} finally {
					requestSignal.removeEventListener("abort", cancel);
				}
			},
		});
		signal.throwIfAborted();
		return {
			policyJson: published.policyJson,
			policy: published.policy,
			publishedPolicyHash: createHash("sha256")
				.update(published.policyJson)
				.digest("hex"),
			policyHash: createHash("sha256")
				.update(published.policyJson)
				.digest("hex"),
			admission: {
				command: async (json: string) => {
					try {
						return await deadline({
							work: spawned.command(json),
							milliseconds: published.policy.requestTimeoutMs,
						});
					} catch (error) {
						spawned.fail(error);
						await terminate();
						throw error;
					}
				},
				terminate,
			},
			evaluate: evaluationService.evaluate,
			terminate,
		};
	} catch (error) {
		signal.removeEventListener("abort", abort);
		try {
			await deadline({
				work: spawned.terminate(),
				milliseconds: terminationTimeoutMs,
			});
		} catch (cleanup) {
			throw new AggregateError(
				[error, cleanup],
				"Liquid initialization failed with unfinished process ownership",
			);
		}
		throw error;
	} finally {
		// A successful capture keeps its abort observer until confirmed termination.
		void aborted.catch(() => {});
	}
}
