-- ======================================================
-- Academic Tracking System (ATS)
-- Database Schema (BetterAuth Integrated)
-- ======================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ======================================================
-- AUTH / BETTERAUTH TABLES
-- ======================================================

CREATE TABLE `user` (
  `id` varchar(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `emailVerified` tinyint(1) NOT NULL,
  `image` text,
  `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `role` text NOT NULL,
  `is_onboarded` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


CREATE TABLE `account` (
  `id` varchar(36) NOT NULL,
  `accountId` text NOT NULL,
  `providerId` text NOT NULL,
  `userId` varchar(36) NOT NULL,
  `accessToken` text,
  `refreshToken` text,
  `idToken` text,
  `accessTokenExpiresAt` timestamp(3) NULL DEFAULT NULL,
  `refreshTokenExpiresAt` timestamp(3) NULL DEFAULT NULL,
  `scope` text,
  `password` text,
  `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` timestamp(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `account_userId_idx` (`userId`),
  CONSTRAINT `account_user_fk`
    FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


CREATE TABLE `session` (
  `id` varchar(36) NOT NULL,
  `expiresAt` timestamp(3) NOT NULL,
  `token` varchar(255) NOT NULL,
  `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` timestamp(3) NOT NULL,
  `ipAddress` text,
  `userAgent` text,
  `userId` varchar(36) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`),
  KEY `session_userId_idx` (`userId`),
  CONSTRAINT `session_user_fk`
    FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


CREATE TABLE `verification` (
  `id` varchar(36) NOT NULL,
  `identifier` varchar(255) NOT NULL,
  `value` text NOT NULL,
  `expiresAt` timestamp(3) NOT NULL,
  `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `verification_identifier_idx` (`identifier`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ======================================================
-- ATS CORE TABLES
-- ======================================================

CREATE TABLE programs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  program_code VARCHAR(20) UNIQUE NOT NULL,
  program_name VARCHAR(150) NOT NULL,
  total_credit_required INT NOT NULL,
  duration_semesters INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE courses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  course_code VARCHAR(20) UNIQUE NOT NULL,
  course_name VARCHAR(150) NOT NULL,
  credit_hour INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE head_of_programs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL UNIQUE,          -- One HoP can only manage one program
  program_id INT NOT NULL UNIQUE,               -- One program can only have one HoP
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_hop_user
    FOREIGN KEY (user_id) REFERENCES `user`(id) ON DELETE CASCADE,

  CONSTRAINT fk_hop_program
    FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  matric_no VARCHAR(30) UNIQUE NOT NULL,
  program_id INT NOT NULL,
  intake_year VARCHAR(4) NOT NULL,              -- Format: MMYY (e.g., 0824 = Aug 2024)
  total_credit_transferred INT DEFAULT 0,       -- Student fills during onboarding
  starting_semester INT DEFAULT 1,              -- Calculated by HoP later
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_student_user
    FOREIGN KEY (user_id) REFERENCES `user`(id) ON DELETE CASCADE,

  CONSTRAINT fk_student_program
    FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE program_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  program_id INT NOT NULL,
  session_name VARCHAR(100) NOT NULL,           -- e.g., "2024/2025 Session 1"
  intake_year VARCHAR(4) NOT NULL,              -- Format: MMYY (e.g., 0824 = Aug 2024)
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_ps_program
    FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE program_courses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  course_id INT NOT NULL,
  semester INT NOT NULL,
  course_type ENUM('Core Computing', 'Free Elective', 'Compulsory', 'Specialization', 'Discipline Core', 'Final Year Project', 'Industrial Training') NOT NULL DEFAULT 'Core Computing',
  course_group VARCHAR(50) DEFAULT NULL,          -- Courses with same group share credits (e.g., "Language Elective")
  prerequisite_course_id INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_pc_session
    FOREIGN KEY (session_id) REFERENCES program_sessions(id) ON DELETE CASCADE,

  CONSTRAINT fk_pc_course
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,

  CONSTRAINT fk_pc_prerequisite
    FOREIGN KEY (prerequisite_course_id) REFERENCES courses(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE semester_entry_rules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  program_id INT NOT NULL,
  intake_type VARCHAR(20) NOT NULL,             -- Flexible intake name (e.g., "May Intake", "Aug Intake")
  credit_transfer INT NOT NULL,                 -- Exact credit transfer value
  entry_semester INT NOT NULL,                  -- Starting semester for this credit level
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_ser_program
    FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE,
  
  INDEX idx_program_intake (program_id, intake_type),
  UNIQUE KEY unique_program_intake_credit (program_id, intake_type, credit_transfer)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE semester_credit_plans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rule_id INT NOT NULL,
  semester_number INT NOT NULL,
  semester_type ENUM('L', 'S') NOT NULL,          -- L = Long semester, S = Short semester
  target_credits INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_scp_rule
    FOREIGN KEY (rule_id) REFERENCES semester_entry_rules(id) ON DELETE CASCADE,
  UNIQUE KEY unique_rule_semester (rule_id, semester_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE academic_plans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  start_semester INT NOT NULL,
  status ENUM('draft', 'approved', 'completed') DEFAULT 'draft',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_ap_student
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE academic_plan_details (
  id INT AUTO_INCREMENT PRIMARY KEY,
  academic_plan_id INT NOT NULL,
  course_id INT NOT NULL,
  semester INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_apd_plan
    FOREIGN KEY (academic_plan_id) REFERENCES academic_plans(id) ON DELETE CASCADE,

  CONSTRAINT fk_apd_course
    FOREIGN KEY (course_id) REFERENCES courses(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
