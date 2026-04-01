# UTPM-ATS Walkthrough

This guide explains how the system behaves today, using the same terms, screens, and rules that exist in the codebase.

## 1. Mental model

UTPM-ATS is centered on one program at a time. A HOP configures the program, processes incoming student data, and generates academic plans. Students then view those plans, submit results, and request rescheduling when necessary.

The main records are:

- `programs`: program-level settings, including credit limits
- `program_sessions`: curriculum versions for a program
- `program_courses`: semester-by-semester course structure for a session
- `semester_entry_rules`: transfer-credit thresholds that map students to entry semesters
- `semester_credit_plans`: target credits and semester types for each rule
- `academic_planning_intakes`: intake-level planning batches such as `0825`
- `academic_plans`: one plan per student per intake
- `academic_plan_details`: the scheduled courses inside a plan
- `semester_results`: uploaded result slips per semester

## 2. Roles and onboarding

### HOP onboarding

When a HOP signs in for the first time, the onboarding flow asks for:

- a program
- a password with at least 8 characters

The app then:

- creates or updates the `head_of_programs` mapping
- marks the user as onboarded
- creates a credential account for email/password sign-in

### Student onboarding

When a student signs in for the first time, the onboarding flow asks for:

- full name
- matric number
- intake year in `MMYY`
- program
- password

The app then does one of two things:

1. If a reserved student record already exists for that matric number, it links the user to that record and changes the record to `active`.
2. If no matching record exists, it creates a new active student record.

This matters because intake assessment often pre-registers students as `reserved` before they ever log in.

## 3. HOP workflow

The HOP dashboard already presents the intended sequence:

1. Semester Rules
2. Program Structure
3. Active Session
4. Intake Assessment
5. Academic Planning

### Step 1: Semester Rules

Use the Semester Rules page to define how transferred credit maps to an entry semester.

Example:

- `0` credits -> semester `1`
- `20` credits -> semester `2`
- `40` credits -> semester `3`

Each rule can also carry a semester credit plan. Those plans tell the scheduler:

- whether a semester is long (`L`) or short (`S`)
- whether a semester is Industrial Training (`LI`)
- what credit target should be used for that semester

#### Semester Rules Excel import

The importer reads the first worksheet and expects a sectioned layout. It looks for:

- section headers like `August Intake (SEM 2)`
- a header row that starts with `PROGRAM`
- semester columns like `SEM 2`, `SEM 3 S`, or `SEM 8 (LI)`

What the importer does:

- extracts the intake type from the section header, for example `August Intake`
- extracts the entry semester from the same header, for example `SEM 2`
- reads each transfer-credit row
- stores the rule in `semester_entry_rules`
- stores the semester-by-semester credit plan in `semester_credit_plans`

If a base rule for semester 1 does not exist for that intake type, the importer auto-creates one.

### Step 2: Program Structure

Use the Program Structure page to create or clone a session and attach courses to semesters.

Each `program_session` represents a curriculum version. Each row in `program_courses` places a course into:

- a semester number
- a course type
- an optional course group
- an optional prerequisite course

This structure is the backbone of plan generation.

#### Program Structure Excel import

The importer reads the first worksheet and expects:

- semester headers such as `SEMESTER 1 / YEAR 1` or `SEMESTER 3`
- a table header containing fields like `Course Code`, `Course Name`, `Credit`, `Status`, and `Pre-Req`

Important behavior:

- missing courses are created in `courses`
- existing courses are reused
- each imported row is attached to the selected session
- merged credit cells or course codes with a trailing `/` are treated as grouped elective-style options
- prerequisite codes are resolved to existing course IDs when possible

If the same course is already present in the selected session, it is skipped as `existing`.

### Step 3: Active Session

The HOP dashboard includes a Global Academic Session card. This sets:

- `active_intake_period`, for example `0825`
- semester type, either `L` or `S`

The current session is used to:

- gate intake assessment, so the selected intake must match the active intake period
- calculate cohort progress on the HOP dashboard
- help the student UI decide whether a semester is current, past, or upcoming

### Step 4: Intake Assessment

Use Intake Assessment to process a spreadsheet of students for the current intake.

This step:

- validates that the uploaded intake matches the configured current session
- validates that the selected intake type has semester rules
- calculates each student's entry semester from transferred credits
- updates existing students or creates new reserved students
- stores transferred-course links when the course codes are valid and the credit total reconciles

#### Intake Assessment Excel format

The importer accepts flexible header names, but it needs:

- either `student_id` or `matric_no`
- a transferred-credit column such as `total_credit_transferred`

Optional columns:

- `transferred_courses`
- `intake_year`
- `starting_semester`
- `program_code`

Important validation rules:

- `starting_semester` must be blank or `0`; the system calculates the real entry semester
- `intake_year`, if present, must match the selected intake
- `program_code`, if present, must match the HOP's program
- invalid credit values still pre-register the student, but with an error note
- invalid transferred course codes are dropped instead of partially linked
- if transferred course credits do not add up to the uploaded total, the student is still registered but the course links are cleared

New students created here are stored as `reserved`. They become `active` later when the real student completes onboarding.

### Step 5: Academic Planning

Academic Planning has two parts:

1. Create an intake record.
2. Generate plans for the students in that intake.

#### Creating the intake

The HOP creates an `academic_planning_intakes` record with:

- `intake_year`
- `intake_name`
- `session_id`
- `intake_type`

The API only allows this if:

- the selected session belongs to the HOP's program
- rules exist for the selected intake type
- the same intake year has not already been created for that program

#### Generating plans

Plan generation reads:

