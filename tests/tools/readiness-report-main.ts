import { runReadinessReport } from './readiness-report';

// 시험 자료(TEST_FIXTURE)를 쓰는 로컬 도구의 진입점. 논리는 readiness-report.ts 에 있고, 여기서는 결과를 쓰고 종료 코드를 정할 뿐이다.
// process.exit 를 부르지 않고 exitCode 만 정해서, 표준 출력이 다 쓰인 뒤에 프로세스가 끝나게 한다.
const result = runReadinessReport(process.argv.slice(2));
if (result.stdout !== '') {
  process.stdout.write(result.stdout);
}
if (result.stderr !== '') {
  process.stderr.write(result.stderr);
}
process.exitCode = result.exitCode;
