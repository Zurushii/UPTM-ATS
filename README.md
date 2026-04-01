# UTPM-ATS

UTPM-ATS is a Nuxt 4 academic tracking system for Heads of Program (HOP) and students. It combines curriculum setup, intake processing, academic plan generation, and result-slip tracking in one MySQL-backed application.

The app is built around a real operational flow:

1. Define semester entry rules for each intake type.
2. Build the program structure for a session.
3. Set the current academic session.
4. Process intake spreadsheets and assign entry semesters.
5. Generate, review, and approve academic plans.
6. Let students follow their plan and submit semester results.

See [walkthrough.md](./walkthrough.md) for the full end-to-end user flow.

## What the system covers

### HOP workflow

- Manage semester entry rules and per-semester target credits.
- Create or clone program sessions and import course structures from Excel.
- Set the active intake period and semester type for the program.
- Process intake assessment spreadsheets and pre-register students.
- Create academic-planning intakes and generate plans in bulk.
- Review draft plans, approve them, complete them, and lock finished intakes.
- Receive notifications when students revert approved plans back to draft for rescheduling.

### Student workflow

- Complete onboarding and attach to a reserved student record when applicable.
- View profile, intake details, and academic-plan progress.
- Open the semester-by-semester roadmap, including transferred courses.
- Upload result slips and let the system pre-fill pass/fail results when parsing succeeds.
- Request rescheduling by reverting an approved plan back to draft.

## Tech stack

- Framework: Nuxt 4 + Vue 3
- Styling: Tailwind CSS v4 + DaisyUI v5
- Database: MySQL via `mysql2`
- Auth: Better Auth
- File processing: `exceljs` and `pdf-parse`

## Project structure

| Path | Purpose |
| --- | --- |
| `app/` | Nuxt pages, layouts, and UI components |
| `server/api/` | Server routes for HOP, student, onboarding, and auth flows |
| `server/utils/db.ts` | Shared MySQL connection pool |
| `utils/auth.ts` | Better Auth server configuration |
| `database/schema.sql` | Full SQL schema, including auth and application tables |
| `uploads/` | Stored result slips uploaded by students |

## Local setup

### Prerequisites

- Node.js 20+ recommended
- MySQL 8+ recommended
- A database user with permission to create tables

### 1. Install dependencies

```bash
npm install
```

### 2. Create the database schema

Import the bundled schema:

```bash
mysql -u <user> -p <database_name> < database/schema.sql
```

`database/schema.sql` already includes the Better Auth tables plus the application tables, so this is the quickest way to bootstrap a local database.

### 3. Configure environment variables

Create a `.env` file in the project root and set:

```env
DB_HOST=127.0.0.1
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=utpm_ats

BASE_URL=http://localhost:3000
NUXT_PUBLIC_BASE_URL=http://localhost:3000

BETTER_AUTH_SECRET=replace-with-a-long-random-string

GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

Notes:

- The current auth configuration expects both email/password auth and Google OAuth credentials.
- `BASE_URL` is used by Better Auth.
- `NUXT_PUBLIC_BASE_URL` is exposed to the client.

### 4. Start the app

```bash
npm run dev
```

The development server runs at [http://localhost:3000](http://localhost:3000).

## Available scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Nuxt dev server |
| `npm run build` | Build for production |
| `npm run preview` | Preview the production build locally |
| `npm run generate` | Generate a static build |
| `npm run auth:migrate` | Run Better Auth CLI migrations if you choose to manage auth tables that way |

## Planning and data behavior

- Academic plans are generated from the selected program session, the student's entry semester, transferred courses, prerequisites, and program credit limits.
- Intake type affects the physical semester cycle used during scheduling:
  - May intake: `S, L, L`
  - August intake: `L, L, S`
  - December intake: `L, S, L`
- Industrial Training is forced into a long semester after the regular scheduled coursework.
- Completed intakes are treated as locked. The API blocks plan edits, status changes, and regeneration once an intake is completed.

## Result-slip handling

- Student uploads are stored under `uploads/results/<matric_no>/`.
- Auto-parsing works for:
  - text-based PDFs
  - HTML result slips saved with a `.pdf` extension
- Scanned or image-only PDFs may not parse and will require manual result marking in the UI.

## Notes for contributors

- Most business rules live in `server/api/hop/academic-planning/generate.post.ts`.
- Intake processing rules live in `server/api/hop/intake-assessment/process.post.ts`.
- The student onboarding flow can either:
  - link to an existing reserved student record, or
  - create a new active student record if none exists yet.
