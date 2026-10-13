/** Node-owned, opaque-origin broker only. Authored code always runs in a fresh
 * Worker; the broker terminates it before forwarding a terminal response.
 * No resources, project text or evaluated frame are retained in this owner.
 */
export class ProgrammaticSandboxRealm {
	private iframe: HTMLIFrameElement | undefined;
	private document: string | undefined;
	private loaded = false;
	private leased = false;
	private closed = false;
	private readonly abort = () => this.close();

	constructor(private readonly signal: AbortSignal) {
		signal.addEventListener("abort", this.abort, { once: true });
		if (signal.aborted) this.close();
	}

	get isClosed(): boolean {
		return this.closed;
	}

	acquire(document: string): {
		iframe: HTMLIFrameElement;
		loaded: boolean;
		release: (healthy: boolean) => void;
	} {
		this.signal.throwIfAborted();
		if (this.closed || this.leased) throw Error("Sandbox broker unavailable");
		if (this.document !== undefined && this.document !== document)
			throw Error("Sandbox broker document changed");
		this.iframe ??= globalThis.document.createElement("iframe");
		this.document = document;
		this.leased = true;
		let released = false;
		return {
			iframe: this.iframe,
			loaded: this.loaded,
			release: (healthy) => {
				if (released) return;
				released = true;
				this.leased = false;
				if (healthy && !this.closed) this.loaded = true;
				else this.close();
			},
		};
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.signal.removeEventListener("abort", this.abort);
		const iframe = this.iframe;
		this.iframe = undefined;
		this.document = undefined;
		if (iframe) {
			iframe.onload = null;
			iframe.remove();
		}
	}
}
