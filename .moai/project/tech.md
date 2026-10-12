# Tech: 메디헬퍼 (medi-helper)

> Status: planning only. No code, dependencies, or tests exist yet, and no stack choice is final. Derived from `메디헬퍼_기획설계_v0.2.md` ("§N" refers to its sections) and `.moai/config/sections/quality.yaml`. Library versions, hosting, costs, and device specifications are not known and are not stated here.

## 1. Candidate stack (§8)

| Layer | Candidate | Status |
|-------|-----------|--------|
| Application | Next.js (App Router) + TypeScript, single application | Candidate; the planning document points to the official Next.js documentation for App Router and server-route support ([6]) |
| Calculation | Independent TypeScript module, separate from UI and rule data | Candidate; rationale below |
| Database | Relational database | Decision pending - product not chosen |
| Hosting | Not chosen | Decision pending - to be fixed after checking the deployment environment and actual costs |
| Admin authentication | Required for the PC admin web | Decision pending - provider not chosen |

Rationale given by the planning document:
- The deployment environment and actual cost conditions decide DB, hosting, and auth provider; the document does not guarantee any free-tier limit or current price (§8).
- The calculation module must be reusable by both the instant preview and the final server calculation, so both use the same engine (§8).
- Calculation is deterministic and runs without external AI calls, so no model API key is needed (§8).
- The engine is verified separately from operating rules through example rules and independent tests (§10 step 2).

## 2. Determinism and no generative AI (§1, §8, §12)

- Insurance calculation and coverage explanation never use generative AI or LLM judgment.
- The same input yields the same result and the same calculation basis.
- The calculation is an independent, deterministic function driven by rule data.

## 3. Money and rounding (§6.3)

- Amounts are stored as integer won.
- Rates are stored as integer fractions or basis points (for example 20% is 2,000 basis points).
- Each rule states its own rounding policy (truncate or round at the won unit) and it is applied consistently, in the order the rule's calculation requires.
- Variable glossary (§6.1; used in the formula below, in section 8, and in `structure.md` section 4):
  - T: total expected payment.
  - G: covered benefit (급여) copay in a calculation group.
  - N: covered non-benefit (비급여) patient amount in a group.
  - E: covered cost of the group.
  - X: confirmed excluded cost.
  - U: cost whose coverage or conditions are unconfirmed.
  - D: deduction under the policy rule.
  - L: payout limit or confirmed remaining limit stated by the policy.
  - P: per-group payout, from the §6.2 formula.
- Deduction can be larger than cost, but a payout is never negative: payout (variables per §6.1, formula per §6.2) is `min(max(E - D, 0), L)` for the general group case. The result distinguishes the nominal deduction from what the patient actually bears. The formula is not forced on every contract; generation-1 per-accident limits and three-major non-benefit annual limits need their own rules, and each rule states whether L is a payout limit or a covered-cost limit (§6.2).
- Invariants (§9): 0 <= expected payout <= T; when everything is calculable, expected payout + burden after payout = T; a limit shared by groups is not paid twice.

## 4. Server-side recalculation and versions (§7, §8)

- The server does not trust client-submitted prices, deduction rates, or clinic IDs; it recalculates from treatment IDs and published server data.
- Price and rule versions travel with an estimate request; a mismatch means the older value is not finalized and the latest amount is shown again.
- Clinic permission is checked on the server for every admin operation.

## 5. Privacy and session rules (§8, §13.2)

- Patient selections and results exist only in the kiosk's in-memory session.
- No localStorage, IndexedDB, or service-worker cache for patient choices or results.
- No personal health data stored on the server by default; no name, resident number, policy, or diagnosis-document upload in the MVP.
- No treatment or insurance conditions in URL queries or analytics events; statistics are step-level aggregates and anonymous events.
- Admin authentication is never left on a shared kiosk; the patient screen has no admin link and no hidden touch entry.
- Reload, restart, and browser Back never restore a previous patient's result.
- In-flight requests are cancelled on reset and the session identifier is replaced, so late responses are ignored.
- Idle timing (initial proposal, to be adjusted after observing real use): input screens warn at 100 s and reset at 120 s; result screens warn at 160 s and reset at 180 s (warning 20 s before reset). The warning shows the remaining time and large ‘계속 사용할게요’ and ‘처음으로’ buttons; extension can repeat and restarts the idle time. Inactivity is judged by patient touch or key input; server responses and internal refreshes must not extend the time. The hospital can set these times in the admin (§7). This is a design specification; no behavior was tested.
- On reset, selections and results are removed; they are never written to localStorage, IndexedDB, or service-worker cache; a response to a request issued before the reset must not restore any screen (cancel the request and replace the session identifier); no administrator authentication state may remain on the shared kiosk.

## 6. Kiosk display requirements (§13.1)

