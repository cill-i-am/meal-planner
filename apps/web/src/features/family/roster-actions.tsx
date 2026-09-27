import type {
  HouseholdPerson,
  HouseholdPeopleRoster,
} from "@meal-planner/household-api";
import { MoreHorizontalIcon } from "lucide-react";

import { Button } from "../../components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip.js";
import { canManagePerson } from "./roster-model.js";
import type { RosterAction } from "./roster-model.js";

export const RosterActions = ({
  person,
  roster,
  organizer,
  disabled,
  onAction,
}: {
  readonly person: HouseholdPerson;
  readonly roster: HouseholdPeopleRoster;
  readonly organizer: boolean;
  readonly disabled: boolean;
  readonly onAction: (kind: RosterAction, person: HouseholdPerson) => void;
}) => {
  const allowed = canManagePerson(person, roster, organizer);
  if (!allowed.invite && !allowed.rename && !allowed.remove) {
    return null;
  }
  return (
    <div
      className="flex shrink-0 items-center gap-2"
      data-roster-person-id={person.id}
    >
      {allowed.invite && (
        <Button
          variant="link"
          disabled={disabled}
          onClick={() => onAction("invite", person)}
        >
          {person.associationState === "unlinked"
            ? "Invite to join"
            : "Invite again"}
        </Button>
      )}
      {(allowed.rename || allowed.remove) && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Manage ${person.displayName}`}
                      disabled={disabled}
                    />
                  }
                />
              }
            >
              <MoreHorizontalIcon aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>{`Manage ${person.displayName}`}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" data-theme="auth">
            <DropdownMenuGroup>
              {allowed.rename && (
                <DropdownMenuItem onClick={() => onAction("rename", person)}>
                  Edit name
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
            {allowed.remove && (
              <>
                {allowed.rename && <DropdownMenuSeparator />}
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => onAction("remove", person)}
                  >
                    Remove from family
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};
