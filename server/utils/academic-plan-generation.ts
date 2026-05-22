import { pool } from "~~/server/utils/db";
import { resolveIntakeLifecyclePattern } from "~~/server/utils/intake-lifecycle";
import {
  ensureAcademicPlanSemesterConfigsTable,
  replaceAcademicPlanSemesterConfigs,
} from "~~/server/utils/academic-plan-semester-config";
import {
  planAcademicPlanForStudent,
  type AcademicPlanCreditLimits,
  type AcademicPlanPlannerStudentInput,
} from "~~/server/utils/academic-plan-planner";
import { getProgramStructureCourses } from "~~/server/utils/program-structure-courses";

export interface AcademicPlanFailedStudent {
  student_id: number;
  matric_no: string;
  reason: string;
}

export interface AcademicPlanStudentInput {
  student_id: number;
  matric_no: string;
  starting_semester: number;
  total_credit_transferred: number;
  transferred_course_ids: Set<number>;
  persist_transferred_course_ids?: boolean;
  persist_total_credit_transferred?: boolean;
  clear_intake_assessment_needs_fix?: boolean;
  system_assigned_entry_semester?: number | null;
  final_entry_semester?: number | null;
  entry_semester_rule_id?: number | null;
  entry_semester_assignment_note?: string | null;
  is_entry_semester_override?: boolean;
}

interface GenerateAcademicPlansArgs {
  intakeId: number;
  intakeType: string;
  intakeYear: string;
  programId: number;
  sessionId: number;
  studentsToProcess: AcademicPlanStudentInput[];
  initialFailedStudents?: AcademicPlanFailedStudent[];
  skippedExistingCount?: number;
}

const getAcademicPlanCreditLimits = async ({
  programId,
}: {
  programId: number;
}): Promise<AcademicPlanCreditLimits> => {
  const [programLimitRows] = await pool.query(
    `SELECT long_sem_min_credit, long_sem_max_credit, short_sem_min_credit, short_sem_max_credit
     FROM programs WHERE id = ?`,
    [programId],
  );

  const programLimits = (programLimitRows as any[])[0] || {};
  return {
    long_min: Number(programLimits.long_sem_min_credit) || 12,
    long_max: Number(programLimits.long_sem_max_credit) || 20,
    short_min: Number(programLimits.short_sem_min_credit) || 6,
    short_max: Number(programLimits.short_sem_max_credit) || 10,
  };
};

