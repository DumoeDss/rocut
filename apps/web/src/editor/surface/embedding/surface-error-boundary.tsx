"use client";

import { Component, type ReactNode, useId } from "react";

interface SurfaceErrorBoundaryProps {
	children: ReactNode;
	onError: (error: Error) => void;
}

interface SurfaceErrorBoundaryState {
	error: Error | null;
}

interface SurfaceErrorBoundaryImplProps extends SurfaceErrorBoundaryProps {
	titleId: string;
}

function normalizeError(value: unknown) {
	return value instanceof Error
		? value
		: new Error("The editor could not render.");
}

export function createSurfaceErrorReporter() {
	const reportedErrors = new WeakSet<Error>();
	return ({
		value,
		onError,
	}: {
		value: unknown;
		onError: (error: Error) => void;
	}) => {
		const error = normalizeError(value);
		if (reportedErrors.has(error)) return;
		reportedErrors.add(error);
		onError(error);
	};
}

class SurfaceErrorBoundaryImpl extends Component<
	SurfaceErrorBoundaryImplProps,
	SurfaceErrorBoundaryState
> {
	private readonly reportError = createSurfaceErrorReporter();
	state: SurfaceErrorBoundaryState = { error: null };

	static getDerivedStateFromError(value: unknown): SurfaceErrorBoundaryState {
		return { error: normalizeError(value) };
	}

	componentDidCatch(value: unknown) {
		this.reportError({ value, onError: this.props.onError });
	}

	render() {
		if (!this.state.error) return this.props.children;

		return (
			<section
				role="alert"
				aria-labelledby={this.props.titleId}
				className="flex size-full min-h-0 min-w-0 items-center justify-center overflow-auto bg-background p-6 text-foreground"
			>
				<div className="max-w-md rounded-md border bg-card p-5 shadow-sm">
					<h2 id={this.props.titleId} className="font-semibold">
						Editor unavailable
					</h2>
					<p className="mt-2 text-sm text-muted-foreground">
						The editor could not render. The host can safely reload this
						surface.
					</p>
				</div>
			</section>
		);
	}
}

export function SurfaceErrorBoundary(props: SurfaceErrorBoundaryProps) {
	return <SurfaceErrorBoundaryImpl {...props} titleId={useId()} />;
}
