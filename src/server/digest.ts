import { createHash } from 'node:crypto';

// 운영 정본 해시 canonicalDigest (SPEC-REIMBURSEMENT-001 M3, design.md DD-04·DD-14, plan.md M3 필수 시험).
// 엔진은 해시 구현을 가져오지 않고 UsabilityContext.digest 로 주입받는다. 이 함수가 그 운영 구현이다.
// 봉인(게시)하는 쪽과 검사하는 쪽이 같은 두 단계를 거친다:
//   1) 엔진의 profileContent / documentRuleSetContent 가 배열을 정렬한 해시 입력을 만든다 (정규화는 엔진 한 곳뿐이다).
//   2) 이 함수가 그 입력을 SHA-256 으로 해시한다. 객체 키 순서에 대한 정규화는 여기서 한다.
// 이 함수는 정규화 구현을 따로 두지 않는다: 항목 해시 = canonicalDigest(profileContent(p)) / canonicalDigest(documentRuleSetContent(s)).
//
// ── 정확한 인코딩 (버전 v1) ──────────────────────────────────────────────────────────────
// digest = lowercase-hex( SHA-256( UTF-16LE( "bodam.digest.v1:" + enc(value) ) ) )
//   문자열을 UTF-16LE 로 바이트화하므로 코드 단위가 그대로 보존된다. 짝이 없는 대리 쌍 절반도 UTF-8 처럼 U+FFFD 로 바뀌지 않아
//   서로 다른 문자열이 같은 바이트로 합쳐지지 않는다. 유니코드 정규화(NFC/NFD)는 하지 않는다.
//
// enc(v) — 모든 토큰이 접두어 없이 끝을 알 수 있는(self-delimiting) 형태라 서로 다른 값은 서로 다른 문자열이 된다:
//   undefined → "u;"          null → "n;"          true → "T;"          false → "F;"
//   number    → "d" + 본문 + ";"  본문: NaN → "NaN", +∞ → "Inf", −∞ → "-Inf", −0 → "-0", 그 밖에는 String(n)
//               (String(n) 은 서로 다른 double 마다 다른 최단 표현이므로 단사다. 0 은 "0", −0 은 "-0" 으로 갈린다)
//   bigint    → "g" + n.toString() + ";"
//   string    → "s" + (UTF-16 코드 단위 수) + ":" + 문자열 그대로
//   array     → "a" + 길이 + "[" + 요소 0..길이-1 의 enc (희소 배열의 빈 칸은 "h;", undefined 요소는 "u;") + "]"
//               배열 순서는 의미로 본다(정렬하지 않는다).
//   Date      → "D" + enc(getTime())
//   object    → 평범한 객체(프로토타입이 Object.prototype 이거나 없음)는 "o" + 키 개수 + "{" + 키마다 enc(키) + enc(값) + "}"
//               키는 own enumerable 문자열 키를 UTF-16 코드 단위 순(기본 정렬)으로 정렬한다 → 삽입 순서와 무관하다.
//               값이 undefined 인 키는 키가 없는 것과 다르다(엔코딩에 "u;" 로 남는다). 평범하지 않은 객체(클래스 인스턴스 등)는
//               "O" + enc(Object.prototype.toString.call(v)) 를 앞에 붙여 평범한 객체와 구분한다.
//   순환 참조 → "r" + 조상 인덱스 + ";"       깊이가 MAX_DEPTH 를 넘으면 "L;" 로 닫는다(던지지 않는다)
//   symbol    → "y" + enc(String(s))      function → "x;"
//
// ── 성질 ────────────────────────────────────────────────────────────────────────────────
//   전체 함수: 일반 자료(평범한 객체·배열·원시값)에서 던지지 않는다. 희소 배열·undefined·bigint·순환 참조·깊은 중첩도 던지지 않는다.
//   키 삽입 순서에 영향을 받지 않고, 배열 순서에는 민감하며, 값의 종류가 다르면(1 · "1" · true · null · 키 없음 · undefined 요소 ·
//   −0 · NaN) 해시가 다르다.
// ── 한계 (일반 자료 밖) ─────────────────────────────────────────────────────────────────
//   Map·Set·타입 배열·박싱된 원시값은 own enumerable 키가 없어 내용이 구분되지 않는다. 함수·심볼은 내용이 아니라 종류만 인코딩한다.
//   서로 다른 클래스 인스턴스는 키가 같으면 구분되지 않는다. 규칙 데이터는 이런 값을 담지 않는다.

const PREFIX = 'bodam.digest.v1:';
/** 이보다 깊은 중첩은 "L;" 로 닫는다. 일반 자료의 깊이(수 단계)와 거리가 멀고, 재귀 스택을 지키려는 한도다. */
const MAX_DEPTH = 256;

function encodeString(value: string): string {
  return `s${value.length}:${value}`;
}

function encodeNumber(value: number): string {
  if (Number.isNaN(value)) {
    return 'dNaN;';
  }
  if (value === Number.POSITIVE_INFINITY) {
    return 'dInf;';
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return 'd-Inf;';
  }
  if (Object.is(value, -0)) {
    return 'd-0;';
  }
  return `d${String(value)};`;
}

function encodeObject(value: object, ancestors: object[]): string {
  const cycle = ancestors.indexOf(value);
  if (cycle >= 0) {
    return `r${cycle};`;
  }
  if (ancestors.length >= MAX_DEPTH) {
    return 'L;';
  }
  ancestors.push(value);
  try {
    if (Array.isArray(value)) {
      let out = `a${value.length}[`;
      for (let index = 0; index < value.length; index += 1) {
        out += index in value ? encode(value[index], ancestors) : 'h;';
      }
      return `${out}]`;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const prototype = Object.getPrototypeOf(value) as object | null;
    const plain = prototype === Object.prototype || prototype === null;
    let out = plain ? `o${keys.length}{` : `O${encodeString(Object.prototype.toString.call(value))}${keys.length}{`;
    for (const key of keys) {
      out += encodeString(key) + encode(record[key], ancestors);
    }
    return `${out}}`;
  } finally {
    ancestors.pop();
  }
}

function encode(value: unknown, ancestors: object[]): string {
  switch (typeof value) {
    case 'undefined':
      return 'u;';
    case 'boolean':
      return value ? 'T;' : 'F;';
    case 'number':
      return encodeNumber(value);
    case 'bigint':
      return `g${value.toString()};`;
    case 'string':
      return encodeString(value);
    case 'symbol':
      return `y${encodeString(String(value))}`;
    case 'function':
      return 'x;';
    default:
      break;
  }
  if (value === null) {
    return 'n;';
  }
  if (value instanceof Date) {
    return `D${encodeNumber(value.getTime())}`;
  }
  return encodeObject(value as object, ancestors);
}

// @MX:ANCHOR: [AUTO] 운영 정본 해시. 항목 봉인·무결성 검사(엔진 UsabilityContext.digest)·규칙 묶음 내용 해시·불변 버전 동일성 판정이 모두 부른다.
// @MX:REASON: 인코딩이 한 글자라도 바뀌면 이미 봉인된 모든 항목이 INTEGRITY_MISMATCH 가 된다. 바꾸려면 버전 접두어(v1)를 올리고 이관 계획을 먼저 세운다.
/**
 * 내용의 SHA-256 해시를 소문자 16진수 64자로 돌려준다. 인코딩은 이 파일 머리말이 정한다.
 * 던지지 않으며 입력을 바꾸지 않는다.
 */
export function canonicalDigest(content: unknown): string {
  return createHash('sha256')
    .update(Buffer.from(PREFIX + encode(content, []), 'utf16le'))
    .digest('hex');
}
