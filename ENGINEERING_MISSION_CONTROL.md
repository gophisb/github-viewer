# Engineering Mission Control

This branch adds the first governed engineering layer to github-viewer.

## Initial foundation capabilities

1. Project X-Ray: repository metadata + recursive Git tree inspection; stack, entry points, CI, dependency manifests and sensitive-path indicators.
2. Engineering Agent: a deterministic read-only tool loop with explicit steps and an operation log. It does not commit, open PRs or deploy.
3. Verification / Evidence Gate: X-Ray and CI claims are represented as PASS/WARN/BLOCK evidence. A warning is never silently promoted to proof.
4. RAECS Governance: autonomy levels L0 READ through L6 DEPLOY are represented explicitly. Selecting a level does not grant permissions.
5. Persistent Engineering Memory: task ledger and checkpoints survive page reloads through localStorage.
6. Commit / Diff Inspection: read-only comparison of the feature revision against main, including SHAs and changed-file statistics.
7. Adversarial Reviewer: deterministic checks for scope creep, sensitive paths, workflow changes, service-worker/privacy changes, hidden write paths, change size and missing CI proof.
8. Evidence Graph: links claims, revisions, files, evidence, CI, reviews and checkpoints.

## Verified foundation checkpoint

The feature branch final initial-build checkpoint is:
`0254ea230072c58641d8667e6c74713d7db9cda1`.

The runtime expansion is documented in `GOVERNED_RUNTIME.md`.

The GitHub Actions CI run for this exact revision completed successfully. This is build evidence for the revision, not a blanket proof of runtime correctness.

## Current boundary

The initial implementation is deliberately read-only. It does not commit, merge, deploy, change permissions, or grant autonomy levels.

## Evidence rule

X-Ray output is an inspection result, not a release approval. A truncated Git tree, sensitive-path finding, missing CI proof, or failed CI produces a review/blocking state as appropriate.

## Initial-build stop condition

The first foundation is considered complete when:
- the feature scope is isolated on its branch;
- the current HEAD has successful CI evidence;
- the diff against main is inspectable;
- adversarial review and evidence graph are present;
- documentation records the actual boundary and limitations.

Further work belongs to later controlled stages rather than expanding this initial foundation indefinitely.
