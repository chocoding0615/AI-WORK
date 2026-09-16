# #001 — Customer Feedback → Action

이 문서는 `#001`의 Scope Lock + Acceptance Contract다.
이 문서를 범용 Automation template/framework로 만들지 않는다.
이것은 첫 실제 Contract v1이다.

---

## Problem

리뷰가 많아지면 사람이 전체 리뷰를 읽고 반복되는 불만, 칭찬, 요구사항을
파악하기 어렵다. 단순 긍정/부정 요약이 아니라 다음 질문에 답한다.

> 고객들이 반복해서 무엇을 말하고 있고, 그래서 무엇부터 고쳐야 하는가?

## User

첫 MVP 사용자: 온라인에서 상품 또는 서비스를 판매하고 고객 리뷰 데이터를
가지고 있는 사람. 초기 MVP에서는 세부 Persona를 더 확장하지 않는다.

## Input

CSV 파일 하나.

Required column:

```text
review
```

Optional:

```text
rating
product
date
```

초기 제한:

```text
Maximum 300 reviews
```

현재는 다음을 지원하지 않는다.

* XLSX
* URL
* scraping
* Amazon direct connection
* Coupang direct connection
* Naver direct connection

## Process

```text
CSV
 ↓
Validate
 ↓
Normalize reviews
 ↓
AI structured classification
 ↓
Code aggregate / count / sort
 ↓
AI interpretation / action extraction
 ↓
Result validation
 ↓
RESULT
```

### Code Ownership

* CSV parsing
* required field validation
* empty review removal
* counting
* aggregation
* sorting
* deterministic calculations
* output validation

### AI Ownership

* review meaning understanding
* theme classification
* praise / complaint / request classification
* evidence-theme association
* interpretation
* action recommendation

AI가 임의의 통계 수치를 생성하게 하지 않는다. 숫자는 실제 데이터 또는
코드 집계에서 나온 값만 사용한다.

## Result

첫 MVP Result는 다음 다섯 영역으로 제한한다.

1. 고객이 좋아하는 이유
2. 반복되는 불만
3. 고객이 원하는 것
4. 주의해야 할 문제
5. 개선 Action TOP 5

Action은 가능한 경우 다음 정보를 가진다.

```text
Problem
Mention count
Why it matters
Evidence
Recommended action
```

Evidence는 실제 입력 리뷰에서 연결되어야 한다. AI가 입력에 없는 고객
의견을 Evidence처럼 생성해서는 안 된다.

## Done

`#001`은 다음 전체 Workflow가 실제 데이터로 PASS해야 완료다.

```text
실제 Review CSV
→ 실제 실행
→ 분석 완료
→ 실제 Review와 Result 대조
→ Evidence가 입력 데이터에 존재함을 확인
→ 사용 가능한 Action Report 생성
→ Copy 또는 Download 가능
→ 30~60초 화면 녹화 가능
```

Build PASS만으로 완료하지 않는다.

## Test Condition

* 실제 Review CSV(최대 300개)를 입력으로 사용한다.
* 결과에 포함된 각 Evidence가 입력 CSV의 실제 review 행에서 확인 가능해야
  한다.
* 결과의 수치(mention count 등)가 코드 집계값과 일치해야 한다.
* Action TOP 5가 실제로 리뷰 내용을 반영하고 있는지 육안으로 대조한다.
* 결과를 Copy 또는 Download할 수 있어야 한다.

## NOT NOW

이번 Automation에서 다음은 구현하지 않는다.

* Amazon integration
* Coupang integration
* Naver integration
* automatic review collection
* OAuth
* database
* login
* user history
* Dashboard
* Agent
* Router
* Recipe
* Background Job
* Queue
* generic Provider abstraction
* multiple AI provider selector
* multiple file merging
* 10,000+ review architecture
* competitor automatic crawling
* automatic product modification
* automatic CS replies

좋은 아이디어가 생겨도 현재 `#001` 완료에 필요하지 않으면 구현하지 않는다.

## KEEP / ARCHIVE Evidence to Observe

개발 이후 다음을 관찰하여 KEEP(계속 개발) 또는 ARCHIVE(중단) 여부를
판단한다.

* 실제 사용자가 CSV를 업로드하고 끝까지 실행하는가
* 반복 사용(같은 사용자가 다시 실행하는가)
* Action 추천이 실제로 유용하다는 피드백이 있는가
* Evidence가 부정확하다는 사용자 지적이 있는가
* 300개 제한, XLSX 미지원 등으로 인한 사용자 이탈/불만이 있는가
* 다른 형태의 Result(예: 경쟁사 비교, 자동 CS 답변)를 요청하는가
* 재방문 또는 추천 의사가 있는가
