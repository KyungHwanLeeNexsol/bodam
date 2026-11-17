# PR 검증용 CI (GitHub Actions)

> 상태: Draft. 기준은 Draft PR #20 head `103ccbe`(`feature/SPEC-REIMBURSEMENT-001-readiness-cli`)이고, 이 문서와 워크플로는 그 위의 별도 브랜치 `ci/SPEC-REIMBURSEMENT-001-pr-verification`에 있다.
> 범위: Linux에서 `npm ci → 타입 검사 → 전체 Vitest → 빌드`를 실행하는 워크플로 하나. 앱 코드, 시험, 기존 워크플로, 브랜치 보호 설정, 기존 PR은 바꾸지 않았다.
> 이 CI가 통과해도 `main`에 앱이 반영됐다거나 Draft PR 사슬(#1~#20)이 병합 준비를 마쳤다는 뜻이 아니다. 이 브랜치(앱 코드가 든 Draft PR 브랜치)가 Linux에서 설치·타입 검사·시험·빌드를 통과하는지를 볼 뿐이다.

## 1. 워크플로

파일: `.github/workflows/pr-verification.yml` (이름 `PR Verification`)

| 항목 | 값 |
|---|---|
| 실행 시점 | `pull_request`의 `opened`·`synchronize`·`reopened`·`ready_for_review` (Draft PR도 실행) |
| 실행 환경 | `ubuntu-latest`, Node `24.22.1` (`actions/setup-node@v4`), 제한 시간 30분 |
| 권한 | `contents: read` 하나. 비밀값(`secrets.*`)·배포 권한·외부 서비스 연결 없음 |
| 단계 | `Step 1/4 npm ci` → `Step 2/4 npm run typecheck` → `Step 3/4 npm test`(= `vitest run`, 전체) → `Step 4/4 npm run build` |
| 실패 처리 | `continue-on-error` 없음. 설치가 성공하면 2~4단계는 앞 단계가 실패해도 모두 실행해서 한 번의 실행에서 실패한 단계를 전부 볼 수 있게 하고, 하나라도 실패하면 작업 전체가 실패한다 |
| 요약 | 마지막 단계가 단계별 결과(`success`/`failure`/`skipped`/`cancelled`)를 실행 요약에 표로 적는다. 결과를 바꾸지는 못한다 |
| 같은 PR의 이전 실행 | 새 커밋이 오면 취소한다(`concurrency`) |

Node `24.22.1`은 이 저장소의 타입 검사와 전체 시험을 가장 최근에 실행한 것으로 기록된 버전이다(`readiness-report-cli.md` §6, Windows 11). 앞선 마일스톤 기록은 `24.19.0`이다. 버전을 바꿀 때는 워크플로 한 곳만 고친다.

`npm ci`는 옵션 없이 쓴다. `package-lock.json`(lockfile v3)에는 Linux용 바이너리(`@next/swc-linux-x64-gnu`, `@rolldown/binding-linux-x64-gnu`, `@typescript/typescript-linux-x64` 등)가 들어 있고, 설치 스크립트가 있는 패키지는 macOS 전용 `fsevents` 하나뿐이다.

### 이 워크플로가 실행되는 PR

`pull_request`는 PR의 병합 커밋에 든 워크플로 파일을 쓴다. 따라서 이 파일이 들어 있는 브랜치의 PR에서만 실행된다. 기존 PR #1~#20의 브랜치에는 이 파일이 없어서 이 CI가 돌지 않는다(기존 PR은 바꾸지 않는다). 사슬 전체를 같은 방식으로 검증하려면 각 브랜치에 이 파일을 넣거나 `main`에 반영해야 하며, 그 결정은 이번 범위 밖이다.

## 2. 로컬 확인 (Linux가 아니다)

이 PC에는 WSL·Docker가 없어 Linux 체크아웃을 만들 수 없었다. 대신 줄바꿈을 LF로 체크아웃한 깨끗한 클론(`git clone --config core.autocrlf=false`, 커밋 `103ccbe`, Windows 11, Node v24.22.1)에서 같은 순서로 실행했다. **Linux에서의 결과가 아니며**, Linux 결과는 Draft PR의 실제 Actions 실행에서만 확인한다(PR 본문).

| 단계 | 명령 | 결과 |
|---|---|---|
| 설치 | `npm ci --ignore-scripts --no-audit --no-fund` | 종료 코드 0 |
| 타입 검사 | `npm run typecheck` | 종료 코드 0 |
| 전체 시험 | `npx vitest run` | `Test Files 210 passed (210)` · `Tests 10123 passed (10123)` |
| 빌드 | `npm run build` | 아래 §4 참고: AI 코딩 에이전트 세션 안에서는 종료 코드 1, 에이전트 환경 변수를 뺀 새 `.next`에서는 종료 코드 0 |

워크플로 문법은 격리한 `yaml` 패키지로 파싱해 오류 0건·경고 0건을 확인했다(`actionlint`는 쓰지 않았다).

## 3. 기존 CRLF 실패 2건

앞선 PR(#20)에서 전체 시험은 `Tests 2 failed | 10121 passed (10123)`이었고, 실패는 `tests/kiosk/state/request-static.test.ts`의 두 시험이었다(Windows 작업 폴더, `core.autocrlf=true`). 이 두 건이 깨끗한 체크아웃에서도 나는지 확인한 결과:

| 체크아웃 | `machine.ts`의 CR 바이트(`LF`) | `request-static.test.ts` | 전체 시험 |
|---|---|---|---|
| Windows 작업 폴더(`core.autocrlf=true`) | 207 (207) | 2건 실패 | `2 failed \| 10121 passed (10123)` |
| LF 체크아웃 클론(`core.autocrlf=false`) | 0 (207) | 23건 통과 | `210 files / 10123 tests 모두 통과` |
| 위 클론에서 `machine.ts`만 CRLF로 변환 | 207 (207) | **2건 실패, 같은 두 시험·같은 메시지** | (이 파일만 실행) |
| 변환을 되돌림(`git checkout -- 파일`) | 0 (207) | 23건 통과 | |

CR 바이트는 Git Bash의 `grep -c $'\r'`가 아니라 바이트를 직접 센 값이다(`grep`은 순수 LF 파일에서도 줄 수만큼 센다). Git에 저장된 blob의 CR은 0개이고, Windows에서 `core.autocrlf=true`로 체크아웃하면 작업 폴더 파일이 CRLF가 된다.

**원인.** `request-static.test.ts`가 `machine.ts`를 `split('\n')`로 줄 단위로 나눈 뒤 `/\{ kind: 'SYSTEM', overlays: EVERY_OVERLAY, apply: settleOnEvent \},?$/`로 줄 끝을 맞춘다. CRLF 파일에서는 각 줄 끝에 `\r`이 남아 `$`가 `},` 바로 뒤에서 맞지 않는다. 실패 메시지의 `Received` 값은 눈으로는 기대 문장과 같게 보이는데, 끝의 `\r`이 보이지 않기 때문이다. 코드 결함이 아니라 **작업 폴더의 줄바꿈 환경** 때문에 생기는 실패다.

**깨끗한 Linux 체크아웃에서의 결과(원격 확인).** Draft PR #21의 Actions 실행 [43991427256](https://github.com/KyungHwanLeeNexsol/bodam/actions/runs/43991427256)(커밋 `ded58ff`, 러너 이미지 `ubuntu-26.04`, 커널 `Linux 7.0.0-1019-azure x86_64`, Node `v24.22.1`)에서 `tests/kiosk/state/request-static.test.ts`는 `23 tests` 모두 통과했고 전체는 `Test Files 210 passed (210)` · `Tests 10123 passed (10123)`이었다. 즉 이 2건은 깨끗한 Linux 체크아웃에서는 발생하지 않았다. 원인이 Linux가 아니라 Windows 작업 폴더의 CRLF라는 §3의 로컬 재현과 일치한다. 이 확인은 한 번의 실행이며 반복 실행의 안정성(불안정한 시험 여부)은 확인하지 않았다. 시험 제외, 기대값 완화, `continue-on-error`는 쓰지 않았다. Windows 작업 폴더를 쓰는 개발자가 이 2건을 피하려면 줄바꿈 정책(`.gitattributes`의 `eol=lf` 등)이 필요하지만, 저장소 전체 줄바꿈을 바꾸는 결정이라 이번에는 하지 않았다.

## 4. 빌드 단계: AI 에이전트 세션 안에서 로컬 빌드가 멈추는 현상

LF 클론에서 `npm run build`는 컴파일(`Compiled successfully`), TypeScript 검사, 정적 페이지 생성까지 모두 끝낸 뒤 마지막에 종료 코드 1로 멈췄다. 오류는 `SecurityFatalError: Your version of Next.js is affected by a known security vulnerability`였다. 확인한 것:

- 이 오류는 설치된 `next@16.4.2` 패키지의 `dist/lib/upgrade/nudge.js`에서 나온다. `dist/server/config-shared.js`의 기본값이 `agentUpgrade: 'security'`이고, 같은 패키지의 에이전트 감지(`@vercel/detect-agent`)는 `AI_AGENT`·`CLAUDECODE` 같은 환경 변수를 읽는다.
- 이 세션의 환경에는 감지 대상 환경 변수 중 `AI_AGENT`와 `CLAUDECODE`가 설정되어 있었다. 감지기가 읽는 환경 변수 18개(위 두 개 포함)를 모두 `unset`하고 `.next`를 지운 뒤 같은 클론에서 `npm run build`를 다시 실행하자 **종료 코드 0**이었다. 둘 중 어느 변수가 원인인지는 가려내지 않았다.
- GitHub Actions 러너에는 이 환경 변수가 없다. 실제로 위 실행 43991427256의 빌드 단계는 성공했고(`Compiled successfully`, `Finished TypeScript`, 정적 페이지 2/2 생성) 로그에 `Build error`·`SecurityFatalError`가 없다.
- 코드·설정·시험은 바꾸지 않았다. 이 문서의 로컬 빌드 결과는 "에이전트 환경 변수를 뺀 조건"의 값이다.

별개의 관찰: `npm audit`은 직접 의존성 `next`에 moderate 1건(영향 범위 `16.3.0 - 16.4.4`, 수정 버전 `16.4.6`)을 보고했다. 높음·치명 등급은 0건이다. 의존성 갱신은 이번 범위 밖이라 하지 않았다.

## 5. 원격 실행

Draft PR #21을 연 뒤 첫 실행 [43991427256](https://github.com/KyungHwanLeeNexsol/bodam/actions/runs/43991427256)(커밋 `ded58ff`)의 결과: 작업 `Verify (Linux, Node 24.22.1)` 성공, 단계 `Step 1/4 npm ci`(`added 81 packages`) · `Step 2/4 typecheck` · `Step 3/4 npm test`(`210 files · 10123 tests` 통과) · `Step 4/4 build` 모두 success. 이후 커밋의 실행 결과와 링크는 PR 본문에 있다(실행마다 링크가 달라 이 문서에는 위 한 건만 적는다). 위 값은 로그를 직접 내려받아 확인했다.

## 6. 한계

- Linux 로컬 확인 불가(WSL·Docker 없음). §2의 로컬 결과는 모두 Windows 11 위의 값이고, Linux 결과는 §5의 원격 실행뿐이다. 원격 확인은 아직 소수의 실행(성공 경로)이고, 실패 경로(단계가 실패하면 작업이 실패로 끝나는지)는 원격에서 일부러 만들어 보지 않았다.
- `npm audit`의 `next` moderate 1건과 `npm ci`가 출력한 `1 moderate severity vulnerability`는 같은 건이다. 이 CI는 취약점으로 실패하지 않는다(보안 점검은 별도 보안 PR #6의 범위).
- `actionlint` 같은 워크플로 전용 검사기는 쓰지 않았다(문법만 파싱).
- Node `24.22.1`만 확인했다. 다른 Node 버전·macOS·Windows CI는 범위 밖이다.
- 브라우저 전체 시험(Playwright)과 린트(린트 스크립트가 없다)는 이 CI에 없다.
- 워크플로의 `actions/checkout@v4`·`actions/setup-node@v4`는 기존 워크플로(`label-sync.yml`, 보안 PR #6)와 같은 태그 방식이며 커밋 해시로 고정하지 않았다. 저장소 설정은 해시 고정을 요구하지 않는다(`sha_pinning_required: false`).
- 이 워크플로는 `main`에 없으므로 이 파일이 든 브랜치의 PR에서만 실행된다(§1).

## 7. 하지 않은 일

운영 인증·DB·실제 데이터 입력·병합·배포, 기존 라벨 워크플로(`label-sync.yml`)와 브랜치 보호 설정과 기존 PR의 변경, 시험 제외·기대값 완화·`continue-on-error`, 의존성 갱신, 줄바꿈 정책(`.gitattributes`) 변경, 브라우저 전체 시험과 Windows CI 추가.
