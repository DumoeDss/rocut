// Opt-in fixture diagnostics. Never print endpoint URLs, expressions or tokens.
const OriginalWebSocket = globalThis.WebSocket;
globalThis.WebSocket = class extends OriginalWebSocket {
	constructor(...args) {
		super(...args);
		const start = Date.now();
		this.addEventListener("open", () =>
			console.error(`HTML phase: socket opened in ${Date.now() - start} ms`),
		);
		this.phases = new Map();
		this.addEventListener("message", ({ data }) => {
			try {
				const message = JSON.parse(String(data)),
					phase = this.phases.get(message.id);
				if (phase) {
					console.error(
						`HTML phase: ${phase.method} completed in ${Date.now() - phase.start} ms`,
					);
					this.phases.delete(message.id);
				}
				if (message.method === "Runtime.consoleAPICalled")
					for (const arg of message.params.args ?? []) {
						if (
							typeof arg.value === "string" &&
							arg.value.startsWith("ASCII probe:")
						)
							console.error(arg.value);
					}
			} catch {
				/* Other protocol traffic is deliberately omitted. */
			}
		});
	}
	send(data) {
		try {
			const message = JSON.parse(String(data));
			if (/^(Target|Runtime|Page|Network|Emulation)\./.test(message.method)) {
				this.phases.set(message.id, {
					method: message.method,
					start: Date.now(),
				});
				console.error(`HTML phase: ${message.method} started`);
			}
		} catch {
			/* Do not inspect non-JSON traffic. */
		}
		return super.send(data);
	}
};
