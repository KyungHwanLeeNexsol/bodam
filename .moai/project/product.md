# Product: 보담 (bodam)

> Status: planning only. No source code, tests, or deployment exist yet. Everything below is derived from the planning document `보담_기획설계_v0.2.md` (repository root, Korean; "§N" refers to its sections). Nothing here is claimed as implemented, tested, or verified. Updated 2026-10-13 to follow the Pencil save `01bacca…` (condition questions and the consultation screen removed, cause step and required-documents screen added), and on 2026-10-14 to follow the committed save with design blob `4b4a158…` (repository HEAD `875f71b`) and to separate what the result confirms, assumes, and does not calculate (section 5.4); the review of that save is `design-requirements.md` section 5.13.

## 1. Project name and description

- Project name: bodam. Patient-facing service name: ‘보담’ (default brand string, managed as a common brand setting; the hospital name is managed separately) (§8).
- Description: a web application used on a shared touch-screen kiosk installed in a hospital. Without sign-up or login, a patient selects (1) the current indemnity-insurance (실손보험) generation, (2) the insurer type (손해보험사, 생명보험사, or 그외 공제 조합), (3) the cause of the treatment (injury, illness, or unknown), and (4) treatments, then sees on a separate result screen the total expected payment, the expected insurance payout, and the expected out-of-pocket amount after the payout (§1).
- The core of the product is not generation explainer pages but an estimate that links the hospital's treatment menu to policy rules. The same input must give the same result and the same calculation basis. Generative AI is not used for insurance calculation or coverage explanation (§1).
- Not a booking, reception, or payment function. The service is for insurance guidance only (§4).
- Initial pilot clinic: ‘성정원통사의원’. This is the user-provided notation; the official name, real treatment list, and real prices are not yet confirmed (§1).

## 2. Target audience

| Audience | How they use the product |
|----------|--------------------------|
| Patients at the kiosk | Use the shared touch screen without sign-up; no personal phone or QR start in the default flow (§1) |
| Hospital administrators | Log in to a separate PC admin web to manage clinic settings, treatments, prices, publication (§7) |
| Insurance-rule reviewers (보험 기준 검토 담당자; proposed split) | Review and publish insurer, product, coverage, and policy-source rules; approve rules against policy text (§7) |
| Platform operator (proposed split) | Manages hospital administrator permissions and which rules a hospital may use (§7) |

The same person may hold several roles at first, but permissions stay separate (§7).

## 3. Core features

- Kiosk idle/start state and four input steps (insurance generation; insurer type; treatment cause; treatment selection), followed by a separate result screen, a calculation-basis screen, and an optional required-documents screen (§1, §4).
- Deterministic estimate engine that combines published treatment prices with versioned, source-backed insurance rules (§6, §8).
- Calculation states that keep "unknown" distinct from "uncovered" (§6.1).
- Idle-timeout warning, extension, and automatic reset so the next patient never sees the previous patient's data (§13.2).
- Guidance on how to check the enrollment date and the number 1544-8069 as text when the generation is unknown; there is no consultation screen and no staff-inquiry button (§4).
- Required-documents screen after the result: the claim documents the case needs, derived from already-entered values (§4).
- PC admin web: clinic name, logo, institution type, notice text, consultation number, kiosk device settings; treatment add/edit/deactivate/reorder; benefit/non-benefit classification and price conditions; common base fees (such as a consultation fee); portrait and landscape kiosk preview; draft and publish with version history; idle-reset, result-hold, and warning times (§7).
- Rule administration: insurer, product, coverage, deduction type, and policy-version management; policy source recording (URL or file identity, clause, page, effective date); treatment-code to coverage-group mapping review; rule lifecycle (draft, reviewed, published, suspended); approval records comparing calculation examples with the actual policy text (§7).

## 4. Use cases and patient journey

Flow: start, insurance generation, insurer type, treatment cause, treatments, calculation, result, optional calculation basis and required documents, finish. Everything is cleared before the patient sees the start state again. ‘이용 완료’ clears the selections and result first, then opens the completion screen (`K06_Complete`), which returns to the start screen (`K00_Start`) automatically after a short wait (its length is left to implementation design). ‘처음으로’ (after confirmation) and the idle timeout clear everything and go straight to the start screen, without the completion screen (§9 "키오스크 동선", "이용 완료 동선", §13.2).

