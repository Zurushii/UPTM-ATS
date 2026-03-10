const mysql = require("mysql2/promise");
require("dotenv").config();

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  // Insert semester_results so it shows properly (student_id=15 for plan 36)
  await pool.query(
    `INSERT INTO semester_results (student_id, academic_plan_id, semester, result_slip_filename, result_slip_path, submitted_at)
     VALUES (15, 36, 1, 'test_sem1.pdf', 'uploads/test_sem1.pdf', NOW()),
            (15, 36, 2, 'test_sem2.pdf', 'uploads/test_sem2.pdf', NOW())
     ON DUPLICATE KEY UPDATE result_slip_filename = VALUES(result_slip_filename)`,
  );
  console.log("Semester results inserted for plan 36");

  // Set plan to draft so student can re-schedule
  await pool.query(`UPDATE academic_plans SET status = 'draft' WHERE id = 36`);
  console.log("Plan 36 set to draft");

  // Verify CGPA
  const [graded] = await pool.query(
    `SELECT apd.grade, c.credit_hour
     FROM academic_plan_details apd
     JOIN courses c ON apd.course_id = c.id
     WHERE apd.academic_plan_id = 36
       AND apd.status IN ('Passed', 'Failed')
       AND apd.grade IS NOT NULL`,
  );

  const gpm = {
    "A+": 4,
    A: 4,
    "A-": 3.67,
    "B+": 3.33,
    B: 3,
    "B-": 2.67,
    "C+": 2.33,
    C: 2,
    "C-": 1.67,
    "D+": 1.33,
    D: 1,
    F: 0,
  };

  let pts = 0,
    cr = 0;
  for (const r of graded) {
    const gp = gpm[r.grade.toUpperCase()] ?? 0;
    pts += gp * r.credit_hour;
    cr += r.credit_hour;
    console.log(
      `  ${r.grade} x ${r.credit_hour}cr = ${(gp * r.credit_hour).toFixed(2)} pts`,
    );
  }
  console.log(`\nTotal points: ${pts.toFixed(2)}`);
  console.log(`Total credits: ${cr}`);
  console.log(`CGPA: ${(pts / cr).toFixed(2)}`);
  console.log(`On probation (< 2.5): ${pts / cr < 2.5}`);

  await pool.end();
})();
