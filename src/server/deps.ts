import type { AuditDeps } from './audit';
import type { Repository } from './repo/interfaces';

/**
 * 상태를 바꾸는 서비스가 받는 의존성: 저장소, 주입한 시계, 주입한 식별자 생성기.
 * 서비스는 이 셋 밖에서 시간이나 식별자를 만들지 않는다 (결정성). 저장소는 트랜잭션을 제공해야 하므로 전체 인터페이스다.
 */
export interface ServiceDeps extends AuditDeps {
  repo: Repository;
}
