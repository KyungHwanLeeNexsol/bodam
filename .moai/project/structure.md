# Structure: 메디헬퍼 (medi-helper)

> Proposed - not yet created; to be finalized by the plan/run phases. No source code exists in the repository. Everything below is a proposed architecture derived from `메디헬퍼_기획설계_v0.2.md` ("§N" refers to its sections). Entity relationships and directory names marked "inferred" are not stated by the planning document and are proposals only. Final decisions belong to the SPEC (the planning document asks for `SPEC-REIMBURSEMENT-ESTIMATOR-001` as a later `/moai plan` step).

## 1. Architecture overview

Single Next.js (App Router) + TypeScript application with two clearly separated surfaces and one shared, independent calculation module (§8).

```
 Kiosk (patient, touch only)          Admin (PC browser, authenticated)
 /kiosk/{clinicSlug}                  /admin
        |                                    |
        v                                    v
   Public read APIs + POST /api/estimate   Admin settings / publish APIs
        |                                    |  (auth + clinic-scope check)
        +----------------+-------------------+
                         v
              Server layer: published data access
                         |
          +--------------+---------------+
          v                              v
 Calculation module (pure TS)      Relational DB
 no UI, no DB, no network          (product TBD; see tech.md)
```

## 2. Route separation

| Surface | Route | Audience | Rules |
|---------|-------|----------|-------|
| Kiosk | `/kiosk/{clinicSlug}` | Patient | Opens in full screen on a device preconfigured to one clinic; the patient never chooses a hospital; no link to `/admin` appears on any patient screen; insurance and treatment conditions never appear in the URL query (§4, §8) |
| Admin | `/admin` | Hospital administrator, insurance-rule reviewer, platform operator | Separate PC web; login required; admin authentication is never left on a shared kiosk; a hidden touch sequence on the patient screen must not open admin rights; kiosk device setup uses separate authentication and a real device-management procedure (§7, §8, §13.3) |

## 3. API endpoints (§8)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/clinics/{slug}/catalog` | Published treatments and price version for the clinic |
| `GET /api/insurance/options` | Verified selection options and the follow-up questions they require |
| `POST /api/estimate` | Takes treatment IDs, the selected insurance conditions, and the price and rule versions; returns the result and its basis |
| Admin settings and publish APIs | Processed only after authentication and clinic-permission checks; concrete paths are not specified by the planning document |

Server-side rules for these endpoints:
- The server never trusts client-submitted treatment prices, deduction rates, or clinic IDs. It recalculates from treatment IDs and the server's published data (§8, §9 "가격 변조").
- The instant on-screen preview and the final server calculation use the same calculation module (§8).
- A price or rule update while a patient is mid-session is detected by a version mismatch check; the latest amount is shown again and an out-of-date value is never finalized (§7, §9 "버전 변경").
- No external AI or model API is called, so no model API key is needed for calculation (§8).

## 4. Calculation module (independent, pure TypeScript)

Kept apart from UI, database, and rule data (§8, §10 step 2).

- Input: published treatment prices (patient-payable amounts), the patient's selected insurance conditions, and a rule version supplied as data.
- Output: a calculation state per group/item (conditional estimate / confirmed uncovered / calculation on hold) plus an overall roll-up, the amounts, and the calculation basis. Any group on hold (unconfirmed cost U present) keeps the overall burden on hold; confirmable groups may be shown as reference values (§6.1). The exact result shape is an open item to be fixed in the SPEC.
- Formula symbols (T, G, N, E, X, U, D, L, P) are defined in `tech.md` section 3 (§6.1).
- Deterministic: the same input yields the same result and basis; no generative AI (§1).
- Order of operations (§6.2): select the published treatment/price version and applicable rule version; check input consistency; split covered / excluded / unconfirmed items; build groups by the policy's deduction unit (visit, date, coverage, rider); sum costs per group and compute the deduction; apply payout limit, count, period, and remaining limit after the deduction; apply a limit shared by groups only once; compute the total payout and the burden after payout, and produce the basis.
- Generic group formula (not forced on every contract): `P = min(max(E - D, 0), L)`; burden after payout = `T - sum(P)`. Whether L is a payout limit or a covered-cost limit is stated per rule (§6.2).
- Deductions are not repeated per treatment; deductions of different coverages are not merged arbitrarily (§6.2).
- Unsupported input (e.g. 5th generation) returns UNSUPPORTED and is never substituted by the C4 rules (§9).
- Rule data is supplied from outside. Example rules used for tests are kept apart from operating rules and labelled DEMO or DRAFT (§8, §10 step 2).

