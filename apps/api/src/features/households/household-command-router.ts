import { Effect } from "effect";

import type {
  HouseholdCommandAdmission,
  HouseholdCommandPurpose,
} from "./rpc/command-envelope.js";
import { requireHouseholdCommandAdmission } from "./rpc/command-envelope.js";

export const routeAdmittedHouseholdCommand = <
  ObjectName,
  Household,
  Result,
  LocateError,
  InvokeError,
  InvokeRequirements,
>(input: {
  readonly admission: HouseholdCommandAdmission;
  readonly purpose: HouseholdCommandPurpose;
  readonly locate: (
    organizationId: HouseholdCommandAdmission["organizationId"]
  ) => Effect.Effect<ObjectName, LocateError>;
  readonly getByName: (objectName: ObjectName) => Household;
  readonly invoke: (
    household: Household
  ) => Effect.Effect<Result, InvokeError, InvokeRequirements>;
}) =>
  requireHouseholdCommandAdmission(input.admission, input.purpose).pipe(
    Effect.flatMap(() => input.locate(input.admission.organizationId)),
    Effect.flatMap((objectName) => input.invoke(input.getByName(objectName)))
  );
