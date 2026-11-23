import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import snapshot from '../../patient-kiosk/data/insurance-rules.generated.json';
import { registerInsuranceRules } from '../../patient-kiosk/data/register-insurance-rules.mjs';

it('registers the five sourced policy editions and exports only calculable rules to the kiosk', () => {
  const temp = mkdtempSync(join(tmpdir(), 'bodam-policy-'));
  try {
    const file = join(temp, 'policy.sqlite');
    expect(JSON.parse(registerInsuranceRules(file))).toEqual(snapshot);
    expect(JSON.parse(registerInsuranceRules(file))).toEqual(snapshot);
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      expect(db.prepare(`
        SELECT generation, fixedDeductibleWon, nonBenefitBasisPoints, perVisitLimitWon,
               annualLimitWon, maxVisits, limitPeriod, scope
        FROM insurance_rule ORDER BY generation
      `).all().map(Object.values)).toEqual([
        ['GEN1_AS', 5_000, 0, 300_000, null, 30, 'ILLNESS_ONSET_365_DAYS', 'HISTORICAL'],
        ['GEN2_5_C2', 10_000, 2000, null, null, 180, 'CONTRACT_YEAR', 'VISIT'],
        ['GEN2_C1', 10_000, 0, null, null, 180, 'CONTRACT_YEAR', 'VISIT'],
        ['GEN3_C3', 20_000, 3000, null, 3_500_000, 50, 'CONTRACT_YEAR', 'TREATMENT'],
        ['GEN4_C4', 30_000, 3000, null, 3_500_000, 50, 'CONTRACT_YEAR', 'INITIAL_TEN'],
      ]);
      expect(snapshot.map(({ generation }) => generation)).not.toContain('GEN1_AS');
    } finally {
      db.close();
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
