import { normalizePersonName } from "./person-name.ts";

/**
 * The September sales organisation supplied by management.
 *
 * Employee ids are the stable join key. Names and team-leader spellings have
 * changed in Odoo and in older target workbooks, so neither is safe enough to
 * decide which unit owns a quota.
 */
export const TARGET_UNIT_LAYOUT = [
  {
    key: "bahaa",
    nameAr: "وحدة بهاء",
    nameEn: "Bahaa's Unit",
    leaders: [
      {
        key: "bahaa-ramadan",
        nameAr: "فريق بهاء رمضان",
        nameEn: "Bahaa Ramadan Team",
        // Hady (319) is a member of Bahaa's team, not an independent target.
        employeeIds: ["238", "338", "482", "503", "606", "346", "319"],
      },
      {
        key: "ahmed-saeed",
        nameAr: "فريق أحمد سعيد",
        nameEn: "Ahmed Saeed Team",
        employeeIds: ["630", "602", "635"],
      },
    ],
  },
  {
    key: "asmaa",
    nameAr: "وحدة أسماء",
    nameEn: "Asmaa's Unit",
    leaders: [
      {
        key: "nader-aziz",
        nameAr: "فريق نادر عزيز",
        nameEn: "Nader Aziz Team",
        employeeIds: ["632", "558", "631", "457", "619", "378", "292"],
      },
      {
        key: "asmaa-fathy",
        nameAr: "فريق أسماء فتحي",
        nameEn: "Asmaa Fathy Team",
        // Abdullah Mohsen (335) is a member of Asmaa's team, not an independent target.
        // Sara has sales but no published personal quota; her row is still
        // shown inside the team while excluded from target achievement totals.
        employeeIds: [
          "235",
          "597",
          "335",
          "sara.abdullah@engosoft.com",
          "workbook:ahmed-salah-aboyazed",
          "workbook:abdelrahman-abdelhamid",
          "workbook:solaf-ali",
          "workbook:radwa-samah",
        ],
      },
    ],
  },
] as const;

export const STANDALONE_TARGET_EMPLOYEE_IDS = [] as const;

const TARGET_UNIT_EMPLOYEE_IDS = new Set<string>(
  TARGET_UNIT_LAYOUT.flatMap((unit) => unit.leaders.flatMap((leader) => leader.employeeIds)),
);

/** True for people explicitly assigned to a unit, including untargeted members. */
export function isTargetUnitEmployee(employeeId: string): boolean {
  return TARGET_UNIT_EMPLOYEE_IDS.has(employeeId);
}

export interface TargetUnitMemberInput {
  key: string;
  employeeId: string;
  name: string;
  /** `null` means the person has sales but no published personal quota. */
  target: number | null;
  paidRevenue: number;
  orderRevenue: number | null;
  /** Published assignment for the selected window, not the latest org chart. */
  teamLeader?: string;
  supervisor?: string;
  /** No matched activity row. Keep the quota, but do not invent performance. */
  rosterOnly?: boolean;
}

export interface TargetUnitMember extends TargetUnitMemberInput {
  achievement: number | null;
  remaining: number | null;
}

export interface TargetRosterAssignment {
  employeeId: string;
  name: string;
  teamLeader: string;
  supervisor: string;
  target: number;
}

/** A person with no activity must not disappear with their published quota. */
export function includeTargetRoster(
  activity: TargetUnitMemberInput[],
  roster: TargetRosterAssignment[] = [],
): TargetUnitMemberInput[] {
  const present = new Set(activity.map((row) => row.employeeId));
  return [
    ...activity,
    ...roster
      .filter((row) => !present.has(row.employeeId))
      .map((row) => ({
        ...row,
        key: `roster:${row.employeeId}`,
        paidRevenue: 0,
        orderRevenue: null,
        rosterOnly: true,
      })),
  ];
}

export interface TargetLeaderRollup {
  key: string;
  nameAr: string;
  nameEn: string;
  target: number;
  paidRevenue: number;
  orderRevenue: number;
  achievement: number;
  remaining: number;
  members: TargetUnitMember[];
}

