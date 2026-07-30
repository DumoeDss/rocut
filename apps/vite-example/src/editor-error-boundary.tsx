import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Host-side error boundary for the embedded editor.
 *
 * Spec §3.4 asks for a **visible diagnostic instead of a blank editor**. Without
 * a boundary, an exception thrown during editor bootstrap unmounts the whole
 * React tree and leaves the container empty, which is precisely the outcome the
 * criterion excludes.
 *
 * This is a real, reproducible path rather than a hypothetical one. Running the
 * production build in a browser with `--disable-gpu --disable-software-rasterizer`:
 * WebGPU surface creation fails, project-thumbnail generation throws
 * `GPU context not initialized`, and the editor tree unmounted to a blank page.
 * The same run against `apps/web` produced Next's built-in "Application error: a
 * client-side exception has occurred" — so **the underlying crash is upstream
 * behaviour present in both hosts**, and the only difference was that Next ships
 * a framework-level boundary and a bare Vite host does not.
 *
 * So this deliberately does **not** try to prevent or recover from the crash;
 * changing that would be editor behaviour, and the parity reference would be
 * lost. It only ensures the host has something to show when the crash happens.
 */
interface State {
	error: Error | null;
}

export class EditorErrorBoundary extends Component<{ children: ReactNode }, State> {
	state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("Editor crashed:", error, info.componentStack);
	}

	render() {
		const { error } = this.state;
		if (!error) return this.props.children;

		// `window.__wasmPanic` is the side channel `rust/wasm` writes a panic
		// message to and `editor-provider.tsx` reads. Surfacing it here means a
		// wasm panic is still visible even when the crash happened somewhere the
		// provider's own error state never rendered.
		const wasmPanic =
			typeof window !== "undefined"
				? (window as { __wasmPanic?: string }).__wasmPanic
				: undefined;

		return (
			<div
				role="alert"
				data-testid="editor-error-boundary"
				style={{
					height: "100%",
					overflow: "auto",
					padding: "24px",
					color: "#eee",
					background: "#1a1a1a",
					font: "13px/1.6 system-ui, sans-serif",
				}}
			>
				<h2 style={{ margin: "0 0 8px", fontSize: "16px", fontWeight: 600 }}>
					The editor failed to start
				</h2>
				<p style={{ margin: "0 0 16px", color: "#aaa" }}>
					This is the host's diagnostic surface, not an editor screen. The most
					common cause is that the browser could not provide a GPU context.
				</p>
				<pre
					style={{
						margin: 0,
						padding: "12px",
						background: "#000",
						borderRadius: "6px",
						whiteSpace: "pre-wrap",
						wordBreak: "break-word",
					}}
				>
					{error.message || String(error)}
				</pre>
				{wasmPanic ? (
					<>
						<h3 style={{ margin: "16px 0 8px", fontSize: "14px", fontWeight: 600 }}>
							WASM panic
						</h3>
						<pre
							style={{
								margin: 0,
								padding: "12px",
								background: "#000",
								borderRadius: "6px",
								whiteSpace: "pre-wrap",
								wordBreak: "break-word",
							}}
						>
							{wasmPanic}
						</pre>
					</>
				) : null}
			</div>
		);
	}
}
