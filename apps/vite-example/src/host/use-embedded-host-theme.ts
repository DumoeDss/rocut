import { useEffect, useState } from "react";

/** Only the embedding parent can override appearance; no data/API capabilities. */
export function useEmbeddedHostTheme() {
	const [theme, setTheme] = useState<"light" | "dark" | undefined>();
	useEffect(() => {
		if (window.parent === window) return;
		const onMessage = (event: MessageEvent) => {
			if (event.source !== window.parent) return;
			const data = event.data;
			if (data?.type !== "elftia:tool-host-theme" || data?.version !== 1)
				return;
			if (data.theme === "light" || data.theme === "dark") setTheme(data.theme);
		};
		window.addEventListener("message", onMessage);
		// no-referrer embedding means the parent origin is unknown. The request
		// carries no URL, token, or user data; replies are source-checked above.
		window.parent.postMessage(
			{ type: "elftia:request-tool-host-theme", version: 1 },
			"*",
		);
		return () => window.removeEventListener("message", onMessage);
	}, []);
	return theme;
}
