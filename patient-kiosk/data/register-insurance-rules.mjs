import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const dbPath = fileURLToPath(new URL('../../dist-ssr/patient-insurance-rules.sqlite', import.meta.url));
const sql = readFileSync(new URL('./insurance-rules.sql', import.meta.url), 'utf8');
const snapshot = fileURLToPath(new URL('./insurance-rules.generated.json', import.meta.url));

export function registerInsuranceRules(path) {
  const target = resolve(path);
  const temp = `${target}.${process.pid}.tmp`;
  mkdirSync(dirname(target), { recursive: true });
  try {
    const db = new DatabaseSync(temp);
    let rules;
    try {
      db.exec(`BEGIN; ${sql} COMMIT;`);
      if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') {
        throw new Error('Insurance rule database failed integrity check');
      }
      rules = db.prepare(`
        SELECT id, generation, insurerType, policy, coverage, sourceUrl, sourceLocation,
               fixedDeductibleWon, nonBenefitBasisPoints, annualLimitWon, maxVisits, scope
        FROM insurance_rule WHERE scope != 'HISTORICAL' ORDER BY id
      `).all();
    } finally {
      db.close();
    }
    renameSync(temp, target);
    return JSON.stringify(rules, null, 2) + '\n';
  } finally {
    rmSync(temp, { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = process.argv[2];
  if ((option !== undefined && option !== '--write-snapshot') || process.argv.length > 3) {
    throw new Error('Usage: npm run patient:rules:register -- [--write-snapshot]');
  }
  const data = registerInsuranceRules(dbPath);
  if (option === '--write-snapshot') {
    writeFileSync(snapshot, data);
  } else if (readFileSync(snapshot, 'utf8').replaceAll('\r\n', '\n') !== data) {
    throw new Error('Insurance rules changed; regenerate the reviewed snapshot with --write-snapshot');
  }
  process.stdout.write(`Registered insurance rules in ${dbPath}\n`);
}
