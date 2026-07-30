/**
 * The seam between the editor and whatever application is hosting it.
 *
 * The editor used to reach for `next/navigation` route globals directly. Those
 * three uses are now named callbacks supplied by the host, so the editor asserts
 * nothing about URL structure — or about there being a router at all.
 *
 * This **is** the Host port contract. It began as the identity, navigation and
 * server-endpoint concerns that blocked a Next-free build, and its header used
 * to say storage, media and clock ports were a later concern that would "widen
 * this one interface rather than scattering new props". They have arrived, and
 * that is what happened: the port roles are composed in below from
 * `@/editor/ports`, which is the single entry point for all of them.
 *
 * Nothing consumes the ports yet. Wiring is later work; this interface is the
 * frozen shape it will be wired to.
 */

import { PORT_ROLES } from "@/editor/ports";
import type { EditorHostPorts } from "@/editor/ports";

export interface EditorHostNavigation {
	/**
	 * The requested project did not exist, so the editor created a replacement.
	 * The host decides what that means: a route change, local state, or nothing.
	 * Was `router.replace(`/editor/${id}`)`.
	 */
	onProjectReplaced(args: { projectId: string }): void;

	/** The user closed the project. Was `router.push("/projects")`. */
	onExitProject(): void;

	/** The user backed out of the mobile gate. Was `router.back()`. */
	onGoBack(): void;
}

/**
 * Server endpoints the host is able to serve. Absent means "this host has no
 * server", and the feature renders an explicit unavailable state rather than
 * issuing a request.
 *
 * Absence has to be declared rather than discovered: against a static build with
 * an SPA fallback, `fetch("/api/...")` returns `index.html` with HTTP 200, so the
 * failure would surface as a JSON parse error — misleading rather than visible.
 */
export interface EditorHostServices {
	/** Freesound search proxy. Next host: `/api/sounds/search`. */
	soundSearchEndpoint?: string;
	/** Feedback submission. Next host: `/api/feedback`. */
	feedbackEndpoint?: string;
}

/**
 * Presentation the host owns rather than the editor.
 *
 * These were module constants imported from `@/site/*`, which is product-shell
 * code that the distributable editor graph must not contain. Routing them
 * through the host keeps one source of truth — the Next host still reads
 * `@/site/brand`, so `apps/web` renders exactly what it did at the pin — while
 * an embedding host supplies its own.
 */
export interface EditorHostBranding {
	/** Logo shown in the editor header. Next host: `DEFAULT_LOGO_URL`. */
	logoUrl: string;
}

/**
 * External destinations the editor links out to.
 *
 * Full URLs rather than a site root, for the same reason the navigation
 * callbacks are named operations: the editor should assert nothing about a
 * host's URL structure.
 */
export interface EditorHostLinks {
	/** Community invite, from the header menu and named in onboarding. */
	discordUrl: string;
	/** Product roadmap, linked from the mobile gate. */
	roadmapUrl: string;
}

/**
 * The host seam, widened with the port roles.
 *
 * The five original members are preserved **verbatim**: both hosts supply them
 * exactly as they did, and every existing consumer keeps working.
 *
 * The port roles are `Partial` at *this* level, and only for one reason: making
 * them required here would break both hosts' compilation the instant this
 * interface changed, and neither host's source is in this change's write set.
 * Optionality here is **not** the contract being soft. A session is created from
 * `ResolvedEditorHost`, where every role is required, and `resolveEditorHost`
 * refuses — by name — to produce one from a host that is missing roles. So the
 * only thing optionality buys is that a host can be widened one role at a time
 * while it is being wired; it never buys a session running without a port.
 */
export interface EditorHost extends Partial<EditorHostPorts> {
	/** The project the editor should open. Was `useParams().project_id`. */
	projectId: string;
	navigation: EditorHostNavigation;
	services: EditorHostServices;
	branding: EditorHostBranding;
	links: EditorHostLinks;
}

/** A host with every port role supplied. What a session is created from. */
export type ResolvedEditorHost = EditorHost & EditorHostPorts;

/**
 * Narrow a host to one a session can be created from, or throw naming what is
 * missing.
 *
 * Throwing beats defaulting to the in-memory reference implementation. A silent
 * fallback would mean a host that forgot to supply storage would run, appear to
 * work, and lose the user's projects on reload — a failure that surfaces late
 * and looks like data loss rather than like a missing port.
 */
export function resolveEditorHost(args: {
	host: EditorHost;
}): ResolvedEditorHost {
	const missing = PORT_ROLES.filter((role) => args.host[role] === undefined);
	if (missing.length > 0) {
		throw new Error(
			`EditorHost is missing ${missing.length} port role(s): ${missing.join(", ")}. ` +
				"A session cannot be created without them — see apps/web/src/editor/ports/index.ts.",
		);
	}
	return args.host as ResolvedEditorHost;
}
