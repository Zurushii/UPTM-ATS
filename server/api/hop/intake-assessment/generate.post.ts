import { pool } from "~~/server/utils/db";
import {
  generateAcademicPlansForIntakeStudents,
  type AcademicPlanFailedStudent,
  type AcademicPlanStudentInput,
} from "~~/server/utils/academic-plan-generation";
import { ensureStudentEntrySemesterColumns } from "~~/server/utils/semester-entry-bands";
import {
  resolveProgramSessionForIntake,
  resolveSemesterRuleSetForIntake,
} from "~~/server/utils/intake-planning-config";
import { auth } from "~~/utils/auth";

const formatIntakeName = (intakeYear: string) => {
  if (!/^\d{4}$/.test(intakeYear)) {
    return `${intakeYear} Intake`;
  }

  const month = Number.parseInt(intakeYear.slice(0, 2), 10);
  const year = Number.parseInt(intakeYear.slice(2), 10);
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const fullYear = year >= 50 ? 1900 + year : 2000 + year;
  const monthLabel = monthNames[month - 1] || intakeYear.slice(0, 2);
  return `${monthLabel} ${fullYear} Intake`;
};

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "HOP") {
    throw createError({ statusCode: 403, statusMessage: "HOP only" });
  }

  const body = await readBody<{
    intake_year?: string;
    intake_type?: string;
  }>(event);

  const intakeYear = body.intake_year?.trim() || "";
  const requestedIntakeType = body.intake_type?.trim() || "";

  if (!intakeYear) {
    throw createError({
      statusCode: 400,
      statusMessage: "intake_year is required",
    });
  }

  const [hopRows] = await pool.query(
    `SELECT program_id FROM head_of_programs WHERE user_id = ?`,
    [session.user.id],
  );

  const hopData = hopRows as any[];
  if (hopData.length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "HOP profile not found",
    });
  }

  const programId = Number(hopData[0].program_id);
  await ensureStudentEntrySemesterColumns();

  const [sessionRows] = await pool.query(
    `SELECT active_intake_period
     FROM program_current_session
     WHERE program_id = ?`,
    [programId],
  );
  const currentSession = (sessionRows as any[])[0] || null;

  if (!currentSession) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "Current session is not set. Please configure the current session before generating academic plans.",
    });
  }

  if (intakeYear !== currentSession.active_intake_period) {
    throw createError({
      statusCode: 400,
      statusMessage: `Intake ${intakeYear} does not match the current session ${currentSession.active_intake_period}.`,
    });
  }

  const [existingIntakeRows] = await pool.query(
    `SELECT id, intake_name, intake_type, session_id, status
     FROM academic_planning_intakes
     WHERE program_id = ? AND intake_year = ?
     LIMIT 1`,
    [programId, intakeYear],
  );
  const existingIntake = (existingIntakeRows as any[])[0] ?? null;

  const resolvedRuleSet =
    requestedIntakeType
      ? {
          status: "resolved" as const,
          value: {
            intake_type: requestedIntakeType,
            resolution_source: "month_token" as const,
          },
          reason: "",
          candidates: [],
        }
      : existingIntake?.intake_type
        ? {
            status: "resolved" as const,
            value: {
              intake_type: String(existingIntake.intake_type),
              resolution_source: "month_token" as const,
            },
            reason: "",
            candidates: [],
          }
        : await resolveSemesterRuleSetForIntake({
            programId,
            intakeYear,
          });

  const intakeType = resolvedRuleSet.value?.intake_type || "";

  if (!intakeType) {
    throw createError({
      statusCode: 400,
      statusMessage:
        resolvedRuleSet.reason ||
        "The system could not resolve a semester rule set for this intake.",
    });
  }

  const [ruleRows] = await pool.query(
    `SELECT id FROM semester_entry_rules WHERE program_id = ? AND intake_type = ? LIMIT 1`,
    [programId, intakeType],
  );

  if ((ruleRows as any[]).length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "No semester rules found for the resolved intake type",
    });
  }

  let intakeId = 0;
  let sessionId = 0;
  let intakeName = "";
  let reusedExistingIntake = false;

  if (existingIntake) {
    if (existingIntake.status === "completed") {
      throw createError({
        statusCode: 400,
        statusMessage:
          "Academic planning for this intake has already been marked as completed.",
      });
    }

    if (String(existingIntake.intake_type) !== intakeType) {
      throw createError({
        statusCode: 409,
        statusMessage:
          "An academic planning batch already exists for this intake year with a different semester rule set. Delete the old batch first or use the same rule set.",
      });
    }

    intakeId = Number(existingIntake.id);
    sessionId = Number(existingIntake.session_id);
    intakeName = String(existingIntake.intake_name);
    reusedExistingIntake = true;
  } else {
    const resolvedProgramSession = await resolveProgramSessionForIntake({
      programId,
      intakeYear,
    });

    if (!resolvedProgramSession.value) {
      throw createError({
        statusCode: 400,
        statusMessage:
          resolvedProgramSession.reason ||
          "The system could not resolve a program structure for this intake.",
      });
    }

    sessionId = Number(resolvedProgramSession.value.id);
    intakeName = formatIntakeName(intakeYear);

    const [insertResult] = await pool.query(
      `INSERT INTO academic_planning_intakes
       (program_id, intake_year, intake_name, session_id, intake_type, status)
       VALUES (?, ?, ?, ?, ?, 'draft')`,
      [programId, intakeYear, intakeName, sessionId, intakeType],
    );

    intakeId = Number((insertResult as any).insertId);
  }

  const [studentRows] = await pool.query(
    `SELECT id,
            matric_no,
            starting_semester,
            total_credit_transferred,
            intake_assessment_needs_fix,
            intake_assessment_error_reason
     FROM students
     WHERE program_id = ? AND intake_year = ?`,
    [programId, intakeYear],
  );

  const [transferredCourseRows] =
    (studentRows as any[]).length > 0
      ? await pool.query(
          `SELECT student_id, course_id
           FROM student_transferred_courses
           WHERE student_id IN (?)`,
          [(studentRows as any[]).map((row) => Number(row.id))],
        )
      : [[]];

  const transferredCoursesByStudent = new Map<number, Set<number>>();
  for (const row of transferredCourseRows as any[]) {
    const studentId = Number(row.student_id);
    if (!transferredCoursesByStudent.has(studentId)) {
      transferredCoursesByStudent.set(studentId, new Set<number>());
    }
    transferredCoursesByStudent.get(studentId)!.add(Number(row.course_id));
  }

  const [existingPlanRows] = await pool.query(
    `SELECT student_id FROM academic_plans WHERE intake_id = ?`,
    [intakeId],
  );
  const studentsWithPlans = new Set<number>(
    (existingPlanRows as any[]).map((row) => Number(row.student_id)),
  );

  const studentsToProcess: AcademicPlanStudentInput[] = [];
  const initialFailedStudents: AcademicPlanFailedStudent[] = [];

  for (const student of studentRows as any[]) {
    const studentId = Number(student.id);

    if (studentsWithPlans.has(studentId)) {
      continue;
    }

    if (student.intake_assessment_needs_fix) {
      initialFailedStudents.push({
        student_id: studentId,
        matric_no: String(student.matric_no),
        reason:
          String(student.intake_assessment_error_reason || "").trim() ||
          "Needs Fix in Student Entry Assessment",
      });
      continue;
    }

    const startingSemester = Number(student.starting_semester) || 0;
    if (startingSemester <= 0) {
      initialFailedStudents.push({
        student_id: studentId,
        matric_no: String(student.matric_no),
        reason: "Entry semester not set",
      });
      continue;
    }

    studentsToProcess.push({
      student_id: studentId,
      matric_no: String(student.matric_no),
      starting_semester: startingSemester,
      total_credit_transferred: Number(student.total_credit_transferred) || 0,
      transferred_course_ids:
        transferredCoursesByStudent.get(studentId) || new Set<number>(),
    });
  }

  const generationResult = await generateAcademicPlansForIntakeStudents({
    intakeId,
    intakeType,
    intakeYear,
    programId,
    sessionId,
    studentsToProcess,
    initialFailedStudents,
    skippedExistingCount: studentsWithPlans.size,
  });

  return {
    ...generationResult,
    intake: {
      id: intakeId,
      intake_year: intakeYear,
      intake_name: intakeName,
      intake_type: intakeType,
      reused_existing_intake: reusedExistingIntake,
    },
  };
});
