export async function saveEffectPreview({
	commit,
	discard,
}: {
	commit: () => Promise<boolean>;
	discard: () => void;
}): Promise<string> {
	try {
		if (await commit()) return "";
	} catch {
		// Transaction errors leave the authored state intact.
	}
	discard();
	return "Effect was not saved. Previous values restored; check your changes and try again.";
}
