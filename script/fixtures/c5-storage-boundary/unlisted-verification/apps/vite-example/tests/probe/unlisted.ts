export function openUnlistedProbeDatabase() {
	return indexedDB.open("unlisted-probe");
}
