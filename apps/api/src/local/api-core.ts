import { Layer } from "effect";

import type { AgentConversationHostOptions } from "../agent-conversations.js";
import { makeAgentConversationHttpLayer } from "../agent-conversations.js";
import { makeAuthFamilyHttpLayer } from "../auth-family.js";
import {
  makeHouseholdDomainGateway,
  makeHouseholdMealPlanGateway,
  makeHouseholdMealPlanRequestLayer,
  makeHouseholdPlanningContentGateway,
  makeHouseholdPlanningContentRequestLayer,
  makeHouseholdRequestLayer,
} from "../features/households/household-request-composition.js";

export const makeLocalApiCoreLayer = (options: AgentConversationHostOptions) =>
  Layer.mergeAll(
    makeAuthFamilyHttpLayer(options),
    makeAgentConversationHttpLayer(options),
    makeHouseholdRequestLayer({
      gateway: makeHouseholdDomainGateway(options.domain),
      resolver: options.resolver,
    }),
    makeHouseholdMealPlanRequestLayer({
      gateway: makeHouseholdMealPlanGateway({ domain: options.domain }),
      resolver: options.resolver,
    }),
    makeHouseholdPlanningContentRequestLayer({
      gateway: makeHouseholdPlanningContentGateway({ domain: options.domain }),
      resolver: options.resolver,
    })
  );
