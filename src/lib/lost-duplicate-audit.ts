import { canonicalLossReason } from "./loss-reason-taxonomy";
import { normalizePhone, samePhoneIdentity, type NormalizedPhone } from "./lead-contact-evidence";

/**
 * Evidence behind the "Duplicate" Lost reason.
 *
 * A reason selected in Odoo is a human classification, not proof that a second
 * CRM record exists. This audit deliberately keeps those two facts separate:
 * the declared share is still reported, while identity support is checked from
 * provider lead ids and both phone fields across the available CRM universe.
 */
export interface DuplicateAuditSubject {
  id: string;
  phone: string;
  mobile: string;
  facebookLeadId: string;
  lossReason?: string;
}

export interface DuplicateRecordEvidence {
  id: string;
  supported: boolean;
  matchedRecordCount: number;
  sources: ("provider_id" | "phone")[];
}

export interface LostDuplicateAudit {
  declaredCount: number;
  declaredShare: number | null;
  supportedCount: number;
  unsupportedCount: number;
  supportRate: number | null;
  identityGroups: number;
  universeRecords: number;
  records: DuplicateRecordEvidence[];
}

const providerKey = (value: string): string =>
  String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

class DisjointSet {
  private parent = new Map<string, string>();

  add(id: string) {
    if (id && !this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    const parent = this.parent.get(id) ?? id;
    if (parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  join(left: string, right: string) {
    this.add(left);
    this.add(right);
    const a = this.find(left);
    const b = this.find(right);
    if (a !== b) this.parent.set(b, a);
  }
}

interface IndexedPhone {
  id: string;
  phone: NormalizedPhone;
}

export function auditDuplicateReasons(
  lostRows: readonly DuplicateAuditSubject[],
  universeRows: readonly DuplicateAuditSubject[],
): LostDuplicateAudit {
  const declared = lostRows.filter(
    (row) => canonicalLossReason(row.lossReason ?? "").canonicalReasonKey === "duplicate",
  );
  const universe = new Map<string, DuplicateAuditSubject>();
  for (const row of [...universeRows, ...lostRows]) {
    if (row.id && !universe.has(row.id)) universe.set(row.id, row);
  }

  const sets = new DisjointSet();
  const providerIndex = new Map<string, string[]>();
  const phoneIndex = new Map<string, IndexedPhone[]>();
  const matchSources = new Map<string, Set<"provider_id" | "phone">>();
  const matchedIds = new Map<string, Set<string>>();

  const connect = (left: string, right: string, source: "provider_id" | "phone") => {
    if (!left || !right || left === right) return;
    sets.join(left, right);
    for (const [id, other] of [
      [left, right],
      [right, left],
    ] as const) {
      const ids = matchedIds.get(id) ?? new Set<string>();
      ids.add(other);
      matchedIds.set(id, ids);
      const sources = matchSources.get(id) ?? new Set<"provider_id" | "phone">();
      sources.add(source);
      matchSources.set(id, sources);
    }
  };

  for (const row of universe.values()) {
    sets.add(row.id);
    const provider = providerKey(row.facebookLeadId);
    if (provider) {
      const ids = providerIndex.get(provider) ?? [];
      for (const id of ids) connect(row.id, id, "provider_id");
      ids.push(row.id);
      providerIndex.set(provider, ids);
    }

    const phones = [row.phone, row.mobile]
      .map(normalizePhone)
      .filter(
        (phone, index, all) =>
          phone.key &&
          all.findIndex((other) => other.key === phone.key && samePhoneIdentity(other, phone)) ===
            index,
      );
    for (const phone of phones) {
      const bucket = phoneIndex.get(phone.key) ?? [];
      for (const other of bucket) {
        if (samePhoneIdentity(phone, other.phone)) connect(row.id, other.id, "phone");
      }
      bucket.push({ id: row.id, phone });
      phoneIndex.set(phone.key, bucket);
    }
  }

  const records = declared.map((row) => ({
    id: row.id,
    supported: (matchedIds.get(row.id)?.size ?? 0) > 0,
    matchedRecordCount: matchedIds.get(row.id)?.size ?? 0,
    sources: [...(matchSources.get(row.id) ?? [])],
  }));
  const supportedCount = records.filter((row) => row.supported).length;
  const supportedRoots = new Set(
    records.filter((row) => row.supported).map((row) => sets.find(row.id)),
  );

  return {
    declaredCount: declared.length,
    declaredShare: lostRows.length ? (declared.length / lostRows.length) * 100 : null,
    supportedCount,
    unsupportedCount: declared.length - supportedCount,
    supportRate: declared.length ? (supportedCount / declared.length) * 100 : null,
    identityGroups: supportedRoots.size,
    universeRecords: universe.size,
    records,
  };
}
