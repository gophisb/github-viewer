# Governed Runtime

The initial foundation now includes a controlled runtime layer.

## Capabilities

- L4 Commit: creates a new checkpoint file on the current feature branch after a PASS gate and explicit COMMIT confirmation.
- L5 PR: opens a draft pull request from the current branch to main after a PASS gate and explicit PR confirmation.
- L6 Deploy: dispatches the repository Pages workflow on main only after a PASS gate and explicit DEPLOY MAIN confirmation.
- Multi-Agent Council: separates architecture, implementation, testing, adversarial review and evidence review roles. The first implementation is deterministic role orchestration; it does not pretend that independent model instances exist.
- Model-Backed Agent Adapter: accepts an OpenAI-compatible Chat Completions endpoint. The API key is held only in React memory and is never written to localStorage. The model receives no GitHub tool authority automatically.

## Gate rules

- X-Ray alone is never sufficient for write/deploy authority.
- The runtime target is BLOCK until current-head CI evidence is successful.
- A failed or missing CI result keeps the runtime blocked.
- The UI requires an explicit confirmation phrase for commit, PR and deploy actions.
- Deploy targets main; it never deploys an unverified feature branch.
- The runtime does not merge a pull request automatically.

## Security boundary

The browser uses the user's GitHub token for requested GitHub write operations. The token must have the required repository permissions; the application cannot manufacture or escalate permissions.

The model adapter is intentionally provider-neutral. A secure deployment should use a server-side proxy or provider integration rather than placing a long-lived provider key in a browser.

## Evidence

GitHub's workflow-dispatch API supports manual workflow execution when the workflow declares workflow_dispatch; repository workflow permissions should remain least-privilege.

## Stop condition

This completes the requested runtime expansion. Further work should be treated as a separate versioned project: production-grade provider isolation, cryptographic evidence anchoring, real independent multi-agent execution, policy-enforced permission brokers, and automated merge/release gates.
