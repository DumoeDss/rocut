/**
 * The id-generation port.
 *
 * The editor already generates ids internally, so this looks redundant until you
 * ask what makes a headless run (C7) or an automation run (S03) *reproducible*.
 * A Host that wants determinism needs a seam to supply it through, and no S02
 * acceptance clause exercises this one — which is exactly why the reason is
 * recorded here rather than left to be rediscovered.
 */
export interface IdGenerator {
	/**
	 * A fresh id. `scope` lets an implementation keep independent sequences —
	 * a deterministic generator that shared one counter across kinds would make
	 * an unrelated change to one kind renumber another, which defeats the point.
	 */
	next(args: { scope: string }): string;
}
