import { AgentConversationsApi } from "@meal-planner/agent-conversations-api";
import { FamilyApi } from "@meal-planner/families";
import {
  AuthenticatedHouseholdPlanningContentApi,
  HouseholdApi,
  HouseholdMealPlanApi,
  HouseholdPeopleApi,
} from "@meal-planner/household-api";
import { InvitationReadApi } from "@meal-planner/invitations";
import { RecipeImportApi } from "@meal-planner/recipe-import-api";
import { HttpApi } from "effect/http-api";
import type { HttpApiEndpoint } from "effect/http-api";

import { ProductAccountApi } from "./product-account.js";
import { ProductConversationsApi } from "./product-conversations.contract.js";

/** The existing application contracts are the source for both public protocols. */
export const ProductApi = HttpApi.make("mealPlannerProductApi")
  .addHttpApi(FamilyApi)
  .addHttpApi(HouseholdApi)
  .addHttpApi(HouseholdMealPlanApi)
  .addHttpApi(HouseholdPeopleApi)
  .addHttpApi(AuthenticatedHouseholdPlanningContentApi)
  .addHttpApi(RecipeImportApi)
  .addHttpApi(AgentConversationsApi)
  .addHttpApi(InvitationReadApi)
  .addHttpApi(ProductAccountApi)
  .addHttpApi(ProductConversationsApi);

export type ProductScope =
  | "meal-planner:read"
  | "meal-planner:write"
  | "meal-planner:account"
  | "meal-planner:private"
  | "meal-planner:assistant";

type Groups = typeof ProductApi.groups;
type OperationId = {
  [G in keyof Groups]: `${G & string}.${keyof Groups[G]["endpoints"] & string}`;
}[keyof Groups];

interface OperationPolicy {
  readonly description: string;
  readonly destructive?: true;
  readonly scope?: ProductScope;
  readonly extraScopes?: readonly ProductScope[];
}

const policies = {
  "account.read": {
    description:
      "Read your account identity and email verification status. Never returns session tokens or passwords.",
    scope: "meal-planner:account",
  },
  "agentConversations.family": {
    description:
      "Read a family's shared planning conversation and proposed actions.",
    scope: "meal-planner:assistant",
  },
  "agentConversations.familyAction": {
    description:
      "Answer a specific shared planning action using its original action and mutation identities.",
    scope: "meal-planner:assistant",
  },
  "agentConversations.setup": {
    description:
      "Read your private family-setup conversation and its proposed actions.",
    extraScopes: ["meal-planner:private"],
    scope: "meal-planner:assistant",
  },
  "agentConversations.setupAction": {
    description:
      "Answer a specific proposed family-setup action using its action and mutation identities.",
    extraScopes: ["meal-planner:private"],
    scope: "meal-planner:assistant",
  },
  "conversationTurns.family": {
    description:
      "Start or recover a shared family planning assistant turn. Reuse the turn ID and poll the family conversation for completion.",
    scope: "meal-planner:assistant",
  },
  "conversationTurns.setup": {
    description:
      "Start or recover your private setup assistant turn. Reuse the turn ID and poll the setup conversation for completion.",
    extraScopes: ["meal-planner:private"],
    scope: "meal-planner:assistant",
  },
  "families.complete": {
    description: "Finish a family's setup after its people have been recorded.",
  },
  "families.create": {
    description:
      "Create a family. Keep the same request identity when retrying.",
  },
  "families.get": { description: "Read a family and its current version." },
  "families.list": {
    description:
      "List families you belong to. Use a returned family ID for later operations.",
  },
  "families.resumeCreation": {
    description:
      "Resume an interrupted family creation using its existing family ID.",
  },
  "families.update": {
    description: "Change a family's name or setup with its current version.",
  },
  "households.current": {
    description: "Read household readiness for the explicitly selected family.",
  },
  "invitationRead.read": {
    description: "Read an invitation addressed to you.",
  },
  "invitationRead.respond": {
    description: "Accept or reject an invitation addressed to you.",
  },
  "mealPlans.acceptRevision": {
    description: "Accept the reviewed proposed revision of a meal plan.",
  },
  "mealPlans.approve": {
    description: "Approve the reviewed revision of a draft meal plan.",
  },
  "mealPlans.change": {
    description:
      "Change a draft meal plan with version checks. Read the plan before changing it.",
  },
  "mealPlans.create": {
    description:
      "Create a draft meal plan for a date range. Reuse its request key on retries.",
  },
  "mealPlans.list": { description: "List meal plans for a family." },
  "mealPlans.proposeRevision": {
    description:
      "Propose a revision to an accepted meal plan without replacing the accepted schedule.",
  },
  "mealPlans.read": {
    description:
      "Read a meal plan, its revision, and proposed or accepted schedule.",
  },
  "mealPlans.rejectRevision": {
    description:
      "Discard a proposed meal-plan revision, retaining the accepted schedule.",
    destructive: true,
  },
  "people.archive": {
    description:
      "Archive a family person with a stable mutation ID and current version.",
    destructive: true,
  },
  "people.associateInvitation": {
    description:
      "Associate an existing invitation with a family's adult person record.",
  },
  "people.bootstrapCreator": {
    description:
      "Recover the family creator's person record after interrupted setup.",
  },
  "people.cancelDeparture": {
    description:
      "Cancel an adult departure when its current state permits cancellation.",
  },
  "people.completeAdultLink": {
    description:
      "Complete an invited adult's association with their family person record.",
  },
  "people.create": {
    description:
      "Add an adult or dependant to a family using a stable mutation ID.",
  },
  "people.departAdult": {
    description:
      "Begin an adult's departure from the family. Read the returned operation until settled.",
    destructive: true,
  },
  "people.get": {
    description: "Read one family person's identity, status and version.",
  },
  "people.getDeparture": {
    description: "Read the progress and result of an adult departure.",
  },
  "people.getDepartureByMutation": {
    description:
      "Recover the result of an adult departure by its original mutation ID.",
  },
  "people.getProfile": {
    description:
      "Read a person's household food preferences and safety restrictions. Private interview transcripts are separate.",
  },
  "people.getProfileVersion": {
    description: "Read one saved version of a person's household food profile.",
  },
  "people.inviteAdult": {
    description:
      "Send an invitation for an adult to join this family. This sends email.",
  },
  "people.list": {
    description: "List active and archived people in a family.",
  },
  "people.listProfileAudit": {
    description:
      "Read the change history of a person's household food profile.",
  },
  "people.listProfileVersions": {
    description: "List saved versions of a person's household food profile.",
  },
  "people.mutateProfile": {
    description:
      "Edit a food profile using its current version and a stable mutation ID. Acceptance authority is derived from your identity. Weakening a safety restriction requires the explicit safety-change command.",
  },
  "people.remove": {
    description:
      "Remove a family person with the current lifecycle and association versions.",
    destructive: true,
  },
  "people.rename": {
    description: "Rename a family person using their current version.",
  },
  "people.repairAdultLink": {
    description:
      "Repair an interrupted association between an adult member and a family person.",
  },
  "people.restore": { description: "Restore an archived family person." },
  "people.retryDeparture": {
    description:
      "Resume a failed adult departure using the existing operation identity.",
  },
  "people.returnAdult": {
    description:
      "Return an adult to a family using current association versions.",
  },
  "planningContent.listSavedRecipes": {
    description: "List recipes saved in this family for meal planning.",
  },
  "planningContent.mutate": {
    description:
      "Change a family's planning content with a stable mutation ID and version checks.",
  },
  "planningContent.read": {
    description:
      "Read a family's meals, portions, prepared stock and planning content.",
  },
  "privateInterviews.cancelTurn": {
    description:
      "Cancel your private assistant turn when its current state permits cancellation.",
    destructive: true,
    scope: "meal-planner:private",
  },
  "privateInterviews.command": {
    description:
      "Apply an explicit private interview command using the current version and original mutation ID. Profile confirmation preserves the existing safety and sharing checks.",
    scope: "meal-planner:private",
  },
  "privateInterviews.continueConfirmation": {
    description:
      "Recover a pending private profile confirmation by its original mutation ID. This continues the existing confirmation; it does not create a new one.",
    scope: "meal-planner:private",
  },
  "privateInterviews.list": {
    description:
      "List your private interview sessions in the selected family. Other adults' private transcripts are never included.",
    scope: "meal-planner:private",
  },
  "privateInterviews.read": {
    description:
      "Read your private interview's messages, proposed profile cards, versions and durable turn status. Paginate using the returned ordinals.",
    scope: "meal-planner:private",
  },
  "privateInterviews.start": {
    description:
      "Start or recover a private interview using its original mutation ID.",
    scope: "meal-planner:private",
  },
  "privateInterviews.startTurn": {
    description:
      "Start or recover your private assistant turn. Reuse its turn ID after uncertainty and poll the interview for completion.",
    extraScopes: ["meal-planner:assistant"],
    scope: "meal-planner:private",
  },
  "recipeImportBatches.create": {
    description:
      "Start a batch of TikTok URL recipe imports. Reuse the idempotency key when retrying; poll the returned batch ID.",
  },
  "recipeImportBatches.get": {
    description:
      "Read batch import progress and each recipe's review or failure status.",
  },
  "recipeImportIntents.answerAction": {
    description:
      "Save corrections to a recipe draft's review action. This does not publish the recipe.",
  },
  "recipeImportIntents.cancel": {
    description:
      "Cancel a recipe import using its current version and the same idempotency key on retries.",
    destructive: true,
  },
  "recipeImportIntents.confirmAction": {
    description:
      "Publish the explicitly reviewed recipe action at its current version. Read and correct the draft before confirming.",
  },
  "recipeImportIntents.create": {
    description:
      "Import a recipe from a TikTok video URL. This starts durable work and returns an ID; poll it. Extracted drafts require explicit review before publication.",
  },
  "recipeImportIntents.get": {
    description:
      "Read recipe import progress. Follow requires_action to review the extracted draft; respect retry-after.",
  },
  "recipeImportIntents.getAction": {
    description:
      "Read an extracted recipe draft and its review action, including unresolved fields.",
  },
  "recipeImportIntents.timeline": {
    description: "Read the sanitized progress history of a recipe import.",
  },
  "recipes.get": {
    description:
      "Read a published structured recipe, retaining ingredient quantities, groups and cooking instructions.",
  },
} satisfies Record<OperationId, OperationPolicy>;

const ambientFamilyGroups = new Set([
  "privateInterviews",
  "households",
  "mealPlans",
  "planningContent",
  "recipeImportBatches",
  "recipeImportIntents",
  "recipes",
]);

export interface ProductOperation {
  readonly name: string;
  readonly id: string;
  readonly description: string;
  readonly endpoint: HttpApiEndpoint.Top;
  readonly familyContext: boolean;
  readonly scopes: readonly ProductScope[];
  readonly destructive: boolean;
  readonly readOnly: boolean;
}

const snakeCase = (value: string) =>
  value.replaceAll(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);

export const ProductOperations: readonly ProductOperation[] = Object.values(
  ProductApi.groups
).flatMap((group) =>
  Object.values(group.endpoints).map((endpoint) => {
    const id = `${group.identifier}.${endpoint.identifier}`;
    const policy: OperationPolicy | undefined = Object.entries(policies).find(
      ([key]) => key === id
    )?.[1];
    if (policy === undefined) {
      throw new Error(`Missing public operation policy: ${id}`);
    }
    const familyContext = ambientFamilyGroups.has(group.identifier);
    const readOnly = endpoint.method === "GET";
    const scopes: ProductScope[] = [
      policy.scope ?? (readOnly ? "meal-planner:read" : "meal-planner:write"),
    ];
    if (policy.scope !== undefined && !readOnly) {
      scopes.push("meal-planner:write");
    }
    return {
      description: policy.description,
      destructive: policy.destructive === true,
      endpoint,
      familyContext,
      id,
      name: `${snakeCase(group.identifier)}_${snakeCase(endpoint.identifier)}`,
      readOnly,
      scopes: [...scopes, ...(policy.extraScopes ?? [])],
    };
  })
);

const pathSegments = (path: string) => path.split("/");

export const matchProductOperation = (method: string, pathname: string) => {
  const actual = pathSegments(pathname);
  const checkedResult: ProductOperation | undefined = ProductOperations.find(
    ({ endpoint }) => {
      if (method !== endpoint.method) {
        return false;
      }
      const expected = pathSegments(endpoint.path);
      return (
        actual.length === expected.length &&
        expected.every((part, index) =>
          part.startsWith(":") ? actual[index] !== "" : actual[index] === part
        )
      );
    }
  );
  return checkedResult;
};
