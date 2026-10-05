import type { TransactionEngine } from "./types";

/** Host-provided Rust codec. Must be deterministic, collision-resistant and
 * idempotent; unknown formats must remain unchanged, never become valid keys. */
export type OperationFingerprintNormalizer = (fingerprint: string) => string;

const normalizers = new WeakMap<object, OperationFingerprintNormalizer>();

export function registerOperationFingerprintNormalizer({
	engine,
	normalize,
}: {
	readonly engine: TransactionEngine<string>;
	readonly normalize: OperationFingerprintNormalizer | undefined;
}): void {
	if (normalizers.has(engine))
		throw new TypeError("Fingerprint normalizer is already registered");
	if (normalize) normalizers.set(engine, normalize);
}

/** Draft preflight must use the exact codec bound to its native engine. */
export function bindOperationFingerprintNormalizer(
	engine: TransactionEngine<string>,
): OperationFingerprintNormalizer | undefined {
	return normalizers.get(engine);
}
