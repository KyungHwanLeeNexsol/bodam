import { describe, expect, it } from 'vitest';
import { canonicalDigest } from '../../src/server/digest';

// 운영 정본 해시(canonicalDigest) 시험. 인코딩 규칙은 src/server/digest.ts 머리말에 있다.
// 아래 기준값(known-answer)은 구현과 별개로 규칙을 다시 풀어 쓴 스크립트로 한 번 계산해 굳힌 것이며,
// 가장 단순한 두 값(null, "a")은 셸의 `printf | iconv -t UTF-16LE | sha256sum` 으로도 교차 확인했다.

const HEX64 = /^[0-9a-f]{64}$/;

describe('canonicalDigest 기준값 (known-answer)', () => {
  const vectors: Array<[string, unknown, string]> = [
    ['null', null, '09bc6ad21d8bf929f10c468096688b6716feae88125c7dba994bb524a795a230'],
    ['undefined', undefined, '0ce931f99b5c2ddf714d378dc5b8ff463fe8f0b9ef4aa012b8f641e20d72da7e'],
    ['true', true, '84a6d68adf6061339d9d4b4cf5b203f1265ab3a2893e7cb4ad3bd3d95de3c239'],
    ['false', false, '4653772c1d3a3a6ad2c1c2172882fd3e4d33cef1b9a65a90b5b2d26a7ff32dcf'],
    ['0', 0, 'ee648236da31f7257955b56620c6f054356c3ebac535b22f66f21e5fafe0f96b'],
    ['-0', -0, '2d427e4d84848d127a99e00f3ea564d17398a64de6f3855b2a4fe91d6d4c1a01'],
    ['1', 1, '52a6a0235f8ca879ecd7254739b9afce36b184bc56eb406444e981ce7bc5261c'],
    ['"1"', '1', '3c8866396ac18d8986560558650831bfaa283db4203191d226610446c522ec4e'],
    ['""', '', '62754ca98ce45db29294a1a496e0444f08ff4c052193d9e036dcbaa75aca43a4'],
    ['"a"', 'a', '2b40af9be6a932213f1fcb1e17c2d98e3d551cc5abde2ad6bf2316ce4b79c322'],
    ['NaN', Number.NaN, '6f933e2596e5d1b758968470d6058870646269da380d052a3c91b7060116e363'],
    ['Infinity', Number.POSITIVE_INFINITY, '5f463ebad1e35d2f9a6422ef056cfbb95ba98c1eb82ba779b93c5991a2216ebb'],
    ['-Infinity', Number.NEGATIVE_INFINITY, '4796ceef4522556ec89fed0ff4424bba384e6a850cad23e770202b77282956ad'],
    ['10n', 10n, '8fc91ceccbe7bf03ed8b92f7f4670486586f8edc2018a2815bfe83a293263c57'],
    ['[]', [], '4f6828044d700fd18db6b2f3b3f3ac98f1f2c3c0b65699b1e06a3e2b18444fb6'],
    ['{}', {}, '4092d8d71baeaf2d9ec719613f5260d29eab244206660307348c74c2c9c6a368'],
    ['"보담"', '보담', 'f85717f3c16305f94821c38e72eeaa7a791ba20cef0a557be03b10f3f81d209b'],
    ['[undefined]', [undefined], '859b7fb5602deacbcc5ca5ca47a7eddf1c98e311c76b964f77abd54fb9846acd'],
    ['[null]', [null], '55b604b55b44f7c05cd9fe31d4d735af3f4b17eb006da93a4201f63ce72ec4a9'],
    ['희소 배열 [<빈 칸>, 1]', [, 1], 'bc39df3a174c40cefe39a3d0967cc0e0a729a0866c096b811dd448ced24972b3'],
    ['{a:1, b:[1,"x",null]}', { a: 1, b: [1, 'x', null] }, '996e298b9673537742af9e3c8c63a0da3f80740e01926819c39bd860e9af9e87'],
    ['{a:undefined}', { a: undefined }, '289dd0a773f10a0ed09f35325f3871326990d6da890e0c63a93461d23c34b14f'],
    ['{a:null}', { a: null }, '3478f57b524d9f79a6c9d9fb07f1281b73c1c62de64756cd46377e739a1f301b'],
    ['깊게 중첩한 값', { x: { y: { z: [{ k: 'v' }] } } }, '99365274e992d748de5c7870600bec1f4c043ef2df4a52593577866494c186c4'],
  ];

  it.each(vectors)('%s', (_label, value, expected) => {
    expect(canonicalDigest(value)).toBe(expected);
  });

  it('결과는 소문자 16진수 64자(SHA-256)다', () => {
    for (const [, value] of vectors) {
      expect(canonicalDigest(value)).toMatch(HEX64);
    }
  });
});

