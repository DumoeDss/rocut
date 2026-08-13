export function isC4ProjectLoadComplete(editor: {
	readonly project: {
		getActiveOrNull(): unknown;
		getIsLoading(): boolean;
	};
}): boolean {
	return (
		editor.project.getActiveOrNull() !== null && !editor.project.getIsLoading()
	);
}