## 5. Rule data and policy-source handling (§7, §8)

- A rule carries its insurer/product/coverage, deduction, payout limit, period, count, exclusions, aggregation unit, validity period, and review state.
- Every operating rule requires a policy source: insurer document, revision date, clause or page, effective date, reviewer and review date. Rules built only from generic generation descriptions stay DEMO or DRAFT and are never applied to a real patient's estimate (§8, §9 "초안 규칙").
- Public press releases and official product guides explain structure; they do not replace verification against individual policy text (§8).
- Lifecycle: draft, reviewed, published, suspended. Rules are not deleted or overwritten; a new version is issued. Preview before publishing, restore a prior version, and record the editor, date, and reason (§7).
- Hospitals can change prices and menus but not deductions or payout limits. A newly added treatment whose insurance classification is unreviewed has its price published but its expected payout put on hold (§7).
- Treatment-to-coverage mapping is reviewed as data (TreatmentCoverageMapping), not inferred from treatment names (§5).
- Insurer data: ‘농협’ is not a single rule; NH농협손해보험, NH농협생명, and former 농협공제 are stored as different institutions/products and linked through search aliases. Former and pre-merger company names are also aliases (§4).

## 6. Data entities (§8) and proposed relationships

| Entity | Main contents (from §8) |
|--------|-------------------------|
| Clinic | slug, name, institution type, contact, published version |
| KioskDevice | device identifier, linked clinic, screen orientation/settings, active flag; not editable by patients |
| ClinicMembership | links an admin user to a clinic and a role |
| TreatmentVersion | treatment ID, price, benefit classification, codes, effective date, publication state |
| Insurer | institution type, current name, former-name aliases, verified contact |
| ProductProfile | generation, product/coverage, sales period, deduction type, enrollment-limit options |
| PolicySource | insurer document, revision date, clause/page, reviewer and review date |
| CoverageRuleVersion | deduction / payout limit / period / count / exclusions / aggregation unit, validity period, review state |
| TreatmentCoverageMapping | treatment code to product/rule group, conditions, review state |
| AuditLog | admin changes and publication history |

Proposed relationships (inferred from the entity descriptions, to be confirmed in the data-model SPEC):

```
Clinic 1 --- N KioskDevice
Clinic 1 --- N TreatmentVersion          (versioned, published per clinic)
Clinic N --- N admin user   via ClinicMembership (role per membership)
Insurer 1 --- N ProductProfile
ProductProfile 1 --- N CoverageRuleVersion
CoverageRuleVersion N --- 1 PolicySource   (required for operating rules)
TreatmentVersion N --- N CoverageRuleVersion   via TreatmentCoverageMapping
AuditLog  <--  changes to the entities above
```

Initial admin price fields for treatments (from §5): display name and description, benefit/non-benefit (the same treatment name in benefit and non-benefit form is two separate items), expected patient payment (a confirmed charge or an expected copay with its stated assumption), price conditions (patient type, assumption, reference date), procedure/fee code if obtainable, insurance calculation class (general benefit / general non-benefit / three-major non-benefit / needs review), coverage review state (not reviewed / reviewed / needs consultation), publication state and order. Common base-fee items can be registered separately.

## 7. Roles and permission boundaries (§7)

| Role | Can | Cannot |
|------|-----|--------|
| Hospital administrator | Manage own clinic's name, logo, institution type, notice, consultation number, kiosk device settings; add/edit/deactivate/reorder treatments; set benefit class, price, conditions, common base fees; preview portrait/landscape; draft and publish; view version and change history; set idle-reset, result-hold, and warning times | Change insurance deductions or payout limits; read or change another clinic's data |
| Insurance-rule reviewer | Manage insurers, products, coverages, deduction types, policy versions; record sources and clauses; review treatment-code to coverage mapping; move rules through draft, reviewed, published, suspended; approve calculation examples against policy text | Not specified in the planning document |
| Platform operator | Manage clinic administrator permissions and the rule scope a clinic may use | Not specified in the planning document |

