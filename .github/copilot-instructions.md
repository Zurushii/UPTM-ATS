# UTPM Academic Tracking System – AI Instructions

## Project Summary

Nuxt 4 Academic Tracking System (ATS) with two roles: **HOP** (Head of Program) and **STUDENT**.

- **Authentication**: Better Auth
- **Database**: MySQL
- **UI**: DaisyUI

All academic logic is driven by the database schema.

## Roles & Identity

- Identity source: `user` table
- Roles: `user.role` → `"HOP"` | `"STUDENT"`
- Onboarding flag: `user.is_onboarded`

| Role    | Table                                |
| ------- | ------------------------------------ |
| HOP     | `head_of_programs.user_id → user.id` |
| Student | `students.user_id → user.id`         |

## Core ATS Flow (Database-Driven)

1. **Credit Transfer** – HOP uploads Excel → updates `students.total_credit_transferred`
2. **Semester Entry** – Rules in `semester_entry_rules` → determines `students.starting_semester` (default: semester 1)
3. **Academic Planning** – `academic_plans` (header) + `academic_plan_details` (items) from `program_courses`. Status: draft → approved → completed
4. **Prerequisites** – Stored in `program_courses.prerequisite_course_id`. Courses must be scheduled after prerequisites.

## Route Structure

- `(auth)/` → sign in / sign up (parenthesized = no route segment)
- `onboarding/` → insert into `students` or `head_of_programs`, set `user.is_onboarded = true`
- `dashboard/hop/` → HOP only (use `middleware: ["hop"]`)
- `dashboard/student/` → Student only

## Authentication Flow

```typescript
// Server handler: server/api/auth/[...all].ts
// Client: import from @@/utils/auth-client

// Fetch session in components/pages
const { data: session } = await authClient.useSession(useFetch);
session.value?.user.role === "HOP";

// Or use hydrated state from auth.global.ts
const user = useState<any>("user");
user.value?.role === "HOP";
```

## Database Access Pattern

Direct SQL via pool – no repositories, no services.

```typescript
import { pool } from "~/server/utils/db";
const [rows] = await pool.query("SELECT * FROM programs");
```

## UI & Component Rules

- Use DaisyUI classes: `btn`, `card`, `input input-bordered`, `modal`, `select select-bordered`
- HOP components: `app/components/hop/`
- Dashboard pages must use: `definePageMeta({ layout: "dashboard" })`

## Credit Transfer Upload

- Accept `.xlsx` / `.csv`
- Parse with `xlsx` library
- Required columns: `matric_no`, `total_credit_transferred`

## Environment Variables

```
DB_HOST, DB_USER, DB_PASSWORD, DB_NAME
BETTER_AUTH_SECRET
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
NUXT_PUBLIC_BASE_URL
```

## Commands

```bash
npm run dev          # Start dev server
npm run auth:migrate # Run Better Auth DB migrations
```

## Rules (Do Not Break)

- `user` is the only identity table – ATS tables reference `user.id`
- All automation follows database rules
- Prefer SQL + simple logic
- Keep implementation simple
