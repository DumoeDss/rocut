/**
 * The seam between the editor and whatever application is hosting it.
 *
 * The editor used to reach for `next/navigation` route globals directly. Those
 * three uses are now named callbacks supplied by the host, so the editor asserts
 * nothing about URL structure — or about there being a router at all.
 *
 * This is deliberately **not** a Host port contract. It carries the identity,
 * navigation and server-endpoint concerns that block a Next-free build, and
 * nothing else. Storage, media and clock ports are a later concern; when they
 * arrive they widen this one interface rather than scattering new props.
 */

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

export interface EditorHost {
	/** The project the editor should open. Was `useParams().project_id`. */
	projectId: string;
	navigation: EditorHostNavigation;
	services: EditorHostServices;
	branding: EditorHostBranding;
	links: EditorHostLinks;
}