export interface TargetUnitRollup {
  key: string;
  nameAr: string;
  nameEn: string;
  target: number;
  paidRevenue: number;
  orderRevenue: number;
  achievement: number;
  remaining: number;
  leaders: TargetLeaderRollup[];
}

function memberRollup(member: TargetUnitMemberInput): TargetUnitMember {
  return {
    ...member,
    achievement:
      member.target !== null && member.target > 0
        ? (member.paidRevenue / member.target) * 100
        : null,
    remaining: member.target !== null ? Math.max(0, member.target - member.paidRevenue) : null,
  };
}

function totals(members: TargetUnitMember[]) {
  // Untargeted members remain visible inside their team, but their collections
  // must stay outside target achievement — the same rule used by the employee
  // target cards and the overall target notice.
  const targeted = members.filter((member) => member.target !== null);
  const target = targeted.reduce((sum, member) => sum + (member.target ?? 0), 0);
  const paidRevenue = targeted.reduce((sum, member) => sum + member.paidRevenue, 0);
  const orderRevenue = targeted.reduce((sum, member) => sum + (member.orderRevenue ?? 0), 0);
  return {
    target,
    paidRevenue,
    orderRevenue,
    achievement: target > 0 ? (paidRevenue / target) * 100 : 0,
    remaining: Math.max(0, target - paidRevenue),
  };
}

export function buildTargetUnitRollup(input: TargetUnitMemberInput[]) {
  // Preserve the existing stable-ID deduplication: aliases must never publish
  // the same person's quota twice in a team total.
  input = [...new Map(input.map((member) => [member.employeeId, member])).values()];
  const assigned = new Set<string>();

  const units: TargetUnitRollup[] = TARGET_UNIT_LAYOUT.map((unit) => {
    const definitions: {
      key: string;
      nameAr: string;
      nameEn: string;
      employeeIds: readonly string[];
    }[] = [...unit.leaders];
    if (unit.key === "asmaa" && input.some((member) => member.teamLeader === "Nader Aziz Resale")) {
      definitions.splice(1, 0, {
        key: "nader-aziz-resale",
        nameAr: "فريق نادر عزيز — إعادة البيع",
        nameEn: "Nader Aziz Resale Team",
        employeeIds: [],
      });
    }
    const normalized = (value: string) => normalizePersonName(value).replace(/ramdan/g, "ramadan");
    const expectedSupervisor = unit.key === "bahaa" ? "Bahaa Ramadan" : "Asmaa Fathy";
    const leaders: TargetLeaderRollup[] = definitions.map((leader) => {
      const expectedLeader =
        leader.key === "bahaa-ramadan"
          ? "Bahaa Ramadan"
          : leader.key === "ahmed-saeed"
            ? "Ahmed Saeed"
            : leader.key === "nader-aziz"
              ? "Nader Aziz"
              : leader.key === "nader-aziz-resale"
                ? "Nader Aziz Resale"
                : "Asmaa Fathy";
      const members = input
        .filter((member) =>
          member.teamLeader !== undefined
            ? normalized(member.teamLeader) === normalized(expectedLeader) &&
              normalized(member.supervisor || "") === normalized(expectedSupervisor)
            : leader.employeeIds.includes(member.employeeId),
        )
        .map((member) => {
          assigned.add(member.employeeId);
          return memberRollup(member);
        });
      return { ...leader, ...totals(members), members };
    });
    const members = leaders.flatMap((leader) => leader.members);
    return { ...unit, ...totals(members), leaders };
  });

  const standalone = STANDALONE_TARGET_EMPLOYEE_IDS.map((employeeId) =>
    input.find((member) => member.employeeId === employeeId),
  )
    .filter((member): member is TargetUnitMemberInput => Boolean(member))
    .map((member) => {
      assigned.add(member.employeeId);
      return memberRollup(member);
    });

  // Never make a published target disappear because the org chart changed.
  // These rows stay visible as unassigned until management maps them.
  const unassigned = input.filter((member) => !assigned.has(member.employeeId)).map(memberRollup);

  const allMembers = [
    ...units.flatMap((unit) => unit.leaders.flatMap((leader) => leader.members)),
    ...standalone,
    ...unassigned,
  ];

  return {
    units,
    standalone,
    unassigned,
    ...totals(allMembers),
  };
}
