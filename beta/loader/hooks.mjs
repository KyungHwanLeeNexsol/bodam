// 베타 서버용 모듈 해석 훅. 서버 소스는 확장자 없는 상대 경로("./numeric")로 서로를 가져와 Node 가 그대로 해석하지 못한다.
// 못 찾으면 ".ts" 를 붙여 다시 해석한다. 번들러나 새 패키지 없이 Node 내장 기능만 쓴다.
// tests/fixtures/engine/ts-resolve-hooks.mjs 와 같은 내용의 복사본이다: 배포본이 tests/ 폴더에 기대지 않게 한다(이 훅 하나 때문에 tests/ 를 실을 이유가 없다).
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    if (relative && error !== null && typeof error === 'object' && error.code === 'ERR_MODULE_NOT_FOUND') {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw error;
  }
}
