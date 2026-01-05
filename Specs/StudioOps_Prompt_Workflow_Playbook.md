# StudioOps Prompt & Workflow Playbook
_For Eliran — Emily’s Studio / Magnetic Studio Console_

**Language rule:** Instructions in English. Agents respond in Hebrew (except strict JSON keys/structure).

## 0) What this report covers
This playbook turns your real studio way of working into concrete, repeatable guidelines and agent prompt templates. It is designed to:
- Make AI outputs sound like your studio: set design / fabrication / installs / rentals / printing / logistics.
- Keep everything structured enough to become Tasks, Accounting lines, Quotes, and Trello cards.
- Reduce rework by forcing the AI to ask the “right” clarifying questions, and to flag risks early.
- Fit your existing console architecture (projects, tasks, accounting, quotes, knowledge, Trello sync) and extend it where needed (Elements as source of truth, Printing QA, Suggestions UI).

## 1) Your studio operating model
### 1.1 Lifecycle
1. Intake / Clarification
2. Ideation
3. Planning
4. Solutioning
5. Execution (studio)
6. Install day
7. Teardown/return

### 1.2 Non-obvious realities the AI must assume
- Israel context, vendor availability, lead times.
- Work splits: studio fabrication vs vendors vs site installation.
- Temporary, camera-facing builds; safe, fast, transportable.
- Rentals with deposits and return obligations.
- Quotes under uncertainty → assumptions + buffers + options.

## 2) Canonical structure: Projects → Elements → Tasks → Accounting → Quote
- **Project**: the job.
- **Element**: deliverable unit.
- **Task**: atomic action.
- **Accounting**: budget model.
- **Quote**: client-facing snapshot.

Mapping rules:
- Every task links to one element (or project).
- Every accounting line links to one element.
- Elements have Draft/Review/Approved; approved = grounding truth.
- Quote references the exact approved set at generation time.

## 3) Taskcraft (studio language)
Task template:
- Title (imperative verb + object + qualifier)
- Element link
- Outcome / DoD
- Inputs needed
- Tools/process
- Dependencies
- Time + crew estimate
- Risks/notes

Granularity:
- 30–180 minutes per task.
- Split when location/skill/dependency changes.
- Explicit QA tasks for visible outputs.

## 4) Accountingcraft
- Section per element + one project overhead/logistics section.
- Inside element: Materials, External Vendors, Labor (Studio), Labor (Install), Transport, Rentals.
- Prefer Management Hub real prices; otherwise estimate with confidence label.
- Separate studio vs install labor; include friction hours.
- Quote hygiene: scope boundaries, assumptions, buffer, options, proof checkpoints.

## 5) Patterns library
- Printing & graphics: proof, test print, install plan, common failure modes.
- Wood/MDF: modular panels, structural checks, finish workflow + cure time.
- Foam/PVC: lightweight, fragility risks, reinforce when needed.
- Rentals: reserve→confirm→pickup→condition photos→install→return→deposit release.

## 6) Printing dimension + Print QA agent
### 6.1 Printing schema principles
- One element → many PrintParts.
- Each PrintPart stores: intent, size, qty, substrate, finish, cutting, mounting, delivery, QA.
- Files attach via ingestion references.

### 6.2 TypeScript-like schema
(See DOCX for full block.)

### 6.3 Agent contract
- Inputs: PrintPart config + attached files + vendor constraints.
- Outputs: Pass/Fail + issues + fixes + vendor questions.
- UI: issues grouped by severity; “Send to print” blocked on fail unless override reason.

## 7) Shared prompt header
Use one shared header in every skill; then add skill-specific body.

## 8) Skill catalog
- Clarification (Structured Qs)
- Ideation (Elements + rough budget)
- Planning (milestones + quote-ready breakdown)
- Architect (atomic tasks)
- Accounting Generator (materials + labor)
- Quote Writer (Hebrew client-facing)
- Buying Assistant (options per material line)

## 9) Suggestions UI skill
Schema + prompt skeleton to generate selectable suggestions per stage with payloads.

## 10) Quality & safety guardrails
- Safety-critical flagging; human check required.
- Brand-critical printing requires proof/test print.
- Missing measurements → blocked tasks + clarification task.
- Avoid destructive auto-fixes; prefer flag/unlink + tombstone view.

## 11) Continuous improvement
- Post-project: mark what was used; turn into few-shots.
- Track common failure modes; add as rules.
- Version prompts in skills table; keep changelog and rollback.

## 12) Next actions
1. Enforce Approved Elements grounding across agents.
2. Add Printing dimension + Print QA flow.
3. Build Suggestions UI skill.
4. Expand Management Hub with real vendors/prices/rates.
5. Add receipt ingestion (mobile photo → extract → approve → link).
