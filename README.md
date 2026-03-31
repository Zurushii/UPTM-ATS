# UTPM-ATS (Academic Tracking System)

UTPM-ATS is a modern, comprehensive academic planning and tracking system designed to streamline the management of university academic programs, student intakes, and individual course schedules. It serves two primary stakeholders: the **Head of Program (HOP)** and **Students**.

The system automates the generation of academic plans, manages complex prerequisite rules and credit constraints, and tracks student progress throughout their academic journey.

## 🚀 Tech Stack

- **Framework**: [Nuxt 4](https://nuxt.com/) (Vue 3, Server API routes)
- **Styling**: [TailwindCSS v4](https://tailwindcss.com/) & [DaisyUI v5](https://daisyui.com/) (providing a customized, sleek, responsive UI)
- **Database**: MySQL (using `mysql2` driver with raw SQL schema definitions)
- **Authentication**: [Better-Auth](https://better-auth.com/) (Handling sessions, roles, and verification)
- **Document Generation & Processing**: `exceljs` for course data exports, `pdf-parse` for parsing result slips.

## 📦 Core Architecture & Data Models

The system is built on a robust relational database model encompassing the following domains:

1. **Authentication & Roles**:
   Integration with Better-Auth for stateless/stateful session management. Differentiates between `hop` (Head of Program) and `student` roles.
2. **Program Definition (`programs`, `courses`, `program_courses`)**:
   Defines the program syllabus, course groups (electives, core), prerequisites, and credit thresholds per long and short semesters.
3. **Session Timeline (`program_sessions`, `program_current_session`, `program_session_timeline`)**:
   Manages the global and per-program active periods. Tracks historical sessions to dictate how time advances globally in the system.
4. **Intakes & Entry Rules (`semester_entry_rules`, `semester_credit_plans`, `academic_planning_intakes`)**:
   Enables flexible entry requirements. Depending on a student's prior transferred credits, the system maps out their exact starting semester.
5. **Academic Planning Engine (`academic_plans`, `academic_plan_details`)**:
   The automated core that assigns courses to student schedules over their projected lifespan. Calculates credits, respects prerequisites, handles failures, and accommodates retakes.

## 🔑 Key Features

### Head of Program (HOP) Dashboard
*   **Program & Course Management**: Define and maintain the structure of academic programs, course availability, and session associations.
*   **Data Export**: Robust Excel export functionality for courses that precisely formats metadata and numeric data.
*   **Intake Management**: Organize students by intake batches (e.g., "August 2024"). Manage pre-registered ("Reserved") vs "Active" students. Track overall intake completion status (Draft -> Generated -> Completed).
*   **Automated Scheduling Engine**: Powered by a **Rule-Based Constraint Scheduling Algorithm**, it generates academic plans for a batch of students. The algorithm uses a greedy scheduling approach coupled with Directed Acyclic Graph (DAG) prerequisite resolution to map out course schedules while strictly honoring entry credits, semester workloads, and prerequisite chains.
*   **Error Recovery & Regenerations**: Selectively regenerate plans for students who hit validation errors (e.g., credit boundary issues), ensuring that already successful plans are left untouched.
*   **Performance Simulation & Adjustment**: Manually adjusting students' academic statuses to simulate scenarios like Failure, Probation, or dynamically rendering "Missing Result" warnings based on the global session timeline.

### Student Dashboard
*   **Automated Academic Plan**: View a comprehensive roadmap of past, present, and future courses structured semester by semester.
*   **Intelligent Status Tracking**: Granular tracking for every course (e.g., "Planned", "In Progress", "Pending Result", "Completed", "Missing Result").
*   **Retake Visibility**: Intelligently isolates retaken courses from cumulative graduation credit thresholds while accurately enforcing current semester workload limits.
*   **Result Slip Submissions**: Direct functionality to upload result slips, which are tracked and linked to the active academic plan semester.
*   **"Preview All" Scheduling Modal**: A dynamic viewer that displays the student's entire schedule roadmap, maintaining parity with HOP-level planning views.

## 🎨 UI & UX Standards

To deliver a premium, professional user experience, UTPM-ATS strictly adheres to the following UI standards:
*   **Unified Notifications**: The application replaces all native browser `alert()` and `confirm()` dialogs with custom DaisyUI Modals and Toast notifications.
*   **Consistent Formatting & Typography**: Uniform capitalization (e.g., "Draft", "Approved", "Completed").
*   **Accessibility & UX Micro-interactions**: Defined hover states, appropriate color contrasts for different semantic actions (Danger/Delete usually as a distinct first interaction step), and sticky legending elements on planning pages.

## 🛠️ Development Setup

Make sure to install dependencies:

```bash
# npm
npm install
```

Start the development server on `http://localhost:3000`:

```bash
# npm
npm run dev
```

Build the application for production:

```bash
# npm
npm run build
```
