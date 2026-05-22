import { pool } from "~~/server/utils/db";

type QueryExecutor = {
  query: (sql: string, values?: any) => Promise<any>;
};

export interface ProgramStructureCourse {
  id: number;
  course_id: number;
  course_code: string;
  course_name: string;
  credit_hour: number;
  semester: number;
  course_type: string;
  course_group: string | null;
  prerequisite_course_id: number | null;
}

export const getProgramStructureCourses = async ({
  sessionId,
  executor = pool,
}: {
  sessionId: number;
  executor?: QueryExecutor;
}) => {
  const [courseRows] = await executor.query(
    `SELECT
      pc.id,
      pc.course_id,
      c.course_code,
      c.course_name,
      c.credit_hour,
      pc.semester,
      pc.course_type,
      pc.course_group,
      pc.prerequisite_course_id
    FROM program_courses pc
    JOIN courses c ON pc.course_id = c.id
    WHERE pc.session_id = ?
    ORDER BY pc.semester, pc.id`,
    [sessionId],
  );

  return courseRows as ProgramStructureCourse[];
};