| Stage | What the patient does | Notes from the planning document |
|-------|----------------------|----------------------------------|
| Start (idle) | Sees the hospital name, ‘보담’, the description ‘실손보험 예상 부담액 안내’, and a large ‘실손 예상 부담액 확인’ button | Shows no previous amounts or selections; pressing start always opens screen 1 with an empty session; the device is preconfigured to one clinic (§4) |
| Screen 1 (step 1/4) | Chooses one of five generation cards, with the image-based enrollment period shown on the card | Prompt ‘내 실손보험을 선택해 주세요’. ‘다음’ stays inactive until a card is chosen. ‘세대를 모르겠어요’ opens a guidance screen (how to check the enrollment date in the policy or the insurer app, and the number 1544-8069 as text) with ‘보험 선택으로 돌아가기’. A generation is never picked on the patient's behalf. The earlier escape routes (‘가입 조건이 목록에 없어요’, year/month selection, the conversion/change question) and the treatment-cost-total-only path are not in the design saved on 2026-10-13; how to screen out unsupported contracts is open (§4) |
| Screen 2 (step 2/4) | Chooses the insurer type: 손해보험사, 생명보험사, or 그외 공제 조합 (우체국, 새마을금고 공제회, 농협) | Prompt ‘실손보험이 가입된 보험사의 형태를 선택해 주세요’. ‘다음’ stays inactive until a card is chosen; ‘이전’ keeps the choice. There is no insurer-name list, no search, and no extra question: deduction type and outpatient limit are not asked. The result applies a standard deduction and limit assumption (see section 5.1) (§4) |
| Screen 3 (step 3/4) | Chooses why the patient came: ‘다쳐서 왔어요 (상해)’, ‘아파서 왔어요 (질병)’, or ‘잘 모르겠어요’ | Prompt ‘어떤 일로 병원에 오셨나요?’ with the help text that the question is asked only to guide the claim documents and does not change the expected amounts. ‘다음’ stays inactive until a card is chosen; ‘이전’ keeps the choice. The value feeds only the required-documents screen; ‘잘 모르겠어요’ does not put the result on hold (§4) |
| Screen 4 (step 4/4) | Selects hospital-published treatments on large cards | Nothing is preselected or recommended; multiple selection; selecting the same item twice in one visit counts once; benefit and non-benefit totals and the total update immediately; selection persists across list pages; fixed bottom bar shows the selection count, ‘총 예상 결제액’, and the button ‘예상 부담액 확인’ (§4) |
| Result | Reads three large amount cards; may open ‘계산 근거 보기’ or the required-documents screen | Actions: ‘보험 청구에 필요한 서류 확인’ (primary), ‘계산 근거 보기’, ‘치료 다시 선택’ and ‘보험 조건 수정’ (session kept), ‘처음으로’ (confirmation, then reset), ‘이용 완료’ (clears everything, shows the completion screen, then back to start). There is no consultation screen and no staff-inquiry button (§4) |
| Required documents | Reads which claim documents are needed | Reached only from the result; asks nothing more. Nine lines are always shown; the needed ones are marked with a one-line reason; receipt and itemized statement are one line, always marked. If the cause is unknown, the lines are grouped as seven common lines plus one injury-only line (초진기록지) and one illness-only line (진단서). ‘결과로 돌아가기’ returns to the result screen the patient came from (normal, not-covered, or landscape; never a fixed normal result) and keeps the selections and the result. The calculation-basis screen returns the same way. The mapping is an example and needs verification (§4) |

A patient who does not know the generation gets guidance on how to check it and returns to step 1. The treatment-cost-total-only path of the earlier planning document was dropped by the owner on 2026-10-13 (§1).

The generation and insurer type are the patient's own selection, never an automatic lookup. A result computed with the standard assumption is shown as an example (‘예시 계산’) and not as a personal payout (§4). A phrase such as ‘환자분의 실손은 C1입니다’ must not be used as if verified (§4).

### Supported generations (fixed list)

Image-based classification only; the codes C1 to C4 are internal aliases tied to the attached comparison image, not insurer product codes, and the individual meanings of A and S are not inferred (§2, §3).

