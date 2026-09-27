import type { FamilyName } from "./family.js";

/** Display names need not be unique; persistence arbitrates slug collisions. */
export const familySlug = (name: typeof FamilyName.Type): string =>
  name
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036F]/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "") || "family";
export const canManageFamily = (role: string): boolean => role === "owner";
