# Project Interview

> Source note: these answers were NOT collected through the interactive interview. The user supplied a complete planning document (`메디헬퍼_기획설계_v0.2.md`, repository root) and asked for project documents to be written from it. Each answer below is extracted from that document; section numbers refer to it. Anything the document does not state is recorded as unresolved, not guessed.

## Stage A Round 1: Vision and Domain
Question: What does this project do, who is it for, and what problem domain does it sit in?
Answer: Web application for a touch-screen kiosk installed in a hospital (planning doc §1).
Domain: healthcare-insurance-estimation (kiosk web app + PC admin web)
Goal: A patient at a shared hospital kiosk, without signing up or logging in, selects (1) current indemnity-insurance generation, (2) insurer and required coverage conditions, (3) treatments, and sees the estimated total payment, estimated insurance payout, and estimated out-of-pocket amount after payout on a separate result screen. The estimate comes from a deterministic calculation engine driven by hospital treatment menus and verified policy rules, never from generative AI. A hospital administrator manages treatments and prices on a separate PC web admin.

## Stage A Round 2: Technology and Constraints
Question: What is the primary technology stack, and what hard constraints must the project respect?
Answer: Candidate stack (not yet confirmed, §8): Next.js (App Router) + TypeScript single application, a relational database, administrator authentication, and an independent TypeScript calculation module. DB, hosting, and auth provider are to be decided after checking the deployment environment and actual costs.
Constraints:
- No generative AI in insurance calculation or coverage explanation; same input must yield the same result and the same calculation basis (§1, §8).
- Supported generations are fixed: Gen 1 (A·S), Gen 2 (C1), Gen 2.5 (C2), Gen 3 (C3), Gen 4 (C4). Anything else returns UNSUPPORTED and must not be calculated as C4 (§9).
- Out of scope for this development: Gen 5, severe/non-severe branching, riders 1/2, national-health-insurance copay-rate linkage (§ header, §12 rule 8).
- Unknown is not uncovered: when a required condition is unknown, calculation is put on hold; never show 0 won or assume full coverage (§6.1).
- Patient privacy: patient selections live only in the kiosk's in-memory session; no personal health data stored on the server by default; nothing stored in localStorage, IndexedDB, or service-worker cache; no insurance or treatment conditions in URL queries or analytics events; no name, resident number, policy, or diagnosis uploads (§8).
- The server never trusts client-submitted prices, deductible rates, or hospital IDs; it recalculates from published data. The instant preview and final server calculation use the same engine (§8).
- Multi-hospital data and permission isolation; roles split into hospital administrator, insurance-rule reviewer, and platform operator (§7).
- Insurance rules need verified policy sources (insurer, product, clause/page, revision date, effective date, review status); rules without source stay DRAFT/DEMO and never apply to a real patient's estimate (§8, §9).
- Touch-only kiosk use: no physical keyboard or mouse hover required; provisional review screens 1080×1920 portrait and 1920×1080 landscape; large touch targets (§4, §13.1).
- Session reset: idle timeout with warning and extension, completion resets everything, refresh/back must never restore a previous patient's result, late API responses after reset are ignored (§13.2).
- Kiosk web UI is distinct from device lockdown and auto-launch, which are configured on the device OS/browser and verified separately (§13.3).
Money handling: amounts stored as integer won; rates as integer fractions or basis points; rounding policy stated per rule (§6.3).

## Stage A Round 3: Scope and Boundaries
Question: What are the key features and the explicit in-scope / out-of-scope boundary?
Answer: MVP covers same-day outpatient visits at a single domestic clinic, a general individual indemnity policy, and one insurance contract. Data and permission structure support multiple hospitals from the start (§1).
Scope:
- In scope: kiosk idle/start state; three input steps (insurance generation, insurer and conditions, treatment selection); separate result screen with calculation basis; idle-timeout reset; PC admin web (clinic settings, treatment CRUD and ordering, prices, common base fees, preview, draft/publish, change history); insurance-rule management with source tracking and review workflow; server-side estimate API; first pilot clinic shown as 성정원통사의원 (name unverified).
- Out of scope: patient sign-up or login; personal-information uploads; automatic insurance lookup; claims filing on behalf of patients; inpatient, prescription/dispensing, multiple hospitals or dates in one estimate, proportional compensation across several indemnity policies, old-age/pre-existing-condition/group indemnity, workers' compensation or auto insurance combined; offline calculation, printer, phone connection, staff-call integration, result QR transfer; booking, reception, or payment functions. Out-of-scope cases route to consultation and are never calculated as a general individual policy (§1, §13.3).

## Stage B Round 4: Verification, Surfaces, and Sharing
Verification: Meaningful tests for calculation, permissions, and public rules (§9): the numeric examples in the planning doc (fixed deductible 114,000; limit order 250,000; small-cost 0 payout; Gen 2 standard 99,200 vs selectable-II 100,600; Gen 4 4,000+77,000=81,000), invariants (0 ≤ payout ≤ total; payout + remaining burden = total when fully calculable), price-tampering, hospital isolation, version-change, session-reset and late-response cases, and layout checks at 1080×1920 and 1920×1080. The concrete test command is not yet chosen because the stack is unconfirmed.
UI surface: has-ui
External systems: relational database (product TBD); administrator authentication provider (TBD); hospital price and treatment data entered by administrators; insurer policy source documents verified by reviewers; no external AI or model APIs. No phone, staff-call, printer, or QR integration in the MVP.
Team sharing: unresolved. The document assigns design to Pencil.dev, development to Claude + MoAI, and planning/review to GPT, but does not state how many contributors work in the repository. `project.yaml` currently says `mode: personal`.

## Unresolved items carried from the planning document (§11)
- Kiosk screen size, orientation, resolution, OS, browser, mounting height, network environment.
- Hospital's official name, logo, institution type, and real treatment list.
- Whether each price is the full insurance fee or the patient copay; whether a common consultation fee is included.
- First insurer, product, and coverage whose real policy text will back the first published rules, and its limit options.
- The complete "1588" number; operating entity, hours, and purpose of 1544-8069.
- Applicable medical-advertising rules at deployment time (the cited source is a 2026 legislative notice, not settled law).
