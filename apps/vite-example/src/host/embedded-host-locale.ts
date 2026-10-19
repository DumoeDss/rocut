/** Optional presentation channel; never authorizes project/content operations. */
export function subscribeEmbeddedHostLocale({
	target = window,
	onLocale,
}: {
	target?: LocaleTarget;
	onLocale: (locale: string) => void;
}): () => void {
	if (Object.is(target.parent, target)) return () => {};
	const requestId = `locale-${crypto.randomUUID()}`;
	let origin: string | null = null;
	const discover = (replyOrigin = "*") =>
		target.parent.postMessage(
			{
				type: "elftia:tool-host-locale-discover",
				version: 1,
				requestId,
			},
			replyOrigin,
		);
	const receive = (event: LocaleMessage) => {
		if (
			event.source !== target.parent ||
			event.origin === "null" ||
			(origin !== null && event.origin !== origin)
		)
			return;
		const data = event.data;
		if (!isRecord(data)) return;
		if (data.type === "elftia:tool-host-locale-request" && data.version === 1) {
			discover(event.origin);
			return;
		}
		if (
			!data ||
			data.type !== "elftia:tool-host-locale-changed" ||
			data.version !== 1 ||
			data.requestId !== requestId ||
			typeof data.locale !== "string" ||
			!/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(data.locale) ||
			data.locale.length > 64
		)
			return;
		origin ??= event.origin;
		onLocale(data.locale);
	};
	target.addEventListener("message", receive);
	// No-referrer embedding has no parent origin before discovery. This
	// request contains only a correlation id; subsequent replies are pinned.
	discover();
	return () => target.removeEventListener("message", receive);
}
interface LocaleMessage {
	source: unknown;
	origin: string;
	data: unknown;
}

interface LocaleTarget {
	parent: { postMessage(message: unknown, origin: string): void };
	addEventListener(
		type: "message",
		listener: (event: LocaleMessage) => void,
	): void;
	removeEventListener(
		type: "message",
		listener: (event: LocaleMessage) => void,
	): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
