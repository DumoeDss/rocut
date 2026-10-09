export interface EmberRasterEvent {
	readonly target: string;
	readonly op: string;
	readonly args: readonly unknown[];
	readonly state: Record<string, unknown>;
}
interface State {
	transform: unknown[][];
	clip: unknown;
	path: number;
	steps: unknown[][];
}
export function createEmberRecordingContext({
	events,
	noPattern,
	drawError,
}: {
	events: EmberRasterEvent[];
	noPattern?: boolean;
	drawError?: boolean;
}) {
	let pathId = 0;
	return class Context {
		[key: string]: unknown;
		readonly state: State = { transform: [], clip: [], path: 0, steps: [] };
		readonly stack: {
			properties: Record<string, unknown>;
			transform: unknown[][];
			clip: unknown;
		}[] = [];
		letterSpacing = "0px";
		constructor(readonly target: string) {}
		properties() {
			const { stack: _stack, state: _state, ...properties } = this;
			return properties;
		}
		record({ op, args = [] }: { op: string; args?: readonly unknown[] }) {
			events.push({
				target: this.target,
				op,
				args,
				state: { ...this.properties(), ...this.state },
			});
		}
		save() {
			this.stack.push({
				properties: this.properties(),
				transform: this.state.transform,
				clip: this.state.clip,
			});
			this.record({ op: "save" });
		}
		restore() {
			const saved = this.stack.pop();
			if (!saved) throw Error("Unbalanced Canvas restore");
			for (const key of Object.keys(this))
				if (!["target", "state", "stack"].includes(key)) delete this[key];
			for (const [key, value] of Object.entries(saved.properties))
				if (key !== "target") this[key] = value;
			// Canvas save/restore does not save its current path.
			this.state.transform = saved.transform;
			this.state.clip = saved.clip;
			this.record({ op: "restore" });
		}
		getTransform() {
			this.record({ op: "getTransform" });
			return {
				transform: this.state.transform.map((operation) => [...operation]),
			};
		}
		setTransform(...args: (number | { transform: unknown[][] })[]) {
			const snapshot = args[0];
			this.state.transform =
				args.length === 1 && snapshot && typeof snapshot === "object"
					? snapshot.transform.map((operation) => [...operation])
					: [["setTransform", ...args]];
			this.record({ op: "setTransform", args });
		}
		step({ op, args }: { op: string; args: number[] }) {
			this.state.transform = [...this.state.transform, [op, ...args]];
			this.record({ op, args });
		}
		translate(...args: number[]) {
			this.step({ op: "translate", args });
		}
		rotate(...args: number[]) {
			this.step({ op: "rotate", args });
		}
		scale(...args: number[]) {
			this.step({ op: "scale", args });
		}
		setLineDash(args: number[]) {
			this.record({ op: "setLineDash", args });
		}
		beginPath() {
			this.state.path = ++pathId;
			this.state.steps = [];
			this.record({ op: "beginPath" });
		}
		path({ op, args }: { op: string; args: unknown[] }) {
			this.state.steps = [...this.state.steps, [op, ...args]];
			this.record({ op, args });
		}
		moveTo(...args: number[]) {
			this.path({ op: "moveTo", args });
		}
		lineTo(...args: number[]) {
			this.path({ op: "lineTo", args });
		}
		rect(...args: number[]) {
			this.path({ op: "rect", args });
		}
		closePath() {
			this.path({ op: "closePath", args: [] });
		}
		arc(...args: unknown[]) {
			this.path({ op: "arc", args });
		}
		ellipse(...args: unknown[]) {
			this.path({ op: "ellipse", args });
		}
		clip(rule: string) {
			this.state.clip = {
				rule,
				transform: this.state.transform,
				steps: this.state.steps,
			};
			this.record({ op: "clip", args: [rule] });
		}
		fill() {
			this.record({ op: "fill" });
		}
		stroke() {
			this.record({ op: "stroke" });
		}
		fillRect(...args: number[]) {
			this.record({ op: "fillRect", args });
		}
		strokeRect(...args: number[]) {
			this.record({ op: "strokeRect", args });
		}
		clearRect(...args: number[]) {
			this.record({ op: "clearRect", args });
		}
		fillText(...args: unknown[]) {
			this.record({ op: "fillText", args });
		}
		strokeText(...args: unknown[]) {
			this.record({ op: "strokeText", args });
		}
		measureText() {
			throw Error("Rasterizer must not measure/layout text");
		}
		drawImage(...args: unknown[]) {
			this.record({ op: "drawImage", args });
			if (drawError) throw Error("fixture image failure");
		}
		gradient({ kind, args }: { kind: string; args: number[] }) {
			this.record({ op: kind, args });
			const stops: unknown[] = [];
			return {
				kind,
				stops,
				addColorStop(...[offset, color]: [number, string]) {
					stops.push([offset, color]);
				},
			};
		}
		createLinearGradient(...args: number[]) {
			return this.gradient({ kind: "createLinearGradient", args });
		}
		createRadialGradient(...args: number[]) {
			return this.gradient({ kind: "createRadialGradient", args });
		}
		createPattern(...[canvas, repeat]: [unknown, string]) {
			this.record({ op: "createPattern", args: [canvas, repeat] });
			return noPattern ? null : { canvas, repeat };
		}
		createImageData(...[w, h]: [number, number]) {
			return { data: new Uint8ClampedArray(w * h * 4) };
		}
		putImageData(
			...[pixels, x, y]: [{ data: Uint8ClampedArray }, number, number]
		) {
			this.record({ op: "putImageData", args: [[...pixels.data], x, y] });
		}
	};
}
