export type ProgramMaterial = {
  id: string;
  title: string;
  type: "Guide" | "Worksheet" | "Video";
  downloadUrl: string;
};

export type ProgramMilestone = {
  id: string;
  label: string;
  date: string;
  owner: string;
};

export type ProgramDefinition = {
  id: string;
  name: string;
  category: "Prevention" | "Intervention" | "Follow-up";
  summary: string;
  durationWeeks: number;
  materials: ProgramMaterial[];
  chronogram: ProgramMilestone[];
  evaluationQuestions: string[];
};

export type ClientAssignedProgram = {
  clientSlug: string;
  programId: string;
  campaignCode: string;
  status: "scheduled" | "running" | "completed";
  startDate: string;
  endDate: string;
};

export const PROGRAMS_DATABASE: ProgramDefinition[] = [
  {
    id: "stress-management",
    name: "Stress Management Track",
    category: "Prevention",
    summary: "Structured prevention cycle for stress reduction in operational teams.",
    durationWeeks: 8,
    materials: [
      { id: "sm-guide", title: "Manager implementation guide", type: "Guide", downloadUrl: "#" },
      { id: "sm-sheet", title: "Weekly stress check worksheet", type: "Worksheet", downloadUrl: "#" },
      { id: "sm-video", title: "Breathing micro-practice", type: "Video", downloadUrl: "#" },
    ],
    chronogram: [
      { id: "sm-1", label: "Kickoff + baseline pulse", date: "2026-03-10", owner: "HR + Consultancy" },
      { id: "sm-2", label: "Workshop 1: stress triggers", date: "2026-03-17", owner: "Consultancy" },
      { id: "sm-3", label: "Workshop 2: coping routines", date: "2026-03-24", owner: "Consultancy" },
      { id: "sm-4", label: "Final evaluation", date: "2026-04-28", owner: "HR" },
    ],
    evaluationQuestions: [
      "The program was clear and practical for our team.",
      "The interventions reduced day-to-day overload signals.",
      "The materials were useful for managers and employees.",
    ],
  },
  {
    id: "emotional-intelligence",
    name: "Emotional Intelligence Program",
    category: "Intervention",
    summary: "Emotional regulation and conflict handling for high-pressure teams.",
    durationWeeks: 10,
    materials: [
      { id: "ei-guide", title: "Facilitator playbook", type: "Guide", downloadUrl: "#" },
      { id: "ei-sheet", title: "Conflict reflection worksheet", type: "Worksheet", downloadUrl: "#" },
      { id: "ei-video", title: "Feedback conversations", type: "Video", downloadUrl: "#" },
    ],
    chronogram: [
      { id: "ei-1", label: "Program kickoff", date: "2026-02-20", owner: "Consultancy" },
      { id: "ei-2", label: "Manager coaching sprint", date: "2026-03-06", owner: "Consultancy" },
      { id: "ei-3", label: "Department labs", date: "2026-03-27", owner: "HR + Leaders" },
      { id: "ei-4", label: "Outcome review", date: "2026-05-01", owner: "Consultancy" },
    ],
    evaluationQuestions: [
      "Participants improved emotional self-awareness.",
      "Communication quality improved after the sessions.",
      "The program should remain as a continuous initiative.",
    ],
  },
  {
    id: "return-to-balance",
    name: "Return-to-Balance Follow-up",
    category: "Follow-up",
    summary: "Recovery and adaptation checkpoints after high-risk campaigns.",
    durationWeeks: 6,
    materials: [
      { id: "rb-guide", title: "Follow-up protocol", type: "Guide", downloadUrl: "#" },
      { id: "rb-sheet", title: "Weekly adaptation check", type: "Worksheet", downloadUrl: "#" },
    ],
    chronogram: [
      { id: "rb-1", label: "Case prioritization", date: "2026-04-05", owner: "HR" },
      { id: "rb-2", label: "Support routines", date: "2026-04-12", owner: "People managers" },
      { id: "rb-3", label: "Post-follow-up review", date: "2026-05-12", owner: "Consultancy" },
    ],
    evaluationQuestions: [
      "The follow-up cadence was enough to track behavior changes.",
      "The program contributed to reduction of repeated incidents.",
      "The checkpoints improved governance confidence.",
    ],
  },
];

export const CLIENT_ASSIGNED_PROGRAMS: ClientAssignedProgram[] = [
  {
    clientSlug: "techcorp-brasil",
    programId: "stress-management",
    campaignCode: "PRG-2026-Q1-STR",
    status: "running",
    startDate: "2026-03-10",
    endDate: "2026-04-30",
  },
  {
    clientSlug: "techcorp-brasil",
    programId: "emotional-intelligence",
    campaignCode: "PRG-2026-Q1-EI",
    status: "scheduled",
    startDate: "2026-05-06",
    endDate: "2026-07-15",
  },
];

export function findProgramById(programId: string) {
  return PROGRAMS_DATABASE.find((program) => program.id === programId) ?? null;
}

export function listAssignedPrograms(clientSlug: string) {
  return CLIENT_ASSIGNED_PROGRAMS.filter((item) => item.clientSlug === clientSlug);
}
