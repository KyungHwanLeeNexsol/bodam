// 환자에게 보이는 고정 문구의 단일 출처 (SPEC-REIMBURSEMENT-001 M6, BRIEF D9). 문구는 디자인 저장본(.pen)과 기획서 §4·§13.2 에서 그대로 옮겼다.
// 디자인에 프레임이 없어 이 단계가 만든 문구는 "(파생)" 으로 표시했고, 최종 보고의 "그리지 않고 만든 화면" 목록에 적는다.
// 환자 문구에는 내부 코드(PROFILE_·MAPPING_·LINE_·오류 코드)·"N" 같은 기호·참고 그룹 값을 넣지 않는다. 1544-8069 은 문장으로만 쓰고 이 단계 문구에는 없다.

/** 서류 화면의 안내 문장 (기획서 §4): 원인 모름에서 전용 줄이 하나도 없을 때도 같은 문장을 쓴다. */
const COPY_HINT_BASE = '서류는 병원 원무과에서 발급합니다. 보험사와 상품에 따라 추가 서류를 요구할 수 있습니다.';

export const COPY = {
  /** catalog 응답이 오기 전(또는 응답이 없을 때)의 서비스 이름. 응답이 있으면 serviceDisplayName 을 쓴다. */
  serviceName: '보담',
  serviceDescription: '실손보험 예상 부담액 안내',
  largeTextToggle: '큰 글자 보기',

  /** 입력 단계 이름 (AC-012a: 1/4 실손보험 · 2/4 보험사 형태 · 3/4 치료 원인 · 4/4 치료 선택). */
  steps: ['실손보험', '보험사 형태', '치료 원인', '치료 선택'],
  /** 단계 표시(StepIndicator)의 영역 이름(화면 낭독기용). */
  stepsLabel: '진행 단계',

  start: {
    guide: '선택한 보험 조건으로 치료비와 예상 부담액을 확인해 보세요.',
    startButton: '시작하기',
    hint: '화면을 손가락으로 터치해서 이용하세요. 로그인이나 개인정보 입력은 필요하지 않습니다.',
    /** 이용 순서 칩 목록의 영역 이름(화면 낭독기용). */
    flowLabel: '이용 순서',
    /** 가로형·큰 글자 보기의 세로 목록 칩 이름(L_K00_Start 프레임 그대로: 앞의 셋은 "선택"이 붙고 넷째는 "치료 선택" 그대로다). */
    stackedSteps: ['실손보험 선택', '보험사 형태 선택', '치료 원인 선택', '치료 선택'],
  },

  buttons: {
    retry: '다시 시도',
    previous: '이전',
    next: '다음',
    home: '처음으로',
  },

  resetConfirm: {
    title: '선택 내용을 지우고 처음으로 돌아갈까요?',
    body: '지금까지 선택한 보험 조건과 치료가 모두 지워집니다.',
    cancel: '계속 이용',
    confirm: '처음으로',
  },

  timeoutDialog: {
    countdownLabel: '남은 시간',
    countdownUnit: '초',
    title: '계속 사용하시겠어요?',
    /** 남은 초를 넣는다. 디자인은 "20초 후 처음 화면으로 돌아갑니다. …". */
    body: (seconds: number): string => `${seconds}초 후 처음 화면으로 돌아갑니다. 지금까지 선택한 내용은 모두 지워집니다.`,
    // 디자인의 안내문 끝 문장("경고는 입력 화면 무입력 100초, 결과 화면 무입력 160초 시점에 표시합니다.")은 병원 정책(catalog.idlePolicy)이 다르면 틀린 수치가 되어 싣지 않는다.
    note: '‘계속 사용할게요’를 누르면 남은 시간을 처음부터 다시 셉니다. 연장 횟수 제한은 없습니다.',
    reset: '처음으로',
    continue: '계속 사용할게요',
  },

  // ───── 입력 단계 (디자인 K01·K02·K02b·K03 프레임의 문구 그대로. "(파생)" 은 프레임이 없어 이 단계가 만든 문구) ─────
  input: {
    selected: '선택됨',
    generation: {
      title: '내 실손보험을 선택해 주세요',
      subtitle: '가입하신 시기에 맞는 카드를 하나 눌러 주세요.',
      /** 가입 시기를 알 수 없을 때 가는 안내 화면으로의 버튼 (디자인 프레임의 "Help 세대를 모르겠어요"). */
      unknownButton: '세대를 모르겠어요',
      periodPrefix: '가입기간 ',
      helpTitle: '가입 시기를 모르실 때',
      /** 인수 기준(AC-012d·AC-012h, 기획서 §4 화면 1)의 버튼 이름. 디자인 저장본에서는 이 패널의 동작이 숨겨져 있다 — 보고 참고. */
      helpAction: '확인 방법 보기',
      /** plan.md §E #35: 2009.08~09 경계 계약 도움말의 문구와 위치는 소유자 확정 전이다. 2026-11-04 소유자 지시로 시험 미리보기에서는 이 한 줄만 보인다. 보험 설명을 지어내지 않고, 가입일로 세대를 정하거나 제안하지 않는다. */
      boundaryPending: '가입 시기 경계 안내: 문구 검토 중',
    },
    generationHelp: {
      title: '보험 세대가 특정되지 않으면 정확한 안내가 어렵습니다',
      body: '아래 방법으로 가입 시기를 확인한 뒤 앞 화면에서 세대를 선택해 주세요.',
      steps: [
        { title: '보험증권 · 보험사 앱에서 가입일을 확인해 주세요', desc: '가입일이 확인되면 앞 화면에서 세대를 선택할 수 있습니다.' },
        // plan.md §E #32: 1544-8069 의 운영 주체·상담 시간은 소유자 확정 전이다(2026-11-04 지시: 지어내지 않고 미확정으로 표시). 번호는 문구로만 있고 1588 번호는 없다.
        { title: '확인이 어려우면 1544-8069로 문의해 주세요', desc: '번호는 안내 문구이며 키오스크에서 전화가 걸리지는 않습니다. 운영 주체와 문의 가능 시간은 확인 중입니다.' },
      ],
      back: '보험 선택으로 돌아가기',
    },
    type: {
      title: '실손보험이 가입된 보험사의 형태를 선택해 주세요',
      hint: '어디에 가입했는지 모르시면 접수 직원에게 문의해 주세요.',
    },
    cause: {
      title: '어떤 일로 병원에 오셨나요?',
      subtitle: '청구에 필요한 서류를 안내하기 위해 여쭤봅니다. 예상 금액은 달라지지 않습니다.',
      hint: '다친 경우와 병으로 치료받는 경우에 보험사가 요구하는 서류가 다릅니다.',
    },
    treatments: {
      title: '확인할 치료를 선택해 주세요',
      subtitle: '여러 개를 선택할 수 있습니다. 카드를 다시 누르면 선택이 해제됩니다.',
      keepHint: '다른 목록 페이지로 넘어가도 이미 선택한 치료는 그대로 유지됩니다.',
      /** 확인 버튼이 비활성인 이유 (디자인 K03_Treatments_Empty 의 "Empty Hint"). */
      emptyHint: '치료를 1개 이상 선택하면 예상 부담액을 확인할 수 있습니다.',
      /** 4단계 주 버튼. */
      confirm: '예상 부담액 확인',
      benefit: '급여',
      nonBenefit: '비급여',
      /** 디자인은 "환자 결제액(예시)" — "(예시)" 는 디자인 예시 데이터라는 뜻이라 운영 화면에는 기획서 §6 의 표현("환자 예상 결제액")을 쓴다 (파생). */
      priceCaption: '환자 예상 결제액',
      selectedCount: (count: number): string => `선택한 치료 ${count}개`,
      breakdown: (benefit: string, nonBenefit: string): string => `급여 ${benefit} · 비급여 ${nonBenefit}`,
      totalLabel: '총 예상 결제액',
      /** 선택 요약 영역의 이름(화면 낭독기용). */
      summaryLabel: '선택 요약',
      /** 가로형 선택 패널 (L_K03_Treatments). */
      panelCount: '선택한 치료',
      panelBenefit: '급여 합계',
      panelNonBenefit: '비급여 합계',
      /** 새 가격·규칙으로 목록이 바뀌어 보일 치료가 없을 때 (파생). */
      noneAvailable: '지금 선택할 수 있는 치료가 없습니다.\n접수 직원에게 문의해 주세요.',
      pager: {
        previous: '이전 목록',
        next: '다음 목록',
        /** 쪽 넘김 영역의 기본 이름(화면 낭독기용). */
        label: '치료 목록 쪽',
        status: (page: number, count: number): string => `${page} / ${count} 페이지`,
      },
    },
    /** 자료 갱신(409·422 뒤) 안내. 디자인에 프레임이 없어 이 단계가 만든 문구다(파생). 내부 코드·상태 번호·금액 0원을 싣지 않는다. */
    refresh: {
      runningTitle: '가격과 보험 기준을 다시 확인하고 있어요',
      runningBody: '확인이 끝나면 예상 부담액 확인을 다시 눌러 주세요.',
      failedTitle: '최신 정보를 불러오지 못했어요',
      failedBody: '통신 오류로 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.\n계속 안 되면 접수 직원에게 문의해 주세요.',
      retry: '다시 시도',
      removedTitle: '더 이상 선택할 수 없는 치료를 목록에서 뺐어요',
      removedBody: '가격이 바뀌었을 수 있으니 예상 부담액 확인을 다시 눌러 주세요.',
    },
  },

  // ───── 계산 중·결과·통신 오류 (S3a: 디자인 KXX_Loading_Calculating·K04_Result·K04_Result_NotCovered·KXX_Error_Network 와 기획서 §4 의 문구 그대로. "(파생)" 은 프레임이 없어 이 단계가 만든 문구) ─────
  calculating: {
    title: '예상 금액을 계산하고 있습니다',
    body: '잠시만 기다려 주세요.\n계산이 끝나면 결과 화면으로 넘어갑니다.',
    note: '계산 중에는 버튼이 비활성화되어 중복 실행되지 않습니다.',
    busy: '계산 중…',
  },

  networkError: {
    barLabel: '연결 상태',
    badge: '통신 오류',
    title: '계산하지 못했어요',
    // 둘째 줄의 "0원" 은 금액 표시가 아니라 "0원이라는 뜻이 아니다"를 알리는 디자인 문장이다(KXX_Error_Network 프레임 그대로). 금액을 보이는 자리가 이 화면에는 없다.
    body: '통신 오류로 보험 계산 정보를 불러오지 못했습니다.\n예상 보험금이 0원이라는 뜻이 아닙니다. 잠시 후 다시 시도해 주세요.\n계속 안 되면 접수 직원에게 문의해 주세요.',
    retry: '다시 시도',
    finish: '이용 종료',
  },

  result: {
    barLabel: '예상 결과 안내',
    /** 보류 결과에도 같은 제목을 쓴다(파생: 보류 전용 제목 문구가 문서에 없다. plan.md §E #23 의 확인 대상). */
    title: '선택한 조건의 예상 금액입니다',
    badgeExample: '예시 계산',
    badgePartlyExcluded: '일부 항목 보장 제외',
    /** 보류 결과의 상태 표시. "산출 보류" 는 기획서 §4 "결과 상태별 표시" 표의 이름이다. */
    badgeHold: '산출 보류',
    /** 운영이 아닌 자료(origin !== OPERATING)로 계산한 결과의 상단 표시 (AC-010e, plan.md §E #22). 문구는 2026-11-04 소유자 지시로 정했다("예시" + 실제 안내에 쓸 수 없다는 문장). 운영 문구의 최종 승인은 아니다. */
    testData: '테스트 데이터로 계산한 예시입니다. 실제 보험금 안내에 사용할 수 없습니다.',
    conditionInsurance: '보험 조건',
    conditionTreatments: '선택한 치료',
    hospital: { label: '예상 병원 결제액', note: '오늘 병원 창구에서 결제하는 금액입니다.' },
    payout: { label: '예상 보험금', note: '보험사에 청구한 뒤 받는 예상 금액입니다.' },
    // 세 번째 금액은 오늘 병원에 낼 돈이 아니다. 이름과 보조 설명이 모든 결과 화면(정상·보장 제외·보류·가로)에서 같다(기획서 §4).
    afterPayout: { label: '보험금 수령 후 예상 본인 부담', note: '보험금을 받은 뒤 남는 예상 부담액이며, 오늘 병원에 결제할 금액이 아닙니다.' },
    /** 결과 문구 원칙 (기획서 §4, DD-22): 정상·보장 제외 결과에만 쓴다. */
    principle: '표준 공제·한도 가정으로 계산한 예상 금액입니다. 실제 지급액은 가입 담보와 보험사 심사 결과에 따라 달라집니다. 자세한 계산 과정은 아래 ‘계산 근거 보기’에서 확인하세요.',
    /** 개인 계약 조건 문장: 정상·보장 제외 결과의 공통 안내 끝 문장이고, 보류 결과는 이 문장만 쓴다(DD-07). */
    personalContract: '개인별 부담보, 면책·보장기간, 잔여 한도·횟수, 치료 목적 및 심사 결과에 따라 실제 지급액이 달라질 수 있습니다.',
    commonLead: '입력하신 세대·보험사 형태와 표준 가정을 기준으로 예상 금액을 안내합니다.',
    exclusion: {
      title: '보장 제외 항목',
      /** 가정 코드 REMAINING_COVERED_AND_LIMIT_REMAINS (기획서 §4 "나머지 항목은 보장 대상이고 한도가 남아 있다고 가정"). */
      remaining: '나머지 항목은 보장 대상이고 한도가 남아 있다고 가정합니다.',
      /** 가정 코드 REMAINING_LIMIT_ASSUMED (기획서 §4 "한도·횟수가 남아 있다는 가정" 별도 표시). */
      limit: '한도·횟수가 남아 있다고 가정합니다.',
      /** 제외 항목 한 줄: 이름, 금액, 예상 보험금 0원이 아니라 "보장 제외" 표시. */
      excludedTag: '보장 제외',
    },
    hold: {
      /** 보류 줄을 묶어 보이는 패널의 제목 (파생: 문서에 제목이 없다. 분류 문구 자체는 DD-21 초안이다). */
      panelTitle: '확인이 필요한 내용',
      /** 환자용 보류 분류 문구 (DD-21 표 왼쪽 열 초안, plan.md §E #23 의 소유자 확인 대상). 키와 내부 코드의 짝은 hold-reasons.ts 가 안다. */
      classes: {
        SETUP: '표준 가정 자료가 아직 준비되지 않았습니다',
        MAPPING: '이 치료의 보장 분류를 검토하고 있습니다',
        CLASSIFICATION: '이 치료의 분류 확인이 필요합니다',
        PRICE: '이 치료의 가격 자료 확인이 필요합니다',
      },
    },
    actions: {
      documents: '보험 청구에 필요한 서류 확인',
      basis: '계산 근거 보기',
      reselect: '치료 다시 선택',
      editInsurance: '보험 조건 수정',
      home: '처음으로',
      complete: '이용 완료',
    },
    /** 저장된 응답이 없는 결과 화면(일어나지 않는 상태의 방어, 파생). 0원이나 빈 결과를 그리지 않는다. */
    unavailable: { title: '결과를 보여 드리지 못했어요', body: '처음으로 돌아가 다시 확인해 주세요.' },
  },

  // ───── 계산 근거·필요 서류·이용 완료 (S3b: 디자인 K04_Basis_Calculation·K07_Documents·K07_Documents_Unknown·K06_Complete 와 기획서 §4·DD-22 의 문구. "(파생)" 은 프레임이 없어 이 단계가 만든 문구) ─────
  // 디자인 프레임의 예시 문장("아래 값은 디자인 예시입니다 …", "… 구현 단계에서 검토된 규칙 데이터와 연결합니다.")과 예시 값(의원 외래 고정 공제 …)은 싣지 않는다(plan.md §E #27): 화면의 값은 응답의 값뿐이다.
  sheet: {
    /** 근거·서류 화면의 하단 동작 (디자인 "결과로 돌아가기"·"이용 완료" + 모든 화면의 "처음으로", 기획서 §13.2). */
    back: '결과로 돌아가기',
    complete: '이용 완료',
    /** 화면 낭독기용: 서류 줄이 이번 청구에 필요한가를 색이 아닌 글로 알린다. */
    required: '필요',
    notRequired: '이번 청구에는 필요하지 않음',
  },

  basis: {
    barLabel: '계산 근거',
    title: '예상 금액을 이렇게 계산했습니다',
    // 디자인 부제는 예시 문장이라 싣지 않는다. 이 문장은 DD-22 ("입력으로 확인한 것·가정으로 적용한 것")를 한 줄로 알리는 파생 문구다.
    subtitle: '고르신 조건과 표준 가정을 기준으로 계산한 예시 과정입니다.',
    conditionCause: '치료 원인',
    treatmentsLabel: '선택한 치료 표',
    treatmentHead: ['치료', '구분', '환자 결제액', '보장 대상 여부'],
    benefit: '급여',
    nonBenefit: '비급여',
    covered: '보장 대상',
    excluded: '보장 제외',
    unconfirmed: '확인 필요',
    hospitalTotal: '예상 병원 결제액 합계',
    stepsLabel: '공제·한도 적용 표',
    stepsHead: ['공제·한도 적용', '금액'],
    groupTitle: (index: number): string => `계산 묶음 ${index}`,
    coveredTotal: '보장 대상 치료비 합계',
    deduction: '공제(가정)',
    deductionApplied: '실제 적용 공제',
    limit: '지급한도(가정)',
    unlimited: '한도 없음',
    groupPayout: '지급액',
    pooledPayout: '공유 한도 적용 후 지급액',
    payout: '예상 보험금',
    assumptionTitle: '적용한 계산 가정',
    /** STANDARD_PROFILE_APPLIED: 보험 조건 이름(세대·보험사 형태)이 있으면 넣는다. */
    standardProfile: (label: string | null): string => (label === null ? '환자에게 묻지 않고 표준 가정값을 적용했습니다.' : `환자에게 묻지 않고 ${label} 표준 가정값을 적용했습니다.`),
    allCovered: '선택한 치료가 모두 보장 대상이고 한도가 남아 있다고 가정했습니다.',
    /** 확인하지 않은 전제 (DD-22): 개인 계약 값을 확인한 값처럼 쓰지 않는다. */
    uncheckedPremise: '개인별 공제·한도·특약·잔여 한도·면책 기간·부담보는 묻거나 조회하지 않았습니다. 실제 계약은 위 가정과 다를 수 있습니다.',
    sourcesTitle: '약관 출처',
    sourceRevision: (date: string): string => `${date} 개정`,
    unavailable: { title: '계산 근거를 보여 드리지 못했어요', body: '처음으로 돌아가 다시 확인해 주세요.' },
  },

  documents: {
    barLabel: '필요 서류 안내',
    badge: '예시 기준',
    title: '청구에 필요한 서류입니다',
    subtitleSingle: '입력하신 내용과 선택한 치료를 기준으로 자동으로 정리했습니다.',
    subtitleUnknown: '치료 원인을 고르지 않으셔서 상해일 때와 질병일 때를 나눠서 안내합니다.',
    claimKey: '청구 기준',
    treatmentsKey: '선택한 치료',
    /** 청구 기준 요약의 조각: 원인 · 보험사 형태 · 진료 형태(의원은 통원 전용, DD-06 clinicSetting). */
    causeInjury: '상해',
    causeIllness: '질병',
    causeUnknown: '상해 또는 질병 (선택 안 함)',
    setting: '통원',
    listHead: '서류 9가지 중 이번 청구에 필요한 항목에 체크했습니다.',
    groupCommon: '공통으로 필요한 서류',
    branchHead: '치료 원인에 따라 추가되는 서류 (해당하는 쪽만 받으세요)',
    groupInjury: '다쳐서 오셨다면 (상해)',
    groupIllness: '아파서 오셨다면 (질병)',
    hintBase: COPY_HINT_BASE,
    /** 원인 모름의 안내: 상해 쪽·질병 쪽 전용 줄 이름을 실제 응답에서 받아 넣는다 (줄 이름을 문장에 적어 두지 않는다). */
    hintUnknown: (injury: readonly string[], illness: readonly string[]): string => {
      const branch = [...(injury.length === 0 ? [] : [`다쳐서 오셨으면 ${injury.join('·')}`]), ...(illness.length === 0 ? [] : [`아파서 오셨으면 ${illness.join('·')}`])];
      if (branch.length === 0) return COPY_HINT_BASE;
      // 서류 이름은 모두 모음으로 끝나 목적격 조사는 "를"이다 (고정 아홉 줄 이름, view/documents-view.ts 의 DOCUMENT_NAME).
      return `${branch.join(', ')}를 함께 받으세요. 서류는 병원 원무과에서 발급하며, 보험사와 상품에 따라 추가 서류를 요구할 수 있습니다.`;
    },
    pagerLabel: '서류 목록 쪽',
    /** 규칙을 쓸 수 없을 때(plan.md §E #18 의 SPEC 제안): 목록도 지어낸 서류도 없다. 접수 직원 문의는 문장이며 버튼이 아니다. */
    unavailable: {
      title: '필요 서류 목록을 안내하지 못했어요',
      body: '서류는 병원 원무과에서 발급합니다. 보험사와 상품에 따라 필요한 서류가 다를 수 있으니\n접수 직원에게 문의해 주세요.',
    },
  },

  complete: {
    title: '이용해 주셔서 감사합니다',
    erased: '선택하신 보험 조건과 치료 내용은 모두 지워졌습니다.',
    /** completionHoldSeconds 가 양수일 때만 쓴다. null 이면 자동 복귀가 없으므로 이 문장을 쓰지 않는다. */
    autoReturn: '잠시 후 첫 화면으로 돌아갑니다.',
    /** completionHoldSeconds 가 null 일 때의 파생 문장(디자인 프레임은 자동 복귀 문장만 있다). */
    manualReturn: '아래 ‘처음 화면으로’ 버튼을 눌러 주세요.',
    note: '다음 환자에게 이전 선택 내용과 금액이 보이지 않습니다.',
    start: '처음 화면으로',
  },

  // ───── 스크롤 안내 (제안: 기획서·디자인에 없는 문장이다. plan.md §E 의 문구 확인 대상) ─────
  scroll: {
    /** 본문이 한 화면에 안 들어가 아래에 더 있을 때만 보이는 단서. */
    cue: '아래에 더 있어요',
    /** 스크롤되는 본문의 접근 가능한 이름(키보드·화면 낭독기). */
    regionLabel: '화면 내용',
    /** 입력 화면은 영역이 겹친다(본문 안에 선택 목록과 부속 안내): 서로 구별되는 이름을 쓴다. */
    inputBodyLabel: '입력 화면 전체',
    inputChoicesLabel: '고를 수 있는 항목',
    inputAsideLabel: '함께 보는 안내',
  },

  // ───── 시작 단계의 비정상 상태 (파생: 디자인에 프레임이 없다. KXX_Error_Network·KXX_Loading_Calculating 의 구성과 문장 결을 따랐다) ─────
  bootstrap: {
    loading: {
      title: '병원 정보를 불러오고 있어요',
      body: '잠시만 기다려 주세요.',
    },
    notFound: {
      title: '이 화면은 이용할 수 없어요',
      body: '병원 안내 정보를 찾지 못했습니다.\n접수 직원에게 문의해 주세요.',
    },
    loadFailed: {
      barLabel: '연결 상태',
      badge: '통신 오류',
      title: '정보를 불러오지 못했어요',
      body: '통신 오류로 병원 정보를 불러오지 못했습니다.\n잠시 후 다시 시도해 주세요.\n계속 안 되면 접수 직원에게 문의해 주세요.',
    },
    noTreatments: {
      title: '지금은 안내할 수 있는 치료가 없어요',
      body: '예상 부담액을 안내할 치료 정보가 아직 준비되지 않았습니다.\n접수 직원에게 문의해 주세요.',
    },
  },
} as const;
