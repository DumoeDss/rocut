import type {
	MvCamera,
	MvColor,
	MvPose,
	MvRole,
	MvTransition,
} from "./mv-recipe";
import type { MvEffect } from "./mv-recipe-post";
import type { MvDrawCommand } from "./mv-recipe-transition";
import type { MvTransitionEdge } from "./mv-recipe-transition";
import type { MvSpriteGlow, MvSpriteUnderlay } from "./mv-recipe-sprite";
import type { MvGeneratorPlan } from "./mv-recipe-generators";
import type { MvLightLeakPlan } from "./mv-light-leak";
import type { MvAfterimagePlan } from "./mv-afterimage";
import type { MvTypeCardPlan } from "./mv-type-card-plan";
import type { MvConvergePlan } from "./mv-converge-plan";
import type { MvEmberPlan } from "./mv-ember-plan";
import type { MvTitleRiffPlan } from "./mv-title-riff-plan";

/** Internal raster transport, produced exclusively by Rust frame evaluation. */
export type MvPlanNode =
	| {
			readonly kind: "kanjiSlam";
			readonly role: MvRole;
			readonly data: MvEmberPlan;
	  }
	| {
			readonly kind: "titleRiff";
			readonly role: MvRole;
			readonly data: MvTitleRiffPlan;
	  }
	| {
			readonly kind: "ember";
			readonly role: MvRole;
			readonly data: MvEmberPlan;
	  }
	| {
			readonly kind: "converge";
			readonly role: MvRole;
			readonly data: MvConvergePlan;
	  }
	| {
			readonly kind: "typeCard";
			readonly role: MvRole;
			readonly data: MvTypeCardPlan;
	  }
	| {
			readonly kind: "afterimage";
			readonly role: MvRole;
			readonly data: MvAfterimagePlan;
	  }
	| {
			readonly kind: "imageSequence";
			readonly imageKey: string;
			readonly role: MvRole;
			readonly view: MvCamera;
	  }
	| MvGeneratorPlan
	| { readonly kind: "empty" }
	| {
			readonly kind: "ref";
			readonly input: MvPlanNode;
			readonly sampledFrame: number;
	  }
	| {
			readonly kind: "panels";
			readonly panels: readonly {
				readonly input: MvPlanNode;
				readonly polygon: readonly (readonly [number, number])[];
				readonly transform: readonly [
					number,
					number,
					number,
					number,
					number,
					number,
				];
				readonly border: MvTransitionEdge | null;
			}[];
	  }
	| { readonly kind: "solid"; readonly role: MvRole; readonly color: MvColor }
	| {
			readonly kind: "illust";
			readonly background: {
				readonly image: string;
				readonly camera: MvCamera;
			} | null;
			readonly sprites: readonly {
				readonly image: string;
				readonly role: MvRole;
				readonly pose: MvPose;
				readonly anchor: readonly [number, number];
				readonly flip: boolean;
				readonly slices:
					| readonly {
							readonly start: number;
							readonly end: number;
							readonly offset: number;
					  }[]
					| null;
				readonly shadow: MvSpriteUnderlay | null;
				readonly rim: MvSpriteUnderlay | null;
				readonly silhouette: MvColor | null;
				readonly glow: MvSpriteGlow | null;
			}[];
	  }
	| {
			readonly kind: "transition";
			readonly from: MvPlanNode;
			readonly to: MvPlanNode;
			readonly progress: number;
			readonly style: MvTransition;
			readonly commands: readonly MvDrawCommand[];
	  };
export interface MvRecipePlan {
	readonly version: 1;
	readonly songSeconds: number;
	readonly outputRoles: readonly MvRole[];
	readonly root: MvPlanNode;
	readonly post: readonly {
		readonly stage: "role" | "composite";
		readonly roles: readonly MvRole[];
		readonly effects: readonly {
			readonly effect: MvEffect;
			readonly seed: number;
			readonly lightLeak?: MvLightLeakPlan;
		}[];
	}[];
}