| Card | Enrollment period as shown on the image | Conditions kept in rule data (not asked on screen) |
|------|------------------------------------------|--------------|
| 1세대(A·S) | before 2009.08.01 (2009.08.01 itself belongs to Gen 2) | Current coverage name, injury/illness, per-accident/per-visit limit, deductible |
| 2세대(C1) | 2009.08.01 to before 2015.09.01 | 2009.08 to 09 boundary contracts, deduction type, outpatient enrollment limit |
| 2.5세대(C2) | 2015.09.01 to before 2017.04.01 | Standard type / selectable-II, outpatient enrollment limit |
| 3세대(C3) | 2017.04.01 to before 2021.07.01 | Standard type / selectable-II, three-major-non-benefit riders |
| 4세대(C4) | 4th-generation contracts from 2021.07.01 (not "every contract after 2021.07.01"; 5th generation is excluded) | Non-benefit rider, per-item limit and count, current coverage |

Periods are half-open: each range includes its start date and excludes the next range's start date. Converted or re-enrolled contracts are never assigned a current generation from the first enrollment date alone; the current coverage and policy decide.

C1 and C2 are separate cards from the first screen. A contract whose current coverage is outside the supported range is never calculated as C4. Contracts from 2009.08 to 09 must not be assigned a generation by the enrollment date alone; no frame of the current design shows a dedicated help text or a current-coverage check for them (§2, §3, §11).

### Image vs official-source discrepancies

- The comparison image's author, date, and footnotes are unconfirmed, so it is a reference classification and not an operating rule (§2).
- The image marks the Gen 1/Gen 2 boundary at 2009.08, while the general standardization date is 2009.10; 2009.08-09 contracts had real renewal coverage-change issues [1]. Such contracts need a current-coverage check, and enrollment date alone must not decide coverage (§2).
- The image's "상해의료비 1,000만원" may be a per-accident combined inpatient plus outpatient limit and must not be shown to every Gen 1 customer as "per outpatient visit 1,000만원". A 0-won deductible applies only where the coverage and policy are confirmed (§2).
- The image's inpatient self-pay rate must not be carried into outpatient calculation (§2).
- The three major non-benefit groups are 도수·체외충격파·증식치료, 비급여 주사, and 비급여 MRI/MRA, each distinct. The image's MRI "50회" must not be implemented, because public 4th-generation material shows non-benefit MRI at 3,000,000 won per year with no count limit [4]; real rules follow each product's policy (§2).

## 5. Result semantics

### Three numbers (§4)

1. 예상 병원 결제액 (expected hospital payment): what the patient is expected to pay at the hospital today, excluding the National Health Insurance portion.
2. 예상 보험금 (expected insurance payout): a conditional estimate under the entered conditions and verified rules.
3. 보험금 수령 후 예상 본인 부담 (expected out-of-pocket burden after payout): item 1 minus item 2.

Every result distinguishes these three amounts. The after-payout burden must never be worded or laid out so it can be read as the amount to pay at the hospital today.

### Three calculation states (§6.1)

