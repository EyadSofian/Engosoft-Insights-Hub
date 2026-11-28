import { normalizePersonName } from "./person-name";

/** Verified against the live PBX directory on 2026-11-28, not guessed from a
 * first name. The live reader rechecks the directory before using these IDs. */
export const YEASTAR_EMPLOYEE_IDENTITIES = [
  {
    email: "ahmed.salah@engosoft.com",
    extension: "3005",
    pbxName: "Ahmed Salah",
    name: "Ahmed Salah Aboyazed Hassan",
    aliases: ["Ahmed Salah Abozeid", "Ahmed Salah Aboyazed Hassan"],
  },
  {
    email: "radwa.sameh@engosoft.com",
    extension: "3030",
    pbxName: "Radwa Sameh",
    name: "RADWA SAMEH SALEM",
    aliases: ["RADWA SAMEH SALEM", "Radwa Samah Salem", "Radwa Sameh Mohamed"],
  },
  {
    email: "abdelrahman.hamouda@engosoft.com",
    extension: "3092",
    pbxName: "Abdelrahman Hamouda",
    name: "Abdelrahman Abdelhamid Nasreldin",
    aliases: ["Abdelrahman Abdelhamid Nasreldin", "Abdelrahman_Hamouda"],
  },
  {
    email: "solaf.ali@engosoft.com",
    extension: "3093",
    pbxName: "Solaf Ali",
    name: "Solaf Ali Mostafa Kamal",
    aliases: ["Solaf Ali Mostafa Kamal", "Solaf Ali Mostafa"],
  },
] as const;

export function yeastarEmployeeIdentity(extension: string, name: string) {
  return YEASTAR_EMPLOYEE_IDENTITIES.find(
    (person) =>
      person.extension === extension &&
      [person.pbxName, person.name, ...person.aliases].some(
        (alias) => normalizePersonName(alias) === normalizePersonName(name),
      ),
  );
}

/** Prefer the existing canonical CRM/target row over a loose PBX spelling. */
export function yeastarEmployeeCandidateKeys(extension: string, name: string) {
  const person = yeastarEmployeeIdentity(extension, name);
  return person ? [...new Set([person.name, ...person.aliases].map(normalizePersonName))] : [];
}
