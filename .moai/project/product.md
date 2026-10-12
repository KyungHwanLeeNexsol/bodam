# Product: 메디헬퍼 (medi-helper)

> Status: planning only. No source code, tests, or deployment exist yet. Everything below is derived from the planning document `메디헬퍼_기획설계_v0.2.md` (repository root, Korean; "§N" refers to its sections). Nothing here is claimed as implemented, tested, or verified.

## 1. Project name and description

- Project name: medi-helper. Patient-facing service name: ‘메디헬퍼’ (default brand string, managed as a common brand setting; the hospital name is managed separately) (§8).
- Description: a web application used on a shared touch-screen kiosk installed in a hospital. Without sign-up or login, a patient selects (1) the current indemnity-insurance (실손보험) generation, (2) the insurer and any required coverage conditions, and (3) treatments, then sees on a separate result screen the total expected payment, the expected insurance payout, and the expected out-of-pocket amount after the payout (§1).
- The core of the product is not generation explainer pages but an estimate that links the hospital's treatment menu to policy rules. The same input must give the same result and the same calculation basis. Generative AI is not used for insurance calculation or coverage explanation (§1).
- Not a booking, reception, or payment function. The service is for insurance guidance only (§4).
- Initial pilot clinic: ‘성정원통사의원’. This is the user-provided notation; the official name, real treatment list, and real prices are not yet confirmed (§1).

## 2. Target audience

| Audience | How they use the product |
|----------|--------------------------|
| Patients at the kiosk | Use the shared touch screen without sign-up; no personal phone or QR start in the default flow (§1) |
| Hospital administrators | Log in to a separate PC admin web to manage clinic settings, treatments, prices, publication (§7) |
| Insurance-rule reviewers (proposed split) | Review and publish insurer, product, coverage, and policy-source rules; approve rules against policy text (§7) |
| Platform operator (proposed split) | Manages hospital administrator permissions and which rules a hospital may use (§7) |

The same person may hold several roles at first, but permissions stay separate (§7).

## 3. Core features

- Kiosk idle/start state and three input steps (insurance generation; insurer and conditions; treatment selection), followed by a separate result screen with a collapsible calculation basis (§1, §4).
- Deterministic estimate engine that combines published treatment prices with versioned, source-backed insurance rules (§6, §8).
- Calculation states that keep "unknown" distinct from "uncovered" (§6.1).
- Idle-timeout warning, extension, and automatic reset so the next patient never sees the previous patient's data (§13.2).
- Consultation routing for cases the product does not calculate (§1, §4).
- PC admin web: clinic name, logo, institution type, notice text, consultation number, kiosk device settings; treatment add/edit/deactivate/reorder; benefit/non-benefit classification and price conditions; common base fees (such as a consultation fee); portrait and landscape kiosk preview; draft and publish with version history; idle-reset, result-hold, and warning times (§7).
- Rule administration: insurer, product, coverage, deduction type, and policy-version management; policy source recording (URL or file identity, clause, page, effective date); treatment-code to coverage-group mapping review; rule lifecycle (draft, reviewed, published, suspended); approval records comparing calculation examples with the actual policy text (§7).

## 4. Use cases and patient journey

Flow: start, insurance generation, insurer and conditions, treatments, result, finish. Idle timeout or finish returns to the start state with everything cleared (§9 "키오스크 동선", §13.2).

