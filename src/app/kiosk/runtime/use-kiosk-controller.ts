import { useEffect, useState } from 'react';
import { createKioskController } from '../state/controller';
import type { KioskController } from '../state/controller';
import type { CatalogDto, OptionsDto } from '../state/api-types';
import { readOrientation } from './viewport';

// 컨트롤러의 수명 (SPEC-REIMBURSEMENT-001 M6, BRIEF D3). 자료가 준비된(READY) 뒤에 효과 안에서 만들고, 효과가 정리되면 dispose() 한다.
// 병원이 바뀌거나 화면이 사라지면 옛 컨트롤러는 타이머·진행 중 요청을 모두 풀고 이후 사건을 받지 않아, 옛 비동기 결과가 새 화면에 닿을 수 없다.
// 다시 그릴 때마다 새로 만들지 않는다: 의존성은 받은 자료 두 객체뿐이다. React Strict Mode 는 효과를 만들고-정리하고-다시 만들며, 마지막 것만 남는다.
// 만들기 전(첫 그리기)에는 null 이고, 호출하는 쪽은 그동안 "불러오는 중" 화면을 유지한다.

export function useKioskController(catalog: CatalogDto, options: OptionsDto): KioskController | null {
  const [controller, setController] = useState<KioskController | null>(null);
  useEffect(() => {
    // deps 를 주지 않는다: 시계·타이머·식별자·전송은 M5 의 기본값(전역을 부를 때 찾아 쓴다)이고, analytics·log 는 아무것도 하지 않는다(BRIEF D11).
    const created = createKioskController({}, { catalog, options, orientation: readOrientation() });
    setController(created);
    return () => {
      created.dispose();
      setController(null);
    };
  }, [catalog, options]);
  return controller;
}
