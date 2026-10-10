import type { ElementAnimations } from "../animation/types";
import { resolveAnimationPathValueAtTime } from "../animation";
import type { ScalarBatchResolver } from "../animation/scalar-batch-resolver";
import type { Transform } from "./index";

export function resolveTransformAtTime({
	baseTransform,
	animations,
	localTime,
	scalarBatch,
}: {
	baseTransform: Transform;
	animations: ElementAnimations | undefined;
	localTime: number;
	scalarBatch?: ScalarBatchResolver;
}): Transform {
	const safeLocalTime = Math.max(0, localTime);
	const sample = ({
		propertyPath,
		fallbackValue,
	}: {
		propertyPath: string;
		fallbackValue: number;
	}): number =>
		scalarBatch && scalarBatch.has({ path: propertyPath })
			? scalarBatch.sample({ path: propertyPath, fallbackValue })
			: resolveAnimationPathValueAtTime({
					animations,
					propertyPath,
					localTime: safeLocalTime,
					fallbackValue,
				});
	return {
		position: {
			x: sample({
				propertyPath: "transform.positionX",
				fallbackValue: baseTransform.position.x,
			}),
			y: sample({
				propertyPath: "transform.positionY",
				fallbackValue: baseTransform.position.y,
			}),
		},
		scaleX: sample({
			propertyPath: "transform.scaleX",
			fallbackValue: baseTransform.scaleX,
		}),
		scaleY: sample({
			propertyPath: "transform.scaleY",
			fallbackValue: baseTransform.scaleY,
		}),
		rotate: sample({
			propertyPath: "transform.rotate",
			fallbackValue: baseTransform.rotate,
		}),
	};
}
