import { Link } from "@tanstack/react-router";
import {
  BookOpenIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  HeartIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { InteractionSoundToggle } from "../../components/interaction-sound-toggle.js";
import { Avatar, AvatarFallback } from "../../components/ui/avatar.js";
import { Button, buttonVariants } from "../../components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu.js";
import { cn } from "../../lib/utils.js";
import type { HouseholdSummary } from "../auth/index.js";
import type { WorkspaceArea } from "./navigation.js";

const destinations = [
  {
    area: "tastes",
    icon: HeartIcon,
    label: "Our tastes",
    mobileLabel: "Tastes",
  },
  {
    area: "weeks",
    icon: CalendarDaysIcon,
    label: "Our weeks",
    mobileLabel: "Weeks",
  },
  {
    area: "food",
    icon: BookOpenIcon,
    label: "Food book",
    mobileLabel: "Food book",
  },
] as const;

const DesktopNavigation = ({ area }: { readonly area: WorkspaceArea }) => (
  <nav
    aria-label="Family workspace"
    className="hidden items-center gap-2 md:flex"
  >
    {destinations.map((destination) => (
      <Link
        key={destination.area}
        to="/"
        search={{ area: destination.area }}
        aria-current={area === destination.area ? "page" : undefined}
        className={buttonVariants({
          variant: area === destination.area ? "secondary" : "ghost",
        })}
      >
        {destination.label}
      </Link>
    ))}
  </nav>
);

const MobileNavigation = ({ area }: { readonly area: WorkspaceArea }) => (
  <nav
    aria-label="Family workspace"
    className="border-border bg-background pb-safe-bottom sticky bottom-0 flex shrink-0 justify-around border-t px-5 pt-2 md:hidden"
  >
    {destinations.map(({ area: destination, mobileLabel, icon: Icon }) => (
      <Link
        key={destination}
        to="/"
        search={{ area: destination }}
        aria-current={area === destination ? "page" : undefined}
        className={cn(
          "text-foreground flex min-h-14 min-w-24 flex-col items-center justify-center gap-1 rounded-xl px-3 text-xs",
          area === destination && "bg-person-lilac"
        )}
      >
        <Icon aria-hidden="true" className="size-5" />
        {mobileLabel}
      </Link>
    ))}
  </nav>
);

const FamilyMenu = ({
  household,
  households,
  pending,
  onSelectFamily,
  onSignOut,
}: {
  readonly household: HouseholdSummary;
  readonly households: readonly HouseholdSummary[];
  readonly pending: boolean;
  readonly onSelectFamily: (householdId: string) => void;
  readonly onSignOut: () => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={<Button variant="ghost" />}
      aria-label={`${household.name}, family menu`}
    >
      <Avatar>
        <AvatarFallback tone="lilac">
          {household.name.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="hidden max-w-40 truncate sm:inline">
        {household.name}
      </span>
      <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" data-theme="journey" className="min-w-60">
      <DropdownMenuGroup>
        <DropdownMenuLabel>{household.name}</DropdownMenuLabel>
        <DropdownMenuItem render={<Link to="/" search={{ area: "family" }} />}>
          Family &amp; people
        </DropdownMenuItem>
      </DropdownMenuGroup>
      {households.length > 1 ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Switch family</DropdownMenuLabel>
            {households
              .filter((family) => family.id !== household.id)
              .map((family) => (
                <DropdownMenuItem
                  key={family.id}
                  disabled={pending}
                  onClick={() => onSelectFamily(family.id)}
                >
                  {family.name}
                </DropdownMenuItem>
              ))}
          </DropdownMenuGroup>
        </>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem disabled={pending} onClick={onSignOut}>
          Log out
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);

export const WorkspaceShell = ({
  area,
  children,
  household,
  households,
  pending,
  onSelectFamily,
  onSignOut,
}: {
  readonly area: WorkspaceArea;
  readonly children: ReactNode;
  readonly household: HouseholdSummary;
  readonly households: readonly HouseholdSummary[];
  readonly pending: boolean;
  readonly onSelectFamily: (householdId: string) => void;
  readonly onSignOut: () => void;
}) => (
  <div
    data-theme="journey"
    className="bg-background font-auth text-foreground flex min-h-dvh flex-col"
  >
    <a href="#family-workspace" className="sr-only focus:not-sr-only focus:p-4">
      Skip to content
    </a>
    <header className="mx-auto flex w-full max-w-screen-2xl shrink-0 items-center justify-between gap-4 px-5 py-5 md:px-12 md:py-6">
      <Link
        to="/"
        search={{ area: "tastes" }}
        className="text-foreground text-lg font-semibold tracking-tight"
      >
        Meal Planner<span className="hidden xl:inline"> / The family edit</span>
      </Link>
      <DesktopNavigation area={area} />
      <div className="flex items-center gap-1">
        <InteractionSoundToggle />
        <FamilyMenu
          household={household}
          households={households}
          pending={pending}
          onSelectFamily={onSelectFamily}
          onSignOut={onSignOut}
        />
      </div>
    </header>
    <main
      id="family-workspace"
      tabIndex={-1}
      className="mx-auto flex w-full max-w-screen-2xl grow flex-col px-5 pb-8 md:px-12 md:pb-12"
    >
      {children}
    </main>
    <MobileNavigation area={area} />
  </div>
);