- the selected intake
- all students in that program and intake year
- the full program structure for the intake's session
- the program credit limits
- an Excel file containing `matric_no` and optional `transferred_courses`

The generation request is blocked if:

- the intake is already completed
- intake assessment has not been done yet
- the Excel file is missing `matric_no`

#### What the scheduler actually does

For each student, the generator:

- skips students who already have a plan for that intake
- checks that transferred-course credits reconcile with `total_credit_transferred`
- creates a draft `academic_plans` row
- populates `academic_plan_details`

Scheduling behavior:

- students starting in semester 1 follow the imported program structure directly
- later-entry students keep transferred courses and get the remaining courses rescheduled
- prerequisites must be completed in a strictly earlier semester
- Industrial Training is forced into a long semester after regular coursework
- some long-semester-only courses, such as Industrial Training and FYP II style courses, cannot be placed into short semesters
- the intake type determines the semester cycle:
  - May intake: `S, L, L`
  - August intake: `L, L, S`
  - December intake: `L, S, L`
- the scheduler respects program min/max credit limits
- a smoothing pass pulls courses forward when possible so the ending semesters are not unnecessarily underloaded

Generation ends by updating intake statistics:

- total students considered
- successful plans
- failed plans

The intake status moves to `generated`.

### Reviewing, approving, and completing plans

A plan moves through these stored statuses:

- `draft`
- `approved`
- `completed`

Allowed HOP transitions:

- `draft` -> `approved`
- `approved` -> `draft`
- `approved` -> `completed`

An intake can only be marked `completed` when:

- the intake is currently `generated`
- every student in that intake has a plan with status `completed`

Once the intake is completed, the APIs treat it as locked. Regeneration, schedule edits, and status changes are blocked.

### Student re-approval requests

Students can revert their own approved plan back to `draft`. When they do:

- the plan status becomes `draft`
- an entry is written to `plan_activity_logs`
- the HOP dashboard shows an unread notification

This is the re-approval loop the HOP dashboard calls out in the "Attention Required" card.

## 4. Student workflow

### Student dashboard

The student dashboard summarizes:

- profile information
- intake and program
- transferred credits
- starting semester
- total plan progress
- latest plan status

If no plan exists yet, the UI shows that the plan is still pending assignment.

### Academic Plan page

The Academic Plan page is the student's main working view. It shows:

- all transferred courses in a collapsible section
- every scheduled semester from the student's start semester onward
- course statuses and grades
- semester summaries and credit totals
- export actions

Stored course statuses in the database are:

- `Planned`
- `Transferred`
- `Passed`
- `Failed`

The UI also derives display states such as:

- `In Progress`
- `Pending Result`
- `Missing Result`

Those derived labels depend on the current session, the student's intake progress, and whether a result slip has been submitted.

### Result-slip upload flow

Students upload result slips per semester. The backend expects:

- `semester`
- `result_slip`
- `results` as JSON

There is also a parsing endpoint that tries to extract grades before final submission.

#### What the parser supports

The parser can read:

- HTML result slips saved as `.pdf`
- real text-based PDFs through `pdf-parse`

If no readable text is found, the response tells the UI to fall back to manual marking.

#### What happens on submission

On a successful submission, the backend:

- saves the uploaded file under `uploads/results/<matric_no>/`
- upserts a row into `semester_results`
- updates `academic_plan_details` for that semester to `Passed` or `Failed`

If any course is marked `Failed`, the backend also:

- finds future planned courses that depend on the failed course
- removes those dependent planned rows
- reverts the academic plan back to `draft`

This forces a rescheduling cycle instead of leaving invalid future prerequisites in place.

## 5. Spreadsheet reference

### Semester Rules import

Use a worksheet with section headers and semester columns, for example:

- `August Intake (SEM 2)`
- `PROGRAM | CREDIT TRANSFER | SEM 2 | SEM 3 S | SEM 8 (LI)`

### Program Structure import

Use semester sections with columns like:

- `Course Code`
- `Course Name`
- `Credit`
- `Status`
- `Pre-Req`

Semester headers can be:

- `SEMESTER 1 / YEAR 1`
- `SEMESTER 2`

### Intake Assessment import

Recommended columns:

- `matric_no`
- `total_credit_transferred`
- `transferred_courses`
- `intake_year`
- `program_code`

`transferred_courses` should be a comma-separated list of course codes. Slash-separated alternatives such as `UCS3153/UCS3143/UCS3163` are also supported and the importer will keep the first valid match.

### Academic Planning generation input

The generation file must include:

- `matric_no`

Optional:

- `transferred_courses`

This file is used as a final validation source before plans are generated.

## 6. Common failure cases

- Current session not set: intake assessment is blocked until the HOP sets the active intake period.
- Intake mismatch: the uploaded intake year must match the configured current session.
- Missing rules: academic-planning intakes cannot be created unless that intake type already exists in Semester Rules.
- Credit mismatch: if transferred-course credits do not add up to the stored credit total, the student is excluded from generation for that run.
- Completed intake: once an intake is completed, scheduling APIs reject further changes.
- Unreadable result slip: scanned PDFs may not parse and must be reviewed manually in the UI.

## 7. Practical summary

If you want the shortest reliable operating sequence, use this:

1. Import Semester Rules.
2. Import or build Program Structure for a session.
3. Set the Global Academic Session.
4. Run Intake Assessment for the matching intake.
5. Create the Academic Planning intake.
6. Generate plans.
7. Review drafts and approve them.
8. Let students submit results or request rescheduling.
9. Mark plans completed, then mark the intake completed.
