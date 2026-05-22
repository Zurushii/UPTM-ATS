import {
  getApplicableSemesterRuleExceptionAllowances,
} from "~~/server/utils/semester-rule-exception-windows";
import {
  getLifecycleSemesterTypeForSlot,
  type IntakeLifecyclePattern,
} from "~~/server/utils/intake-lifecycle";
import { getSemesterRulePlanCreditExceptions } from "~~/server/utils/semester-rule-plans";
import {
  resolveSemesterRuleJourney,
  type ResolvedSemesterRuleJourneyPlanSet,
  type SemesterRuleJourneySlotRole,
} from "~~/server/utils/semester-rule-journeys";

type QueryExecutor = {
  query: (sql: string, values?: any) => Promise<any>;
};

export interface ProgramCourse {
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

export interface AcademicPlanCreditLimits {
  long_min: number;
  long_max: number;
  short_min: number;
  short_max: number;
}

export interface AcademicPlanPlannerStudentInput {
  student_id: number;
  matric_no: string;
  starting_semester: number;
  total_credit_transferred: number;
  transferred_course_ids: Set<number>;
}

export interface AcademicPlanCourseAssignment {
  course_id: number;
  semester: number;
  status: string;
}

export interface AcademicPlanGeneratedSemesterConfig {
  semester_number: number;
  semester_type: "L" | "S";
  is_li: boolean;
  target_credits: number;
  is_credit_exception: boolean;
  credit_exception_reason: string | null;
}

interface PlannerSemesterSlot {
  slot_order: number;
  semester_number: number;
  semester_type: "L" | "S";
  is_li: boolean;
  slot_role: SemesterRuleJourneySlotRole;
  target_credits: number;
  is_credit_exception: boolean;
  credit_exception_reason: string | null;
  source: "journey" | "fallback" | "extra";
}

interface RegularCourseCandidate extends ProgramCourse {
  earliest_semester: number;
  preferred_semester: number;
}

type SpecialCourseRole = "fyp1" | "fyp2" | "li";

const buildProgramCourseSpecialRoleMap = (courses: ProgramCourse[]) => {
  const roleByCourseId = new Map<number, SpecialCourseRole>();

  for (const course of courses) {
    if (course.course_type === "Industrial Training") {
      roleByCourseId.set(course.course_id, "li");
    }
  }

  const fypSemesters = Array.from(
    new Set(
      courses
        .filter((course) => course.course_type === "Final Year Project")
        .map((course) => Number(course.semester))
        .filter((semester) => Number.isInteger(semester) && semester > 0),
    ),
  ).sort((left, right) => left - right);

  const fyp1Semester = fypSemesters[0] ?? null;
  const fyp2Semesters = fypSemesters.slice(1);

  for (const course of courses) {
    if (course.course_type !== "Final Year Project") {
      continue;
    }

    if (fyp1Semester != null && Number(course.semester) === fyp1Semester) {
      roleByCourseId.set(course.course_id, "fyp1");
      continue;
    }

    if (fyp2Semesters.includes(Number(course.semester))) {
      roleByCourseId.set(course.course_id, "fyp2");
    }
  }

  return roleByCourseId;
};

const getGroupKey = (course: ProgramCourse) =>
  course.course_group ? `${course.semester}:${course.course_group}` : null;

const splitTransferredAndPlannableCourses = ({
  programCourses,
  transferredCourseIds,
}: {
  programCourses: ProgramCourse[];
  transferredCourseIds: Set<number>;
}) => {
  const transferredCourses: ProgramCourse[] = [];
  const plannableCourses: ProgramCourse[] = [];
  const claimedGroups = new Set<string>();

  for (const course of programCourses) {
    if (!transferredCourseIds.has(course.course_id)) {
      continue;
    }

    const groupKey = getGroupKey(course);
    if (groupKey && claimedGroups.has(groupKey)) {
      continue;
    }

    if (groupKey) {
      claimedGroups.add(groupKey);
    }

    transferredCourses.push(course);
  }

  for (const course of programCourses) {
    if (transferredCourseIds.has(course.course_id)) {
      continue;
    }

    const groupKey = getGroupKey(course);
    if (groupKey && claimedGroups.has(groupKey)) {
      continue;
    }

    if (groupKey) {
      claimedGroups.add(groupKey);
    }

    plannableCourses.push(course);
  }

  return { transferredCourses, plannableCourses };
};

const getRolePreferredSemester = (
  role: SpecialCourseRole,
  courses: ProgramCourse[],
  startingSemester: number,
) => {
  const sourceSemesters = courses
    .map((course) => Number(course.semester))
    .filter((semester) => Number.isInteger(semester) && semester > 0)
    .sort((left, right) => left - right);

  if (sourceSemesters.length === 0) {
    return startingSemester;
  }

  if (role === "fyp2" || role === "li") {
    return Math.max(startingSemester, sourceSemesters[sourceSemesters.length - 1]!);
  }

  return Math.max(startingSemester, sourceSemesters[0]!);
};

const getMaxCreditsForSemesterType = ({
  semesterType,
  creditLimits,
}: {
  semesterType: "L" | "S";
  creditLimits: AcademicPlanCreditLimits;
}) => (semesterType === "L" ? creditLimits.long_max : creditLimits.short_max);

export const planAcademicPlanForStudent = async ({
  student,
  programId,
  sessionId,
  intakeType,
  programCourses,
  lifecyclePattern,
  creditLimits,
  executor,
  resolvedJourneyOverride,
}: {
  student: AcademicPlanPlannerStudentInput;
  programId: number;
  sessionId: number;
  intakeType: string;
  programCourses: ProgramCourse[];
  lifecyclePattern: IntakeLifecyclePattern;
  creditLimits: AcademicPlanCreditLimits;
  executor: QueryExecutor;
  resolvedJourneyOverride?: Pick<
    ResolvedSemesterRuleJourneyPlanSet,
    "journey_slots" | "exception_windows" | "exact_preview"
  > | null;
}): Promise<{
  courseAssignments: AcademicPlanCourseAssignment[];
  semesterConfigs: AcademicPlanGeneratedSemesterConfig[];
}> => {
  const specialRoleByCourseId = buildProgramCourseSpecialRoleMap(programCourses);
  const maxProgramSemester = Math.max(
    ...programCourses.map((course) => Number(course.semester) || 0),
    student.starting_semester,
  );
  const { transferredCourses, plannableCourses } =
    splitTransferredAndPlannableCourses({
      programCourses,
      transferredCourseIds: student.transferred_course_ids,
    });

  const resolvedJourney =
    resolvedJourneyOverride ||
    (await resolveSemesterRuleJourney({
      programId,
      intakeType,
      entrySemester: student.starting_semester,
      sessionId,
      transferredCredits: student.total_credit_transferred,
      executor,
    }));
  const targetCreditsBySemester = new Map(
    (resolvedJourney.exact_preview?.semesters || []).map((semester) => [
      Number(semester.semester_number),
      Number(semester.estimated_credits) || 0,
    ]),
  );

  const exceptionAllowances = getApplicableSemesterRuleExceptionAllowances({
    windows: resolvedJourney.exception_windows,
    transferredCredits: student.total_credit_transferred,
  });

  const semesterSlots: PlannerSemesterSlot[] = resolvedJourney.journey_slots.map(
    (slot) => ({
      slot_order: Number(slot.slot_order),
      semester_number: Number(slot.semester_number),
      semester_type: slot.semester_type,
      is_li: slot.slot_role === "li",
      slot_role: slot.slot_role,
      target_credits:
        targetCreditsBySemester.get(Number(slot.semester_number)) || 0,
      is_credit_exception: false,
      credit_exception_reason: null,
      source: "journey",
    }),
  );

  if (semesterSlots.length === 0) {
    const fallbackSlotCount = Math.max(
      maxProgramSemester - student.starting_semester + 1,
      1,
    );

    for (let index = 0; index < fallbackSlotCount; index++) {
      const slotOrder = index + 1;
      semesterSlots.push({
        slot_order: slotOrder,
        semester_number: student.starting_semester + index,
        semester_type: getLifecycleSemesterTypeForSlot({
          lifecyclePattern,
          slotOrder,
          slotRole: "regular",
        }),
        is_li: false,
        slot_role: "regular",
        target_credits: 0,
        is_credit_exception: false,
        credit_exception_reason: null,
        source: "fallback",
      });
    }
  }

  const courseAssignments: AcademicPlanCourseAssignment[] = transferredCourses.map(
    (course) => ({
      course_id: course.course_id,
      semester: Number(course.semester),
      status: "Transferred",
    }),
  );
  const semesterCreditsUsed = new Map<number, number>();
  const prereqMap = new Map<number, number>();
  for (const course of plannableCourses) {
    if (course.prerequisite_course_id) {
      prereqMap.set(course.course_id, course.prerequisite_course_id);
    }
  }

  const courseById = new Map(
    plannableCourses.map((course) => [course.course_id, course]),
  );

  const sortSemesterSlots = () => {
    semesterSlots.sort((left, right) => {
      if (left.semester_number !== right.semester_number) {
        return left.semester_number - right.semester_number;
      }
      return left.slot_order - right.slot_order;
    });
  };

  const nextSlotOrder = () =>
    Math.max(...semesterSlots.map((slot) => slot.slot_order), 0) + 1;

  const getSlotBySemester = (semesterNumber: number) =>
    semesterSlots.find((slot) => slot.semester_number === semesterNumber) || null;

  const createSlot = ({
    semesterNumber,
    slotRole = "regular",
    forceLong = false,
    source,
  }: {
    semesterNumber: number;
    slotRole?: SemesterRuleJourneySlotRole;
    forceLong?: boolean;
    source: "fallback" | "extra";
  }) => {
    const slotOrder = nextSlotOrder();
    const slot: PlannerSemesterSlot = {
      slot_order: slotOrder,
      semester_number: semesterNumber,
      semester_type: forceLong
        ? "L"
        : getLifecycleSemesterTypeForSlot({
            lifecyclePattern,
            slotOrder,
            slotRole,
          }),
      is_li: slotRole === "li",
      slot_role: slotRole,
      target_credits: 0,
      is_credit_exception: false,
      credit_exception_reason: null,
      source,
    };
    semesterSlots.push(slot);
    sortSemesterSlots();
    return slot;
  };

  const ensureSlotsThroughSemester = (semesterNumber: number) => {
    let highestSemester = Math.max(
      ...semesterSlots.map((slot) => slot.semester_number),
      student.starting_semester - 1,
    );

    while (highestSemester < semesterNumber) {
      highestSemester += 1;
      createSlot({
        semesterNumber: highestSemester,
        slotRole: "regular",
        source: "extra",
      });
    }
  };

  const ensureRegularSlot = ({
    semesterNumber,
    forceLong = false,
  }: {
    semesterNumber: number;
    forceLong?: boolean;
  }): PlannerSemesterSlot | null => {
    const existingSlot = getSlotBySemester(semesterNumber);
    if (existingSlot) {
      if (existingSlot.is_li) {
        return null;
      }

      if (forceLong) {
        existingSlot.semester_type = "L";
      }

      return existingSlot;
    }

    ensureSlotsThroughSemester(semesterNumber);
    const createdSlot = getSlotBySemester(semesterNumber);
    if (!createdSlot || createdSlot.is_li) {
      return null;
    }

    if (forceLong) {
      createdSlot.semester_type = "L";
    }

    return createdSlot;
  };

  const reserveSpecialSlot = ({
    role,
    courses,
  }: {
    role: SpecialCourseRole;
    courses: ProgramCourse[];
  }) => {
    if (courses.length === 0) {
      return null;
    }

    const exactRoleSlot =
      semesterSlots
        .filter((slot) => slot.slot_role === role)
        .sort((left, right) => left.semester_number - right.semester_number)[0] ||
      null;

    if (exactRoleSlot) {
      if (role === "li" || role === "fyp2") {
        exactRoleSlot.semester_type = "L";
      }
      if (role === "li") {
        exactRoleSlot.is_li = true;
      }
      return exactRoleSlot;
    }

    const preferredSemester = getRolePreferredSemester(
      role,
      courses,
      student.starting_semester,
    );
    const forceLong = role === "li" || role === "fyp2";

    const candidateSlots = semesterSlots
      .filter(
        (slot) =>
          slot.semester_number >= preferredSemester &&
          !slot.is_li &&
          slot.slot_role === "regular",
      )
      .sort((left, right) => left.semester_number - right.semester_number);

    const reusableSlot = candidateSlots[0] || null;
    if (reusableSlot) {
      reusableSlot.slot_role = role;
      reusableSlot.is_li = role === "li";
      if (forceLong) {
        reusableSlot.semester_type = "L";
      }
      return reusableSlot;
    }

    let targetSemester = preferredSemester;
    while (true) {
      const slot = ensureRegularSlot({
        semesterNumber: targetSemester,
        forceLong,
      });
      if (slot) {
        slot.slot_role = role;
        slot.is_li = role === "li";
        if (forceLong) {
          slot.semester_type = "L";
        }
        return slot;
      }
      targetSemester += 1;
    }
  };

  const liCourses = plannableCourses.filter(
    (course) => specialRoleByCourseId.get(course.course_id) === "li",
  );
  const fyp1Courses = plannableCourses.filter(
    (course) => specialRoleByCourseId.get(course.course_id) === "fyp1",
  );
  const fyp2Courses = plannableCourses.filter(
    (course) => specialRoleByCourseId.get(course.course_id) === "fyp2",
  );
  const getEarliestSchedulableSemester = (preferredSemester: number) => {
    const nearestSlot =
      semesterSlots
        .filter(
          (slot) =>
            slot.semester_number >= student.starting_semester &&
            slot.semester_number <= preferredSemester &&
            !slot.is_li,
        )
        .sort((left, right) => right.semester_number - left.semester_number)[0] ||
      null;

    return nearestSlot?.semester_number ?? student.starting_semester;
  };
  const regularCourses: RegularCourseCandidate[] = plannableCourses
    .filter((course) => !specialRoleByCourseId.has(course.course_id))
    .map((course) => {
      const preferredSemester = Math.max(
        student.starting_semester,
        Number(course.semester) || student.starting_semester,
      );

      return {
        ...course,
        earliest_semester: getEarliestSchedulableSemester(preferredSemester),
        preferred_semester: preferredSemester,
      };
    });
  const regularCourseById = new Map(
    regularCourses.map((course) => [course.course_id, course] as const),
  );

  for (const [role, courses] of [
    ["fyp1", fyp1Courses],
    ["fyp2", fyp2Courses],
    ["li", liCourses],
  ] as const) {
    const reservedSlot = reserveSpecialSlot({ role, courses });
    if (!reservedSlot) {
      continue;
    }

    for (const course of courses) {
      courseAssignments.push({
        course_id: course.course_id,
        semester: reservedSlot.semester_number,
        status: "Planned",
      });
      semesterCreditsUsed.set(
        reservedSlot.semester_number,
        (semesterCreditsUsed.get(reservedSlot.semester_number) || 0) +
          Number(course.credit_hour || 0),
      );
    }
  }

  sortSemesterSlots();
  const baseTimelineMaxSemester = Math.max(
    ...semesterSlots.map((slot) => slot.semester_number),
    student.starting_semester - 1,
  );

  const sortRegularCourseCandidates = ({
    courses,
    currentSemester,
    allowFuturePreference = false,
  }: {
    courses: RegularCourseCandidate[];
    currentSemester: number;
    allowFuturePreference?: boolean;
  }) =>
    [...courses].sort((left, right) => {
      if (!allowFuturePreference) {
        const leftFuture = left.preferred_semester > currentSemester ? 1 : 0;
        const rightFuture = right.preferred_semester > currentSemester ? 1 : 0;
        if (leftFuture !== rightFuture) {
          return leftFuture - rightFuture;
        }
      }

      if (left.preferred_semester !== right.preferred_semester) {
        return left.preferred_semester - right.preferred_semester;
      }

      if (left.semester !== right.semester) {
        return left.semester - right.semester;
      }

      if (left.credit_hour !== right.credit_hour) {
        return right.credit_hour - left.credit_hour;
      }

      return left.id - right.id;
    });

  const getOverflowCapacity = (slot: PlannerSemesterSlot) =>
    getMaxCreditsForSemesterType({
      semesterType: slot.semester_type,
      creditLimits,
    }) +
    (exceptionAllowances.get(slot.slot_order)?.allowed_overload_credits || 0);

  const getTargetCapacity = (slot: PlannerSemesterSlot) =>
    Math.min(
      Math.max(Number(slot.target_credits) || 0, 0),
      getOverflowCapacity(slot),
    );

  const getMinimumCreditsForSemesterType = ({
    semesterType,
    creditLimits,
  }: {
    semesterType: "L" | "S";
    creditLimits: AcademicPlanCreditLimits;
  }) => (semesterType === "L" ? creditLimits.long_min : creditLimits.short_min);

  const getUnderloadFloor = (slot: PlannerSemesterSlot) =>
    Math.max(
      getMinimumCreditsForSemesterType({
        semesterType: slot.semester_type,
        creditLimits,
      }) -
        (exceptionAllowances.get(slot.slot_order)?.allowed_underload_credits || 0),
      0,
    );

  const prereqSatisfiedBySemester = (
    course: ProgramCourse,
    semesterNumber: number,
  ) => {
    const prereqId = prereqMap.get(course.course_id);
    if (!prereqId) {
      return true;
    }

    if (student.transferred_course_ids.has(prereqId)) {
      return true;
    }

    const prereqAssignment = courseAssignments.find(
      (assignment) =>
        assignment.course_id === prereqId &&
        assignment.status !== "Transferred" &&
        assignment.semester < semesterNumber,
    );

    return !!prereqAssignment;
  };

  const isLongSemesterOnly = (course: ProgramCourse) => {
    const specialRole = specialRoleByCourseId.get(course.course_id);
    return specialRole === "li" || specialRole === "fyp2";
  };

  const canPlaceRegularCourseInSlot = ({
    course,
    slot,
  }: {
    course: ProgramCourse;
    slot: PlannerSemesterSlot;
  }) => {
    if (slot.is_li) {
      return false;
    }

    if (isLongSemesterOnly(course) && slot.semester_type === "S") {
      return false;
    }

    return true;
  };

  const breaksDependentOrder = ({
    courseId,
    targetSemester,
  }: {
    courseId: number;
    targetSemester: number;
  }) => {
    for (const dependentAssignment of courseAssignments) {
      if (
        dependentAssignment.status === "Transferred" ||
        dependentAssignment.course_id === courseId
      ) {
        continue;
      }

      const dependentCourse = courseById.get(dependentAssignment.course_id);
      if (
        dependentCourse?.prerequisite_course_id === courseId &&
        dependentAssignment.semester <= targetSemester
      ) {
        return true;
      }
    }

    return false;
  };

  let unassignedRegularCourses = [...regularCourses];
  let schedulerSafety = 0;
  const assignCoursesToSlot = ({
    slot,
    capacity,
    courses,
  }: {
    slot: PlannerSemesterSlot;
    capacity: number;
    courses: RegularCourseCandidate[];
  }) => {
    let usedCredits = semesterCreditsUsed.get(slot.semester_number) || 0;
    if (usedCredits >= capacity) {
      return 0;
    }

    const scheduledThisSemester = new Set<number>();
    for (const course of courses) {
      if (!canPlaceRegularCourseInSlot({ course, slot })) {
        continue;
      }

      if (usedCredits + Number(course.credit_hour || 0) > capacity) {
        continue;
      }

      courseAssignments.push({
        course_id: course.course_id,
        semester: slot.semester_number,
        status: "Planned",
      });
      scheduledThisSemester.add(course.course_id);
      usedCredits += Number(course.credit_hour || 0);
      semesterCreditsUsed.set(slot.semester_number, usedCredits);
    }

    if (scheduledThisSemester.size > 0) {
      unassignedRegularCourses = unassignedRegularCourses.filter(
        (course) => !scheduledThisSemester.has(course.course_id),
      );
    }

    return scheduledThisSemester.size;
  };

  const sweepCurrentJourneySemesters = (
    getCapacity: (slot: PlannerSemesterSlot) => number,
  ) => {
    let currentSemester = student.starting_semester;

    while (
      unassignedRegularCourses.length > 0 &&
      currentSemester <= baseTimelineMaxSemester &&
      schedulerSafety < 500
    ) {
      schedulerSafety += 1;
      const slot = getSlotBySemester(currentSemester);
      if (!slot || slot.is_li) {
        currentSemester += 1;
        continue;
      }

      assignCoursesToSlot({
        slot,
        capacity: getCapacity(slot),
        courses: sortRegularCourseCandidates({
          courses: unassignedRegularCourses.filter((course) =>
            prereqSatisfiedBySemester(course, slot.semester_number),
          ),
          currentSemester,
        }).filter((course) => course.preferred_semester <= currentSemester),
      });

      currentSemester += 1;
    }
  };

  const fillWithinJourney = (
    getCapacity: (slot: PlannerSemesterSlot) => number,
  ) => {
    let filledWithinJourney = true;

    while (unassignedRegularCourses.length > 0 && filledWithinJourney) {
      filledWithinJourney = false;

      for (const slot of semesterSlots
        .filter(
          (candidate) =>
            candidate.semester_number >= student.starting_semester &&
            candidate.semester_number <= baseTimelineMaxSemester &&
            !candidate.is_li,
        )
        .sort((left, right) => left.semester_number - right.semester_number)) {
        const scheduledCount = assignCoursesToSlot({
          slot,
          capacity: getCapacity(slot),
          courses: sortRegularCourseCandidates({
            courses: unassignedRegularCourses.filter((course) =>
              prereqSatisfiedBySemester(course, slot.semester_number),
            ),
            currentSemester: slot.semester_number,
            allowFuturePreference: true,
          }).filter((course) => course.earliest_semester <= slot.semester_number),
        });

        if (scheduledCount === 0) {
          continue;
        }

        filledWithinJourney = true;

        if (unassignedRegularCourses.length === 0) {
          break;
        }
      }
    }
  };

  sweepCurrentJourneySemesters(getTargetCapacity);
  fillWithinJourney(getTargetCapacity);
  fillWithinJourney(getOverflowCapacity);

  let currentSemester = baseTimelineMaxSemester + 1;
  while (unassignedRegularCourses.length > 0 && schedulerSafety < 1000) {
    schedulerSafety += 1;
    const slot = ensureRegularSlot({ semesterNumber: currentSemester });
    if (!slot) {
      currentSemester += 1;
      continue;
    }

    let usedCredits = semesterCreditsUsed.get(slot.semester_number) || 0;
    const capacity = getOverflowCapacity(slot);
    const availablePool = sortRegularCourseCandidates({
      courses: unassignedRegularCourses.filter((course) =>
        prereqSatisfiedBySemester(course, slot.semester_number),
      ),
      currentSemester,
      allowFuturePreference: true,
    });

    const scheduledThisSemester = new Set<number>();

    for (const course of availablePool) {
      if (!canPlaceRegularCourseInSlot({ course, slot })) {
        continue;
      }

      if (usedCredits + Number(course.credit_hour || 0) > capacity) {
        continue;
      }

      courseAssignments.push({
        course_id: course.course_id,
        semester: slot.semester_number,
        status: "Planned",
      });
      scheduledThisSemester.add(course.course_id);
      usedCredits += Number(course.credit_hour || 0);
      semesterCreditsUsed.set(slot.semester_number, usedCredits);
    }

    if (scheduledThisSemester.size > 0) {
      unassignedRegularCourses = unassignedRegularCourses.filter(
        (course) => !scheduledThisSemester.has(course.course_id),
      );
    }

    currentSemester += 1;
  }

  if (unassignedRegularCourses.length > 0) {
    throw new Error(
      `Unable to finish scheduling ${unassignedRegularCourses.length} regular course(s) for ${student.matric_no}.`,
    );
  }

  const rebalanceAssignments = (getCapacity: (slot: PlannerSemesterSlot) => number) => {
    let movedAny = false;

    const movableAssignments = courseAssignments
      .filter((assignment) => assignment.status !== "Transferred")
      .sort((left, right) => right.semester - left.semester);

    for (const assignment of movableAssignments) {
      const course = courseById.get(assignment.course_id);
      if (!course || specialRoleByCourseId.has(course.course_id)) {
        continue;
      }

      const regularCourse = regularCourses.find(
        (candidate) => candidate.course_id === course.course_id,
      );
      if (!regularCourse) {
        continue;
      }

      const sourceSemester = assignment.semester;
      if (
        sourceSemester <= regularCourse.preferred_semester &&
        sourceSemester <= baseTimelineMaxSemester
      ) {
        continue;
      }

      for (
        let targetSemester = regularCourse.preferred_semester;
        targetSemester < sourceSemester;
        targetSemester++
      ) {
        const targetSlot = ensureRegularSlot({ semesterNumber: targetSemester });
        if (!targetSlot) {
          continue;
        }

        if (!canPlaceRegularCourseInSlot({ course, slot: targetSlot })) {
          continue;
        }

        const targetUsed = semesterCreditsUsed.get(targetSemester) || 0;
        if (
          targetUsed + Number(course.credit_hour || 0) >
          getCapacity(targetSlot)
        ) {
          continue;
        }

        const prereqId = prereqMap.get(course.course_id);
        if (prereqId && !student.transferred_course_ids.has(prereqId)) {
          const prereqAssignment = courseAssignments.find(
            (candidate) =>
              candidate.course_id === prereqId &&
              candidate.status !== "Transferred",
          );

          if (!prereqAssignment || prereqAssignment.semester >= targetSemester) {
            continue;
          }
        }

        if (
          breaksDependentOrder({
            courseId: course.course_id,
            targetSemester,
          })
        ) {
          continue;
        }

        const sourceSlot = getSlotBySemester(sourceSemester);
        const sourceRemainingCredits =
          (semesterCreditsUsed.get(sourceSemester) || 0) -
          Number(course.credit_hour || 0);
        if (
          sourceSlot &&
          !sourceSlot.is_li &&
          sourceSemester <= baseTimelineMaxSemester &&
          sourceRemainingCredits < getUnderloadFloor(sourceSlot)
        ) {
          continue;
        }

        assignment.semester = targetSemester;
        semesterCreditsUsed.set(
          targetSemester,
          targetUsed + Number(course.credit_hour || 0),
        );
        semesterCreditsUsed.set(
          sourceSemester,
          (semesterCreditsUsed.get(sourceSemester) || 0) -
            Number(course.credit_hour || 0),
        );
        movedAny = true;
        break;
      }
    }

    return movedAny;
  };

  while (rebalanceAssignments((slot) =>
    getMaxCreditsForSemesterType({
      semesterType: slot.semester_type,
      creditLimits,
    }),
  )) {}
  while (rebalanceAssignments(getOverflowCapacity)) {}

  const rebalanceUnderloadedSemesters = () => {
    let movedAny = false;

    const targetSlots = semesterSlots
      .filter(
        (slot) =>
          slot.semester_number >= student.starting_semester &&
          slot.semester_number <= baseTimelineMaxSemester &&
          !slot.is_li,
      )
      .sort((left, right) => left.semester_number - right.semester_number);

    for (const targetSlot of targetSlots) {
      const targetFloor = getUnderloadFloor(targetSlot);
      let targetUsed = semesterCreditsUsed.get(targetSlot.semester_number) || 0;

      if (targetFloor <= 0 || targetUsed >= targetFloor) {
        continue;
      }

      let filledTarget = true;
      while (targetUsed < targetFloor && filledTarget) {
        filledTarget = false;
        const remainingShortage = Math.max(targetFloor - targetUsed, 0);

        const candidateAssignments = courseAssignments
          .filter(
            (assignment) =>
              assignment.status !== "Transferred" &&
              assignment.semester !== targetSlot.semester_number,
          )
          .filter((assignment) => {
            const course = courseById.get(assignment.course_id);
            if (!course || specialRoleByCourseId.has(course.course_id)) {
              return false;
            }

            if (
              !prereqSatisfiedBySemester(course, targetSlot.semester_number) ||
              !canPlaceRegularCourseInSlot({ course, slot: targetSlot })
            ) {
              return false;
            }

            if (
              breaksDependentOrder({
                courseId: course.course_id,
                targetSemester: targetSlot.semester_number,
              })
            ) {
              return false;
            }

            const targetUsedCredits =
              semesterCreditsUsed.get(targetSlot.semester_number) || 0;
            if (
              targetUsedCredits + Number(course.credit_hour || 0) >
              getOverflowCapacity(targetSlot)
            ) {
              return false;
            }

            const sourceSlot = getSlotBySemester(assignment.semester);
            if (!sourceSlot || sourceSlot.semester_number > baseTimelineMaxSemester) {
              return true;
            }

            if (sourceSlot.is_li) {
              return true;
            }

            const sourceRemainingCredits =
              (semesterCreditsUsed.get(assignment.semester) || 0) -
              Number(course.credit_hour || 0);

            return sourceRemainingCredits >= getUnderloadFloor(sourceSlot);
          })
          .sort((left, right) => {
            const leftCourse = courseById.get(left.course_id);
            const rightCourse = courseById.get(right.course_id);
            const leftRegular = regularCourses.find(
              (candidate) => candidate.course_id === left.course_id,
            );
            const rightRegular = regularCourses.find(
              (candidate) => candidate.course_id === right.course_id,
            );
            const leftSourceSlot = getSlotBySemester(left.semester);
            const rightSourceSlot = getSlotBySemester(right.semester);

            const leftLiPriority = leftSourceSlot?.is_li ? 0 : 1;
            const rightLiPriority = rightSourceSlot?.is_li ? 0 : 1;
            if (leftLiPriority !== rightLiPriority) {
              return leftLiPriority - rightLiPriority;
            }

            const leftFromLater = left.semester > targetSlot.semester_number ? 0 : 1;
            const rightFromLater =
              right.semester > targetSlot.semester_number ? 0 : 1;
            if (leftFromLater !== rightFromLater) {
              return leftFromLater - rightFromLater;
            }

            const leftDistance = Math.abs(left.semester - targetSlot.semester_number);
            const rightDistance = Math.abs(right.semester - targetSlot.semester_number);
            if (leftDistance !== rightDistance) {
              return leftDistance - rightDistance;
            }

            const leftShortageFit = Math.abs(
              remainingShortage - Number(leftCourse?.credit_hour || 0),
            );
            const rightShortageFit = Math.abs(
              remainingShortage - Number(rightCourse?.credit_hour || 0),
            );
            if (leftShortageFit !== rightShortageFit) {
              return leftShortageFit - rightShortageFit;
            }

            const leftPreferredGap = Math.abs(
              Number(leftRegular?.preferred_semester || left.semester) -
                targetSlot.semester_number,
            );
            const rightPreferredGap = Math.abs(
              Number(rightRegular?.preferred_semester || right.semester) -
                targetSlot.semester_number,
            );
            if (leftPreferredGap !== rightPreferredGap) {
              return leftPreferredGap - rightPreferredGap;
            }

            return left.semester - right.semester;
          });

        const candidateAssignment = candidateAssignments[0];
        if (!candidateAssignment) {
          break;
        }

        const course = courseById.get(candidateAssignment.course_id);
        if (!course) {
          break;
        }

        const sourceSemester = candidateAssignment.semester;
        candidateAssignment.semester = targetSlot.semester_number;
        semesterCreditsUsed.set(
          targetSlot.semester_number,
          targetUsed + Number(course.credit_hour || 0),
        );
        semesterCreditsUsed.set(
          sourceSemester,
          (semesterCreditsUsed.get(sourceSemester) || 0) -
            Number(course.credit_hour || 0),
        );
        targetUsed = semesterCreditsUsed.get(targetSlot.semester_number) || 0;
        movedAny = true;
        filledTarget = true;
      }
    }

    return movedAny;
  };

  while (rebalanceUnderloadedSemesters()) {}

  const collapseExtraSemesterAssignments = () => {
    let movedAny = false;

    const extraAssignments = courseAssignments
      .filter(
        (assignment) =>
          assignment.status !== "Transferred" &&
          assignment.semester > baseTimelineMaxSemester,
      )
      .sort((left, right) => right.semester - left.semester);

    for (const assignment of extraAssignments) {
      const course = courseById.get(assignment.course_id);
      const regularCourse = regularCourseById.get(assignment.course_id);
      if (
        !course ||
        !regularCourse ||
        specialRoleByCourseId.has(course.course_id)
      ) {
        continue;
      }

      const courseCredits = Number(course.credit_hour || 0);
      const targetSlot = semesterSlots
        .filter(
          (slot) =>
            slot.semester_number >= student.starting_semester &&
            slot.semester_number <= baseTimelineMaxSemester &&
            !slot.is_li,
        )
        .filter((slot) => canPlaceRegularCourseInSlot({ course, slot }))
        .filter((slot) =>
          prereqSatisfiedBySemester(course, slot.semester_number),
        )
        .filter(
          (slot) =>
            !breaksDependentOrder({
              courseId: course.course_id,
              targetSemester: slot.semester_number,
            }),
        )
        .filter((slot) => {
          const targetUsed = semesterCreditsUsed.get(slot.semester_number) || 0;
          return targetUsed + courseCredits <= getOverflowCapacity(slot);
        })
        .sort((left, right) => {
          const leftUsed = semesterCreditsUsed.get(left.semester_number) || 0;
          const rightUsed = semesterCreditsUsed.get(right.semester_number) || 0;
          const leftFitsTarget = leftUsed + courseCredits <= getTargetCapacity(left);
          const rightFitsTarget =
            rightUsed + courseCredits <= getTargetCapacity(right);

          if (leftFitsTarget !== rightFitsTarget) {
            return leftFitsTarget ? -1 : 1;
          }

          if (left.semester_number !== right.semester_number) {
            return right.semester_number - left.semester_number;
          }

          const leftPreferredGap = Math.abs(
            left.semester_number - regularCourse.preferred_semester,
          );
          const rightPreferredGap = Math.abs(
            right.semester_number - regularCourse.preferred_semester,
          );

          return leftPreferredGap - rightPreferredGap;
        })[0];

      if (!targetSlot) {
        continue;
      }

      const sourceSemester = assignment.semester;
      const targetUsed = semesterCreditsUsed.get(targetSlot.semester_number) || 0;
      assignment.semester = targetSlot.semester_number;
      semesterCreditsUsed.set(
        targetSlot.semester_number,
        targetUsed + courseCredits,
      );
      semesterCreditsUsed.set(
        sourceSemester,
        Math.max(
          (semesterCreditsUsed.get(sourceSemester) || 0) - courseCredits,
          0,
        ),
      );
      movedAny = true;
    }

    return movedAny;
  };

  while (collapseExtraSemesterAssignments()) {}

  const highestUsedSemester = Math.max(
    ...courseAssignments.map((assignment) => assignment.semester),
    student.starting_semester - 1,
  );
  const plannedCreditsBySemester = new Map<number, number>();
  for (const assignment of courseAssignments) {
    if (assignment.status === "Transferred") {
      continue;
    }

    const course = programCourses.find(
      (candidate) => candidate.course_id === assignment.course_id,
    );
    plannedCreditsBySemester.set(
      assignment.semester,
      (plannedCreditsBySemester.get(assignment.semester) || 0) +
        Number(course?.credit_hour || 0),
    );
  }

  const semesterConfigs = semesterSlots
    .filter((slot) => slot.semester_number <= highestUsedSemester)
    .sort((left, right) => left.semester_number - right.semester_number)
    .map((slot) => ({
      semester_number: slot.semester_number,
      semester_type: slot.semester_type,
      is_li: !!slot.is_li,
      target_credits: plannedCreditsBySemester.get(slot.semester_number) || 0,
      is_credit_exception: false,
      credit_exception_reason: null,
    }));

  const generatedExceptions = getSemesterRulePlanCreditExceptions(
    semesterConfigs.map((config) => ({
      semester_number: config.semester_number,
      semester_type: config.semester_type,
      is_li: config.is_li,
      target_credits: config.target_credits,
      is_credit_exception: false,
      credit_exception_reason: null,
    })),
    {
      total_credit_required: null,
      long_min: creditLimits.long_min,
      long_max: creditLimits.long_max,
      short_min: creditLimits.short_min,
      short_max: creditLimits.short_max,
    },
  );

  const autoAppendedSemesters = Math.max(
    highestUsedSemester - baseTimelineMaxSemester,
    0,
  );
  const generatedReasonBase =
    autoAppendedSemesters > 0
      ? `System-generated from the configured journey with ${autoAppendedSemesters} extra semester(s).`
      : "System-generated from the configured journey.";

  const finalizedSemesterConfigs = semesterConfigs.map((config) => {
    const matchingException = generatedExceptions.find(
      (exception) => exception.semester_number === config.semester_number,
    );

    if (!matchingException) {
      return config;
    }

    const matchingSlot = semesterSlots.find(
      (slot) => slot.semester_number === config.semester_number,
    );
    const configuredWindowReason =
      matchingSlot != null
        ? exceptionAllowances.get(matchingSlot.slot_order)?.default_reason
        : null;

    return {
      ...config,
      is_credit_exception: true,
      credit_exception_reason:
        configuredWindowReason || generatedReasonBase,
    };
  });

  return {
    courseAssignments: courseAssignments.sort((left, right) => {
      if (left.semester !== right.semester) {
        return left.semester - right.semester;
      }

      const leftCourse = courseById.get(left.course_id);
      const rightCourse = courseById.get(right.course_id);
      return (leftCourse?.id || left.course_id) - (rightCourse?.id || right.course_id);
    }),
    semesterConfigs: finalizedSemesterConfigs,
  };
};
