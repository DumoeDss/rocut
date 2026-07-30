"use client";

import type { ImgHTMLAttributes } from "react";

type NativeImgProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "width" | "height">;

export interface HostImageProps extends NativeImgProps {
	src: string;
	alt: string;
	width?: number | string;
	height?: number | string;
	/** Fill the nearest positioned ancestor, as `next/image`'s `fill` does. */
	fill?: boolean;
	/** Accepted and ignored — meaningful only to a server image optimizer. */
	sizes?: string;
	/** Accepted and ignored — this element is always unoptimized. */
	unoptimized?: boolean;
}

/**
 * A plain `<img>` standing in for `next/image` inside the editor.
 *
 * This is behaviour-preserving rather than a downgrade: every editor call site
 * already passed `unoptimized`, and the one that did not points at an SVG, which
 * Next does not optimize either. Next was already serving the raw `src` at all of
 * them, so both hosts render identically.
 *
 * `sizes` and `unoptimized` are accepted so call sites need not be rewritten, and
 * ignored because neither means anything without an optimizer.
 */
export function HostImage({
	fill,
	sizes: _sizes,
	unoptimized: _unoptimized,
	style,
	width,
	height,
	...props
}: HostImageProps) {
	const fillStyle = fill
		? ({
				position: "absolute",
				inset: 0,
				width: "100%",
				height: "100%",
			} as const)
		: undefined;

	return (
		// eslint-disable-next-line @next/next/no-img-element -- deliberate: the editor must build without a Next runtime.
		<img
			{...props}
			// `fill` sizes from the ancestor, so intrinsic dimensions would fight it.
			width={fill ? undefined : width}
			height={fill ? undefined : height}
			style={fillStyle ? { ...fillStyle, ...style } : style}
		/>
	);
}