- Provisional review sizes: portrait 1080x1920 and landscape 1920x1080. These are not confirmed device resolutions or physical sizes.
- Layout is adjusted per orientation (card columns, items per list page, amount placement); content is not simply scaled.
- Design baselines (design references, not accessibility certification or real-device verification): primary button default height 88; implemented primary touch area at least 72 CSS px; selection card height target 120 or more; body text 24 or more; title 36 or more; key result number 56 or more; spacing between major elements 16 or more. The PC admin screens use a separate specification.
- CSS pixels versus physical size depends on device scaling. Legibility, touch accuracy, and reach must be checked on the real installed device with elderly users, low-vision users, and wheelchair users.
- Large-text mode is a required MVP feature. Buttons, amounts, and key guidance must not be clipped and must stay operable when it is on; selections persist.
- Touch-only and assistive keyboard operation are both satisfied, not in tension: the whole flow completes with no physical keyboard and no mouse hover, and when a keyboard is present navigation, selection, and confirmation work with a visible focus indicator and modal focus handling (focus moves into a modal, stays inside, and returns to the opener on close). Selection is shown by a check mark and text as well as color. Insurer search is optional and only enabled with a verified on-screen Korean keyboard; every insurer must be reachable without typing.
- Warnings, extension, and time adjustment follow the W3C timing-adjustable guidance ([7]) and need review.

## 7. Device lockdown is separate (§13.3)

- Auto-launch, address-bar hiding, preventing the administrator from leaving the page, and relaunch after power recovery are configured and verified on the actual OS and browser, not in the web UI.
- The Fullscreen API has user-activation constraints ([8]), so a page's fullscreen button alone must not be reported as device lockdown being done.
- Kiosk start reads clinic settings and published data. On a communication error the screen offers ‘다시 시도/직원에게 문의/이용 종료’ and never shows a payout of 0 won. No unconfirmed offline-cached data is used to keep calculating. Offline calculation, printer, phone connection, staff call, and result QR are not in the initial MVP.

## 8. Testing and verification strategy (§9, §10)

Methodology: `tdd` (RED-GREEN-REFACTOR), from `quality.yaml` `constitution.development_mode`. Coverage target: 85 percent (`test_coverage_target`); `tdd_settings.min_coverage_per_commit` is 80; tests are written first and must be specification-based with meaningful assertions, not coupled to implementation details; coverage exemptions are disabled. Other quality settings in that file: LSP gates require zero errors, type errors, and lint errors in the run phase; ast-grep gating is enabled. Tests focus on calculation, permissions, and public rules; no tests are written merely to mirror wording or simple style changes (§9).

Numeric examples to reproduce (all from the planning document; DEMO data: X-ray 10,000; ultrasound 70,000; 신장분사치료 40,000 with classification unconfirmed; physical therapy 4,000; total 124,000 = reimbursable 14,000 + non-reimbursable 110,000):

| Check | Input | Expected |
|-------|-------|----------|
| Fixed deduction | E=124,000, D=10,000, L=250,000 | P=114,000; burden after payout 10,000 |
| Limit order | E=400,000, D=10,000, L=250,000 | P=250,000 (min(390,000, 250,000)); burden 150,000 |
| Small cost | E=4,000, nominal deduction 10,000 | P=0; actual patient burden 4,000 |
| 2nd gen late standard | D = max(10,000, 124,000 x 20%) = 24,800 | Payout 99,200; burden 24,800 |
| 2nd gen late selectable-II | D = max(10,000, 14,000 x 10% + 110,000 x 20%) = 23,400 | Payout 100,600; burden 23,400 |
| 4th gen | Benefit D = 10,000; non-benefit D = 33,000 | Benefit 4,000 + non-benefit 77,000 = 81,000; burden 43,000 |
| Confirmed exclusion (hypothetical case E) | Hospital payment 124,000; the 40,000 item excluded; covered 84,000; D=10,000; sufficient remaining limit | P=74,000; burden after payout 50,000; the excluded 40,000 is not mixed into the deduction base |
| Unconfirmed condition | Required condition unknown | Calculation on hold; values null; "확인 필요"; never 0 and never "excluded" |
| Communication error | Estimate request fails | Calculation failed; values null; retry / end of use offered; never 0 |
| Normal zero | Calculation completes with P=0 | 0 won shown with its basis |

In these rows "burden after payout" means 보험금 수령 후 예상 본인 부담 (hospital payment minus expected insurance payout); it is not what the patient pays at the hospital today. The label "expected insurance payout" is 예상 보험금 and "expected hospital payment" is 예상 병원 결제액. The case labels A to E and the general formula caveat are described in `product.md` section 5.1.

The 4th-generation benefit deduction is 10,000, not the full 14,000; the non-benefit part is 110,000 minus 33,000. The planning document says this example assumes every item is covered, limits and counts remain, and no separate rider item exists; it is not a confirmed classification of 신장분사치료. Template deduction formulas (§6.3, test and design templates, not operating policy): generation 2 fixed D=10,000; generation 2 percentage D=max(10,000, rate x E); generation 4 benefit D=min(G, max(10,000, 0.20 x G)); generation 4 general non-benefit D=min(N, max(30,000, 0.30 x N)) (clinic basis).

