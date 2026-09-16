# AI-WORK CORE RULES

이 문서는 AI-WORK 전체 개발에서 항상 따라야 하는 Constitution이다.
길게 읽지 않고도 빠르게 판단할 수 있어야 한다.

---

## CORE PRINCIPLE

AI-WORK는 작은 독립 자동화를 빠르게 완성하고 검증하는 프로젝트다.

기본 단위:

```text
INPUT
→ PROCESS
→ RESULT
```

외부 행동이 필요한 경우에만:

```text
INPUT
→ PROCESS
→ RESULT
→ USER CONFIRM
→ EXTERNAL ACTION
```

전체 플랫폼을 먼저 만들지 않는다. `#001`, `#002`, `#003` 등을 독립적으로 만들고
실제 사용/Evidence로 검증한다. 검증된 자동화만 나중에 필요하면 조합한다.

---

## SIMPLE FIRST

항상 가장 단순하게 작동하는 구조를 먼저 선택한다.
미래 확장을 이유로 현재 구조를 복잡하게 만들지 않는다.

> System complexity may grow.
> User complexity should not.

---

## INDEPENDENT AUTOMATION

각 Automation은 독립 실행 가능해야 한다. 다른 Automation, 중앙 Agent,
Orchestrator가 없어도 자신의 업무를 완료해야 한다.
한 Automation 수정 때문에 다른 Automation 전체를 재검증해야 하는 구조를
만들지 않는다.

---

## NUMBERING

`#number = one independent work experiment`

버그 수정이나 해당 Automation의 작은 개선은 같은 번호 안에서 처리한다.
서로 다른 실제 업무를 해결하면 새로운 번호를 사용한다.

---

## NO PREMATURE PLATFORM

실제 필요가 확인되기 전에는 다음을 만들지 않는다.

* 범용 Workflow Engine
* 중앙 Agent
* 복잡한 Orchestrator
* Queue / Runner
* 중앙 State Machine
* 불필요한 DB
* 다단계 Approval
* 범용 Provider abstraction
* AutomationBase / AutomationRegistry
* RecipeEngine / WorkflowRuntime
* ProviderFactory
* Admin Dashboard

Automation이 하나뿐인 현재는 Router도 만들지 않는다. 향후 Router가
필요해지더라도 초기 Router는 사용자가 명시적으로 선택한 Automation을
호출하는 역할만 한다. Router가 업무를 추론하거나 판단하지 않는다.
AI Agent routing은 실제 Evidence가 생긴 이후에만 검토한다.

---

## ABSTRACTION RULE

한 Automation에서 반복될 것 같다는 이유만으로 공통화하지 않는다.
동일한 실제 문제가 독립 Automation 3개 이상에서 반복되었을 때만 공통화를
검토하고, 그 경우에도 요구사항이 실제로 같은지 먼저 확인한다.

초기에는 약간의 duplication이 잘못된 abstraction보다 낫다.

---

## ONE-DAY MVP

가능하면: `1 DAY = 1 AUTOMATION`

완료 기준은 Build PASS가 아니다.

```text
실제 Input
→ 실제 실행
→ 사용 가능한 Result
→ 실제 결과 검증
→ 화면 녹화 가능
```

여기까지 되어야 완료다.

---

## AI ROLE

AI는 적극적으로 활용하지만, 모든 처리를 AI 또는 Agent로 억지로 만들지 않는다.

기본 사고방식:

```text
INPUT
→ DETERMINISTIC PROCESS
→ AI PROCESS
→ VALIDATION
→ RESULT
```

정확한 계산, parsing, counting, sorting, validation 등 deterministic한 작업은
가능한 경우 코드가 담당한다. 의미 이해, 분류, 해석, 자연어 생성처럼 AI가
유리한 부분에만 AI를 사용한다. LLM output은 항상 untrusted input으로
취급한다.

---

## EXTERNAL DEPENDENCIES

OAuth, 외부 API, DB, Webhook, Queue, Background Worker 등은 Core Value에
반드시 필요한 경우에만 추가한다. 동일한 사용자 가치를 더 단순한 방법으로
검증할 수 있다면 단순한 방법을 먼저 사용한다.

Human Approval은 실제 외부 행동, 비가역적 행동, 민감한 결정이 필요한 경우에만
둔다. 단순 내부 분석 Workflow에 승인 단계를 추가하지 않는다.

---

## EVIDENCE BEFORE EXPANSION

새 기능은 추측으로 확장하지 않는다. 다음과 같은 Evidence가 있을 때 확장을
검토한다.

* 실제 사용
* 반복 사용
* 사용자 오류
* 콘텐츠 반응
* 다른 결과 요청
* 재방문
* 추천
* 가격 동의
* 결제
* 반복 결제

`status = done`, API 성공, AI 응답 성공만으로 완료 처리하지 않는다.
사용자가 실제로 사용할 Result/Artifact가 존재하고 유효해야 한다.

---

## STOP CONDITION

개발 중 항상 질문한다.

> "이 작업이 현재 #자동화를 실제로 완성하는 데 필요한가?"

NO라면 하지 않는다.

---

## DEVELOPMENT PRIORITY

```text
WORKING
→ USABLE
→ TESTED
→ SIMPLE
→ REUSABLE
→ BEAUTIFUL
```

재사용성과 아름다움을 위해 작동과 검증을 늦추지 않는다.

---

## FUTURE ARCHITECTURE PRINCIPLE

장기적인 결합 가능성은 인지하지만 지금 구현하지 않는다.

> Design awareness without implementation commitment.
>
> 미래의 결합 가능성은 독립성으로 보존하고, 미래의 결합 구조는 구현하지 않는다.

미래에는 Evidence에 따라 다음 구조가 생길 수도 있다.

```text
USER
  ↓
Agent        ← only if validated need exists
  ↓
Recipe       ← only if validated need exists
  ↓
#001 #002 #003 ...
```

하지만 현재 Automation이 미래의 Agent/Recipe/Router 구조에 맞춰 설계되어서는
안 된다. 미래 AI-WORK 구조가 살아남은 Automation에 맞춰져야 한다.
