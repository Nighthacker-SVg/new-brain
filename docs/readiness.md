# Attendx backend beta — readiness report

The office connects to a real persistent backend for local development and controlled small-project trials. This does not establish unrestricted autonomous delivery or production security.

| Area | Delivered | Boundary |
| --- | --- | --- |
| Accounts | Salted scrypt passwords, HttpOnly/SameSite sessions, CSRF/Origin/Host checks, account scoping | Local registration; no SSO, email verification or recovery |
| AI settings | Multiple encrypted keys, role/priority routing, bounded fallback, OpenAI-compatible/Anthropic adapters | Owner must supply model access; paid calls unverified here |
| Local-only mode | Remote AI providers denied in backend; local calls use a durable per-project attempt quota and zero external API reservation; serial CPU profile and longer timeout | Infrastructure is still metered; model availability/quality need actual inference checks |
| Delivery | Durable jobs, plan gate, source/diff/ZIP, actual isolated tests and review records | Standard-library Node/Python; no packages/network, pushes or deployments |
| Repair | One additional budgeted attempt using failed evidence | Original tests cannot be edited; failures remain visible |
| Hiring | Named templates, expiry, scoped authority and budgets | 12 agents/account; manager proposals require review |
| Chat/memory | Personas, persistent messages and approved project knowledge | Chat does not silently execute changes; memory/instruction versions are project-scoped |
| Retrieval/research | Scoped lexical knowledge search; bounded public GitHub/HTTPS source collection, citations, fetch reports and optional unverified summary | Exact allowed hosts, no unrestricted crawling/browser execution, no automatic fact approval or weight training |
| Google Cloud package | Private CPU VM scripts, local Ollama profile, IAP access and session stop timer | Cloud account access/quota/provisioning and model performance remain unverified here; finite trial credits |
| Improvement | Baseline/candidate calls on explicit fixtures, recorded scores/latency, approved promotion/rollback | Narrow substring checks, not general intelligence/safety certification or model training |
| Operations | Periodic checks of stored candidates | No externally deployed product monitoring |
| Office | SSE, coalesced updates, actual job/budget metrics, motion, mobile/keyboard/reduced-motion UI | Provider latency is external; no global SLA claim |

## Verification

Checks cover authorization, account/project isolation, encryption and credential destination changes, atomic budgets, approval gates, cancellation/recovery, sandbox policy and malicious paths, model protocols/errors, bounded repair and scoped memory/instructions. Real Docker checks cover passing, failing and empty Node tests, Python unittest and isolation.

Live end-to-end tests use a deterministic HTTP model fixture in a separate Compose project. They exercise actual API/worker persistence, approvals, Docker execution, downloads, preview, chat and evaluated instruction promotion/rollback. They do **not** demonstrate paid-model quality or arbitrary project completion. ZIP content/CRC was independently read using Python's standard ZIP reader.

Latest application verification: **76 server/security/workflow tests passed, 3 real Docker execution tests passed, and all 22 browser tests passed** across isolated standard and local-only Compose projects. No tests were skipped in those runs. Tests cover zero-cost local quotas, remote-provider denial, knowledge search, research transport/citations/checkpoints, and the real execution flow. Test projects and their data were removed afterward. Browser/model checks use a deterministic HTTP fixture and do not establish the quality of an actual Ollama model.

The Google Cloud deployment helpers passed **9 offline checks** using a stubbed `gcloud`; they check resource flags, quota/name-collision failures, private access, preview/local origin transitions and Compose configuration. Together with the application checks above, **110 checks passed**, with zero skips. No Google Cloud project is authenticated here, so VM creation, IAM, IAP, actual model inference and deployment timing are **not verified**. A direct research-source probe in this development environment returned a DNS failure and no source content; actual outbound source collection must be checked on the target VM. Paid external-provider calls remain unverified.

[Live office screenshot](preview/live-office.png) · [Mobile screenshot](preview/live-mobile.png). Failed, skipped or unavailable checks are not counted as passing.

## Governance and remaining integrations

Authority, approval and budgets are enforced outside model prompts. Workers cannot edit provider settings, accounts, keys, permissions or audit records through their interface. Untrusted source/documents/model text cannot grant authority. Only the trusted broker has Docker daemon access; jobs use fixed execution policy. Generated tests and their output are untrusted project evidence, not a tamper-proof attestation of correctness. Owner review and independently maintained acceptance checks remain necessary before release.

Repository import is a bounded public default-branch UTF-8 snapshot pinned to a commit. Private/large/binary repositories, branch/PR writes, dependency installation profiles, arbitrary browsers, voice and public deployment require further configured integrations. Account/project confidentiality is not a complete enterprise tenant administration system.

Before production use, add deployment-specific HTTPS/access administration, tested backup restoration, external secret management, stronger worker-host separation, recovery flows, operational monitoring and independent security review. Release approval records candidate review; it does not create a deployed production product.