describe('객체 키 삽입 순서에 영향을 받지 않는다', () => {
  it('최상위 키 순서가 달라도 같은 해시다', () => {
    expect(canonicalDigest({ a: 1, b: 2, c: 3 })).toBe(canonicalDigest({ c: 3, a: 1, b: 2 }));
  });

  it('중첩한 객체와 배열 안의 객체도 키 순서와 무관하다', () => {
    const one = { x: { p: 1, q: [{ m: 1, n: 2 }, { n: 4, m: 3 }] }, y: 'v' };
    const other = { y: 'v', x: { q: [{ n: 2, m: 1 }, { m: 3, n: 4 }], p: 1 } };
    expect(canonicalDigest(one)).toBe(canonicalDigest(other));
  });

  it('기준값과 같은 내용을 다른 키 순서로 만들어도 기준값이 나온다', () => {
    expect(canonicalDigest({ b: [1, 'x', null], a: 1 })).toBe('996e298b9673537742af9e3c8c63a0da3f80740e01926819c39bd860e9af9e87');
  });

  it('값은 같고 키 이름만 다르면 해시가 다르다 (키와 값을 섞어 읽지 않는다)', () => {
    expect(canonicalDigest({ a: 'b' })).not.toBe(canonicalDigest({ b: 'a' }));
    expect(canonicalDigest({ ab: '' })).not.toBe(canonicalDigest({ a: 'b' }));
    expect(canonicalDigest({ a: 'bc' })).not.toBe(canonicalDigest({ ab: 'c' }));
  });
});

describe('배열 순서에는 민감하다', () => {
  it('[1,2] 와 [2,1] 은 다르다', () => {
    expect(canonicalDigest([1, 2])).toBe('085970a7ae53b495fa1c2c4f046b56ddf5023c07c5bec72c3da2d0402a6e7632');
    expect(canonicalDigest([2, 1])).toBe('1dc958c78c559637cb6d20f62a70908236360cd8ba760ad294af1cf008a7f3d0');
  });

  it('객체 배열의 순서가 바뀌면 해시가 바뀐다', () => {
    expect(canonicalDigest([{ k: 1 }, { k: 2 }])).not.toBe(canonicalDigest([{ k: 2 }, { k: 1 }]));
  });

  it('배열을 한 겹 더 감싸거나 풀면 다르다', () => {
    expect(canonicalDigest([[1, 2]])).not.toBe(canonicalDigest([1, 2]));
    expect(canonicalDigest([[1], [2]])).not.toBe(canonicalDigest([[1, 2]]));
  });
});

describe('값의 종류가 다르면 해시가 다르다 (종류 단사성)', () => {
  const distinct: Array<[string, unknown[]]> = [
    ['숫자 1 · 문자열 "1" · true', [1, '1', true]],
    ['null · 키 없음 · undefined 요소 · undefined 값', [{ a: null }, {}, [undefined], { a: undefined }, null, undefined, [null]]],
    ['-0 · 0', [-0, 0]],
    ['NaN · Infinity · -Infinity · null · "NaN"', [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null, 'NaN']],
    ['빈 배열 · 빈 객체 · 빈 문자열 · null', [[], {}, '', null]],
    ['false · 0 · "" · null · undefined', [false, 0, '', null, undefined]],
    ['빈 칸이 있는 배열 · undefined 요소가 있는 배열', [[, 1], [undefined, 1]]],
    ['bigint 10n · 숫자 10 · 문자열 "10"', [10n, 10, '10']],
    ['문자열 "true" · true', ['true', true]],
    ['길이 접두 경계: ["ab"] · ["a","b"] · ["a","","b"]', [['ab'], ['a', 'b'], ['a', '', 'b']]],
    ['빈 문자열 키: {"":1} · {}', [{ '': 1 }, {}]],
  ];

  it.each(distinct)('%s', (_label, values) => {
    const digests = values.map((value) => canonicalDigest(value));
    expect(new Set(digests).size).toBe(values.length);
  });

  it('1 과 1.0 은 같은 수라 같다', () => {
    expect(canonicalDigest(1)).toBe(canonicalDigest(1.0));
  });

  it('서로 다른 실수는 서로 다르다', () => {
    expect(canonicalDigest(0.1 + 0.2)).not.toBe(canonicalDigest(0.3));
    expect(canonicalDigest(Number.MAX_SAFE_INTEGER)).not.toBe(canonicalDigest(Number.MAX_SAFE_INTEGER + 2));
  });
});

