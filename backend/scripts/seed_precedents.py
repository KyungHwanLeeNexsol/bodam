#!/usr/bin/env python3
"""보험 관련 법원 판례 시드 스크립트

개발/테스트 환경용 현실적인 판례 50개 생성 및 임베딩.
프로덕션용 실시간 스크래퍼(PrecedentScraper) 클래스도 포함.

Usage:
  python scripts/seed_precedents.py seed
  python scripts/seed_precedents.py scrape --source law
  python scripts/seed_precedents.py scrape --source fss
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from datetime import date
from pathlib import Path

# 프로젝트 루트를 Python 경로에 추가
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

try:
    from dotenv import load_dotenv
    load_dotenv(project_root / ".env")
except ImportError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("seed_precedents")


# ─────────────────────────────────────────────────────────────
# 현실적인 한국 보험 분쟁 판례 50개 (개발/테스트용)
# 실제 판례 번호 형식, 법원명, 날짜 사용
# ─────────────────────────────────────────────────────────────
SEED_PRECEDENTS = [
    {
        "case_number": "2024다12345",
        "court_name": "대법원",
        "decision_date": date(2024, 3, 14),
        "case_type": "보험금청구",
        "insurance_type": "실손의료보험",
        "summary": "실손의료보험 가입자가 비급여 치료비에 대한 보험금을 청구하였으나 보험사가 약관상 면책 조항을 이유로 거절한 사건. 법원은 약관 해석 원칙에 따라 보험사의 면책 주장을 제한적으로 해석하여야 한다고 판시.",
        "ruling": "비급여 치료가 의학적으로 필요한 경우에는 약관의 면책 조항을 엄격히 해석하여야 하며, 불명확한 경우 피보험자에게 유리하게 해석한다. 원고 승소.",
        "key_clauses": {"조항": ["제3조(보상하는 손해)", "제5조(보상하지 않는 손해)", "제10조(보험금 청구)"], "핵심쟁점": "비급여 치료비 면책 조항 해석"},
        "source_url": "https://www.law.go.kr/판례/2024다12345",
    },
    {
        "case_number": "2023나56789",
        "court_name": "서울고등법원",
        "decision_date": date(2023, 11, 22),
        "case_type": "보험금청구",
        "insurance_type": "자동차보험",
        "summary": "자동차 사고 피해자가 가해자 측 대인배상보험에 청구하였으나 기여과실 비율 산정에 이견이 있어 분쟁 발생. 법원은 블랙박스 영상과 전문가 감정을 토대로 과실 비율을 재산정.",
        "ruling": "교통사고 과실 비율은 사고 당시 도로 상황, 신호 준수 여부, 속도 등을 종합 고려해야 한다. 피고(보험사)는 원고에게 추가 보험금을 지급하라.",
        "key_clauses": {"조항": ["제9조(대인배상 I)", "제12조(과실상계)", "별표1(대인배상 기준)"], "핵심쟁점": "교통사고 과실 비율 산정"},
        "source_url": "https://www.law.go.kr/판례/2023나56789",
    },
    {
        "case_number": "2024나23456",
        "court_name": "서울고등법원",
        "decision_date": date(2024, 1, 18),
        "case_type": "보험계약취소",
        "insurance_type": "생명보험",
        "summary": "보험계약자가 건강 고지 의무를 위반하여 보험사가 계약 해지를 통보한 사건. 기왕증 고지 누락이 계약 체결에 영향을 미쳤는지 여부가 쟁점.",
        "ruling": "고지 의무 위반의 중요성 판단 기준은 보험사의 계약 체결 여부 결정에 영향을 미칠 수 있는 사항이어야 한다. 경미한 기왕증 누락은 해지 사유가 되지 않는다.",
        "key_clauses": {"조항": ["제14조(계약 전 알릴 의무)", "제15조(계약 전 알릴 의무 위반의 효과)"], "핵심쟁점": "고지의무 위반 판단 기준"},
        "source_url": "https://www.law.go.kr/판례/2024나23456",
    },
    {
        "case_number": "2023가합34567",
        "court_name": "서울중앙지방법원",
        "decision_date": date(2023, 8, 30),
        "case_type": "보험금청구",
        "insurance_type": "화재보험",
        "summary": "상가 화재 발생 후 임차인이 화재보험금을 청구하였으나 보험사가 방화 의심을 이유로 지급을 거절한 사건. 방화 여부 입증 책임 소재가 쟁점.",
        "ruling": "보험사가 면책 사유인 방화를 주장하는 경우 보험사가 이를 입증하여야 한다. 단순 의심만으로 보험금 지급을 거절할 수 없다. 원고 일부 승소.",
        "key_clauses": {"조항": ["제3조(보상하는 손해)", "제6조(면책 사유)", "제8조(손해액 산정)"], "핵심쟁점": "방화 입증 책임 소재"},
        "source_url": "https://www.law.go.kr/판례/2023가합34567",
    },
    {
        "case_number": "2023다67890",
        "court_name": "대법원",
        "decision_date": date(2023, 6, 15),
        "case_type": "보험금청구",
        "insurance_type": "암보험",
        "summary": "암보험 가입자가 갑상선암 진단 후 보험금을 청구하였으나 보험사가 약관상 소액 암에 해당한다는 이유로 일반 암 보험금보다 적은 금액을 지급한 사건.",
        "ruling": "암보험 약관의 소액 암 분류 기준은 의료계의 통상적 기준과 달리 피보험자에게 불리하게 작용하는 경우 이를 약관 해석 원칙에 따라 피보험자에게 유리하게 해석해야 한다.",
        "key_clauses": {"조항": ["제2조(용어의 정의)", "제4조(보험금 지급 기준)", "별표(암의 분류)"], "핵심쟁점": "소액 암 해당 여부"},
        "source_url": "https://www.law.go.kr/판례/2023다67890",
    },
    {
        "case_number": "2022나78901",
        "court_name": "부산고등법원",
        "decision_date": date(2022, 12, 5),
        "case_type": "보험금청구",
        "insurance_type": "상해보험",
        "summary": "해상 작업 중 부상을 당한 근로자가 상해보험금을 청구하였으나 보험사가 직업 위험도 가중 약관을 적용하여 감액 지급을 결정한 사건.",
        "ruling": "직업 위험도 약관 조항은 계약 체결 시 명확히 설명되어야 하며, 설명 의무를 이행하지 않은 경우 해당 조항을 보험계약자에게 주장할 수 없다.",
        "key_clauses": {"조항": ["제7조(직업 위험도 적용)", "제11조(보험금 감액 기준)"], "핵심쟁점": "약관 설명 의무 이행 여부"},
        "source_url": "https://www.law.go.kr/판례/2022나78901",
    },
    {
        "case_number": "2023가단12345",
        "court_name": "수원지방법원",
        "decision_date": date(2023, 3, 21),
        "case_type": "보험금청구",
        "insurance_type": "실손의료보험",
        "summary": "도수치료 비용에 대한 실손보험금 청구 사건. 보험사가 도수치료를 물리치료의 일종으로 보고 연간 한도를 적용한 것에 대해 분쟁 발생.",
        "ruling": "도수치료가 의사의 지시에 따른 정당한 치료인 경우 실손보험금 지급 대상이 된다. 연간 한도 적용은 약관에 명시된 경우에만 가능하다.",
        "key_clauses": {"조항": ["제5조(보상하는 의료비)", "제6조(연간 한도)"], "핵심쟁점": "도수치료 보험금 지급 여부"},
        "source_url": "https://www.law.go.kr/판례/2023가단12345",
    },
    {
        "case_number": "2024나34567",
        "court_name": "대전고등법원",
        "decision_date": date(2024, 4, 10),
        "case_type": "보험계약무효",
        "insurance_type": "생명보험",
        "summary": "사망보험 수익자가 보험계약자를 살해한 경우 보험금 지급 여부에 관한 분쟁. 수익자 변경 시점과 살인 행위의 관련성이 쟁점.",
        "ruling": "보험수익자가 고의로 보험사고를 발생시킨 경우 보험금 청구권을 상실한다. 피고(수익자)에 대한 보험금 지급 청구 기각.",
        "key_clauses": {"조항": ["제8조(면책 사유)", "상법 제659조(보험자의 면책 사유)"], "핵심쟁점": "수익자의 고의 사고 야기"},
        "source_url": "https://www.law.go.kr/판례/2024나34567",
    },
    {
        "case_number": "2022다89012",
        "court_name": "대법원",
        "decision_date": date(2022, 9, 29),
        "case_type": "보험금청구",
        "insurance_type": "운전자보험",
        "summary": "음주운전 중 사고로 인한 운전자 보험금 청구 사건. 면책 약관의 적용 범위와 음주 수치 기준이 쟁점.",
        "ruling": "음주운전 면책 조항은 법정 기준치 이상의 혈중알코올농도인 경우에 적용된다. 약관에서 정한 기준을 초과하면 면책이 유효하다. 피고 보험사 승소.",
        "key_clauses": {"조항": ["제4조(면책 사항)", "제4조 제1항 제3호(음주운전)"], "핵심쟁점": "음주운전 면책 조항 적용 기준"},
        "source_url": "https://www.law.go.kr/판례/2022다89012",
    },
    {
        "case_number": "2023나45678",
        "court_name": "광주고등법원",
        "decision_date": date(2023, 7, 17),
        "case_type": "보험금청구",
        "insurance_type": "재물보험",
        "summary": "태풍으로 인한 농업시설 피해에 대한 재물보험 청구 사건. 강풍 피해와 수해 피해의 복합 원인 구분이 쟁점.",
        "ruling": "복합 원인으로 발생한 손해는 각 원인별 기여도에 따라 보험금을 산정한다. 보험사가 기여도 산정 근거를 제시해야 한다.",
        "key_clauses": {"조항": ["제3조(보상하는 손해)", "제7조(손해 발생 원인 구분)"], "핵심쟁점": "복합 원인 손해 구분"},
        "source_url": "https://www.law.go.kr/판례/2023나45678",
    },
    {
        "case_number": "2024가합56789",
        "court_name": "서울중앙지방법원",
        "decision_date": date(2024, 2, 28),
        "case_type": "보험금청구",
        "insurance_type": "실손의료보험",
        "summary": "정신건강의학과 치료비에 대한 실손보험금 청구 사건. 보험사가 정신질환 치료를 면책 사항으로 보고 지급을 거절한 사건.",
        "ruling": "정신질환 치료 면책 조항은 명확히 적시된 경우에만 유효하며, 약관 해석 원칙에 따라 입원 치료가 필요한 중증 정신질환은 지급 대상이 된다.",
        "key_clauses": {"조항": ["제5조(면책 사항)", "제5조 제2항(정신질환 등)"], "핵심쟁점": "정신질환 치료 면책 조항 범위"},
        "source_url": "https://www.law.go.kr/판례/2024가합56789",
    },
    {
        "case_number": "2022나90123",
        "court_name": "서울고등법원",
        "decision_date": date(2022, 5, 11),
        "case_type": "보험금청구",
        "insurance_type": "자동차보험",
        "summary": "자동차 전손 처리 후 실제 차량 가액 산정 분쟁. 보험사가 제시한 차량 가액이 시장 가액보다 현저히 낮다는 주장.",
        "ruling": "전손 보험금은 사고 직전의 차량 가액을 기준으로 산정해야 한다. 보험사는 공정한 시장 가액 산정 방식을 적용해야 하며, 일방적 기준 적용은 불합리하다.",
        "key_clauses": {"조항": ["제10조(차량 손해 보상)", "제12조(전손 처리 기준)"], "핵심쟁점": "전손 차량 가액 산정 기준"},
        "source_url": "https://www.law.go.kr/판례/2022나90123",
    },
    {
        "case_number": "2023다01234",
        "court_name": "대법원",
        "decision_date": date(2023, 4, 20),
        "case_type": "보험금청구",
        "insurance_type": "연금보험",
        "summary": "변액연금보험 원금 손실에 대한 손해배상 청구 사건. 불완전판매 여부와 설명의무 위반이 쟁점.",
        "ruling": "금융상품 판매 시 위험성에 대한 충분한 설명이 필요하다. 설명 의무 위반이 인정되는 경우 판매사는 손해를 배상해야 한다. 원고 일부 승소.",
        "key_clauses": {"조항": ["자본시장법 제47조(설명 의무)", "금융소비자보호법 제19조"], "핵심쟁점": "금융상품 설명의무 위반"},
        "source_url": "https://www.law.go.kr/판례/2023다01234",
    },
    {
        "case_number": "2024나67890",
        "court_name": "인천고등법원",
        "decision_date": date(2024, 5, 23),
        "case_type": "보험금청구",
        "insurance_type": "실손의료보험",
        "summary": "해외 여행 중 의료비에 대한 실손보험금 청구 사건. 국내 기준으로 환산한 보험금 산정 방식의 적절성 분쟁.",
        "ruling": "해외 의료비는 실제 지출 비용을 기준으로 하되 약관에 국내 기준 적용 규정이 명시된 경우에만 환산 적용이 가능하다.",
        "key_clauses": {"조항": ["제8조(해외 의료비 보상)", "제9조(환산 기준)"], "핵심쟁점": "해외 의료비 환산 기준"},
        "source_url": "https://www.law.go.kr/판례/2024나67890",
    },
    {
        "case_number": "2021나12345",
        "court_name": "대구고등법원",
        "decision_date": date(2021, 10, 8),
        "case_type": "보험금청구",
        "insurance_type": "화재보험",
        "summary": "임차인의 과실로 화재 발생 후 임대인의 보험금 청구 및 임차인에 대한 구상권 행사 사건.",
        "ruling": "임차인의 과실로 발생한 화재에 대해 보험사는 보험금을 지급한 후 임차인에게 구상권을 행사할 수 있다. 단 임차인을 피보험자로 포함시킨 경우 구상권이 제한된다.",
        "key_clauses": {"조항": ["상법 제682조(보험자의 대위)", "제14조(피보험자 범위)"], "핵심쟁점": "보험사의 임차인에 대한 구상권"},
        "source_url": "https://www.law.go.kr/판례/2021나12345",
    },
    {
        "case_number": "2023가합78901",
        "court_name": "서울남부지방법원",
        "decision_date": date(2023, 9, 14),
        "case_type": "보험금청구",
        "insurance_type": "상해보험",
        "summary": "레저 스포츠 중 사고로 인한 상해보험금 청구 사건. 위험 스포츠 면책 조항의 적용 여부가 쟁점.",
        "ruling": "위험 스포츠 면책 조항은 계약 체결 시 명확히 고지되어야 한다. 일반적인 레저 활동은 위험 스포츠로 분류할 수 없다.",
        "key_clauses": {"조항": ["제4조(면책 사항)", "제4조 제1항 제5호(위험한 운동)"], "핵심쟁점": "위험 스포츠 면책 조항 적용 범위"},
        "source_url": "https://www.law.go.kr/판례/2023가합78901",
    },
    {
        "case_number": "2022다23456",
        "court_name": "대법원",
        "decision_date": date(2022, 7, 28),
        "case_type": "보험금청구",
        "insurance_type": "저축성보험",
        "summary": "저축성 보험 중도 해지 시 환급금 부족에 대한 불완전판매 분쟁. 원금 보장 설명과 실제 환급금의 차이가 쟁점.",
        "ruling": "보험 판매 시 원금 손실 가능성을 충분히 설명하지 않은 경우 불완전판매에 해당한다. 설명 의무 위반에 따른 손해배상 책임이 인정된다.",
        "key_clauses": {"조항": ["금융소비자보호법 제19조", "제21조(적합성 원칙)"], "핵심쟁점": "저축성 보험 불완전판매"},
        "source_url": "https://www.law.go.kr/판례/2022다23456",
    },
    {
        "case_number": "2024가단34567",
        "court_name": "의정부지방법원",
        "decision_date": date(2024, 6, 19),
        "case_type": "보험금청구",
        "insurance_type": "자동차보험",
        "summary": "교통사고 후유장해에 대한 보험금 산정 분쟁. 맥브라이드 기준과 AMA 기준 중 어느 것을 적용할지가 쟁점.",
        "ruling": "장해 평가 기준은 약관에 별도 규정이 없는 경우 국내에서 통용되는 기준을 우선 적용한다. 피보험자에게 더 유리한 기준을 선택할 수 있다.",
        "key_clauses": {"조항": ["제13조(후유장해 보상 기준)", "별표(장해 분류표)"], "핵심쟁점": "후유장해 평가 기준 선택"},
        "source_url": "https://www.law.go.kr/판례/2024가단34567",
    },
    {
        "case_number": "2023나56780",
        "court_name": "울산지방법원",
        "decision_date": date(2023, 2, 7),
        "case_type": "보험금청구",
        "insurance_type": "산재보험",
        "summary": "산업재해 인정 범위에 관한 분쟁. 출퇴근 중 사고의 업무 관련성 판단이 쟁점.",
        "ruling": "통상적인 경로와 방법으로 출퇴근 중 발생한 사고는 산재로 인정된다. 경로 이탈 여부를 엄격히 판단해서는 안 된다.",
        "key_clauses": {"조항": ["산업재해보상보험법 제37조(업무상 재해 인정)"], "핵심쟁점": "출퇴근 재해 인정 기준"},
        "source_url": "https://www.law.go.kr/판례/2023나56780",
    },
    {
        "case_number": "2024다45678",
        "court_name": "대법원",
        "decision_date": date(2024, 8, 1),
        "case_type": "보험금청구",
        "insurance_type": "의료배상책임보험",
        "summary": "의료과실로 인한 환자 사망 사건에서 의사 측 의료배상책임보험금 지급 분쟁. 과실 인정 범위와 보험금 산정이 쟁점.",
        "ruling": "의료과실의 입증 책임은 피해자에게 있으나 의료 기록 접근이 어려운 경우 입증 책임을 완화할 수 있다. 의료배상책임보험은 확정된 과실에 대해 지급한다.",
        "key_clauses": {"조항": ["제2조(보상하는 손해)", "제10조(보험금 청구 시기)"], "핵심쟁점": "의료과실 입증 책임"},
        "source_url": "https://www.law.go.kr/판례/2024다45678",
    },
    {
        "case_number": "2022나34567",
        "court_name": "서울고등법원",
        "decision_date": date(2022, 11, 3),
        "case_type": "보험계약해지",
        "insurance_type": "건강보험",
        "summary": "보험사가 보험금 과다 청구를 이유로 건강보험 계약을 해지한 사건. 해지 사유의 정당성과 절차적 요건이 쟁점.",
        "ruling": "보험계약 해지는 법령과 약관에서 정한 사유에 해당해야 하며, 사전 통지 등 절차적 요건을 갖추어야 한다. 절차 위반 시 해지는 효력이 없다.",
        "key_clauses": {"조항": ["제25조(계약의 해지)", "제26조(해지 통보 절차)"], "핵심쟁점": "보험계약 해지 요건"},
        "source_url": "https://www.law.go.kr/판례/2022나34567",
    },
    {
        "case_number": "2023가합90123",
        "court_name": "서울중앙지방법원",
        "decision_date": date(2023, 10, 31),
        "case_type": "보험금청구",
        "insurance_type": "실손의료보험",
        "summary": "한방 치료비에 대한 실손보험금 청구 사건. 침술, 한약 처방 비용이 실손보험 보상 대상인지 여부가 쟁점.",
        "ruling": "한방 치료 중 의료법에 따른 한의사의 처방에 의한 치료는 실손보험금 지급 대상이 될 수 있다. 약관의 명시적 제외 규정이 없는 경우 지급해야 한다.",
        "key_clauses": {"조항": ["제5조(보상하는 의료비)", "제5조 제2항(한방 치료 포함 범위)"], "핵심쟁점": "한방 치료비 보상 여부"},
        "source_url": "https://www.law.go.kr/판례/2023가합90123",
    },
    {
        "case_number": "2021다56789",
        "court_name": "대법원",
        "decision_date": date(2021, 8, 26),
        "case_type": "보험금청구",
        "insurance_type": "종신보험",
        "summary": "자살로 사망한 피보험자의 유족이 종신보험금을 청구한 사건. 자살 면책 조항의 적용 기간과 범위가 쟁점.",
        "ruling": "자살 면책 조항의 2년 적용 기간이 경과한 후의 자살은 보험금 지급 대상이 된다. 정신질환으로 인한 자살은 면책 적용 여부를 별도 판단해야 한다.",
        "key_clauses": {"조항": ["제4조(면책 사항)", "제4조 제2호(피보험자의 고의)", "상법 제732조의2"], "핵심쟁점": "자살 면책 조항 적용 기간"},
        "source_url": "https://www.law.go.kr/판례/2021다56789",
    },
    {
        "case_number": "2024나78901",
        "court_name": "부산고등법원",
        "decision_date": date(2024, 7, 4),
        "case_type": "보험금청구",
        "insurance_type": "화재보험",
        "summary": "공장 화재로 인한 기업휴지 손해에 대한 보험금 청구 사건. 휴지 기간의 적정성과 손해액 산정 방식이 쟁점.",
        "ruling": "기업휴지 보험금은 실제 영업 중단 기간과 그 기간의 이익 손실을 기준으로 산정해야 한다. 복구 기간의 합리성을 객관적으로 판단해야 한다.",
        "key_clauses": {"조항": ["제6조(기업휴지 손해 보상)", "제6조 제3항(손해액 산정)"], "핵심쟁점": "기업휴지 손해액 산정 방법"},
        "source_url": "https://www.law.go.kr/판례/2024나78901",
    },
    {
        "case_number": "2023나11111",
        "court_name": "대전고등법원",
        "decision_date": date(2023, 5, 25),
        "case_type": "보험금청구",
        "insurance_type": "자동차보험",
        "summary": "자율주행 모드 중 발생한 교통사고의 보험금 분쟁. 자율주행 시스템 결함과 운전자 과실 분리 문제가 쟁점.",
        "ruling": "자율주행 시스템 작동 중 사고는 제조사 결함과 운전자 과실을 구분하여 책임을 판단해야 한다. 현행 약관으로는 자율주행 사고를 명확히 규율하기 어렵다.",
        "key_clauses": {"조항": ["제9조(대인배상)", "제10조(대물배상)"], "핵심쟁점": "자율주행 사고 책임 구분"},
        "source_url": "https://www.law.go.kr/판례/2023나11111",
    },
    {
        "case_number": "2022가합22222",
        "court_name": "수원지방법원",
        "decision_date": date(2022, 4, 15),
        "case_type": "보험금청구",
        "insurance_type": "어린이보험",
        "summary": "학교 폭력으로 부상을 입은 어린이에 대한 어린이 보험금 청구 사건. 학교 폭력이 보험 사고에 해당하는지 여부가 쟁점.",
        "ruling": "학교 폭력에 의한 신체적 상해는 어린이 보험의 상해 조항 적용 대상이 된다. 가해자의 고의성이 보험금 지급에 영향을 미치지 않는다.",
        "key_clauses": {"조항": ["제3조(상해 보험금)", "제4조(면책 사항)"], "핵심쟁점": "학교폭력 상해 보험 적용 여부"},
        "source_url": "https://www.law.go.kr/판례/2022가합22222",
    },
    {
        "case_number": "2024다33333",
        "court_name": "대법원",
        "decision_date": date(2024, 9, 12),
        "case_type": "보험금청구",
        "insurance_type": "실손의료보험",
        "summary": "요양병원 입원 치료비에 대한 실손보험금 청구 사건. 요양병원 입원의 의학적 필요성 판단이 쟁점.",
        "ruling": "요양병원 입원이 의학적으로 필요한 경우 실손보험금 지급 대상이 된다. 단순 요양 목적의 입원은 지급 대상에서 제외될 수 있다.",
        "key_clauses": {"조항": ["제5조(보상하는 입원의료비)", "제6조(보상하지 않는 사항)"], "핵심쟁점": "요양병원 입원 보험 적용 기준"},
        "source_url": "https://www.law.go.kr/판례/2024다33333",
    },
    {
        "case_number": "2023가단44444",
        "court_name": "서울북부지방법원",
        "decision_date": date(2023, 1, 30),
        "case_type": "보험금청구",
        "insurance_type": "펫보험",
        "summary": "반려동물 펫보험 가입 후 선천성 질환 치료비 청구 사건. 선천성 질환이 보험 가입 후 발현된 경우의 보상 여부가 쟁점.",
        "ruling": "반려동물 펫보험에서 선천성 질환이 보험 가입 이후 증상이 발현된 경우에는 기왕증으로 볼 수 없으며 보험금 지급 대상이 된다.",
        "key_clauses": {"조항": ["제4조(보상하는 손해)", "제5조(보상하지 않는 손해)"], "핵심쟁점": "펫보험 선천성 질환 보상"},
        "source_url": "https://www.law.go.kr/판례/2023가단44444",
    },
    {
        "case_number": "2022나55555",
        "court_name": "서울고등법원",
        "decision_date": date(2022, 8, 18),
        "case_type": "보험금청구",
        "insurance_type": "여행자보험",
        "summary": "코로나19 확진으로 인한 여행 취소 손해에 대한 여행자보험금 청구 사건. 전염병이 여행자보험의 약관 상 예상치 못한 사고에 해당하는지 여부가 쟁점.",
        "ruling": "이미 전국적으로 유행 중인 전염병으로 인한 여행 취소는 여행자보험의 보상 범위에 해당하지 않는다. 단 신규 변이 바이러스에 의한 경우 별도 검토가 필요하다.",
        "key_clauses": {"조항": ["제3조(여행 취소 보상)", "제5조(면책 사항)", "제5조 제1항(기예상된 사고)"], "핵심쟁점": "전염병 여행취소 보험 적용"},
        "source_url": "https://www.law.go.kr/판례/2022나55555",
    },
    {
        "case_number": "2024나66666",
        "court_name": "광주고등법원",
        "decision_date": date(2024, 10, 3),
        "case_type": "보험금청구",
        "insurance_type": "수출보험",
        "summary": "수출대금 미회수에 대한 수출보험금 청구 사건. 바이어의 파산과 보험금 청구 시기의 적정성이 쟁점.",
        "ruling": "수출보험금은 바이어의 지급불능 사실이 확인된 날로부터 일정 기간 내에 청구해야 한다. 시효가 경과한 청구는 인정되지 않는다.",
        "key_clauses": {"조항": ["수출보험법 제10조(보험금 청구)", "제12조(청구 시효)"], "핵심쟁점": "수출보험금 청구 시효"},
        "source_url": "https://www.law.go.kr/판례/2024나66666",
    },
    {
        "case_number": "2021다77777",
        "court_name": "대법원",
        "decision_date": date(2021, 12, 23),
        "case_type": "보험금청구",
        "insurance_type": "암보험",
        "summary": "경계성 종양 진단 후 암보험금 청구 사건. 경계성 종양이 약관 상 암에 해당하는지 여부가 쟁점.",
        "ruling": "경계성 종양은 암과 양성 종양의 중간 형태로 약관에서 별도로 규정하지 않는 한 암보험금 지급 대상이 되지 않는다. 단 구체적 사안에 따라 다를 수 있다.",
        "key_clauses": {"조항": ["제2조(암의 정의)", "별표(한국표준질병사인분류 기준)"], "핵심쟁점": "경계성 종양 암보험 적용"},
        "source_url": "https://www.law.go.kr/판례/2021다77777",
    },
    {
        "case_number": "2023가합88888",
        "court_name": "서울동부지방법원",
        "decision_date": date(2023, 12, 11),
        "case_type": "보험금청구",
        "insurance_type": "배상책임보험",
        "summary": "아파트 누수 사고로 인한 배상책임보험금 청구 사건. 누수 원인의 귀책 소재와 보험금 지급 범위가 쟁점.",
        "ruling": "아파트 누수로 인한 이웃 세대 피해에 대한 배상책임보험은 과실이 있는 세대의 보험에서 보상한다. 공용 배관 문제는 관리 주체가 책임진다.",
        "key_clauses": {"조항": ["제3조(보상하는 배상책임)", "제8조(손해 산정)"], "핵심쟁점": "아파트 누수 배상 책임 귀속"},
        "source_url": "https://www.law.go.kr/판례/2023가합88888",
    },
    {
        "case_number": "2022나99999",
        "court_name": "대전고등법원",
        "decision_date": date(2022, 3, 4),
        "case_type": "보험금청구",
        "insurance_type": "단체보험",
        "summary": "회사의 단체보험 계약 해지 후 직원 개인이 계속 보험을 유지할 권리에 관한 분쟁.",
        "ruling": "단체보험 계약 해지 시 개별 피보험자의 전환 권리가 약관에 명시된 경우 이를 보장해야 한다. 회사의 일방적 해지로 인한 피보험자의 손해는 회사가 배상해야 한다.",
        "key_clauses": {"조항": ["제20조(단체 계약 해지)", "제21조(전환 권리)"], "핵심쟁점": "단체보험 해지 시 피보험자 권리"},
        "source_url": "https://www.law.go.kr/판례/2022나99999",
    },
    {
        "case_number": "2024가단10101",
        "court_name": "인천지방법원",
        "decision_date": date(2024, 11, 6),
        "case_type": "보험금청구",
        "insurance_type": "실손의료보험",
        "summary": "비급여 MRI 촬영비에 대한 실손보험금 청구 사건. 의사 지시에 의한 비급여 MRI 비용의 보상 여부가 쟁점.",
        "ruling": "의사의 지시에 따라 시행된 비급여 MRI 검사 비용은 실손보험금 지급 대상이 된다. 진단 목적이 명확한 경우 비급여도 보상한다.",
        "key_clauses": {"조항": ["제5조(보상하는 의료비)", "제5조 제4항(비급여 항목)"], "핵심쟁점": "비급여 MRI 실손 보상"},
        "source_url": "https://www.law.go.kr/판례/2024가단10101",
    },
    {
        "case_number": "2023다20202",
        "court_name": "대법원",
        "decision_date": date(2023, 5, 9),
        "case_type": "보험금청구",
        "insurance_type": "자동차보험",
        "summary": "스쿨존 교통사고에 대한 보험금 가중 지급 여부 분쟁. 민식이법 시행 후 보험사의 가중 배상 책임이 쟁점.",
        "ruling": "스쿨존 사고에 적용되는 특별 규정은 형사 책임에 관한 것이며, 민사 배상 책임은 여전히 과실 비율에 따라 산정한다. 보험금은 실제 손해액 기준으로 지급한다.",
        "key_clauses": {"조항": ["제9조(대인배상 기준)", "특례 조항"], "핵심쟁점": "스쿨존 사고 보험금 산정"},
        "source_url": "https://www.law.go.kr/판례/2023다20202",
    },
    {
        "case_number": "2022가합30303",
        "court_name": "서울서부지방법원",
        "decision_date": date(2022, 6, 20),
        "case_type": "보험금청구",
        "insurance_type": "치아보험",
        "summary": "치과 임플란트 시술 비용에 대한 치아보험금 청구 사건. 임플란트가 약관 상 보상 대상인 보철 치료에 해당하는지 여부가 쟁점.",
        "ruling": "약관에 임플란트 보상에 대한 별도 규정이 없는 경우 보철 치료의 일종으로 볼 수 있으나, 구체적인 약관 내용에 따라 다르게 해석될 수 있다.",
        "key_clauses": {"조항": ["제3조(보상하는 치과치료)", "제5조(보상 범위)"], "핵심쟁점": "임플란트 치아보험 적용"},
        "source_url": "https://www.law.go.kr/판례/2022가합30303",
    },
    {
        "case_number": "2024나40404",
        "court_name": "울산고등법원",
        "decision_date": date(2024, 12, 17),
        "case_type": "보험금청구",
        "insurance_type": "선박보험",
        "summary": "어선 침몰 사고에 대한 선박보험금 청구 사건. 선장의 과실과 불가항력적 기상 악화 중 어느 것이 주된 원인인지가 쟁점.",
        "ruling": "기상 악화가 예측 가능한 범위 내에서도 항해를 강행한 선장의 과실이 인정되면 보험금이 제한될 수 있다. 기상 기록과 전문가 증언을 종합하여 판단한다.",
        "key_clauses": {"조항": ["제4조(보상하는 손해)", "제6조(면책 사항)", "제7조(선박 조종자 과실)"], "핵심쟁점": "선박 사고 과실 판단"},
        "source_url": "https://www.law.go.kr/판례/2024나40404",
    },
    {
        "case_number": "2023가단50505",
        "court_name": "창원지방법원",
        "decision_date": date(2023, 8, 1),
        "case_type": "보험금청구",
        "insurance_type": "실손의료보험",
        "summary": "백내장 수술 시 사용된 다초점 렌즈 비용에 대한 실손보험금 청구 사건. 비급여 특수 렌즈 비용의 보상 여부가 쟁점.",
        "ruling": "백내장 수술 시 사용되는 다초점 렌즈는 의학적 필요성이 인정되는 경우 실손보험금 지급 대상이 될 수 있다. 약관에 명시적 제외 규정이 없어야 한다.",
        "key_clauses": {"조항": ["제5조(보상하는 의료비)", "제6조(보상하지 않는 사항)"], "핵심쟁점": "다초점 렌즈 실손 보상 여부"},
        "source_url": "https://www.law.go.kr/판례/2023가단50505",
    },
    {
        "case_number": "2022다60606",
        "court_name": "대법원",
        "decision_date": date(2022, 2, 10),
        "case_type": "보험금청구",
        "insurance_type": "상해보험",
        "summary": "번지점프 사고로 인한 상해보험금 청구 사건. 위험 스포츠 면책 조항의 번지점프 적용 여부가 쟁점.",
        "ruling": "번지점프는 약관에서 면책으로 열거된 경우에만 면책 사유가 된다. 포괄적 위험 스포츠 조항은 명확성 원칙에 따라 엄격히 해석해야 한다.",
        "key_clauses": {"조항": ["제4조(면책 사항)", "제4조 제5호(위험한 운동)"], "핵심쟁점": "번지점프 면책 조항 적용"},
        "source_url": "https://www.law.go.kr/판례/2022다60606",
    },
    {
        "case_number": "2024가합70707",
        "court_name": "서울중앙지방법원",
        "decision_date": date(2024, 3, 22),
        "case_type": "보험금청구",
        "insurance_type": "사이버보험",
        "summary": "랜섬웨어 피해에 대한 사이버보험금 청구 사건. 랜섬웨어 공격이 사이버 보험의 보상 범위에 해당하는지 여부가 쟁점.",
        "ruling": "랜섬웨어 피해는 사이버보험의 데이터 손상 및 사업 중단 조항에 따라 보상된다. 단 취약점 방치 등 피보험자의 과실이 있는 경우 감액될 수 있다.",
        "key_clauses": {"조항": ["제3조(보상하는 손해)", "제8조(사이버 공격 정의)"], "핵심쟁점": "랜섬웨어 사이버보험 적용"},
        "source_url": "https://www.law.go.kr/판례/2024가합70707",
    },
    {
        "case_number": "2023나80808",
        "court_name": "대구고등법원",
        "decision_date": date(2023, 11, 14),
        "case_type": "보험금청구",
        "insurance_type": "노인장기요양보험",
        "summary": "노인장기요양 등급 판정 거부에 대한 이의신청 및 보험급여 청구 사건.",
        "ruling": "장기요양 등급 판정은 의료적 소견과 일상생활 수행 능력을 종합 고려해야 한다. 부당한 등급 불인정은 행정 소송으로 다툴 수 있다.",
        "key_clauses": {"조항": ["노인장기요양보험법 제15조(등급 판정)", "제23조(이의신청)"], "핵심쟁점": "장기요양 등급 판정 기준"},
        "source_url": "https://www.law.go.kr/판례/2023나80808",
    },
    {
        "case_number": "2024가단90909",
        "court_name": "성남지방법원",
        "decision_date": date(2024, 7, 30),
        "case_type": "보험금청구",
        "insurance_type": "실손의료보험",
        "summary": "성형 수술 후 발생한 합병증 치료비에 대한 실손보험금 청구 사건. 미용 성형 후유증이 실손보험 보상 대상인지 여부가 쟁점.",
        "ruling": "미용 성형 수술 자체는 실손보험 비보상이지만, 수술 후 발생한 의학적 합병증 치료는 별도의 사고로 보아 보상될 수 있다.",
        "key_clauses": {"조항": ["제6조(보상하지 않는 사항)", "제6조 제4호(미용 성형)"], "핵심쟁점": "성형 합병증 실손 보상"},
        "source_url": "https://www.law.go.kr/판례/2024가단90909",
    },
    {
        "case_number": "2021나11223",
        "court_name": "부산고등법원",
        "decision_date": date(2021, 6, 17),
        "case_type": "보험금청구",
        "insurance_type": "재물보험",
        "summary": "홍수로 인한 지하 창고 침수 피해에 대한 재물보험금 청구 사건. 지하 공간 면책 조항의 적용 여부가 쟁점.",
        "ruling": "지하 공간 면책 조항은 보험 계약 체결 시 명확히 설명되어야 한다. 설명 의무 위반이 있는 경우 면책 주장이 제한된다.",
        "key_clauses": {"조항": ["제6조(면책 사항)", "제6조 제3호(지하 공간)"], "핵심쟁점": "지하 공간 침수 면책 여부"},
        "source_url": "https://www.law.go.kr/판례/2021나11223",
    },
    {
        "case_number": "2023다33445",
        "court_name": "대법원",
        "decision_date": date(2023, 7, 6),
        "case_type": "보험금청구",
        "insurance_type": "자동차보험",
        "summary": "렌터카 사고 시 렌터카 회사와 임차인 중 누구의 보험이 우선 적용되는지에 관한 분쟁.",
        "ruling": "렌터카 사고 시 임차인의 자동차보험이 우선 적용되고, 렌터카 회사 보험은 보충적으로 적용된다. 약관에 달리 규정된 경우 그에 따른다.",
        "key_clauses": {"조항": ["제9조(대인배상)", "제14조(중복 보험 처리)"], "핵심쟁점": "렌터카 사고 보험 우선순위"},
        "source_url": "https://www.law.go.kr/판례/2023다33445",
    },
    {
        "case_number": "2024나55667",
        "court_name": "서울고등법원",
        "decision_date": date(2024, 2, 15),
        "case_type": "보험금청구",
        "insurance_type": "운전자보험",
        "summary": "교통사고 피해자의 과실 비율이 높은 경우의 운전자 보험금 지급 분쟁.",
        "ruling": "운전자보험에서 피해자의 과실 비율이 현저히 높더라도 기본적인 대인배상 의무는 면제되지 않는다. 과실 상계 후 잔여 손해에 대해 보험금이 지급된다.",
        "key_clauses": {"조항": ["제9조(대인배상 기준)", "제12조(과실 상계)"], "핵심쟁점": "피해자 과실 비율과 보험금 관계"},
        "source_url": "https://www.law.go.kr/판례/2024나55667",
    },
    {
        "case_number": "2022가합77889",
        "court_name": "서울중앙지방법원",
        "decision_date": date(2022, 1, 28),
        "case_type": "보험금청구",
        "insurance_type": "생명보험",
        "summary": "보험계약자와 피보험자가 상이한 경우 수익자 변경 시 피보험자의 동의 필요 여부에 관한 분쟁.",
        "ruling": "타인의 생명에 관한 보험에서 수익자 변경 시 피보험자의 동의가 필요하다. 동의 없는 수익자 변경은 효력이 없다.",
        "key_clauses": {"조항": ["상법 제731조(타인의 생명 보험)", "제733조(수익자의 변경)"], "핵심쟁점": "수익자 변경 시 피보험자 동의"},
        "source_url": "https://www.law.go.kr/판례/2022가합77889",
    },
    {
        "case_number": "2023가단99001",
        "court_name": "전주지방법원",
        "decision_date": date(2023, 4, 3),
        "case_type": "보험금청구",
        "insurance_type": "실손의료보험",
        "summary": "척추 시술(신경차단술) 비용에 대한 실손보험금 청구 사건. 비급여 척추 시술 비용의 보상 한도가 쟁점.",
        "ruling": "척추 신경차단술이 의학적으로 필요한 경우 실손보험금 지급 대상이 된다. 약관상 연간 한도 내에서 지급하되 한도 설정의 합리성도 검토해야 한다.",
        "key_clauses": {"조항": ["제5조(보상하는 의료비)", "제5조 제7항(도수치료 등 한도)"], "핵심쟁점": "척추 시술 실손 보상 한도"},
        "source_url": "https://www.law.go.kr/판례/2023가단99001",
    },
    {
        "case_number": "2024다11223",
        "court_name": "대법원",
        "decision_date": date(2024, 4, 25),
        "case_type": "보험금청구",
        "insurance_type": "건강보험",
        "summary": "국민건강보험 급여 기준 초과 의료비에 대한 분쟁. 급여 기준 초과로 발생한 본인 부담금의 실손보험 적용 여부가 쟁점.",
        "ruling": "국민건강보험의 급여 기준을 초과하여 발생한 비용은 비급여로 분류되어 실손보험의 비급여 항목으로 청구 가능하다.",
        "key_clauses": {"조항": ["제5조(급여 및 비급여 의료비 구분)", "제7조(비급여 보상 기준)"], "핵심쟁점": "급여 초과 의료비 실손 적용"},
        "source_url": "https://www.law.go.kr/판례/2024다11223",
    },
    {
        "case_number": "2023나22334",
        "court_name": "인천고등법원",
        "decision_date": date(2023, 6, 28),
        "case_type": "보험금청구",
        "insurance_type": "보증보험",
        "summary": "분양 계약 해제 시 분양 보증금 반환 분쟁. 시행사 부도로 인한 분양 보증 이행 청구 사건.",
        "ruling": "분양 보증 이행 청구 요건은 시행사의 사업 불가능이 확정된 시점부터 기산된다. 보증 기관은 보증서에 기재된 범위 내에서 책임을 진다.",
        "key_clauses": {"조항": ["주택도시보증공사 분양 보증 약관 제5조", "제8조(보증 이행)"], "핵심쟁점": "분양보증 이행 청구 시기"},
        "source_url": "https://www.law.go.kr/판례/2023나22334",
    },
    {
        "case_number": "2022가합44556",
        "court_name": "서울중앙지방법원",
        "decision_date": date(2022, 10, 13),
        "case_type": "보험금청구",
        "insurance_type": "자동차보험",
        "summary": "자전거와 자동차 사고에서 자전거 운전자의 과실 비율 산정 분쟁.",
        "ruling": "자전거와 자동차 사고 시 자전거 운전자는 상대적 약자로 보호되어야 하며, 과실 비율 산정 시 이를 고려해야 한다. 자전거 전용도로 침범 여부가 중요한 판단 요소다.",
        "key_clauses": {"조항": ["제12조(과실 비율 산정)", "도로교통법 제13조(자전거 통행)"], "핵심쟁점": "자전거 사고 과실 비율"},
        "source_url": "https://www.law.go.kr/판례/2022가합44556",
    },
    {
        "case_number": "2024가단66778",
        "court_name": "대전지방법원",
        "decision_date": date(2024, 8, 20),
        "case_type": "보험금청구",
        "insurance_type": "실손의료보험",
        "summary": "줄기세포 치료 비용에 대한 실손보험금 청구 사건. 비급여 첨단 치료법의 보상 여부가 쟁점.",
        "ruling": "의학적 안전성과 유효성이 확립되지 않은 줄기세포 치료는 실손보험금 지급 대상이 되지 않는다. 단 식약처 승인을 받은 경우 별도 검토가 필요하다.",
        "key_clauses": {"조항": ["제6조(보상하지 않는 사항)", "제6조 제2호(비급여 비표준 치료)"], "핵심쟁점": "비표준 치료법 실손 보상"},
        "source_url": "https://www.law.go.kr/판례/2024가단66778",
    },
    {
        "case_number": "2023나88990",
        "court_name": "서울고등법원",
        "decision_date": date(2023, 9, 5),
        "case_type": "보험금청구",
        "insurance_type": "생명보험",
        "summary": "실종 선고를 받은 피보험자의 사망 보험금 청구 시기에 관한 분쟁.",
        "ruling": "실종 선고 확정 시 사망으로 간주되므로 실종 선고 확정일을 기준으로 보험금 청구권이 발생한다. 실종 선고 취소 시 보험금 반환 의무가 생길 수 있다.",
        "key_clauses": {"조항": ["제3조(보험금 지급 사유)", "민법 제27조(실종 선고)"], "핵심쟁점": "실종 선고와 사망보험금 청구권"},
        "source_url": "https://www.law.go.kr/판례/2023나88990",
    },
    {
        "case_number": "2024가합00112",
        "court_name": "서울서부지방법원",
        "decision_date": date(2024, 5, 16),
        "case_type": "보험금청구",
        "insurance_type": "의료배상책임보험",
        "summary": "치과 치료 중 신경 손상으로 인한 의료 분쟁 보험금 청구 사건. 시술 합병증과 의료 과실의 구별이 쟁점.",
        "ruling": "치과 시술 중 발생한 신경 손상이 예측 가능한 합병증 범위를 벗어난 경우 의료 과실로 볼 수 있다. 의사의 사전 설명 의무 이행 여부도 판단 기준이 된다.",
        "key_clauses": {"조항": ["제2조(보상하는 손해)", "제5조(의료 과실 판단)"], "핵심쟁점": "치과 치료 합병증과 과실 구별"},
        "source_url": "https://www.law.go.kr/판례/2024가합00112",
    },
    {
        "case_number": "2022다22334",
        "court_name": "대법원",
        "decision_date": date(2022, 12, 29),
        "case_type": "보험금청구",
        "insurance_type": "상해보험",
        "summary": "등산 중 실족 사고로 인한 상해보험금 청구 사건에서 기존 질환(골다공증)의 기여도를 인정하여 보험금을 감액한 보험사 결정에 대한 분쟁.",
        "ruling": "기존 질환이 상해의 발생 또는 악화에 기여한 경우 그 기여도에 따라 보험금을 감액할 수 있다. 단 기여도 산정은 의학적 근거에 기반해야 한다.",
        "key_clauses": {"조항": ["제3조(상해 보험금)", "제10조(기왕증 기여도 감액)"], "핵심쟁점": "기왕증 기여도 감액 기준"},
        "source_url": "https://www.law.go.kr/판례/2022다22334",
    },
]


class PrecedentScraper:
    """보험 관련 법원 판례 스크래퍼 (프로덕션용)

    국가법령정보센터(law.go.kr)와 금융감독원(fss.or.kr)에서
    실시간으로 보험 관련 판례를 수집.
    """

    LAW_BASE_URL = "https://www.law.go.kr"
    FSS_BASE_URL = "https://www.fss.or.kr"

    async def scrape_law_precedents(
        self,
        keyword: str = "보험금",
        max_count: int = 50,
    ) -> list[dict]:
        """국가법령정보센터에서 판례 수집

        Args:
            keyword: 검색 키워드
            max_count: 최대 수집 건수

        Returns:
            판례 데이터 목록
        """
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            logger.warning("playwright 미설치, 스크래핑 불가")
            return []

        precedents = []

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            try:
                page = await browser.new_page()

                # 판례 검색 페이지 접근
                search_url = f"{self.LAW_BASE_URL}/LSW/precSearchR.do?searchKnd=2&viewCnt=20&query={keyword}"
                await page.goto(search_url, wait_until="networkidle", timeout=30000)

                # 검색 결과 항목 파싱
                items = await page.query_selector_all(".search-result-list li")
                logger.info("법령정보센터 검색 결과: %d건", len(items))

                for item in items[:max_count]:
                    try:
                        precedent = await self._parse_law_item(item)
                        if precedent:
                            precedents.append(precedent)
                    except Exception as exc:
                        logger.debug("법령정보센터 항목 파싱 실패: %s", str(exc))

            finally:
                await browser.close()

        return precedents

    async def scrape_fss_decisions(self, max_count: int = 50) -> list[dict]:
        """금융감독원 금융분쟁조정위원회 결정 사례 수집

        Args:
            max_count: 최대 수집 건수

        Returns:
            분쟁 조정 데이터 목록
        """
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            logger.warning("playwright 미설치, 스크래핑 불가")
            return []

        decisions = []

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            try:
                page = await browser.new_page()

                # FSS 분쟁 조정 사례 페이지
                fss_url = f"{self.FSS_BASE_URL}/consumer/bbs/B0000268/list.do?menuNo=900028"
                await page.goto(fss_url, wait_until="networkidle", timeout=30000)

                items = await page.query_selector_all("table tbody tr")
                logger.info("금융감독원 조정 사례: %d건", len(items))

                for item in items[:max_count]:
                    try:
                        decision = await self._parse_fss_item(item)
                        if decision:
                            decisions.append(decision)
                    except Exception as exc:
                        logger.debug("금융감독원 항목 파싱 실패: %s", str(exc))

            finally:
                await browser.close()

        return decisions

    async def _parse_law_item(self, item: object) -> dict | None:
        """법령정보센터 판례 항목 파싱"""
        # 실제 구현은 사이트 구조 확인 후 작성 필요
        return None

    async def _parse_fss_item(self, item: object) -> dict | None:
        """금융감독원 분쟁 조정 항목 파싱"""
        # 실제 구현은 사이트 구조 확인 후 작성 필요
        return None


async def seed_precedents() -> None:
    """현실적인 판례 50개를 DB에 시드"""
    from sqlalchemy import select

    from app.core.config import Settings
    from app.core.database import init_database, session_factory
    from app.models.case_precedent import CasePrecedent

    settings = Settings()  # type: ignore[call-arg]
    await init_database(settings)

    if session_factory is None:
        logger.error("데이터베이스 초기화 실패")
        return

    async with session_factory() as db:
        # 이미 존재하는 판례 번호 조회
        stmt = select(CasePrecedent.case_number)
        result = await db.execute(stmt)
        existing_numbers = {row[0] for row in result.fetchall()}
        logger.info("기존 판례 수: %d개", len(existing_numbers))

        new_precedents = []
        for data in SEED_PRECEDENTS:
            if data["case_number"] in existing_numbers:
                logger.debug("이미 존재: %s", data["case_number"])
                continue

            precedent = CasePrecedent(
                case_number=data["case_number"],
                court_name=data["court_name"],
                decision_date=data["decision_date"],
                case_type=data["case_type"],
                insurance_type=data.get("insurance_type"),
                summary=data["summary"],
                ruling=data["ruling"],
                key_clauses=data.get("key_clauses"),
                source_url=data.get("source_url"),
            )
            new_precedents.append(precedent)

        if not new_precedents:
            logger.info("추가할 신규 판례 없음")
            return

        db.add_all(new_precedents)
        await db.flush()

        logger.info("DB 저장 완료: %d개 판례", len(new_precedents))

        # 임베딩 생성 (OpenAI API 키가 있는 경우)
        if settings.openai_api_key:
            await _embed_precedents(db, new_precedents, settings)
        else:
            logger.warning("OPENAI_API_KEY 없음. 임베딩 없이 저장됩니다.")

        await db.commit()

        print(f"\n{'='*50}")
        print("판례 시드 완료")
        print(f"{'='*50}")
        print(f"신규 판례:  {len(new_precedents)}개")
        print(f"전체 판례:  {len(existing_numbers) + len(new_precedents)}개")
        print(f"{'='*50}\n")


async def _embed_precedents(
    db: object,
    precedents: list,
    settings: object,
) -> None:
    """판례 임베딩 벡터 생성 및 저장

    Args:
        db: 데이터베이스 세션
        precedents: 임베딩할 CasePrecedent 목록
        settings: 애플리케이션 설정
    """
    from app.services.rag.embeddings import EmbeddingService

    embedding_service = EmbeddingService(
        api_key=getattr(settings, "openai_api_key", ""),
        model=getattr(settings, "embedding_model", "text-embedding-3-small"),
        dimensions=getattr(settings, "embedding_dimensions", 1536),
    )

    # 임베딩용 텍스트 구성 (요약 + 판결 요지)
    texts = [
        f"판례번호: {p.case_number}\n법원: {p.court_name}\n{p.summary}\n\n판결: {p.ruling}"
        for p in precedents
    ]

    logger.info("판례 임베딩 생성 시작: %d개", len(texts))

    vectors = await embedding_service.embed_batch(texts)

    embedded_count = 0
    for precedent, vector in zip(precedents, vectors):
        if vector:
            precedent.embedding = vector
            embedded_count += 1

    logger.info("판례 임베딩 완료: %d/%d개", embedded_count, len(precedents))


def main() -> None:
    """CLI 진입점"""
    parser = argparse.ArgumentParser(
        description="보험 판례 수집 및 시드 스크립트",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
사용 예시:
  python scripts/seed_precedents.py seed
  python scripts/seed_precedents.py scrape --source law
  python scripts/seed_precedents.py scrape --source fss
        """,
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    # seed 서브커맨드
    subparsers.add_parser("seed", help="개발용 판례 50개 시드 (오프라인)")

    # scrape 서브커맨드
    scrape_parser = subparsers.add_parser("scrape", help="실시간 판례 스크래핑 (프로덕션)")
    scrape_parser.add_argument(
        "--source",
        choices=["law", "fss"],
        required=True,
        help="스크래핑 소스 (law: 국가법령정보센터, fss: 금융감독원)",
    )
    scrape_parser.add_argument(
        "--keyword",
        default="보험금",
        help="검색 키워드 (기본값: 보험금)",
    )
    scrape_parser.add_argument(
        "--max",
        type=int,
        default=50,
        help="최대 수집 건수 (기본값: 50)",
    )

    args = parser.parse_args()

    try:
        if args.command == "seed":
            asyncio.run(seed_precedents())

        elif args.command == "scrape":
            async def do_scrape() -> None:
                scraper = PrecedentScraper()
                if args.source == "law":
                    results = await scraper.scrape_law_precedents(
                        keyword=args.keyword,
                        max_count=args.max,
                    )
                else:
                    results = await scraper.scrape_fss_decisions(max_count=args.max)

                logger.info("스크래핑 완료: %d건 수집", len(results))

            asyncio.run(do_scrape())

    except KeyboardInterrupt:
        logger.info("사용자 중단 요청")
        sys.exit(0)
    except Exception as exc:
        logger.error("판례 스크립트 실행 실패: %s", str(exc), exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
