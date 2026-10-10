export async function digest({
	bytes,
	nativeWebCrypto,
}: {
	bytes: Uint8Array;
	nativeWebCrypto: { readonly subtle: Pick<SubtleCrypto, "digest"> };
}) {
	if (!(bytes.buffer instanceof ArrayBuffer))
		throw Error("Heart binary snapshot cannot use shared memory");
	return [
		...new Uint8Array(
			await nativeWebCrypto.subtle.digest(
				"SHA-256",
				new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
			),
		),
	]
		.map((v) => v.toString(16).padStart(2, "0"))
		.join("");
}
