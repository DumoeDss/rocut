/**
 * The alien store's wire codec (S05 P3, design E7).
 *
 * The store persists every record as a JSON string, so structured values the
 * payload may legally carry -- Date, Map, Set, ArrayBuffer -- need a typed
 * encoding inside that JSON text. This codec is that encoding: a deliberate,
 * documented subset with an unforgeable marker scheme, NOT a normalization
 * pass. Values outside the subset (functions, symbols, class instances,
 * non-finite numbers) are a typed corrupt failure at the boundary -- they are
 * never silently dropped or coerced, which is the difference between an alien
 * representation and a lossy one.
 *
 * Marker scheme: structural entries are single-key objects whose key is
 * MARKER-prefixed (a NUL byte, then "alien:"). A literal payload key that
 * itself starts with NUL is escaped with one extra leading NUL, so a payload
 * containing such keys round-trips exactly and can never be mistaken for a
 * marker.
 */

/** The NUL byte, spelled without an escape so the source stays pure ASCII. */
const NUL = String.fromCharCode(0);

/** Prefix of every structural marker key the codec writes. */
const MARKER = `${NUL}alien:`;

/** Thrown for values outside the codec's documented subset. */
export class AlienCodecError extends Error {
	constructor(reason: string) {
		super(`Alien store cannot serialize this value: ${reason}`);
		this.name = "AlienCodecError";
	}
}

function escapeKey(key: string): string {
	return key.startsWith(NUL) ? `${NUL}${key}` : key;
}

function unescapeKey(key: string): string {
	return key.startsWith(`${NUL}${NUL}`) ? key.slice(1) : key;
}

function isPlainObject(value: object): value is Record<string, unknown> {
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

/** Encode one value into the JSON-safe wire form. Throws outside the subset. */
export function alienEncode(value: unknown): unknown {
	if (value === null) return null;
	if (typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new AlienCodecError("numbers must be finite");
		}
		return value;
	}
	if (typeof value === "string") return value;
	if (typeof value === "function" || typeof value === "symbol") {
		throw new AlienCodecError(
			`values of type ${typeof value} are outside the serialized subset`,
		);
	}
	if (value instanceof Date) {
		return { [`${MARKER}date`]: value.toISOString() };
	}
	if (value instanceof Map) {
		return {
			[`${MARKER}map`]: [...value].map(([k, v]) => [
				alienEncode(k),
				alienEncode(v),
			]),
		};
	}
	if (value instanceof Set) {
		return { [`${MARKER}set`]: [...value].map((entry) => alienEncode(entry)) };
	}
	if (value instanceof ArrayBuffer) {
		return {
			[`${MARKER}bytes`]: Buffer.from(value).toString("base64"),
		};
	}
	if (Array.isArray(value)) {
		return value.map((entry) => alienEncode(entry));
	}
	if (value === undefined) {
		// Fail closed with the codec's own error rather than a TypeError from
		// getPrototypeOf — `undefined` is outside the serialized subset (the
		// same subset structuredClone carries drops it; store null instead).
		throw new AlienCodecError(
			"undefined is outside the serialized subset; store null instead",
		);
	}
	if (!isPlainObject(value)) {
		throw new AlienCodecError(
			"class instances are outside the serialized subset; store plain data",
		);
	}
	const encoded: Record<string, unknown> = {};
	// Own enumerable properties only -- the same surface structuredClone carries.
	// Symbol-keyed and non-enumerable properties are not part of the payload.
	for (const [key, property] of Object.entries(value)) {
		encoded[escapeKey(key)] = alienEncode(property);
	}
	return encoded;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		isPlainObject(value as object)
	);
}

function decodeBytes(text: string): ArrayBuffer {
	const bytes = Buffer.from(text, "base64");
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
}

function decodeMarkedKey(
	key: string,
	value: Record<string, unknown>,
): { decoded: unknown; matched: boolean } {
	if (key === `${MARKER}date`) {
		return { decoded: new Date(value[key] as string), matched: true };
	}
	if (key === `${MARKER}map`) {
		const entries = value[key] as unknown[];
		if (!Array.isArray(entries)) {
			throw new AlienCodecError("malformed map entry in stored text");
		}
		return {
			decoded: new Map(
				entries.map((entry) => {
					if (!Array.isArray(entry) || entry.length !== 2) {
						throw new AlienCodecError("malformed map entry in stored text");
					}
					return [alienDecode(entry[0]), alienDecode(entry[1])];
				}),
			),
			matched: true,
		};
	}
	if (key === `${MARKER}set`) {
		const entries = value[key] as unknown[];
		if (!Array.isArray(entries)) {
			throw new AlienCodecError("malformed set entry in stored text");
		}
		return {
			decoded: new Set(entries.map((entry) => alienDecode(entry))),
			matched: true,
		};
	}
	if (key === `${MARKER}bytes`) {
		return { decoded: decodeBytes(value[key] as string), matched: true };
	}
	return { decoded: undefined, matched: false };
}

/** Revive one decoded JSON value back to its structured form. */
function alienDecode(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => alienDecode(entry));
	}
	if (!isPlainRecord(value)) return value;
	const keys = Object.keys(value);
	if (keys.length === 1 && keys[0].startsWith(NUL)) {
		const key = keys[0];
		if (key.startsWith(`${NUL}${NUL}`)) {
			// A literal key that started with NUL: strip the escape NUL.
			return { [key.slice(1)]: alienDecode(value[key]) };
		}
		const marked = decodeMarkedKey(key, value);
		if (marked.matched) return marked.decoded;
		throw new AlienCodecError(`unknown structural marker in stored text`);
	}
	const decoded: Record<string, unknown> = {};
	for (const key of keys) {
		decoded[unescapeKey(key)] = alienDecode(value[key]);
	}
	return decoded;
}

/** Serialize a value to the store's wire text. */
export function alienText(value: unknown): string {
	return JSON.stringify(alienEncode(value));
}

/** Parse the store's wire text back to a fresh value (a clone, by construction). */
export function fromAlienText(text: string): unknown {
	return alienDecode(JSON.parse(text));
}