The planning document groups the six rule-administration duties under "platform operator / insurance-rule reviewer" without splitting them between the two roles; the split above is a proposal. The server verifies the clinic permission on every admin call, so one clinic's administrator cannot read or change another clinic's prices or settings (§7, §9 "병원 격리").

## 8. Kiosk session state

- Patient selections and results live only in the kiosk page's in-memory session. Nothing is stored in localStorage, IndexedDB, or service-worker caches. The server stores no personal health data by default. No treatment or insurance condition is put in a URL query or an analytics event; operating statistics use step-level aggregates and anonymous events (§8).
- Reset triggers: reload/restart starts an empty session; ‘이용 완료’ clears immediately; ‘처음으로’ asks for confirmation while in progress and then clears all; idle timeout shows a warning with extension, then clears; Back and Edit keep the current patient's choices (§13.2).
- A request in flight when a reset happens is cancelled, and the session identifier is replaced so a late response is ignored and never shows on the next patient's screen (§13.2, §9 "늦은 계산 응답").
- Browser history, page cache, and Back must not bring back the previous patient's result; this must be verified on the real device (§13.2).
- State machine as stated: idle (start) is separate from the three input steps; the result is a separate screen; extra insurance questions are an additional state inside step 2; a question caused by a treatment chosen in step 3 can be asked on that screen or by returning to the matching item in step 2 (§1, §4).

## 9. Proposed directory layout

Proposed - not yet created. Each entry is one purpose; names are suggestions.

```
src/
  app/
    kiosk/[clinicSlug]/     patient flow: start, three steps, result
    admin/                  PC admin web
    api/
      clinics/[slug]/catalog/   published treatments and price version
      insurance/options/        selectable options and follow-up questions
      estimate/                 server-side recalculation and basis
  engine/                   pure TypeScript calculation module (no UI, DB, or network imports)
  server/                   (inferred) data access, authentication, clinic-scope checks, version checks
tests/
  engine/                   numeric examples and invariants (see tech.md); DEMO rule fixtures
  permissions/              clinic isolation and role checks
.moai/project/              product.md, structure.md, tech.md
```

## 10. Layout behavior

- Separate layouts for portrait 1080x1920 and landscape 1920x1080 (provisional, not real device specs): card columns, items per list page, and amount placement differ by orientation instead of simply scaling up (§13.1).
- Screen composition: top shows hospital name, a short question, and the current step; the center shows large selection cards; the bottom shows Back/Next and the total area. Important actions are not placed only at the very top (§13.1).
- Web UI development is separate from kiosk device lockdown (auto-launch, address-bar hiding, admin-escape prevention, relaunch after power recovery), which is set and verified on the real OS and browser (§13.3).

## 11. Open items (trace to §11 and other gaps)

- Kiosk size, orientation, resolution, OS, browser, mounting height, and network environment are unconfirmed.
- How a kiosk device is bound to a clinic (device ID versus the `clinicSlug` route versus both) is not specified; KioskDevice exists as an entity but the binding mechanism is open.
- Admin API paths, authentication provider, database, and hosting are undecided (see tech.md).
- Relationships in section 6 and the `server/` layer are inferences.
- Split of rule-administration duties between the insurance-rule reviewer and platform operator.
- Real hospital data (name, logo, treatments, prices, whether a price is full fee or copay, base fees) and the first real policy source.
- Treatment-code mapping for 신장분사치료 and for items whose insurance class is unreviewed.
- Storage for hospital-configurable idle-reset / result-hold / warning times (§7), the common brand setting (§8), and common base-fee items (§5) is not assigned to an entity (Clinic, KioskDevice, or a new entity), and a parent "Treatment" identity for TreatmentVersion is not defined; all undecided.
- Exact shape of the per-group plus overall calculation result (section 4) is to be fixed in the SPEC.
- Medical-advertising rules in force at deployment time.
