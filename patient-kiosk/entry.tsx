import { createRoot } from 'react-dom/client';
import { LiveKiosk } from '../src/app/kiosk/runtime/LiveKiosk';
import { createKioskController } from '../src/app/kiosk/state/controller';
import { clinicCatalog, clinicOptions, referenceResponse } from './clinic';
import type { EstimateInput } from './estimate';
import { ReferenceBasis, ReferenceDocuments } from './ReferenceSheets';
import { TreatmentStep } from './TreatmentStep';
import '../src/app/kiosk/styles/tokens.css';
import '../src/app/kiosk/styles/fonts.css';
import '../src/app/kiosk/styles/kiosk.css';
import '../src/app/kiosk/styles/inputs.css';
import '../src/app/kiosk/styles/results.css';
import '../src/app/kiosk/styles/sheets.css';
import './entry.css';
import './responsive.css';

const root = document.getElementById('patient-entry');
if (root !== null) {
  let pending: EstimateInput | null = null;
  const controller = createKioskController({
    transport: async (path, init) => {
      const checks = pending;
      pending = null;
      const response = path === '/api/clinics/seongjeongwon/estimate' && init.method === 'POST' && init.body
        ? referenceResponse(JSON.parse(init.body), checks)
        : null;
      return { status: response === null ? 400 : 200, json: async () => response };
    },
  }, { catalog: clinicCatalog, options: clinicOptions });

  let displayedScreen = controller.getState().screen;
  controller.subscribe(({ screen }) => {
    if (screen === displayedScreen) return;
    displayedScreen = screen;
    window.scrollTo(0, 0);
  });

  createRoot(root).render(<LiveKiosk controller={controller} renderScreen={(screen) => {
    switch (screen) {
      case 'K03_Treatments':
        return <TreatmentStep submit={(checks) => {
          pending = checks;
          if (controller.dispatch({ type: 'REQUEST_ESTIMATE' }) === 'IGNORED') pending = null;
        }} />;
      case 'K04_Basis_Calculation':
        return <ReferenceBasis />;
      case 'K07_Documents':
      case 'K07_Documents_Unknown':
        return <ReferenceDocuments />;
    }
  }} />);
}
