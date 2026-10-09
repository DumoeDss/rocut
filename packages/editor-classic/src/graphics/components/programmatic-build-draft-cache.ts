import type { ProgrammaticBuildDraft } from "./programmatic-build-draft";

const drafts = new WeakMap<object, Map<string, ProgrammaticBuildDraft>>();

/** Cache only subscribed, dirty, or active drafts within the owning editor. */
export function getCachedBuildDraft({
	owner,
	key,
	create,
}: {
	owner: object;
	key: string;
	create: () => ProgrammaticBuildDraft;
}) {
	let session = drafts.get(owner);
	if (!session) {
		session = new Map();
		drafts.set(owner, session);
	}
	let draft = session.get(key);
	if (!draft) {
		draft = create();
		const cache = session;
		const retained = draft;
		draft.setRetentionListener(() => {
			if (retained.isRetained()) cache.set(key, retained);
			else if (cache.get(key) === retained) cache.delete(key);
		});
	}
	return draft;
}
