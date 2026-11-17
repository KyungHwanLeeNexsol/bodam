// 버전 게시 서비스의 공개 진입점 (plan.md M3 파일 목록의 versioning.ts). 구현은 두 모듈에 있고 이 파일은 다시 내보내기만 한다.
//   catalog-publish.ts  — 카탈로그 게시·복구 (HA)
//   bundle-publish.ts   — 규칙 묶음 게시·복구와 묶음 내용 해시 (RV)
// 게시된 CatalogVersion·RuleBundleVersion 을 수정하거나 지우는 동작은 어디에도 없다: 수정은 새 버전의 게시(복구 포함)로만 생긴다 (AC-011a).
export { publishCatalog, restoreCatalogVersion } from './catalog-publish';
export { bundleContentHashOf, computeBundleContentHash, publishRuleBundle, restoreRuleBundle } from './bundle-publish';
export type { BundleHashEntry } from './bundle-publish';
export { SERVICE_PUBLISH_DEFECT_CODES } from './publish-defects';
export type { ServicePublishDefectCode } from './publish-defects';
