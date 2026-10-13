/** Logins of the «Happy Steps» demo dataset (scripts/seed/demo.ts, docs/demo.md). */
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "HappySteps2026";
export const DEMO = {
  superadmin: "+77070000000",
  owner: "+77070000001",
  head: "+77070000002",
  accountant: "+77070000003",
  teacher: "+77070000004",
  clubTeacher: "+77070000005",
  cook: "+77070000006",
  parent: "+77070000007",
  teacherParent: "+77070000008",
} as const;