export const generateAcademicPlansForIntakeStudents = async ({
  intakeId,
  intakeType,
  intakeYear,
  programId,
  sessionId,
  studentsToProcess,
  initialFailedStudents = [],
  skippedExistingCount = 0,
}: GenerateAcademicPlansArgs) => {
  const [programCourses, creditLimits, lifecycleConfig] = await Promise.all([
    getProgramStructureCourses({ sessionId }),
    getAcademicPlanCreditLimits({ programId }),
    resolveIntakeLifecyclePattern({
      programId,
      intakeType,
      executor: pool,
    }),
  ]);

  await ensureAcademicPlanSemesterConfigsTable();

  const connection = await pool.getConnection();
  let successfulPlans = 0;
  let clearedNeedsFixCount = 0;
  const failedStudents = [...initialFailedStudents];

  try {
    await connection.beginTransaction();

    for (const student of studentsToProcess) {
      const savepointName = `student_plan_${student.student_id}`;
      try {
        await connection.query(`SAVEPOINT ${savepointName}`);

        const [planResult] = await connection.query(
          `INSERT INTO academic_plans (student_id, intake_id, start_semester, status)
           VALUES (?, ?, ?, 'draft')`,
          [student.student_id, intakeId, student.starting_semester],
        );

        const planId = Number((planResult as any).insertId);

        const plannedResult = await planAcademicPlanForStudent({
          student: student as AcademicPlanPlannerStudentInput,
          programId,
          sessionId,
          intakeType,
          programCourses,
          lifecyclePattern: lifecycleConfig.lifecycle_pattern,
          creditLimits,
          executor: connection,
        });

        if (plannedResult.courseAssignments.length > 0) {
          const values = plannedResult.courseAssignments.map((assignment) => [
            planId,
            assignment.course_id,
            assignment.semester,
            assignment.status,
          ]);

          await connection.query(
            `INSERT INTO academic_plan_details (academic_plan_id, course_id, semester, status)
             VALUES ?`,
            [values],
          );
        }

        if (plannedResult.semesterConfigs.length > 0) {
          await replaceAcademicPlanSemesterConfigs(
            planId,
            plannedResult.semesterConfigs,
            connection,
          );
        }

        if (student.persist_transferred_course_ids) {
          await connection.query(
            `DELETE FROM student_transferred_courses WHERE student_id = ?`,
            [student.student_id],
          );

          if (student.transferred_course_ids.size > 0) {
            const transferredCourseValues = Array.from(
              student.transferred_course_ids,
            ).map((courseId) => [student.student_id, courseId]);

            await connection.query(
              `INSERT INTO student_transferred_courses (student_id, course_id)
               VALUES ?`,
              [transferredCourseValues],
            );
          }
        }

        if (
          student.persist_total_credit_transferred ||
          student.system_assigned_entry_semester != null ||
          student.entry_semester_assignment_note != null
        ) {
          if (student.is_entry_semester_override) {
            await connection.query(
              `UPDATE students
               SET total_credit_transferred = ?,
                   system_assigned_entry_semester = ?,
                   entry_semester_rule_id = ?,
                   entry_semester_assignment_note = ?
               WHERE id = ?`,
              [
                student.total_credit_transferred,
                student.system_assigned_entry_semester,
                student.entry_semester_rule_id ?? null,
                student.entry_semester_assignment_note ?? null,
                student.student_id,
              ],
            );
          } else {
            await connection.query(
              `UPDATE students
               SET total_credit_transferred = ?,
                   starting_semester = ?,
                   system_assigned_entry_semester = ?,
                   final_entry_semester = ?,
                   entry_semester_rule_id = ?,
                   entry_semester_assignment_note = ?,
                   is_entry_semester_override = FALSE,
                   entry_semester_override_reason = NULL,
                   entry_semester_overridden_by = NULL,
                   entry_semester_overridden_at = NULL
               WHERE id = ?`,
              [
                student.total_credit_transferred,
                student.starting_semester,
                student.system_assigned_entry_semester,
                student.final_entry_semester ?? student.starting_semester,
                student.entry_semester_rule_id ?? null,
                student.entry_semester_assignment_note ?? null,
                student.student_id,
              ],
            );
          }
        }

        if (student.clear_intake_assessment_needs_fix) {
          await connection.query(
            `UPDATE students
             SET intake_assessment_needs_fix = 0,
                 intake_assessment_error_reason = NULL
             WHERE id = ?`,
            [student.student_id],
          );
          clearedNeedsFixCount++;
        }

        await connection.query(`RELEASE SAVEPOINT ${savepointName}`);
        successfulPlans++;
      } catch (error: any) {
        await connection.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
        await connection.query(`RELEASE SAVEPOINT ${savepointName}`);

        failedStudents.push({
          student_id: student.student_id,
          matric_no: student.matric_no,
          reason: error.message || "Unknown error during plan generation",
        });
      }
    }

    const [intakeStudentRows] = await connection.query(
      `SELECT COUNT(*) AS total_students
       FROM students
       WHERE program_id = ? AND intake_year = ?`,
      [programId, intakeYear],
    );
    const totalStudents = Number(
      (intakeStudentRows as any[])[0]?.total_students ?? 0,
    );

    const [successfulPlanRows] = await connection.query(
      `SELECT COUNT(DISTINCT ap.student_id) AS successful_plans
       FROM academic_plans ap
       JOIN students s ON s.id = ap.student_id
       WHERE ap.intake_id = ?
         AND s.program_id = ?
         AND s.intake_year = ?`,
      [intakeId, programId, intakeYear],
    );
    const successfulPlanCount = Number(
      (successfulPlanRows as any[])[0]?.successful_plans ?? 0,
    );
    const failedPlanCount = Math.max(totalStudents - successfulPlanCount, 0);

    await connection.query(
      `UPDATE academic_planning_intakes 
       SET status = 'generated',
           total_students = ?,
           successful_plans = ?,
           failed_plans = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [totalStudents, successfulPlanCount, failedPlanCount, intakeId],
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to generate academic plans",
    });
  } finally {
    connection.release();
  }

  return {
    summary: {
      total_processed: studentsToProcess.length,
      successful: successfulPlans,
      failed: failedStudents.length,
      skipped_existing: skippedExistingCount,
      cleared_needs_fix: clearedNeedsFixCount,
    },
    failed_students: failedStudents,
  };
};
