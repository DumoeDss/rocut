# s0304-surface-mount-focus-lifecycle

R1 (surface): wrap EditorRoot in <EditorSurface>, implement focus-mode matrix, wire visibility-suspend to session.suspend, deterministic unmount. Consumes T0 commit-binding types. dependsOn: R0,T0
