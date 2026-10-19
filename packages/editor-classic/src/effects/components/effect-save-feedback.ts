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
	return "效果未保存，已恢复原来的参数，请检查修改后重试。";
}
