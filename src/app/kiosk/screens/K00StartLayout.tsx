import { Button } from '../components/Button';
import { Icon } from '../components/icons';
import { BrandMark } from '../components/KioskHeader';
import { ScrollRegion } from '../components/ScrollRegion';
import type { ReactNode } from 'react';
import { COPY } from '../view/copy';

interface K00StartLayoutProps {
  readonly serviceName: string;
  readonly hospitalName: string;
  readonly stack: boolean;
  readonly guide?: string;
  readonly onStart?: () => void;
  readonly unavailableReason?: string;
  readonly extraActions?: ReactNode;
}

/** Shared portrait/landscape K00 layout; never starts a session on its own. */
export function renderK00StartLayout({ serviceName, hospitalName, stack, guide = COPY.start.guide, onStart, unavailableReason, extraActions }: K00StartLayoutProps) {
  return (
    <div className={stack ? 'kiosk-k00 kiosk-k00--stack' : 'kiosk-k00'}>
      <ScrollRegion className="kiosk-k00__body">
        <section className="kiosk-k00__hero">
          <BrandMark hero />
          <h1 className="kiosk-k00__wordmark" tabIndex={-1} data-kiosk-primary>
            {serviceName}
          </h1>
          <p className="kiosk-k00__service">{COPY.serviceDescription}</p>
          <div className="kiosk-k00__divider" aria-hidden="true" />
          <p className="kiosk-k00__hospital">{hospitalName}</p>
        </section>
        <div className="kiosk-k00__panel">
          <p className="kiosk-k00__guide">{guide}</p>
          <ol className="kiosk-k00__flow" aria-label={COPY.start.flowLabel}>
            {COPY.steps.flatMap((label, index) => [
              ...(index === 0 || stack
                ? []
                : [
                    <li key={`arrow-${label}`} className="kiosk-k00__arrow" aria-hidden="true">
                      <Icon name="chevron-right" size={30} />
                    </li>,
                  ]),
              <li key={label} className="kiosk-k00__chip">
                <span>{index + 1}</span>
                <span>{stack ? (COPY.start.stackedSteps[index] ?? label) : label}</span>
              </li>,
            ])}
          </ol>
          <div className="kiosk-k00__actions">
            <Button
              variant="primary"
              block
              icon="chevron-right"
              iconSize={44}
              className="kiosk-k00__start"
              onClick={onStart}
              disabled={unavailableReason !== undefined}
              aria-describedby={unavailableReason === undefined ? undefined : 'kiosk-start-unavailable'}
            >
              {COPY.start.startButton}
            </Button>
            {unavailableReason === undefined ? (
              <p className="kiosk-k00__hint">{COPY.start.hint}</p>
            ) : (
              <p className="kiosk-k00__hint" id="kiosk-start-unavailable">{unavailableReason}</p>
            )}
            {extraActions}
          </div>
        </div>
      </ScrollRegion>
    </div>
  );
}
