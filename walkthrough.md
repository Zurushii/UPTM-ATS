# UTPM-ATS Detailed System Walkthrough

This walkthrough details every moving part, functional workflow, and edge case of the **Academic Tracking System (UTPM-ATS)**.

## 1. Authentication and Onboarding

The system incorporates **Better-Auth** as its identity provider layer.
*   **Roles & Access Control**: Upon login, the system detects whether the user is a `hop` (Head of Program) or `student`.
*   **Student Onboarding**: When students log in for the first time, they go through an onboarding phase where they map their user account to their registered student record. If they are pre-registered by the HOP, their status transitions from `reserved` to `active`. During onboarding, students confirm their **transferred credits**, which sets their starting point on the academic timeline.

## 2. Global Time and Session Settings

UTPM-ATS revolves around a global **Session Timeline**.
*   **Current Session State**: Managed in the `program_current_session` table. This tracks the active semester (e.g., "1224" -> Dec 2024 cutoff, Semester Type: Long or Short).
*   **Progression**: When a session "advances", the system audits the student database. Students who were scheduled to take courses in the previous session must have their grades reviewed or results uploaded. If a student fails to upload a result when the global session shifts forward, the system automatically flags that semester's coursework as **"Missing Result"**.

## 3. Head of Program (HOP) Features & Workflows

### 3.1. Structure & Curriculum Management
*   **Course Inventory & Search**: The HOP manages the master repository of all courses. They can utilize a robust search interface to find specific subjects.
*   **Course Exports**: The HOP can export course lists via an Excel file powered by ExcelJS. The export logic is specifically crafted to prevent auto-formatting (e.g., turning "0524" intake strings into date formats like "May-24").
*   **Program Structure & Sessions**: Courses are bound to **Program Sessions**. The HOP can create sessions, assign courses to semesters within those sessions, mark them as Electives or Core, and configure prerequisite dependencies.
*   **Session Deletion Workflow**: To maintain data integrity, session deletion is heavily guarded. The HOP must trigger a standardized, DaisyUI-based confirmation modal to initiate a cascading removal of the session.

### 3.2. Intake and Cohort Management
*   **Intakes**: Students are clustered into specific intakes (e.g., August Intake).
*   **Intake Lifecycles**: An intake goes through 3 statuses:
    1.  **Draft**: Adding students, adjusting schedules.
    2.  **Generated**: Academic plans have been scheduled.
    3.  **Completed**: The intake is finalized and firmly locked using custom modal confirmations (no native browser `confirm()` alerts). Once completed, an intake is systematically excluded from auto-progression algorithms that apply to active drafts.

### 3.3. Academic Plan Generation Engine
*   **Batch Planning**: The HOP clicks "Generate" on an intake. The system uses a **Rule-Based Constraint Scheduling Algorithm** (employing a Greedy Scheduling approach with Directed Acyclic Graph prerequisite validation) to iterate through all students sequentially and securely map out their academic journeys.
*   **Validation Rules**: During generation, the core engine calculates the total credit payload per semester, strictly comparing it against the defined boundaries for Long and Short semesters.
*   **Regeneration Handling**: If 90 students succeed but 10 fail (due to credit bounds), the HOP can click **"Regenerate Plans"**. The system intelligently skips the 90 successful students and attempts to fix the pending 10 based on newly adjusted rules.

## 4. Student Features & Workflows

### 4.1. The Academic Dashboard
*   **Schedule View**: Displays the academic roadmap semester by semester.
*   **Sticky Legends & Visual Cues**: A sticky sidebar legend dictates the color-coding of course statuses ("Planned", "In Progress", "Pending Result", "Missing Result", "Completed", "Failed"). Uniform capitalization ensures the system looks premium.
*   **Course Previews**: Students can click a "Preview All" button to summon a sprawling modal, giving a macro-perspective of their entire academic roadmap.

### 4.2. Workload and Retakes
*   **Credit Counting Constraints**: To maintain perfect sync between backend validation and frontend display:
    *   **Retake Courses** are distinctively marked. They *do not* increment the student's Total Accumulated Credits toward Graduation (preventing "double counting").
    *   However, Retake Courses *do* count toward the immediate Semester Workload Limit to ensure physical scheduling validity.
*   **Elective Groups**: For Elective and Option groups, the system properly segregates unassigned courses from core computing credits so statistics panels clearly articulate remaining requirements.

### 4.3. Result Submissions
*   At the conclusion of a semester, students are prompted to upload their official Results Slip (PDF handled via `pdf-parse` capabilities).
*   Once uploaded, courses in that semester shift to **"Pending Result"** (awaiting administrative verification) or are updated based on extracted grades.

## 5. System UI/UX Ideals
UTPM-ATS operates with a strict mandate for professional aesthetics.
*   **Zero Native Dialogs**: All `window.alert` and `window.confirm` functions are strictly forbidden. They are replaced by cohesive DaisyUI popups and toast messages.
*   **Button and State Legibility**: All interactive buttons incorporate hover effects and stringent contrast requirements so that text remains legible across various active states. Data cards and student information profiles are standardized between both the Student and HOP dashboards to provide a seamless, unified design language.
