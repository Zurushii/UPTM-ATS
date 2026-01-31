import { pool } from "../../utils/db";
import { auth } from "@@/utils/auth";
import { hashPassword } from "better-auth/crypto";

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers });

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  if (session.user.role !== "STUDENT") {
    throw createError({ statusCode: 403, statusMessage: "Students only" });
  }

  const { full_name, matric_no, intake_year, program_id, password } =
    await readBody(event);

  if (!full_name || !matric_no || !intake_year || !program_id || !password) {
    throw createError({
      statusCode: 400,
      statusMessage: "All fields are required",
    });
  }

  // Validate password
  if (password.length < 8) {
    throw createError({
      statusCode: 400,
      statusMessage: "Password must be at least 8 characters",
    });
  }

  // Validate full_name
  if (full_name.trim().length < 2) {
    throw createError({
      statusCode: 400,
      statusMessage: "Full name must be at least 2 characters",
    });
  }

  // Validate intake_year format (MMYY)
  if (!/^\d{4}$/.test(intake_year)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid intake format. Use MMYY (e.g., 0824)",
    });
  }
  const month = parseInt(intake_year.substring(0, 2), 10);
  if (month < 1 || month > 12) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid month in intake. Must be 01-12",
    });
  }

  const connection = await pool.getConnection();
  try {
    // Check if a reserved student record exists with this matric_no
    const [existing] = await connection.query(
      "SELECT id, status, program_id, intake_year FROM students WHERE matric_no = ?",
      [matric_no],
    );

    const existingStudent = (existing as any[])[0];

    if (existingStudent) {
      // Student record exists
      if (existingStudent.status === "active") {
        throw createError({
          statusCode: 400,
          statusMessage: "Student ID already registered",
        });
      }

      // Reserved student found - verify program and intake match
      if (existingStudent.program_id !== program_id) {
        throw createError({
          statusCode: 400,
          statusMessage: "Program does not match the pre-registered record. Please contact your Head of Program.",
        });
      }

      if (existingStudent.intake_year !== intake_year) {
        throw createError({
          statusCode: 400,
          statusMessage: `Intake year does not match the pre-registered record (${existingStudent.intake_year}). Please verify your intake year.`,
        });
      }

      await connection.beginTransaction();

      // Link the reserved student to this user account and activate
      await connection.query(
        `UPDATE students 
         SET user_id = ?, status = 'active'
         WHERE id = ?`,
        [session.user.id, existingStudent.id],
      );

      // Update user name and mark as onboarded
      await connection.query(
        "UPDATE user SET name = ?, is_onboarded = 1 WHERE id = ?",
        [full_name.trim(), session.user.id],
      );

      // Hash password and create credential account for email/password login
      const hashedPassword = await hashPassword(password);

      await connection.query(
        `INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
         VALUES (UUID(), ?, 'credential', ?, ?, NOW(3), NOW(3))
         ON DUPLICATE KEY UPDATE password = VALUES(password), updatedAt = NOW(3)`,
        [session.user.email, session.user.id, hashedPassword],
      );

      await connection.commit();
      return { success: true, linked_reserved: true };
    }

    // No existing student - create new active student record
    await connection.beginTransaction();

    // Insert student record
    await connection.query(
      `INSERT INTO students (user_id, status, matric_no, program_id, intake_year)
       VALUES (?, 'active', ?, ?, ?)`,
      [session.user.id, matric_no, program_id, intake_year],
    );

    // Update user name and mark as onboarded
    await connection.query(
      "UPDATE user SET name = ?, is_onboarded = 1 WHERE id = ?",
      [full_name.trim(), session.user.id],
    );

    // Hash password and create credential account for email/password login
    const hashedPassword = await hashPassword(password);

    await connection.query(
      `INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
       VALUES (UUID(), ?, 'credential', ?, ?, NOW(3), NOW(3))
       ON DUPLICATE KEY UPDATE password = VALUES(password), updatedAt = NOW(3)`,
      [session.user.email, session.user.id, hashedPassword],
    );

    await connection.commit();
    return { success: true };
  } catch (error: any) {
    await connection.rollback();
    if (error.statusCode) throw error;
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to complete onboarding",
    });
  } finally {
    connection.release();
  }
});
