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
        employeeIds: ["238", "338", "482", "503", "606", "346"],
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
        employeeIds: ["235", "597"],
      },
    ],
  },
] as const;

export const STANDALONE_TARGET_EMPLOYEE_IDS = ["335", "319"] as const;

export interface TargetUnitMemberInput {
  key: string;
  employeeId: string;
  name: string;
  target: number;
  paidRevenue: number;
  orderRevenue: number | null;
}

export interface TargetUnitMember extends TargetUnitMemberInput {
  achievement: number;
  remaining: number;
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
    achievement: member.target > 0 ? (member.paidRevenue / member.target) * 100 : 0,
    remaining: Math.max(0, member.target - member.paidRevenue),
  };
}

function totals(members: TargetUnitMember[]) {
  const target = members.reduce((sum, member) => sum + member.target, 0);
  const paidRevenue = members.reduce((sum, member) => sum + member.paidRevenue, 0);
  const orderRevenue = members.reduce((sum, member) => sum + (member.orderRevenue ?? 0), 0);
  return {
    target,
    paidRevenue,
    orderRevenue,
    achievement: target > 0 ? (paidRevenue / target) * 100 : 0,
    remaining: Math.max(0, target - paidRevenue),
  };
}

export function buildTargetUnitRollup(input: TargetUnitMemberInput[]) {
  const byEmployeeId = new Map(input.map((member) => [member.employeeId, member]));
  const assigned = new Set<string>();

  const units: TargetUnitRollup[] = TARGET_UNIT_LAYOUT.map((unit) => {
    const leaders: TargetLeaderRollup[] = unit.leaders.map((leader) => {
      const members = leader.employeeIds
        .map((employeeId) => byEmployeeId.get(employeeId))
        .filter((member): member is TargetUnitMemberInput => Boolean(member))
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
    byEmployeeId.get(employeeId),
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
