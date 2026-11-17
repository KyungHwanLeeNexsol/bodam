import { DomainError } from '../../../src/server/domain/errors';

// 시험 도우미. 던져진 DomainError 를 잡아 돌려준다. 아무것도 던지지 않았거나 다른 종류의 오류면 시험이 실패한다.

export function catchDomainError(action: () => unknown): DomainError {
  try {
    action();
  } catch (error) {
    if (error instanceof DomainError) {
      return error;
    }
    throw new Error(`DomainError 가 아닌 오류가 던져졌다: ${String(error)}`);
  }
  throw new Error('DomainError 가 던져져야 하는데 아무것도 던져지지 않았다');
}