| State | Condition | Shown |
|-------|-----------|-------|
| 조건부 예상 계산 (conditional estimate) | The approved standard assumption profile and the approved treatment coverage mappings exist; calculable under stated assumptions (the patient's own contract values are not confirmed) | Expected payout, expected burden, assumptions |
| 확인된 규칙상 미보장 (confirmed uncovered) | An unsubscribed rider or exclusion clause is confirmed | 0 won for that item, with reason and basis |
| 계산 보류 (calculation on hold) | The approved standard assumption profile or the approved treatment coverage mapping is absent, unapproved, invalid, or under re-review, so the rule, coverage, or treatment classification cannot be fixed (section 5.4) | Treatment total, unconfirmed items, ‘확인 필요’, what must be confirmed; computed values are null |
| 계산 실패 (calculation failed) | Communication error or other failure to finish the calculation | Failure notice with retry / end-of-use; computed values are null |

Zero handling is by state, not a blanket rule: unconfirmed condition = null; communication error = null; confirmed exclusion = that item's payout 0 won with the exclusion reason; a normal calculation that results in 0 = 0 won with its calculation basis. "Unconfirmed" is never turned into "excluded".

An assumption sentence such as "all selected treatments are covered and limits remain" is shown only when every selected item is confirmed covered. A result with a confirmed exclusion replaces it with the excluded items, their reasons, and an assumption that matches the actual state.

Rules that follow from this:
- "Unknown" is never treated as "not subscribed" or "uncovered". An item whose approved standard profile or treatment mapping cannot be used is put on hold; it is not zero. An unknown treatment cause is not such a case: it only branches the required-documents list and never holds the calculation (section 5.4).
- If any unconfirmed amount exists, a single overall payout number is not shown as final; confirmable groups may appear as reference values while the overall burden stays on hold.
- When no treatment is selected, or the approved standard profile or treatment mapping cannot be used, the result does not show a payout of 0 won; it explains the state.
- A disclaimer does not repair a wrong calculation; when the approved profile or mapping cannot be used, the result itself becomes "on hold". The patient's own deductible, limit, and riders are not asked and not looked up, so they are not a reason to hold: they are stated as unconfirmed premises.
- The explanation area gives the selected generation and insurer type, the standard deduction and limit assumption applied (marked ‘(가정)’), the coverage premise, the deduction formula and limit overage, exclusions, the policy source (insurer, product, revision date, clause or page, source link), and a "remaining limit/count assumed" notice when remaining annual or per-accident limits are not confirmed. Policy sources are shown in the detail view only, and the kiosk never opens an external website directly.
- The planning document supplies a fixed wording for the standard disclaimer and for the deduction explanation example (§4); those texts are to be reused as written when the screens are specified.

### 5.1 Standard assumption (no condition questions) and review examples

The design saved on 2026-10-13 (blob `c68530b…`) removed the condition-question step (§4 screen 2). The patient is no longer asked for deduction type, outpatient coverage limit, or riders. The injury/illness cause is asked again, on its own input step (§4 screen 3), and is used only by the required-documents screen. The result applies a standard deduction and limit assumption for the chosen generation and insurer type, says so on the result (‘표준 공제·한도 가정으로 계산한 예상 금액입니다’), and shows the applied assumption on the basis screen marked ‘(가정)’. The design's example is generation 2 (C1), clinic outpatient fixed deduction 10,000 won, per-visit limit 250,000 won. The standard values (per generation and insurer type, source policy, approver) are not defined yet (§11). Values come only from confirmed policy data; without a real value or evidence the result is on hold (‘확인 필요’). The same values are not forced on every C1, C2, or C3 contract.

The earlier rules (deduction type and limit asked separately, the destination of "모르겠어요", the cause-based injury/illness help text, no internal notes on patient screens) were removed from this document together with the condition questions; they are in the version of this file at commit `57f5c01`. The cause (injury / illness / unknown) is asked on input step 3 of 4 and never changes the amounts; whether it should also drive the calculation is open (§11).

Review examples (DEMO patient amounts: X-ray 10,000 + ultrasound 70,000 + 신장분사치료 40,000 + physical therapy 4,000 = 124,000; benefit 14,000, non-benefit 110,000). They are illustrations, not confirmed hospital fees or coverage decisions. Expected hospital payment is 124,000 in every row. Arithmetic checked by hand for this document; no engine exists yet.

| Case | Assumptions | Expected insurance payout | Burden after payout |
|------|-------------|--------------------------:|--------------------:|
| A | A confirmed specific C1 profile: all items covered, deduction 10,000, outpatient payout limit 250,000. Not applied to all C1 contracts | 114,000 | 10,000 |
| B | C2 standard type, 20% deduction: max(10,000, 124,000 x 20%) = 24,800 | 99,200 | 24,800 |
| C | C2 selectable-II: max(10,000, 10% benefit + 20% non-benefit) = 23,400 | 100,600 | 23,400 |
| D | Hypothetical 4th gen: calculable in the general benefit and general non-benefit groups, rider enrolled, remaining limit sufficient | 4,000 + 77,000 = 81,000 | 43,000 |
| E | Hypothetical: the 40,000 item is excluded, the remaining 84,000 is covered, deduction 10,000, sufficient remaining limit | 74,000 | 50,000 |

Case E does not state that any real treatment is excluded. The general group formula P = min(max(E - D, 0), L) explains typical cases only; real products' benefit/non-benefit split, riders, counts, and shared limits must be reviewed, and no single formula is forced on every contract.

### 5.2 Admin permission split

- Hospital administrator: manage treatment menu and prices; register coverage-classification fields (benefit class, procedure code, treatment class) or request a change to them; view review status (read-only); request review; see review results and rejection reasons. Cannot approve or reject a coverage mapping, and cannot choose "검토 완료" themselves.
- Insurance-rule reviewer (보험 기준 검토 담당자): review treatment classification and coverage rules; approve or reject; manage the evidence and versions that were applied.
- A change that affects the coverage judgement (treatment or procedure code, benefit/non-benefit class) sends the existing approved mapping back to re-review; a price-only change does not.
- Settings and permissions are separated between hospitals.

### 5.3 Consultation guidance and reset

- There is no consultation screen and no staff-inquiry button; the number 1544-8069 appears only as text in the ‘세대를 모르겠어요’ guidance. Finishing (‘이용 완료’), ‘처음으로’ (with confirmation), and automatic reset are different actions. Returning from the required-documents screen keeps the selections and result.
- 1544-8069 is the user-provided consultation number; operating entity and hours are unconfirmed; the incomplete "1588" is not completed; real call connection and staff-call integration are out of the MVP. Individual exclusions, waiting periods, rider enrollment, and remaining limits still need a check against the patient's own contract.
- Idle reset: input screens warn at 100 s and reset at 120 s; result screens warn at 160 s and reset at 180 s. The calculation-basis screen and the required-documents screens (portrait, landscape, unknown-cause variants) use the result-screen times (160 s / 180 s), restart the idle time on every patient touch (including moving between the result and these screens), and on reset go to the start screen, not back to the result. This is a provisional default decided on 2026-10-14 without observed dwell times. The warning shows the remaining time, ‘계속 사용할게요’, and ‘처음으로’. Extension can repeat and restarts the idle time. Patient selections and results are removed on reset and are not kept in localStorage, IndexedDB, or service-worker cache; late responses after reset do not restore the screen; no admin sign-in state stays on a shared kiosk. This is a specification; no behavior has been tested.

### 5.4 Calculation basis: what the result confirms, assumes, and does not calculate (§4, §6.1)

The result keeps four things apart and never mixes them.

| Level | What it is | How the result words it |
|-------|------------|-------------------------|
| Confirmed from input | The generation, insurer type, treatment cause, and treatments the patient chose, and the prices the hospital published | Shown as chosen |
| Not confirmed | The patient's own deductible, limit, riders, remaining limit, waiting period, and exclusions. The kiosk neither asks for nor looks them up | Never written as if confirmed; the result says the actual values depend on the personal contract |
| Assumed | The approved standard assumption profile for the generation and insurer type (values, source policy, approver) and the approved treatment coverage mappings | ‘예시 계산’ and ‘(가정)’; the applied profile is shown on the basis screen |
| Not calculated | Anything for which the assumed level cannot be used | Calculation on hold: ‘확인 필요’, values null |

- Calculate (as an example, not a personal payout) only when the profile for the chosen generation and insurer type is approved and every chosen treatment has an approved coverage mapping.
- Hold the calculation when the profile or a treatment mapping is absent (no data), draft or DEMO, unapproved (unreviewed, rejected), invalid (superseded, expired), or under re-review. The hold applies to the affected treatment; any hold keeps the overall payout and burden on hold (§6.1, cost U).
- An unknown treatment cause does not hold the calculation. It only splits the required-documents list into common lines plus an injury-only and an illness-only line.
- An unknown generation is not a result state: the patient cannot leave step 1 and gets the enrollment-date guidance instead.
- Unfixed standard values are never estimated: no neighbouring generation's value, no average, no substitute profile for another generation or insurer type, no 0 won, no full coverage. The design's generation-2 (C1) example (10,000 deductible, 250,000 per-visit limit) illustrates the screen and is not an approved profile.

## 6. MVP scope

### In scope (§1, §4, §7, §8)

- Same-day outpatient visit at a single domestic clinic, a general individual indemnity policy, one insurance contract.
- Single initial hospital, with data and permission structure that already supports multiple hospitals.
- Generations 1 (A·S), 2 (C1), 2.5 (C2), 3 (C3), 4 (C4) only; anything else returns UNSUPPORTED.
- Kiosk start state, four input steps, separate result screen, required-documents screen, idle reset, and the number 1544-8069 as guidance text.
- Large-text mode (required, not a roadmap candidate; it enlarges the same screens responsively, with no dedicated design frames, and keeps every function, selection, and result of the normal mode, including "보험 조건 수정" on the result screen; layout is adjusted and lists are split into pages when space runs short; verified on the built screen, section 13.1 of the planning document) and assistive keyboard operation (navigation, selection, confirmation, visible focus, modal focus handling) alongside full touch-only completion (§13.1).
- PC admin web and insurance-rule management with source tracking and review states.
- Server-side recalculation from published prices and rules, with version checks.
- Example data labelled DEMO (see §7 below).

### Out of scope (§1, §8, §12, §13.3)

- Patient sign-up or login; uploads of name, resident number, policy, or diagnosis documents; automatic insurance lookup; claims filing on behalf of the patient.
- Inpatient care, prescription/dispensing, multiple hospitals, multiple dates, proportional compensation across several indemnity policies, old-age/pre-existing-condition/group indemnity, workers' compensation or auto insurance combined. These are not calculated as a general individual policy; the current design has no screen that screens them out (§11).
- Offline calculation, printer, phone connection, staff-call integration, result QR transfer, booking, reception, payment.
- The development excludes 5th generation, severe/non-severe branching, riders 1/2, and National Health Insurance copay-rate linked calculation, together with their data and tests.
- Hospital-side changes to insurance deductibles or payout limits: hospitals may change prices and menus only (§7).

## 7. Example (DEMO) data

All four rows are the user's example amounts assumed to be what the patient pays; they are not real hospital fees (§5).

| Type | Treatment | Expected patient payment | Status |
|------|-----------|-------------------------:|--------|
| Benefit (급여) | X-ray | 10,000 won | DEMO |
| Non-benefit (비급여) | 초음파 | 70,000 won | DEMO |
| Non-benefit (비급여) | 신장분사치료 | 40,000 won | DEMO; code and insurance classification unconfirmed |
| Benefit (급여) | 물리치료 | 4,000 won | DEMO |
| Total | 4 selected | 124,000 won | Benefit 14,000 / Non-benefit 110,000 |

The name 신장분사치료 must not be mapped to a general non-benefit or manual-therapy rider by name alone; classification depends on the actual procedure code, billing content, treatment purpose, and policy text. Always-present costs such as a consultation fee are not in the example; a hospital can register them as a common base-fee item, and when not registered the screen shows whether they are included (§5).

## 8. Contact numbers

- 1544-8069 is a user-provided consultation number. Its operating entity, purpose, and hours are unconfirmed (§4, §11).
- "1588" is an incomplete number from the user and must not be turned into a phone number; it is displayed only if an exact representative number is configured (§4).
- The kiosk shows the number as text in the generation-unknown guidance; sentences such as asking the reception staff stay as text and are not buttons. It must not present a real call or staff-call function when the device has no such integration (§4).

## 9. Roadmap candidates

Candidates only. None is committed; any of them becomes a SPEC later through `/moai plan`.

- Treatment quantity setting (§4: the MVP counts a duplicate tap once; quantity is to be extended after reviewing treatment characteristics).
- Further insurers, products, and coverages, starting with the first insurer whose real policy text is obtained, and limited use of confirmed profiles at the pilot (§10 steps 5 and 6).
- Roll-out to additional hospitals on the existing multi-hospital data and permission structure (§1, §7).
- Optional insurer search when a verified on-screen Korean keyboard exists (§4).
- Items the MVP excludes and that the document does not rule out for later: offline calculation, printer, phone connection, staff-call integration, result QR transfer (§13.3).

## 10. Success metrics

As stated in §10, with no invented targets; reference values are to be measured in the pilot at 성정원통사의원 instead of fixing numbers in advance.

- Completion rate across the four steps.
- Reasons calculations are put on hold.
- Time staff spend explaining.
- Touch mis-operations and mid-flow abandonment.
- Calculation error reports.

## 11. Reference sources named by the planning document

The planning document cites these as supporting structure, not as operating policy text; none was fetched or checked while writing this file.
- [1] Korea Consumer Agency notice on renewal of 2009.08 to 09 contracts (2012): https://www.kca.go.kr/home/sub.do?menukey=4005&mode=view&no=1001288923 ; Korea Insurance Research Institute material on the 2009.10 standardization: https://www.kiri.or.kr/pdf/%EC%97%B0%EA%B5%AC%EC%9E%90%EB%A3%8C/%EC%A0%95%EC%B1%85%EB%B3%B4%EA%B3%A0%EC%84%9C/rej2011-06_03.pdf
- [2] KB Insurance product guide PDF (selectable-II outpatient deduction and enrollment-limit options, p. 7); a summary, not a replacement for policy text: https://www.kbinsure.co.kr/extrnl/clause/ltins/21930.pdf
- [3] Financial Services Commission notices on the 4th-generation product restructuring (2020.12, 2021.06): https://www.fsc.go.kr/no010101/74948 / https://www.fsc.go.kr/no010101/76157
- [4] Financial Services Commission press-release comparison table (4th generation), hosted by the Korea Insurance Research Institute: https://kiri.or.kr/PDF/weeklytrend/20260518/trend20260518_4.pdf
- [5] Ministry of Government Legislation notice of a 2026 amendment draft of the Medical Service Act enforcement decree (a legislative notice, not settled law): https://www.moleg.go.kr/lawinfo/makingInfo.mo?cptOfiOrgCd=&currentPage=25&edYdFmt=&keyField=&keyWord=&lawCd=0&lawSeq=86888&lawType=TYPE5&lsClsCd=&mid=a10104010000&pageCnt=40&stYdFmt=

## 12. Open items (traceable to §11 and other gaps)

From §11:
- Kiosk screen size, orientation, resolution, OS, browser, mounting height, network environment.
- Official hospital display name, logo, institution type, and real treatment list.
- Whether each price is the full insurance fee or the patient copay; whether a common consultation fee is included.
- First insurer, product, and coverage whose real policy text and limit options will back the first published rules.
- Complete "1588" number; operating entity, hours, and purpose of 1544-8069.
- Applicable medical-advertising rules at deployment time. The source cited ([5]) is a 2026 legislative notice and not a settled legal basis; the phrase "conditional estimate" does not by itself make the service compliant.

Additional, found while writing:
- Meaning of A and S individually; not inferred.
- Insurer list and official representative numbers must be verified before publication; each company's sale/conversion timing and product exceptions are separate data still to be collected.
- Deduction and limit formulas for several template profiles are only named, not specified: generation-1 injury/illness outpatient (by policy, fixed or percentage), generation-2 percentage-deduction type (rate by sales period/type), generation-3 basic and three-major-non-benefit riders (see tech.md).
- How the three-major non-benefit group shares limits with ordinary non-benefit is to follow each policy and is not specified.
- Real classification of 신장분사치료 (procedure code, billing content, purpose).
- Which of the six rule-administration duties belong to the insurance-rule reviewer and which to the platform operator is not split in the document.
- Whether a staff-call or phone feature will ever exist depends on device integration not yet known.
- Whether a staff-entry route for insurance conditions will exist: undefined, so no screen may imply it.
- Standard deduction and limit assumption per generation and insurer type (values, source policy, approver) and what the insurer type means for rule selection. The owner will attach a table (image) to the GPT review request; the values are entered afterwards. Until the table is entered and approved the profile counts as absent and the calculation is held (section 5.4).
- The real document requirements per insurer, product, and claim-amount band; whether the injury/illness split should also drive the amounts.
- How unsupported contracts are screened out (the treatment-total-only path was dropped on 2026-10-13).
- Font: Pretendard (decided 2026-10-13; the design's spec sentences now say so). Open: whether the real device has it or it is loaded as a web font. Confirming that Pretendard is actually applied, and that no text clips in it, is an implementation acceptance criterion (planning document §13.1, §14); it cannot be shown from the design file.
- Large text: no dedicated design frames exist and none is required. The responsive layout is checked on the built screen at 1080x1920 and 1920x1080 (planning document §13.1).
- Pencil design: the current saved file is design blob `4b4a158…` at repository HEAD `875f71b` (the `design:` commit is `3a76482`). It is reviewed in `design-requirements.md` section 5.13, which lists the findings and the decisions and input materials needed before the next SPEC (working name SPEC-REIMBURSEMENT-ESTIMATOR-001 [old ID; renamed SPEC-REIMBURSEMENT-001 on 2026-10-15], not started). Earlier saves (`01bacca…` and before) are dated records in sections 5.2 to 5.12.
