import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { KioskFrame } from '../src/app/kiosk/components/KioskFrame';
import { KioskHeader } from '../src/app/kiosk/components/KioskHeader';
import { useViewportOrientation } from '../src/app/kiosk/runtime/viewport';
import { renderK00StartLayout } from '../src/app/kiosk/screens/K00StartLayout';
import { COPY } from '../src/app/kiosk/view/copy';
import '../src/app/kiosk/styles/tokens.css';
import '../src/app/kiosk/styles/fonts.css';
import '../src/app/kiosk/styles/kiosk.css';
import './entry.css';

const hospitalName = '성정원통사의원';

function PatientEntry() {
  const orientation = useViewportOrientation();
  const [largeText, setLargeText] = useState(false);

  return (
    <KioskFrame orientation={orientation} largeText={largeText} data-patient-entry>
      <div className="kiosk-underlay">
        <KioskHeader
          serviceName={COPY.serviceName}
          hospitalName={hospitalName}
          largeText={{ pressed: largeText, onToggle: () => setLargeText((previous) => !previous) }}
        />
        <main className="kiosk-screen">
          {renderK00StartLayout({
            serviceName: COPY.serviceName,
            hospitalName,
            stack: orientation === 'LANDSCAPE' || largeText,
            guide: '예상 부담액 안내를 준비 중입니다.',
            unavailableReason: '치료 목록이 아직 없습니다. 진료비는 접수·수납 창구에서 확인해 주세요.',
            extraActions: (
              <nav className="patient-entry-links" aria-label="이용 가능한 안내">
                <a href="/policy.html">내 실손보험 확인 방법</a>
                <a href="/claim.html">진료비·청구 서류 안내</a>
              </nav>
            ),
          })}
        </main>
      </div>
    </KioskFrame>
  );
}

const root = document.getElementById('patient-entry');
if (root !== null) createRoot(root).render(<PatientEntry />);