| Stage | What the patient does | Notes from the planning document |
|-------|----------------------|----------------------------------|
| Start (idle) | Sees the hospital name, ‘메디헬퍼’, the description ‘실손보험 예상 부담액 안내’, and a large ‘실손 예상 부담액 확인’ button | Shows no previous amounts or selections; pressing start always opens screen 1 with an empty session; the device is preconfigured to one clinic (§4) |
| Screen 1 (step 1/3) | Chooses one of five generation cards, with the image-based enrollment period shown on the card | Prompt ‘내 실손보험을 선택해 주세요’. Escape routes: ‘가입 조건이 목록에 없어요’ (out-of-scope contract, consultation instead of calculation); ‘가입 시기는 알지만 세대는 모르겠어요’ (year/month buttons or on-screen numeric keypad to show candidates); ‘실손을 전환하거나 보장내용을 변경했나요?’ (yes/no/unknown; if yes, guide the patient to choose by the current policy (현재 증권 기준)); ‘세대를 모르겠어요’ (how to check, consultation). A generation is never picked on the patient's behalf. Patients may skip consultation and go to the treatment-cost total only (§4) |
| Screen 2 (step 2/3) | Chooses an insurer and answers only the extra questions that are needed, one question at a time | Insurer tabs: 손해보험 / 생명보험 / 우체국 / 농협·공제, plus main-insurer and full-list views, paged with ‘이전 목록/다음 목록’. Search is optional and only enabled where a verified on-screen Korean keyboard exists. Every question offers ‘모르겠어요/직원에게 문의’. Choices are kept when navigating back (§4) |
| Screen 3 (step 3/3) | Selects hospital-published treatments on large cards | Nothing is preselected or recommended; multiple selection; selecting the same item twice in one visit counts once; benefit and non-benefit totals and the total update immediately; selection persists across list pages; fixed bottom bar shows the selection count, ‘총 예상 결제액’, and the button ‘예상 부담액 확인’ (§4) |
| Result | Reads three large amount cards; may open ‘계산 근거 보기’ | Actions: ‘치료 다시 선택’, ‘보험 조건 수정’ (session kept), ‘이용 완료’ (clears everything, back to start), ‘직원에게 문의’ (§4) |

A patient who does not know the insurance condition can still see the treatment-cost total only (§1).

Insurance condition entry is the patient's own selection, never an automatic lookup. The UI distinguishes ‘현재 가입 조건으로 선택했습니다’ from ‘일반적인 조건만 살펴봅니다’; the latter is shown as an example and not as a personal payout (§4). A phrase such as ‘환자분의 실손은 C1입니다’ must not be used as if verified (§4).

### Supported generations (fixed list)

Image-based classification only; the codes C1 to C4 are internal aliases tied to the attached comparison image, not insurer product codes, and the individual meanings of A and S are not inferred (§2, §3).

| Card | Enrollment period as shown on the image | Extra checks |
|------|------------------------------------------|--------------|
| 1세대(A·S) | on or before 2009.08.01 | Current coverage name, injury/illness, per-accident/per-visit limit, deductible |
| 2세대(C1) | 2009.08.01 to before 2015.09.01 | 2009.08 to 09 boundary contracts, deduction type, outpatient enrollment limit |
| 2.5세대(C2) | 2015.09.01 to before 2017.04.01 | Standard type / selectable-II, outpatient enrollment limit |
| 3세대(C3) | 2017.04.01 to before 2021.07.01 | Standard type / selectable-II, three-major-non-benefit riders |
| 4세대(C4) | 4th-generation contracts from 2021.07.01 | Non-benefit rider, per-item limit and count, current coverage |

C1 and C2 are separate cards from the first screen. A contract whose current coverage is outside the supported range stops calculation and routes to consultation; it is never calculated as C4. Contracts from 2009.08 to 09 get a dedicated help text and a check of current coverage, because the enrollment date alone must not decide the coverage (§2, §3).

### Image vs official-source discrepancies

- The comparison image's author, date, and footnotes are unconfirmed, so it is a reference classification and not an operating rule (§2).
- The image marks the Gen 1/Gen 2 boundary at 2009.08, while the general standardization date is 2009.10; 2009.08-09 contracts had real renewal coverage-change issues [1]. Such contracts need a current-coverage check, and enrollment date alone must not decide coverage (§2).
- The image's "상해의료비 1,000만원" may be a per-accident combined inpatient plus outpatient limit and must not be shown to every Gen 1 customer as "per outpatient visit 1,000만원". A 0-won deductible applies only where the coverage and policy are confirmed (§2).
- The image's inpatient self-pay rate must not be carried into outpatient calculation (§2).
- The three major non-benefit groups are 도수·체외충격파·증식치료, 비급여 주사, and 비급여 MRI/MRA, each distinct. The image's MRI "50회" must not be implemented, because public 4th-generation material shows non-benefit MRI at 3,000,000 won per year with no count limit [4]; real rules follow each product's policy (§2).

