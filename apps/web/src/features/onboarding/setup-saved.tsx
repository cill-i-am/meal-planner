import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { Button } from "../../components/ui/button.js";
import { useSetup } from "./setup-context.js";
import { setupDestination } from "./setup-state.js";
import { SetupError, SetupStatus } from "./setup-ui.js";

export const SetupSavedPage = () => {
  const setup = useSetup();
  const navigate = useNavigate();
  const resume = useMutation({
    mutationFn: async () => {
      const next = { ...setup.progress, status: "active" as const };
      await setup.save(next);
      await navigate({ href: setupDestination(next) });
    },
  });
  const logout = useMutation({ mutationFn: setup.logout });
  const pending = resume.isPending || logout.isPending;
  const { stage } = setup.progress.checkpoint;
  const nextStep = {
    complete: "Open your workspace",
    "family-create": "Finish creating your family",
    "family-name": "Name your family",
    "family-review": "Review your family",
    ready: "Tell us how you eat",
  }[stage];
  return (
    <SetupStatus
      title="Setup saved"
      description="You can close this page and pick up where you left off."
      footer={
        <Button
          variant="link"
          disabled={pending}
          onClick={() => logout.mutate()}
        >
          Log out
        </Button>
      }
    >
      <p className="flex flex-col gap-1">
        <span className="text-muted-foreground text-sm">Next step</span>
        <span>{nextStep}</span>
      </p>
      {(resume.error || logout.error) && (
        <SetupError>We couldn’t complete that action. Try again.</SetupError>
      )}
      <Button disabled={pending} onClick={() => resume.mutate()}>
        Resume setup
      </Button>
    </SetupStatus>
  );
};