describe('유니코드는 정규화하지 않는다', () => {
  it('NFC 와 NFD 로 쓴 같은 글자는 다른 해시다', () => {
    const nfc = 'é';
    const nfd = 'é';
    expect(nfc.normalize('NFD')).toBe(nfd);
    expect(canonicalDigest(nfc)).toBe('9901e37733ffcbc418802da9d81978485bd1bbdc6689cd47da55661273616a5b');
    expect(canonicalDigest(nfd)).toBe('97db40246c001f62542468491a3a894e2915d412e253c5faeb91e1052189b0f5');
  });

  it('한글 NFC/NFD 도 다르다', () => {
    const composed = '보담';
    expect(canonicalDigest(composed)).not.toBe(canonicalDigest(composed.normalize('NFD')));
  });

  it('짝이 없는 대리 쌍 절반도 서로 구분한다 (UTF-8 변환의 U+FFFD 충돌이 없다)', () => {
    expect(canonicalDigest('\ud800')).toBe('7eb09e8127bdda9cb5ce2ed69143ec716b6d3be706e676ff21a0d626ba4ef39a');
    expect(canonicalDigest('\udfff')).toBe('5a8b19aa8e3efd6312d231cd0fc3c9d88815ef0e386d85c83179d0c090c1b3ad');
    expect(canonicalDigest('\ud800')).not.toBe(canonicalDigest('\udfff'));
  });

  it('키도 같은 규칙이다 (NFC/NFD 키는 다른 해시)', () => {
    expect(canonicalDigest({ 'é': 1 })).not.toBe(canonicalDigest({ 'é': 1 }));
  });
});

describe('전체 함수다 (일반 자료에서 던지지 않는다)', () => {
  it('희소 배열·undefined·bigint·함수·심볼·날짜를 던지지 않고 64자 해시로 바꾼다', () => {
    const inputs: unknown[] = [[, , 1], [undefined, null], { a: undefined }, 10n, () => 1, Symbol('x'), new Date(0), new Date(Number.NaN)];
    for (const input of inputs) {
      expect(() => canonicalDigest(input)).not.toThrow();
      expect(canonicalDigest(input)).toMatch(HEX64);
    }
  });

  it('순환 참조도 던지지 않고 결정적이다', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    const b: Record<string, unknown> = { name: 'a' };
    b.self = b;
    expect(canonicalDigest(a)).toMatch(HEX64);
    expect(canonicalDigest(a)).toBe(canonicalDigest(b));
    expect(canonicalDigest(a)).not.toBe(canonicalDigest({ name: 'a', self: null }));
  });

  it('아주 깊은 중첩도 던지지 않는다 (깊이 한도를 넘으면 표식으로 닫는다)', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 5_000; i += 1) {
      deep = [deep];
    }
    expect(() => canonicalDigest(deep)).not.toThrow();
    expect(canonicalDigest(deep)).toMatch(HEX64);
  });

  it('날짜는 시각 값으로 구분한다', () => {
    expect(canonicalDigest(new Date(0))).not.toBe(canonicalDigest(new Date(1)));
    expect(canonicalDigest(new Date(0))).toBe(canonicalDigest(new Date(0)));
    expect(canonicalDigest(new Date(0))).not.toBe(canonicalDigest({}));
  });

  it('클래스 인스턴스는 평범한 객체와 구분한다', () => {
    class Box {
      readonly a = 1;
    }
    expect(canonicalDigest(new Box())).not.toBe(canonicalDigest({ a: 1 }));
  });

  it('프로토타입이 없는 객체는 평범한 객체와 같다', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare.a = 1;
    expect(canonicalDigest(bare)).toBe(canonicalDigest({ a: 1 }));
  });
});

describe('결정성', () => {
  it('같은 값을 여러 번 해시해도 같다', () => {
    const value = { id: 'TEST_FIXTURE', list: [1, 2, { z: null }], text: '보담' };
    const first = canonicalDigest(value);
    for (let i = 0; i < 20; i += 1) {
      expect(canonicalDigest(value)).toBe(first);
    }
  });

  it('입력을 바꾸지 않는다', () => {
    const value = { b: [3, 2, 1], a: { y: 1, x: 2 } };
    const before = JSON.stringify(value);
    canonicalDigest(value);
    expect(JSON.stringify(value)).toBe(before);
    expect(Object.keys(value)).toEqual(['b', 'a']);
  });

  it('깊은 복사본은 같은 해시다', () => {
    const value = { a: [1, { b: 'c' }], d: null };
    expect(canonicalDigest(structuredClone(value))).toBe(canonicalDigest(value));
  });
});
