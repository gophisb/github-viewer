# Engineering Mission Control

This branch adds the first governed engineering layer to github-viewer.

## Five capabilities

1. Project X-Ray: repository metadata + recursive Git tree inspection; stack, entry points, CI, dependency manifests and sensitive-path indicators.
2. Engineering Agent: a read-only tool loop with explicit steps and an operation log. It does not commit, open PRs or deploy.
3. Verification / Evidence Gate: every X-Ray claim is represented as PASS/WARN/BLOCK evidence. A warning is not silently promoted to proof.
4. RAECS Governance: autonomy levels L0 READ through L6 DEPLOY are represented explicitly. Selecting a level does not grant permissions.
5. Persistent Engineering Memory: local task ledger and checkpoints survive page reloads through localStorage.

## Current boundary

The first implementation is deliberately read-only. It does not claim that a repository builds or passes tests because GitHub tree inspection cannot establish that. Real CI/build/test evidence must come from separate GitHub Actions and/or controlled execution tools.

## Evidence rule

X-Ray output is an inspection result, not a release approval. A truncated Git tree or sensitive-path finding produces a review state.

## Next controlled stages

- Actions/run inspection as a verification source.
- Commit/diff/PR evidence graph.
- Adversarial reviewer.
- Real model-backed tool agent with provider isolation.
- Higher autonomy gates only after evidence and approval.