## 5. Result semantics

### Three numbers (§4)

1. Expected hospital payment: what the patient pays at the hospital, excluding the National Health Insurance portion.
2. Expected indemnity payout: a conditional estimate under the entered conditions and verified rules.
3. Expected burden after payout: item 1 minus item 2.

The after-payout burden must never be worded as the amount to pay at the hospital today.

### Three calculation states (§6.1)

| State | Condition | Shown |
|-------|-----------|-------|
| 조건부 예상 계산 (conditional estimate) | Rule and required conditions confirmed; calculable under stated assumptions | Expected payout, expected burden, assumptions |
| 확인된 규칙상 미보장 (confirmed uncovered) | An unsubscribed rider or exclusion clause is confirmed | 0 won for that item, with reason and basis |
| 계산 보류 (calculation on hold) | Rule, coverage, treatment classification, or a required condition is unclear | Treatment total, unconfirmed items, what must be confirmed |

Rules that follow from this:
- "Unknown" is never treated as "not subscribed" or "uncovered". An unknown condition puts the item on hold; it is not zero.
- If any unconfirmed amount exists, a single overall payout number is not shown as final; confirmable groups may appear as reference values while the overall burden stays on hold.
- When no treatment is selected or a required condition is unconfirmed, the result does not show a payout of 0 won; it explains the state.
- A disclaimer does not repair a wrong calculation; when a condition is unknown the result itself becomes "on hold".
- The explanation area gives the selected generation, deduction type, coverage, enrollment limit, the injury/illness premise, the deduction formula and limit overage, exclusions, the policy source (insurer, product, revision date, clause or page, source link), and a "remaining limit/count assumed" notice when remaining annual or per-accident limits are not confirmed. Policy sources are shown in the detail view only, and the kiosk never opens an external website directly.
- The planning document supplies a fixed wording for the standard disclaimer and for the deduction explanation example (§4); those texts are to be reused as written when the screens are specified.

## 6. MVP scope

### In scope (§1, §4, §7, §8)

- Same-day outpatient visit at a single domestic clinic, a general individual indemnity policy, one insurance contract.
- Single initial hospital, with data and permission structure that already supports multiple hospitals.
- Generations 1 (A·S), 2 (C1), 2.5 (C2), 3 (C3), 4 (C4) only; anything else returns UNSUPPORTED.
- Kiosk start state, three input steps, separate result screen, idle reset, consultation guidance.
- PC admin web and insurance-rule management with source tracking and review states.
- Server-side recalculation from published prices and rules, with version checks.
- Example data labelled DEMO (see §7 below).

### Out of scope (§1, §8, §12, §13.3)

- Patient sign-up or login; uploads of name, resident number, policy, or diagnosis documents; automatic insurance lookup; claims filing on behalf of the patient.
- Inpatient care, prescription/dispensing, multiple hospitals, multiple dates, proportional compensation across several indemnity policies, old-age/pre-existing-condition/group indemnity, workers' compensation or auto insurance combined. These route to consultation and are never calculated as a general individual policy.
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
- The kiosk shows the number plus guidance such as using one's own mobile phone or asking the reception staff. It must not present a real call or staff-call function when the device has no such integration (§4).

## 9. Roadmap candidates

Candidates only. None is committed; any of them becomes a SPEC later through `/moai plan`.

- Treatment quantity setting (§4: the MVP counts a duplicate tap once; quantity is to be extended after reviewing treatment characteristics).
- Further insurers, products, and coverages, starting with the first insurer whose real policy text is obtained, and limited use of confirmed profiles at the pilot (§10 steps 5 and 6).
- Roll-out to additional hospitals on the existing multi-hospital data and permission structure (§1, §7).
- Optional insurer search when a verified on-screen Korean keyboard exists (§4).
- Text enlargement option for body text (§13.1).
- Items the MVP excludes and that the document does not rule out for later: offline calculation, printer, phone connection, staff-call integration, result QR transfer (§13.3).

## 10. Success metrics

As stated in §10, with no invented targets; reference values are to be measured in the pilot at 성정원통사의원 instead of fixing numbers in advance.

- Completion rate across the three steps.
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
