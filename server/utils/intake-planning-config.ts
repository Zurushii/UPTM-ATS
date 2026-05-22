import { pool } from "~~/server/utils/db";

type QueryExecutor = {
  query: (sql: string, values?: any) => Promise<any>;
};

export interface ResolvedSemesterRuleSet {
  intake_type: string;
  resolution_source: "month_token" | "single_rule_set";
}

export interface ResolvedProgramSession {
  id: number;
  session_name: string;
  intake_year: string;
  is_active: boolean;
  resolution_source: "exact_intake" | "active_session";
}

export interface ResolutionResult<T> {
  status: "resolved" | "ambiguous" | "missing";
  value: T | null;
  reason: string;
  candidates: T[];
}

const MONTH_TOKENS: Record<string, string[]> = {
  "01": ["jan", "january"],
  "02": ["feb", "february"],
  "03": ["mar", "march"],
  "04": ["apr", "april"],
  "05": ["may"],
  "06": ["jun", "june"],
  "07": ["jul", "july"],
  "08": ["aug", "august"],
  "09": ["sep", "sept", "september"],
  "10": ["oct", "october"],
  "11": ["nov", "november"],
  "12": ["dec", "december"],
};

const normalizeForMatching = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hasWholeWord = (haystack: string, needle: string) =>
  new RegExp(`(?:^|\\s)${escapeRegex(needle)}(?:$|\\s)`).test(haystack);

const scoreRuleSetAgainstIntakeYear = (
  intakeType: string,
  intakeYear: string,
): number => {
  const normalizedType = normalizeForMatching(intakeType);
  const month = intakeYear.slice(0, 2);
  const monthTokens = MONTH_TOKENS[month] || [];
  let score = 0;

  for (const token of monthTokens) {
    if (hasWholeWord(normalizedType, token)) {
      score = Math.max(score, token.length > 3 ? 120 : 110);
      continue;
    }

    if (normalizedType.includes(token)) {
      score = Math.max(score, token.length > 3 ? 90 : 80);
    }
  }

  if (hasWholeWord(normalizedType, month)) {
    score = Math.max(score, 40);
  } else if (normalizedType.includes(month)) {
    score = Math.max(score, 25);
  }

  return score;
};

export const resolveSemesterRuleSetForIntake = async ({
  programId,
  intakeYear,
  executor = pool,
}: {
  programId: number;
  intakeYear: string;
  executor?: QueryExecutor;
}): Promise<ResolutionResult<ResolvedSemesterRuleSet>> => {
  const [ruleRows] = await executor.query(
    `SELECT DISTINCT intake_type
     FROM semester_entry_rules
     WHERE program_id = ?
     ORDER BY intake_type ASC`,
    [programId],
  );

  const candidates = (ruleRows as any[]).map((row) => ({
    intake_type: String(row.intake_type),
    resolution_source: "month_token" as const,
  }));

  if (candidates.length === 0) {
    return {
      status: "missing",
      value: null,
      reason:
        "No semester-entry rule sets are available for this program. Create semester rules before processing this intake.",
      candidates: [],
    };
  }

  const scoredCandidates = candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreRuleSetAgainstIntakeYear(candidate.intake_type, intakeYear),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.intake_type.localeCompare(right.intake_type),
    );

  const topScore = scoredCandidates[0]?.score || 0;
  const topMatches =
    topScore > 0
      ? scoredCandidates.filter((candidate) => candidate.score === topScore)
      : [];
  const topMatch = topMatches[0] ?? null;

  if (topMatches.length === 1 && topMatch) {
    return {
      status: "resolved",
      value: {
        intake_type: topMatch.intake_type,
        resolution_source: "month_token",
      },
      reason: `Matched the semester rules '${topMatch.intake_type}' from intake ${intakeYear}.`,
      candidates: candidates,
    };
  }

  if (topMatches.length > 1) {
    return {
      status: "ambiguous",
      value: null,
      reason: `More than one semester-rule set looks valid for intake ${intakeYear}. Please choose the correct rule set manually.`,
      candidates: topMatches.map((candidate) => ({
        intake_type: candidate.intake_type,
        resolution_source: "month_token",
      })),
    };
  }

  if (candidates.length === 1) {
    const onlyCandidate = candidates[0]!;

    return {
      status: "resolved",
      value: {
        intake_type: onlyCandidate.intake_type,
        resolution_source: "single_rule_set",
      },
      reason: `Only one semester-rule set exists for this program, so '${onlyCandidate.intake_type}' will be used automatically.`,
      candidates,
    };
  }

  return {
    status: "ambiguous",
    value: null,
    reason: `The system could not safely infer a semester-rule set for intake ${intakeYear}. Please choose the correct rule set manually.`,
    candidates,
  };
};

