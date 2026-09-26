import { Volume2Icon, VolumeXIcon } from "lucide-react";

import { useInteractionSoundPreference } from "../hooks/interaction-sound-preference.js";
import { Button } from "./ui/button.js";
import { IconSwap } from "./ui/icon-swap.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip.js";

export const InteractionSoundToggle = () => {
  const { enabled, setEnabled } = useInteractionSoundPreference();
  const label = enabled
    ? "Mute interaction sounds"
    : "Enable interaction sounds";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            static
            variant="ghost"
            size="icon"
            aria-label={label}
            onClick={() => setEnabled(!enabled)}
          />
        }
      >
        <IconSwap
          active={!enabled}
          activeIcon={VolumeXIcon}
          inactiveIcon={Volume2Icon}
        />
      </TooltipTrigger>
      <TooltipContent data-theme="auth">{label}</TooltipContent>
    </Tooltip>
  );
};
