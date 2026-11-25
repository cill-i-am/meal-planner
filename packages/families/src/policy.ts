import type { FamilyName } from "./family.js";

/** Display names need not be unique; persistence arbitrates slug collisions. */
export const familySlug = (name: typeof FamilyName.Type) => {
  const checkedResult: string =
    name
      .normalize("NFKD")
      .replaceAll(/[\u0300-\u036F]/gu, "")
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, "-")
      .replaceAll(/^-|-$/gu, "") || "family";
  return checkedResult;
};
export const canManageFamily = (role: string) => {
  const checkedResult: boolean = role === "owner";
  return checkedResult;
};