export const resolveProgramSessionForIntake = async ({
  programId,
  intakeYear,
  executor = pool,
}: {
  programId: number;
  intakeYear: string;
  executor?: QueryExecutor;
}): Promise<ResolutionResult<ResolvedProgramSession>> => {
  const [exactRows] = await executor.query(
    `SELECT id, session_name, intake_year, is_active
     FROM program_sessions
     WHERE program_id = ? AND intake_year = ?
     ORDER BY is_active DESC, created_at DESC, id DESC`,
    [programId, intakeYear],
  );

  const exactMatches = (exactRows as any[]).map((row) => ({
    id: Number(row.id),
    session_name: String(row.session_name),
    intake_year: String(row.intake_year),
    is_active: !!row.is_active,
    resolution_source: "exact_intake" as const,
  }));
  const exactMatch = exactMatches[0] ?? null;

  if (exactMatches.length === 1 && exactMatch) {
    return {
      status: "resolved",
      value: exactMatch,
      reason: `Matched the program structure '${exactMatch.session_name}' from intake ${intakeYear}.`,
      candidates: exactMatches,
    };
  }

  if (exactMatches.length > 1) {
    const exactActiveMatches = exactMatches.filter((candidate) => candidate.is_active);
    const exactActiveMatch = exactActiveMatches[0] ?? null;

    if (exactActiveMatches.length === 1 && exactActiveMatch) {
      return {
        status: "resolved",
        value: exactActiveMatch,
        reason: `Matched the active program structure '${exactActiveMatch.session_name}' for intake ${intakeYear}.`,
        candidates: exactMatches,
      };
    }

    return {
      status: "ambiguous",
      value: null,
      reason: `More than one program structure exists for intake ${intakeYear}. Please choose the correct structure manually.`,
      candidates: exactMatches,
    };
  }

  const [activeRows] = await executor.query(
    `SELECT id, session_name, intake_year, is_active
     FROM program_sessions
     WHERE program_id = ? AND is_active = 1
     ORDER BY created_at DESC, id DESC`,
    [programId],
  );

  const activeMatches = (activeRows as any[]).map((row) => ({
    id: Number(row.id),
    session_name: String(row.session_name),
    intake_year: String(row.intake_year),
    is_active: !!row.is_active,
    resolution_source: "active_session" as const,
  }));
  const activeMatch = activeMatches[0] ?? null;

  if (activeMatches.length === 1 && activeMatch) {
    return {
      status: "resolved",
      value: activeMatch,
      reason: `No exact program structure was found for intake ${intakeYear}, so the active structure '${activeMatch.session_name}' will be used.`,
      candidates: activeMatches,
    };
  }

  if (activeMatches.length > 1) {
    return {
      status: "ambiguous",
      value: null,
      reason:
        "More than one active program structure exists for this program. Clean up the duplicates or choose the structure manually.",
      candidates: activeMatches,
    };
  }

  return {
    status: "missing",
    value: null,
    reason:
      "No program structure is available for this intake. Create a program session with courses before generating academic plans.",
    candidates: [],
  };
};
