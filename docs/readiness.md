# Attendx backend beta — readiness report

The office connects to a real persistent backend for local development and controlled small-project trials. This does not establish unrestricted autonomous delivery or production security.

| Area | Delivered | Boundary |
| --- | --- | --- |
| Accounts | Salted scrypt passwords, HttpOnly/SameSite sessions, CSRF/Origin/Host checks, account scoping | Local registration; no SSO, email verification or recovery |
| AI settings | Multiple encrypted keys, role/priority routing, bounded fallback, OpenAI-compatible/Anthropic adapters | Owner must supply model access; paid calls unverified here |
| Delivery | Durable jobs, plan gate, source/diff/ZIP, actual isolated tests and review records | Standard-library Node/Python; no packages/network, pushes or deployments |
| Repair | One additional budgeted attempt using failed evidence | Original tests cannot be edited; failures remain visible |
| Hiring | Named templates, expiry, scoped authority and budgets | 12 agents/account; manager proposals require review |
| Chat/memory | Personas, persistent messages and approved project knowledge | Chat does not silently execute changes; memory/instruction versions are project-scoped |
| Improvement | Baseline/candidate calls on explicit fixtures, recorded scores/latency, approved promotion/rollback | Narrow substring checks, not general intelligence/safety certification or model training |
| Operations | Periodic checks of stored candidates | No externally deployed product monitoring |
| Office | SSE, coalesced updates, actual job/budget metrics, motion, mobile/keyboard/reduced-motion UI | Provider latency is external; no global SLA claim |

## Verification

Checks cover authorization, account/project isolation, encryption and credential destination changes, atomic budgets, approval gates, cancellation/recovery, sandbox policy and malicious paths, model protocols/errors, bounded repair and scoped memory/instructions. Real Docker checks cover passing, failing and empty Node tests, Python unittest and isolation.

Live end-to-end tests use a deterministic HTTP model fixture in a separate Compose project. They exercise actual API/worker persistence, approvals, Docker execution, downloads, preview, chat and evaluated instruction promotion/rollback. They do **not** demonstrate paid-model quality or arbitrary project completion. ZIP content/CRC was independently read using Python's standard ZIP reader.

Final verification: **42 server/security/workflow tests passed, 3 real Docker execution tests passed, and all 18 browser tests passed** in an isolated Compose project. No tests were skipped in that full browser run. The test project and its data were removed afterward. Paid external-provider calls remain unverified.

[Live office screenshot](preview/live-office.png) · [Mobile screenshot](preview/live-mobile.png). Failed, skipped or unavailable checks are not counted as passing.

## Governance and remaining integrations

Authority, approval and budgets are enforced outside model prompts. Workers cannot edit provider settings, accounts, keys, permissions or audit records through their interface. Untrusted source/documents/model text cannot grant authority. Only the trusted broker has Docker daemon access; jobs use fixed execution policy. Generated tests and their output are untrusted project evidence, not a tamper-proof attestation of correctness. Owner review and independently maintained acceptance checks remain necessary before release.

Repository import is a bounded public default-branch UTF-8 snapshot pinned to a commit. Private/large/binary repositories, branch/PR writes, dependency installation profiles, arbitrary browsers, voice and public deployment require further configured integrations. Account/project confidentiality is not a complete enterprise tenant administration system.

Before production use, add deployment-specific HTTPS/access administration, tested backup restoration, external secret management, stronger worker-host separation, recovery flows, operational monitoring and independent security review. Release approval records candidate review; it does not create a deployed production product.
