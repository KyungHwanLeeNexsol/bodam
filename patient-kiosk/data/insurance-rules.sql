-- One row represents one published policy edition and coverage option, never a whole generation.
CREATE TABLE insurance_rule (
  id TEXT PRIMARY KEY NOT NULL,
  generation TEXT NOT NULL CHECK (generation IN ('GEN1_AS','GEN2_C1','GEN2_5_C2','GEN3_C3','GEN4_C4')),
  insurerType TEXT NOT NULL CHECK (insurerType IN ('NON_LIFE','LIFE','MUTUAL_AID')),
  policy TEXT NOT NULL,
  coverage TEXT NOT NULL,
  sourceUrl TEXT NOT NULL CHECK (sourceUrl LIKE 'https://%'),
  sourceLocation TEXT NOT NULL,
  fixedDeductibleWon INTEGER NOT NULL CHECK (fixedDeductibleWon >= 0),
  nonBenefitBasisPoints INTEGER NOT NULL CHECK (nonBenefitBasisPoints BETWEEN 0 AND 10000),
  perVisitLimitWon INTEGER CHECK (perVisitLimitWon > 0),
  annualLimitWon INTEGER CHECK (annualLimitWon > 0),
  maxVisits INTEGER NOT NULL CHECK (maxVisits > 0),
  limitPeriod TEXT NOT NULL CHECK (limitPeriod IN ('CONTRACT_YEAR','ILLNESS_ONSET_365_DAYS')),
  scope TEXT NOT NULL CHECK (scope IN ('VISIT','TREATMENT','INITIAL_TEN','HISTORICAL')),
  notes TEXT NOT NULL,
  CHECK (
    (scope = 'HISTORICAL' AND generation = 'GEN1_AS' AND limitPeriod = 'ILLNESS_ONSET_365_DAYS' AND perVisitLimitWon IS NOT NULL)
    OR (scope = 'VISIT' AND generation IN ('GEN2_C1','GEN2_5_C2') AND limitPeriod = 'CONTRACT_YEAR' AND perVisitLimitWon IS NULL)
    OR (scope = 'TREATMENT' AND generation = 'GEN3_C3' AND limitPeriod = 'CONTRACT_YEAR' AND annualLimitWon IS NOT NULL)
    OR (scope = 'INITIAL_TEN' AND generation = 'GEN4_C4' AND limitPeriod = 'CONTRACT_YEAR' AND annualLimitWon IS NOT NULL AND maxVisits >= 10)
  ),
  UNIQUE (generation, insurerType, policy, coverage)
) STRICT;

INSERT INTO insurance_rule
(id, generation, insurerType, policy, coverage, sourceUrl, sourceLocation, fixedDeductibleWon,
 nonBenefitBasisPoints, perVisitLimitWon, annualLimitWon, maxVisits, limitPeriod, scope, notes)
VALUES
('lig-wellbeing-2008-illness-30', 'GEN1_AS', 'NON_LIFE',
 '무배당 LIG 웰빙보험 (2008.10 공시본)', '질병통원의료비Ⅲ(30만원한도) 특별약관(갱신계약)',
 'https://www.kbinsure.co.kr/CG802030003.ec?fileNm=2812_1_1_20081009.pdf', '질병통원의료비Ⅲ(30만원한도) 특별약관 제1조',
 5000, 0, 300000, NULL, 30, 'ILLNESS_ONSET_365_DAYS', 'HISTORICAL',
 '국민건강보험 적용 시: 통원 1일 전체 보상대상에서 5천 원 공제, 1일 최대 30만 원. 발병일부터 365일 동안 같은 질병 통산 30일. 재발병 간주와 건강보험 미적용 예외는 원문 확인. 다른 1세대 계약에 적용하지 않음.'),
('samsung-super-v-s1004-outpatient', 'GEN2_C1', 'NON_LIFE',
 '삼성화재 통합보험 Super V(s1004)', '갱신형 실손의료비 특별약관의 외래 담보',
 'https://www.samsungfire.com/publication/pdf/95903_0_20100401_file1.pdf', '4-1. 갱신형 실손의료비 특별약관, 제3조 및 표1',
 10000, 0, NULL, NULL, 180, 'CONTRACT_YEAR', 'VISIT',
 '의원 외래 1회 공제. 외래 보상은 보험증권의 가입금액 한도. 외래와 처방조제의 합산 가입금액 상한은 30만 원이며 외래 단독 한도가 아님.'),
('samsung-1509-5-choice-2-outpatient', 'GEN2_5_C2', 'NON_LIFE',
 '삼성화재 실손의료비보험(1509.5) 2종(선택형Ⅱ)', '상해·질병 외래 담보',
 'https://www.samsungfire.com/publication/pdf/96058_0_21050901_file1.pdf', '2종(선택형Ⅱ) 보통약관 제3조, 상해·질병 외래 및 표1',
 10000, 2000, NULL, NULL, 180, 'CONTRACT_YEAR', 'VISIT',
 '의원 외래 공제는 1만 원과 보상대상 급여 본인부담 10% 및 비급여 20%의 합 중 큰 금액. 여기서는 비급여 치료 1건이 외래의 보상대상 비용 전부인 경우만 계산. 외래 가입금액 한도는 보험증권 확인.'),
('kb-2017-04-msk', 'GEN3_C3', 'NON_LIFE',
 'KB개인실손의료비보험(2017.04 공시본)', '비급여 도수치료·체외충격파치료·증식치료 특별약관',
 'https://kbinsure.co.kr/CG802030003.ec?fileNm=20170401_15125_1.pdf', '비급여 도수치료·체외충격파치료·증식치료 특별약관 제3조',
 20000, 3000, NULL, 3500000, 50, 'CONTRACT_YEAR', 'TREATMENT',
 '상해·질병의 치료 목적. 공제는 치료행위별로 적용. 도수치료·체외충격파치료·증식치료 합산 계약연도 350만 원 및 50회.'),
('kb-23-01-msk', 'GEN4_C4', 'NON_LIFE',
 'KB손해보험 실손의료비보장보험(23.01)', '3대 비급여 특약 중 도수치료·체외충격파치료·증식치료',
 'https://kbinsure.co.kr/CG802030003.ec?fileNm=23870_1_1.pdf', '상해·질병 3대 비급여 특별약관, 77–78쪽',
 30000, 3000, NULL, 3500000, 50, 'CONTRACT_YEAR', 'INITIAL_TEN',
 '도수치료·체외충격파치료·증식치료 합산 계약연도 350만 원 및 50회. 최초 10회 이후에는 객관적 검사상 호전 확인 조건이 추가되어 이 화면에서는 계산하지 않음.');
