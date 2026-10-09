/** TEST ONLY: vary scheduling without changing commands, paint or production.
 * The default is byte-identical. Validate before any realm/timer is allocated.
 */
export function nativeReplayDocument(
	document: string,
	batchSize?: 1 | 64 | 4096,
) {
	if (batchSize === undefined || batchSize === 64) return document;
	if (batchSize !== 1 && batchSize !== 4096)
		throw Error("Invalid controlled native command batch size");
	const anchor = "count < 64; count++";
	if (document.split(anchor).length !== 2)
		throw Error("Native scheduling diagnostic requires one exact batch anchor");
	return document.replace(anchor, `count < ${batchSize}; count++`);
}
