// 시험 도우미. 올바른 자료를 복사한 뒤 한 곳만 망가뜨리는 작은 함수들.
// 게시 검증 시험은 "그 밖의 내용은 유효하고 결함 하나만 있다"는 입력이 많아서, 경로로 값을 바꾸고 지우는 도구가 필요하다.
// 원본은 바꾸지 않는다(깊은 복사). 형식 검사를 우회하려고 unknown 으로 다루는 것이 목적이다.

export type PathStep = string | number;

type Container = Record<string | number, unknown>;

function walk(root: unknown, path: readonly PathStep[]): Container {
  let current = root as Container;
  for (const step of path) {
    current = current[step] as Container;
  }
  return current;
}

/** root 를 복사한 뒤 path 위치의 값을 value 로 바꾼 사본을 돌려준다. 경로의 중간 단계는 이미 있어야 한다. */
export function setAt<T>(root: T, path: readonly PathStep[], value: unknown): T {
  const copy = structuredClone(root);
  const last = path[path.length - 1];
  if (last === undefined) {
    return value as T;
  }
  walk(copy, path.slice(0, -1))[last] = value;
  return copy;
}

/** root 를 복사한 뒤 path 위치의 키를 지운 사본을 돌려준다(키 자체가 사라진다. 값을 undefined 로 두지 않는다). */
export function unsetAt<T>(root: T, path: readonly PathStep[]): T {
  const copy = structuredClone(root);
  const last = path[path.length - 1];
  if (last === undefined) {
    throw new Error('unsetAt 은 빈 경로를 받을 수 없다');
  }
  delete walk(copy, path.slice(0, -1))[last];
  return copy;
}

/** 모든 객체와 배열을 얼려 어떤 쓰기도 TypeError 가 되게 한다(순수·비변경 시험용). */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<string | symbol, unknown>)[key]);
    }
  }
  return value;
}

/** 모든 객체의 키 삽입 순서를 뒤집은 사본(배열 순서는 그대로). 키 순서에 대한 독립성 시험용. */
export function reverseKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry: unknown) => reverseKeys(entry)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).reverse();
    return Object.fromEntries(entries.map(([key, entry]) => [key, reverseKeys(entry)])) as T;
  }
  return value;
}

/** 고정 시드 의사 난수(mulberry32). 시험이 시드를 이름에 적고 console.info 로 한 번 출력한다. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
