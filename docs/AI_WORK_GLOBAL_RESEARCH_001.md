# AI-WORK Global Research — Decision Record 001

이 문서는 `#001` Automation을 결정하기까지의 시장조사 Decision Record다.
구체적인 조회수, 펀딩액, 제품 통계, URL 등 검증되지 않은 수치는 포함하지 않는다.
이 문서의 목적은 조사 결론과 의사결정 구조를 보존하는 것이다.

---

## 조사 목적

AI-WORK의 첫 Automation(`#001`)으로 무엇을 선택할지 결정하기 위해,
실제로 반복되는 업무 문제군을 조사하고 후보를 압축한다.
전체 플랫폼 설계가 아니라 하나의 독립 Automation을 검증 가능한 형태로
선정하는 것이 목적이다.

## 조사 범위 / 권역

글로벌 범위에서 반복적으로 언급되는 업무 자동화 수요를 조사했다.
특정 국가/플랫폼 하나에 한정하지 않고, 여러 시장에서 공통적으로
나타나는 패턴을 우선한다.

## 사용한 Evidence 유형

* MARKET — 실제 시장에서 반복적으로 관찰되는 수요/문제 패턴
* PATTERN — 여러 사례에서 공통적으로 나타나는 업무 구조
* AI-WORK ORIGINAL — 위 두 가지를 바탕으로 AI-WORK가 자체적으로 정의한
  업무 재구성 관점 (Evidence 기반 Action extraction 등)

이 구분은 후보 평가 시 "시장에 실제로 존재하는 문제인가"와
"AI-WORK가 다르게 풀 수 있는 지점이 있는가"를 분리해서 보기 위함이다.

## 발견한 주요 문제군

반복적으로 강하게 확인된 문제군:

* 매출 / Excel 분석
* 고객 리뷰 / Feedback 분석
* Lead / 문의 우선순위
* CS 반복 문제 탐지
* 문서 / Invoice 처리
* 회의 / 영업 후속업무
* Data → Report

## Candidate 20 → TOP 10 → TOP 3

초기 후보 20개를 구성하고, 실제 반복성/명확성/AI 부가가치/구현 난이도를
기준으로 TOP 10으로 압축한 뒤, 다시 TOP 3으로 압축했다.

TOP 3:

1. Sales Data → Anomaly Diagnosis
2. Customer Inquiry → Priority Action
3. Customer Feedback → Action

## A vs C 최종 비교

TOP 3 중 두 후보(Sales Data → Anomaly Diagnosis, Customer Feedback → Action)를
심층 비교했다.

* **Sales Data → Anomaly Diagnosis**: 업무 가치는 명확하지만 데이터 형식/컬럼
  구조가 회사마다 크게 달라 초기 MVP의 Input 정의가 상대적으로 어렵고,
  "이상 징후"의 기준을 코드/AI 어느 쪽이 얼마나 책임질지 경계가 덜 명확하다.
* **Customer Feedback → Action**: Input(리뷰 텍스트)이 형식적으로 단순하고,
  Result(반복 불만/요청/Action)가 화면에서 Before/After로 직관적으로
  보여줄 수 있으며, 외부 연동 없이 구현 난이도가 낮다(S).

비교 결과 `#001 — Customer Feedback → Action`을 최종 선정한다.

## #001 선정 이유

* Input → Result가 매우 명확하다.
* 구현 난이도 S.
* OAuth / DB / Runner / Webhook / 외부 Action이 필요 없다.
* 실제 업무 가치가 있다.
* 리뷰 Before → Action After 콘텐츠가 직관적이다.
* 단순 sentiment analysis가 아니라 Evidence 기반 Action extraction으로
  업무 정의를 좁힐 수 있다.
* 특정 LLM 제품 자체보다 업무 Workflow가 중심이다.
* 이후 상품기획, CS, 경쟁상품 분석 등으로 Evidence 기반 확장이 가능하지만
  현재는 확장하지 않는다.

## 보존할 Later 후보

* Sales Data → Anomaly Diagnosis
* Weekly Management Brief
* Product Sales Diagnosis
* Customer Problem Integrated Analysis
* Lead / Inquiry Priority Analysis
* Sales Follow-up Action
* Data → Report

## 초기 제외 후보와 이유

시장성은 있지만 초기에는 뒤로 두는 후보:

* WhatsApp Agent
* AI Phone Sales
* CRM Autonomous Operation
* Automatic Social Publishing
* Booking Agent
* Browser Task Delegation

이유: OAuth / API / Webhook / account state / external action / retry /
uncertain / background execution 등의 복잡도가 초기 검증에 불필요하다.

## Candidate Gate에 추가된 질문

향후 새로운 Automation 후보를 평가할 때, 다음 질문이 Candidate Gate에
포함된다.

> 사용자가 그냥 범용 ChatGPT에 파일을 올리고 한 문장 입력하는 것과
> 무엇이 다른가?

이 질문에 명확한 답이 없다면 우선순위를 낮추거나 만들지 않는다.
