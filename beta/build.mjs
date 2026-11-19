import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// 키오스크 전용 베타 빌드. 운영 src/ 는 그대로 두고, 임시 복사본(.beta-build/)에서 Next 를 빌드한다.
//   node beta/build.mjs      (npm run beta:build)
//  - 복사하는 것: src/app/layout.tsx · src/app/kiosk/** · src/engine/** · next.config.mjs · 글꼴 두 파일(Pretendard Regular·Bold) · tsconfig(포함 범위만 좁힘).
//    복사하지 않는 것: 관리자 화면(src/app/admin/**) · 관리자 API(src/app/api/**) · 운영 서비스 연결(src/app/services.ts·admin-services.ts) · src/server/**.
//    키오스크 화면이 쓰는 공개 API 세 경로는 beta/server.ts 의 처리기가 받는다(Next 라우트가 아니다).
//  - 운영 코드와 다른 곳은 정확히 한 군데다: src/app/kiosk/state/deps.ts 의 기본 전송이 `credentials: 'omit'` 이라 키오스크가 API 요청에 쿠키를 싣지 않는다.
//    그대로면 초대 세션 쿠키로 계산 API 를 막을 수 없으므로, 이 베타 빌드에서만 'same-origin' 으로 바꾼다. 원문에 그 문자열이 정확히 한 번 있지 않으면 빌드를 멈춘다.
//    (운영 src/ 와 그 시험(default-transport.test.ts)은 바뀌지 않는다.)
//  - 빌드 뒤 검사: 라우트 목록에 관리자·API 라우트가 없고, 빌드 산출물 어디에도 /api/admin 문자열이 없어야 한다. 어긋나면 종료 코드 1.
//  - 증거: .beta-build/BUILD-MANIFEST.json (복사한 파일 목록·해시·패치 위치·라우트 목록).

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, '.beta-build');

const PATCH_FILE = 'src/app/kiosk/state/deps.ts';
const PATCH_FROM = "credentials: 'omit'";
const PATCH_TO = "credentials: 'same-origin'";
const FONT_DIR = 'node_modules/pretendard/dist/web/static/woff2';
const FONT_FILES = ['Pretendard-Regular.woff2', 'Pretendard-Bold.woff2'];

function fail(message) {
  process.stderr.write(`BETA_BUILD_FAILED ${message}\n`);
  process.exit(1);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

// 1. 임시 폴더를 비운다. 이 폴더 안에는 심볼릭 링크·정션을 만들지 않는다(지울 때 원본을 건드릴 길이 없다).
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const copied = [];
function copyFile(fromRelative, toRelative = fromRelative) {
  const from = join(ROOT, fromRelative);
  const to = join(OUT, toRelative);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  copied.push({ path: toRelative.split('\\').join('/'), sha256: sha256(readFileSync(to)) });
}
function copyTree(fromRelative) {
  const base = join(ROOT, fromRelative);
  for (const file of walk(base)) copyFile(relative(ROOT, file));
}

copyFile('src/app/layout.tsx');
copyTree('src/app/kiosk');
copyTree('src/engine');
copyFile('next.config.mjs');
for (const font of FONT_FILES) copyFile(`${FONT_DIR}/${font}`);

// 2. 베타 빌드에서만 하는 패치: 정확히 한 군데.
const patchPath = join(OUT, PATCH_FILE);
const original = readFileSync(patchPath, 'utf8');
const occurrences = original.split(PATCH_FROM).length - 1;
if (occurrences !== 1) fail(`${PATCH_FILE} 에 "${PATCH_FROM}" 가 정확히 한 번 있어야 한다 (지금 ${occurrences}번). 키오스크 전송 코드가 바뀌었는지 확인해 달라`);
writeFileSync(patchPath, original.replace(PATCH_FROM, PATCH_TO), 'utf8');
const patched = { file: PATCH_FILE, from: PATCH_FROM, to: PATCH_TO, sha256Before: sha256(Buffer.from(original, 'utf8')), sha256After: sha256(readFileSync(patchPath)) };

// 3. tsconfig: 운영 설정을 그대로 두되 포함 범위만 src 와 Next 타입으로 좁힌다.
const tsconfig = JSON.parse(readFileSync(join(ROOT, 'tsconfig.json'), 'utf8'));
tsconfig.include = ['src', '.next/types/**/*.ts'];
writeFileSync(join(OUT, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, 2)}\n`, 'utf8');
writeFileSync(join(OUT, 'package.json'), `${JSON.stringify({ name: 'bodam-beta-kiosk-build', private: true, type: 'module' }, null, 2)}\n`, 'utf8');

/** 빌드에는 초대 토큰·공개 출처 같은 서버 설정(BODAM_BETA_*)을 넘기지 않는다. */
function buildEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('BODAM_BETA_')));
}

// 4. Next 빌드(임시 폴더에서). 환경 변수는 그대로 물려받되 NODE_ENV 는 production 이다.
const next = spawnSync(process.execPath, [join(ROOT, 'node_modules/next/dist/bin/next'), 'build', OUT], { cwd: ROOT, stdio: 'inherit', env: { ...buildEnv(), NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' } });
if (next.status !== 0) fail(`next build 가 실패했다 (종료 코드 ${String(next.status)})`);

// 5. 빌드 뒤 검사.
const routesFile = join(OUT, '.next/app-path-routes-manifest.json');
if (!existsSync(routesFile)) fail('.next/app-path-routes-manifest.json 이 없다');
const routes = Object.values(JSON.parse(readFileSync(routesFile, 'utf8'))).sort();
const forbiddenRoute = routes.filter((route) => /admin|^\/api(\/|$)/i.test(String(route)));
if (forbiddenRoute.length > 0) fail(`관리자·API 라우트가 빌드에 들어 있다: ${forbiddenRoute.join(', ')}`);
if (!routes.includes('/kiosk/[clinicSlug]')) fail(`키오스크 라우트가 없다: ${routes.join(', ')}`);

const leaks = [];
for (const file of walk(join(OUT, '.next'))) {
  if (statSync(file).size > 20_000_000) continue;
  const text = readFileSync(file).toString('latin1');
  if (text.includes('/api/admin')) leaks.push(relative(OUT, file));
}
if (leaks.length > 0) fail(`빌드 산출물에 /api/admin 문자열이 있다: ${leaks.slice(0, 5).join(', ')}`);

writeFileSync(join(OUT, 'BUILD-MANIFEST.json'), `${JSON.stringify({ routes, patch: patched, copied }, null, 2)}\n`, 'utf8');
process.stdout.write(`BETA_BUILD_OK routes=${routes.join(',')} copied=${copied.length} patch=${PATCH_FILE}\n`);
