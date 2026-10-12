export function createNativeAudioNetworkObservations() {
	return {
		schema: "rocut-native-audio-network-observations/v1",
		consoleFailures: [],
		contextHttpFailures: [],
		viteHttpFailures: [],
		fixtureHttpFailures: [],
		fixtureServerLimitReached: false,
		contextResponses: { total: 0, byStatus: {} },
		dropped: {},
	};
}
export function recordNativeAudioNetworkObservation({
	observations,
	key,
	value,
}) {
	if (
		![
			"consoleFailures",
			"contextHttpFailures",
			"viteHttpFailures",
			"fixtureHttpFailures",
		].includes(key)
	)
		return;
	const records = observations[key];
	if (records.length >= 64) {
		observations.dropped[key] = (observations.dropped[key] ?? 0) + 1;
		return;
	}
	records.push({ sequence: records.length, ...value });
}
