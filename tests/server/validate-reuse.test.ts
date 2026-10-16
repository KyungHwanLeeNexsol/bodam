import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 게시 검증기는 엔진의 판정 함수를 새로 만들지 않고 가져와 부른다 (plan.md M3 "두 번째 구현을 두지 않음").
// 같은 이름의 함수를 따로 정의하면 게시와 계산이 어긋난다. 이 시험은 소스를 읽어 (1) 필요한 엔진 함수를 엔진 모듈에서 가져오는지,
// (2) src/server 어디에도 같은 이름을 정의하지 않는지, (3) 해시 구현이 digest.ts 하나뿐인지 확인한다.

const SERVER_DIR = fileURLToPath(new URL('../../src/server', import.meta.url));

function read(dir: string): Array<{ file: string; text: string }> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return read(path);
    return entry.name.endsWith('.ts') ? [{ file: path.slice(SERVER_DIR.length + 1), text: readFileSync(path, 'utf8') }] : [];
  });
}

const files = read(SERVER_DIR);
const validators = files.filter(({ file }) => file.startsWith('validate/') || file === 'publish-validate.ts');

/** 게시 검증이 엔진에서 가져와 쓰는 함수와 가져오는 엔진 모듈. */
const REUSED: Array<[name: string, engineModule: string]> = [
  ['checkProfileStructure', 'profile-structure'],
  ['checkDocumentRuleSetStructure', 'documents'],
  ['profileContent', 'usability'],
  ['documentRuleSetContent', 'usability'],
  ['profileHasGroup', 'resolve'],
  ['isWon', 'numeric'],
  ['isBasisPoints', 'numeric'],
];

/** 이름이 name 인 함수·상수를 정의하는 줄(가져오기 제외). */
function definitions(name: string): string[] {
  const declaration = new RegExp(`(?:function\\s+${name}\\b|(?:const|let|var)\\s+${name}\\b)`);
  return files.filter(({ text }) => declaration.test(text)).map(({ file }) => file);
}

describe('게시 검증기는 엔진의 판정 함수를 가져와 부른다', () => {
  it.each(REUSED)('%s 는 엔진 %s 모듈에서 가져온다', (name, engineModule) => {
    const importer = validators.find(({ text }) => new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'\\.\\./\\.\\./engine/${engineModule}'`).test(text));
    expect(importer, `${name} 를 가져오는 검증기 파일이 없다`).toBeDefined();
  });

  it.each(REUSED)('%s 를 src/server 어디에도 다시 정의하지 않는다', (name) => {
    expect(definitions(name)).toEqual([]);
  });

  it('가져온 함수를 주석 밖에서 실제로 쓴다 (가져오기만 하고 쓰지 않는 일이 없다)', () => {
    const code = validators
      .map(({ text }) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''))
      .join('\n');
    for (const [name] of REUSED) {
      // 가져오기 한 번 + 사용 한 번 이상.
      expect(code.split(name).length - 1, `${name} 의 주석 밖 등장 횟수`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('해시는 digest.ts 의 canonicalDigest 하나다', () => {
  it('검증기는 canonicalDigest 를 가져오고 node:crypto 를 가져오지 않는다', () => {
    const header = validators.find(({ file }) => file === 'validate/bundle-header.ts');
    expect(header?.text).toMatch(/import\s*\{\s*canonicalDigest\s*\}\s*from\s*'\.\.\/digest'/);
    for (const { file, text } of validators) {
      expect(text, file).not.toMatch(/node:crypto|createHash|\bcrypto\b/);
    }
  });

  it('정규화·해시 함수를 검증기가 따로 정의하지 않는다', () => {
    for (const name of ['canonicalDigest', 'normalize', 'canonicalize', 'digest']) {
      expect(definitions(name).filter((file) => file !== 'digest.ts'), name).toEqual([]);
    }
  });
});