Other verification topics (§9), each needing a meaningful test or check:
- Same visit and same coverage are summed and deducted once.
- Unsubscribed rider: only that treatment is uncovered; other subscribed coverages stay. Unknown rider: calculation on hold, never 0 won.
- Three-major non-benefit: group and shared-limit relationship applied per policy.
- Generation 1: general injury medical cost and injury outpatient medical cost can give different results.
- 2009.08 to 09 boundary contract: no automatic decision from enrollment date without checking current coverage.
- First screen: five cards; C1 and C2 are separate; out-of-range input (such as 5th generation) returns UNSUPPORTED and is never computed as C4.
- Excluded costs are not mixed into the deduction base. Remaining limit or period used up is reflected when confirmed, and the assumption is shown when unknown. Rounding policy is applied consistently.
- DRAFT or DEMO rules are never applied to a real patient's personal estimate.
- Price tampering in the browser still yields the server's published-price result. Clinic A's administrator cannot read or change clinic B. Stale price or rule versions are not finalized.
- Kiosk flow start to finish keeps selections on in-session edits; list paging keeps selections and a repeated tap never increases quantity; idle warning, extension, completion, and timeout reset work and remove the previous result; a late response after reset is not shown; reload, restart, or Back never restores a previous result.
- Layout at 1080x1920 and 1920x1080 without clipped buttons, amounts, or warnings; whole flow without physical keyboard or mouse hover.
- Communication errors offer retry or end of use and never show 0 won.

No test runner, test command, or CI is chosen yet because the stack is unconfirmed.

## 9. Development environment

Known:
- Design: Pencil.dev. Development: Claude and MoAI. Planning and review: GPT (§ header).
- Language: TypeScript. Framework: Next.js (App Router), as a candidate.
- Methodology: TDD; project mode `personal` in `project.yaml` (the document does not say how many contributors will work in the repository).
- Documentation language: English; conversation language Korean; commit messages and code comments Korean (`language.yaml`).
- Review package for GPT should contain changed files, a SPEC requirement mapping table, the actual calculation functions, test output, screen captures, policy-source locations, and a list of unimplemented or unconfirmed items; reports must separate what was run, what was read from documents, and what was not confirmed (§10).

Unresolved:
- Runtime and package-manager versions, linter and formatter, test runner, CI.
- Database product, hosting, admin authentication provider, and their costs.
- Kiosk OS, browser, resolution, size, mounting height, and network environment (§11).
- Existing code or project integration: reuse is to be judged after a repository check (§8).

## 10. Open items (trace to §11 and other gaps)

- Kiosk device specification and network environment.
- DB, hosting, and admin authentication provider.
- Real hospital data and whether prices are full fee or copay.
- First insurer, product, coverage, and real policy text with limit options; per-company policy references.
- Rounding rule per policy.
- Calculation formulas not specified in the planning document: generation 1 injury/illness outpatient (fixed or percentage per policy), generation 2 percentage deduction rate, generation 3 basic and three-major non-benefit deduction and limit rules, shared-limit relationships.
- 1588 and the 1544-8069 operating entity, hours, and purpose.
- Medical-advertising rules at deployment time. The cited source ([5]) is a 2026 legislative notice, not a settled legal basis.
- Source documents cited in the planning document ([1] to [8]) were not fetched or independently checked.

## 11. References cited by the planning document (as given; not independently fetched)

- [1] Korea Consumer Agency notice on renewal of 2009.08 to 09 contracts (2012): https://www.kca.go.kr/home/sub.do?menukey=4005&mode=view&no=1001288923 ; Korea Insurance Research Institute material on the 2009.10 standardization: https://www.kiri.or.kr/pdf/%EC%97%B0%EA%B5%AC%EC%9E%90%EB%A3%8C/%EC%A0%95%EC%B1%85%EB%B3%B4%EA%B3%A0%EC%84%9C/rej2011-06_03.pdf
- [2] KB Insurance product guide PDF (selectable-II outpatient deduction and enrollment-limit options, p. 7): https://www.kbinsure.co.kr/extrnl/clause/ltins/21930.pdf
- [3] Financial Services Commission notices on the 4th-generation product restructuring (2020.12, 2021.06): https://www.fsc.go.kr/no010101/74948 / https://www.fsc.go.kr/no010101/76157
- [4] Financial Services Commission press-release comparison table (4th generation), hosted by the Korea Insurance Research Institute: https://kiri.or.kr/PDF/weeklytrend/20260518/trend20260518_4.pdf
- [5] Ministry of Government Legislation, notice of a 2026 amendment draft to the Medical Service Act enforcement decree: https://www.moleg.go.kr/lawinfo/makingInfo.mo?cptOfiOrgCd=&currentPage=25&edYdFmt=&keyField=&keyWord=&lawCd=0&lawSeq=86888&lawType=TYPE5&lsClsCd=&mid=a10104010000&pageCnt=40&stYdFmt=
- [6] Next.js App Router documentation: https://nextjs.org/docs/app/getting-started
- [7] W3C WCAG 2.2 and timing-adjustable guidance: https://www.w3.org/TR/wcag/ and https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html
- [8] MDN, Fullscreen API user-activation condition: https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen
