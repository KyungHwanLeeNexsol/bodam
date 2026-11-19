import type { Repository } from '../src/server/repo/interfaces';

// 읽기 전용 저장소 (베타). 공개 API 핸들러가 받는 저장소를 감싸, 읽기 말고는 아무것도 못 하게 한다.
//  - 기본 거절(default-deny): 이름이 get·list·read 로 시작하는 메서드만 통과하고, 함수가 아닌 속성은 undefined 다. 이름 기준이라 쓰기 메서드가 새로 생겨도 대개 막히지만,
//    `getOrCreateX` 처럼 읽기 이름을 단 쓰기가 생기면 통과한다: 저장소에 메서드를 더할 때 이 파일과 개발 브랜치의 tests/beta/readonly-snapshot.test.ts 의 이름 목록을 함께 본다.
//    transaction 도 막는다: 공개 API 핸들러는 쓰지 않으며(src/server/api/*.ts 에 transaction·쓰기 호출이 없다), 읽기에 트랜잭션이 필요하지 않다.
//  - 속성 대입·정의·삭제도 거절한다. 던지는 쪽은 ReadOnlyViolation 이라 시험이 "막혔다"를 정확히 확인할 수 있다.

export class ReadOnlyViolation extends Error {
  readonly method: string;
  constructor(method: string) {
    super(`읽기 전용 저장소: ${method} 은(는) 허용하지 않는다`);
    this.method = method;
  }
}

const READ_PREFIX = /^(get|list|read)[A-Z]/;

export function readOnly(inner: Repository): Repository {
  return new Proxy(inner, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof property !== 'string') return value;
      // 함수가 아닌 속성(MemoryRepository 의 store·spy 같은 내부 상태)은 내주지 않는다: 살아 있는 저장 상태를 건드리는 길을 막는다.
      if (typeof value !== 'function') return undefined;
      const method = value as (...args: unknown[]) => unknown;
      if (!READ_PREFIX.test(property)) {
        return (): never => {
          throw new ReadOnlyViolation(property);
        };
      }
      return method.bind(target);
    },
    set(_target, property) {
      throw new ReadOnlyViolation(`set ${String(property)}`);
    },
    defineProperty(_target, property) {
      throw new ReadOnlyViolation(`define ${String(property)}`);
    },
    deleteProperty(_target, property) {
      throw new ReadOnlyViolation(`delete ${String(property)}`);
    },
    // 프로토타입으로 원본 클래스의 메서드를 꺼내는 길도 막는다.
    getPrototypeOf() {
      return Object.prototype;
    },
    setPrototypeOf() {
      throw new ReadOnlyViolation('setPrototypeOf');
    },
    preventExtensions() {
      throw new ReadOnlyViolation('preventExtensions');
    },
  });
}
