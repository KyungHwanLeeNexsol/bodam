import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../src/app/kiosk/components/Button';
import { KioskFrame } from '../src/app/kiosk/components/KioskFrame';
import { KioskHeader } from '../src/app/kiosk/components/KioskHeader';
import { ScrollRegion } from '../src/app/kiosk/components/ScrollRegion';
import { useViewportOrientation } from '../src/app/kiosk/runtime/viewport';
import { renderK00StartLayout } from '../src/app/kiosk/screens/K00StartLayout';
import { COPY } from '../src/app/kiosk/view/copy';
import { PatientEstimate } from './PatientEstimate';
import '../src/app/kiosk/styles/tokens.css';
import '../src/app/kiosk/styles/fonts.css';
import '../src/app/kiosk/styles/kiosk.css';
import './entry.css';

const hospitalName = '성정원통사의원';

function PatientEntry() {
  const orientation = useViewportOrientation();
  const [largeText, setLargeText] = useState(false);
  const [page, setPage] = useState<'home' | 'guides' | 'estimate'>('home');
  const screen = useRef<HTMLElement>(null);
  const focusAfterNavigation = useRef(false);

  useEffect(() => {
    if (focusAfterNavigation.current) {
      screen.current?.querySelector<HTMLElement>('h1')?.focus();
      focusAfterNavigation.current = false;
    }
  }, [page]);

  function changeScreen(next: typeof page) {
    focusAfterNavigation.current = true;
    setPage(next);
  }

  return (
    <KioskFrame orientation={orientation} largeText={largeText} data-patient-entry>
      <div className="kiosk-underlay">
        <KioskHeader
          serviceName={COPY.serviceName}
          hospitalName={hospitalName}
          largeText={{ pressed: largeText, onToggle: () => setLargeText((previous) => !previous) }}
        />
        <main className="kiosk-screen" ref={screen}>
          {page === 'estimate' ? (
            <ScrollRegion className="patient-guide-screen">
              <PatientEstimate onBack={() => changeScreen('guides')} onHome={() => changeScreen('home')} />
            </ScrollRegion>
          ) : page === 'guides' ? (
            <ScrollRegion className="patient-guide-screen">
              <h1 tabIndex={-1}>어떤 안내가 필요하신가요?</h1>
              <p>실손보험 계약 확인 방법과 진료비를 안내합니다.</p>
              <Button variant="primary" onClick={() => changeScreen('estimate')} icon="chevron-right">예상 부담액 확인</Button>
              <nav className="patient-entry-links" aria-label="이용 가능한 안내">
                <a href="/policy.html"><strong>내 실손보험 확인 방법</strong><span>보험사와 가입한 계약을 확인하는 방법</span></a>
                <a href="/claim.html"><strong>진료비·청구 서류 안내</strong><span>진료비 확인과 서류 발급 문의 방법</span></a>
              </nav>
              <Button variant="secondary" onClick={() => changeScreen('home')}>처음 화면으로</Button>
            </ScrollRegion>
          ) : renderK00StartLayout({
            serviceName: COPY.serviceName,
            hospitalName,
            stack: orientation === 'LANDSCAPE' || largeText,
            guide: '예상 부담액, 실손보험 확인 방법과 청구 서류를 안내합니다.',
            onStart: () => changeScreen('guides'),
            extraActions: <p className="kiosk-k00__hint">예상 부담액은 일부 치료와 보험 계약에 한해 확인할 수 있습니다.</p>,
          })}
        </main>
      </div>
    </KioskFrame>
  );
}

const root = document.getElementById('patient-entry');
if (root !== null) createRoot(root).render(<PatientEntry />);
