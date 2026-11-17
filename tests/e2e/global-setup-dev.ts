import { spawn } from 'node:child_process';

// Strict Mode 시험용 전역 준비 (SPEC-REIMBURSEMENT-001 M6, BRIEF D3). 개발 서버(`next dev`)를 띄운다.
// 개발 서버는 React Strict Mode 를 켠다: 효과를 "만들고 → 정리하고 → 다시 만든다"(운영 빌드는 한 번만 돈다). 컨트롤러 수명·구독 해제·진행 중 요청 취소가 그 이중 실행에서 새지 않는지 본다.
// 운영 빌드용 서버(전역 준비 global-setup.ts)와 포트가 다르고, 개발 서버는 .next/dev 를 써서 운영 빌드(.next)를 건드리지 않는다. 이미 쓰는 포트가 있으면 시작하지 않는다.

export const DEV_PORT = 3103;

async function isUp(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1_500) });
    return true;
  } catch {
    return false;
  }
}

export default async function globalSetupDev(): Promise<() => Promise<void>> {
  const url = `http://localhost:${DEV_PORT}/kiosk/e2e-probe`;
  if (await isUp(url)) throw new Error(`이미 쓰고 있는 주소다(다른 서버를 시험하지 않는다): ${url}`);
  const dev = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(DEV_PORT)], { stdio: 'ignore', windowsHide: true });
  const deadline = Date.now() + 180_000;
  try {
    while (Date.now() < deadline) {
      if (dev.exitCode !== null) throw new Error(`개발 서버가 먼저 종료되었다(코드 ${String(dev.exitCode)})`);
      if (await isUp(url)) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!(await isUp(url))) throw new Error(`개발 서버가 제때 뜨지 않았다: ${url}`);
  } catch (error) {
    dev.kill();
    throw error;
  }
  return async () => {
    dev.kill();
  };
}
