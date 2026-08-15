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
 * Runtime consumers receive this complete Host through session composition;
 * this interface is the frozen, platform-neutral shape they are wired to.
 */

import type { EditorHostPorts } from "..";

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
 * The five shell-facing members the host has always supplied, unchanged.
 * Named separately because ordinary UI context consumers need only this subset;
 * port-bearing runtime code receives the complete Host through its session.
 */
export interface EditorHostBase {
	/** The project the editor should open. Was `useParams().project_id`. */
	projectId: string;
	navigation: EditorHostNavigation;
	services: EditorHostServices;
	branding: EditorHostBranding;
	links: EditorHostLinks;
}

/**
 * The host seam, widened with the port roles.
 *
 * This is the one complete surface a **host author** implements. Every port is
 * required: production composition is complete, so there is no partial form to
 * resolve, cast, or silently replace with an in-memory fallback.
 *
 * UI components still read `EditorHostBase` through `useEditorHost()`. Runtime
 * consumers obtain the complete Host through the owning session; no parallel
 * port context or factory argument exists.
 */
export interface EditorHost extends EditorHostBase, EditorHostPorts {}

/**
 * Compatibility name retained for the protected session surface. Since
 * `EditorHost` already requires every role, resolution cannot narrow or fill it.
 */
export type ResolvedEditorHost = EditorHost;

/** Identity compatibility seam; no optional check, cast, or fallback remains. */
export function resolveEditorHost(args: {
	host: EditorHost;
}): ResolvedEditorHost {
	return args.host;
}
