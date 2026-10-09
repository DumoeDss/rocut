/** A straight hinge and one rigid perspective-projected outgoing plane. */
export interface MvBendTransition {
	readonly kind: "bend";
	readonly direction: "left" | "right" | "up" | "down";
	/** Normalized fold-axis position at eased progress 0.5. */
	readonly hinge: number;
	/** Maximum rotation in radians; actual rotation is progress * angle. */
	readonly angle: number;
	readonly perspective: number;
	/** Changes folded RGB brightness, not alpha. */
	readonly shading: number;
}
