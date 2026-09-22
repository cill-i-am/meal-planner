import {
  createFormHook,
  createFormHookContexts,
  useStore,
} from "@tanstack/react-form";
import type { AnyFieldMeta } from "@tanstack/react-form";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useRef, useState } from "react";
import type { ReactNode } from "react";

import { useInteractionSound } from "../../hooks/use-interaction-sound.js";
import { cn } from "../../lib/utils.js";
import { Card, CardTitle } from "../ui/card.js";
import { Checkbox } from "../ui/checkbox.js";
import { Collapsible, CollapsibleContent } from "../ui/collapsible.js";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "../ui/field.js";
import { IconSwap } from "../ui/icon-swap.js";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "../ui/input-group.js";
import { Input } from "../ui/input.js";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.js";

const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly disabled: boolean;
  readonly serverError?: string | undefined;
  readonly autoComplete: string;
  readonly description?: string;
  readonly maxLength?: number;
}

const useAuthField = ({
  id,
  disabled,
  serverError,
  autoComplete,
  description,
}: FieldProps) => {
  const field = useFieldContext<string>();
  const attempts = useStore(
    field.form.store,
    (state) => state.submissionAttempts
  );
  const errors =
    field.state.meta.isBlurred || attempts > 0 ? field.state.meta.errors : [];
  const isInvalid = errors.length > 0 || serverError !== undefined;
  const descriptionId = description ? `${id}-help` : undefined;
  const describedBy = isInvalid ? `${id}-error` : descriptionId;
  return {
    errors,
    inputProps: {
      "aria-describedby": describedBy,
      "aria-invalid": isInvalid,
      autoComplete,
      disabled,
      id,
      name: field.name,
      onBlur: () => {
        field.handleBlur();
        void field.form.validate("change");
      },
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        field.handleChange(event.target.value),
      required: true,
      value: field.state.value,
    },
    isInvalid,
  };
};

const TextField = (
  props: FieldProps & { readonly type?: "text" | "email" }
) => {
  const { errors, isInvalid, inputProps } = useAuthField(props);
  return (
    <Field data-invalid={isInvalid} data-disabled={props.disabled}>
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <Input
        {...inputProps}
        maxLength={props.maxLength}
        type={props.type ?? "text"}
      />
      {isInvalid && (
        <FieldError id={`${props.id}-error`} errors={errors}>
          {errors.length === 0 ? props.serverError : undefined}
        </FieldError>
      )}
    </Field>
  );
};

const ParticipationField = ({
  id,
  disabled,
}: {
  readonly id: string;
  readonly disabled: boolean;
}) => {
  const field = useFieldContext<string>();
  const playInteractionSound = useInteractionSound();
  const attempts = useStore(
    field.form.store,
    (state) => state.submissionAttempts
  );
  const errors =
    field.state.meta.isBlurred || attempts > 0 ? field.state.meta.errors : [];
  return (
    <Field data-invalid={errors.length > 0} data-disabled={disabled}>
      <FieldLabel id={`${id}-label`}>Person type</FieldLabel>
      <ToggleGroup
        variant="segment"
        aria-labelledby={`${id}-label`}
        aria-describedby={errors.length ? `${id}-error` : `${id}-help`}
        aria-invalid={errors.length > 0}
        disabled={disabled}
        value={field.state.value ? [field.state.value] : []}
        onValueChange={(value) => {
          const next = value[0] ?? "";
          if (next !== field.state.value) {
            field.handleChange(next);
            void playInteractionSound();
          }
        }}
        onBlur={() => field.handleBlur()}
      >
        <ToggleGroupItem value="adult">Adult</ToggleGroupItem>
        <ToggleGroupItem value="dependant">Child</ToggleGroupItem>
      </ToggleGroup>
      {errors.length > 0 && <FieldError id={`${id}-error`} errors={errors} />}
      {field.state.value && (
        <FieldDescription id={`${id}-help`}>
          {field.state.value === "adult"
            ? "You can add them without an account or invite them to join."
            : "You’ll manage their food preferences. No account needed."}
        </FieldDescription>
      )}
    </Field>
  );
};

const InviteField = ({
  disabled,
  children,
}: {
  readonly disabled: boolean;
  readonly children: ReactNode;
}) => {
  const field = useFieldContext<boolean>();
  const playInteractionSound = useInteractionSound();
  return (
    <Collapsible open={field.state.value} variant="invite">
      <Field
        orientation="horizontal"
        data-disabled={disabled}
        className="relative"
      >
        <FieldLabel
          id="person-invite-label"
          htmlFor="person-invite"
          variant="inviteCard"
        >
          <span>Invite them to join</span>
          <span
            id="person-invite-help"
            aria-hidden="true"
            className="text-muted-foreground text-sm leading-5 font-normal"
          >
            Let them sign in and manage their preferences.
          </span>
        </FieldLabel>
        <Checkbox
          id="person-invite"
          name={field.name}
          aria-describedby="person-invite-help"
          aria-controls="person-invite-details"
          aria-expanded={field.state.value}
          checked={field.state.value}
          onCheckedChange={(checked) => {
            if (checked !== field.state.value) {
              field.handleChange(checked);
              if (!checked) {
                field.form.setFieldMeta("email", (meta) => ({
                  ...meta,
                  errorMap: {},
                  errors: [],
                }));
              }
              void playInteractionSound();
            }
          }}
          onBlur={field.handleBlur}
          disabled={disabled}
          className="absolute top-1/2 right-4 size-5 -translate-y-1/2"
        />
      </Field>
      <CollapsibleContent
        id="person-invite-details"
        aria-labelledby="person-invite-label"
        inert={!field.state.value}
      >
        <div className="border-border bg-control border-t p-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
};

const PasswordField = (props: FieldProps & { readonly action?: ReactNode }) => {
  const { errors, isInvalid, inputProps } = useAuthField(props);
  const [visible, setVisible] = useState(false);
  const playInteractionSound = useInteractionSound();
  const visibilityLabel = visible ? "Hide password" : "Show password";
  return (
    <Field data-invalid={isInvalid} data-disabled={props.disabled}>
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
        {props.action}
      </div>
      <InputGroup>
        <InputGroupInput {...inputProps} type={visible ? "text" : "password"} />
        <InputGroupAddon align="inline-end">
          <Tooltip>
            <TooltipTrigger
              render={
                <InputGroupButton
                  static
                  size="icon-sm"
                  aria-label={visibilityLabel}
                  aria-pressed={visible}
                  aria-controls={props.id}
                  onClick={() => {
                    setVisible(!visible);
                    void playInteractionSound();
                  }}
                  disabled={props.disabled}
                />
              }
            >
              <IconSwap
                active={visible}
                activeIcon={EyeOffIcon}
                inactiveIcon={EyeIcon}
              />
            </TooltipTrigger>
            <TooltipContent data-theme="auth">{visibilityLabel}</TooltipContent>
          </Tooltip>
        </InputGroupAddon>
      </InputGroup>
      {!isInvalid && props.description && (
        <FieldDescription id={`${props.id}-help`}>
          {props.description}
        </FieldDescription>
      )}
      {isInvalid && (
        <FieldError id={`${props.id}-error`} errors={errors}>
          {errors.length === 0 ? props.serverError : undefined}
        </FieldError>
      )}
    </Field>
  );
};

const Frame = ({
  children,
  pending,
  className = "max-w-auth",
  size = "default",
}: {
  readonly className?: string;
  readonly children: ReactNode;
  readonly pending: boolean;
  readonly size?: "default" | "sm";
}) => {
  const form = useFormContext();
  const element = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={element}
      className={cn("w-full", className)}
      noValidate
      aria-labelledby="auth-title"
      aria-busy={pending}
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await form.handleSubmit();
        element.current
          ?.querySelector<HTMLElement>(
            'input[aria-invalid="true"]:not(:disabled), [aria-invalid="true"] button:not(:disabled)'
          )
          ?.focus();
      }}
    >
      <Card size={size}>{children}</Card>
      <form.Subscribe
        selector={(state) =>
          state.submissionAttempts > 0 && state.errors.length > 0
        }
      >
        {(invalid) =>
          invalid ? (
            <p role="alert" className="sr-only">
              Check the highlighted fields before continuing.
            </p>
          ) : null
        }
      </form.Subscribe>
    </form>
  );
};

const Heading = ({
  children,
  errorTitle,
  rejected,
}: {
  readonly children: ReactNode;
  readonly errorTitle: string;
  readonly rejected: boolean;
}) => {
  const form = useFormContext();
  return (
    <form.Subscribe
      selector={(state) =>
        Object.values<AnyFieldMeta | undefined>(state.fieldMeta).some(
          (meta) =>
            meta !== undefined &&
            (meta.isBlurred || state.submissionAttempts > 0) &&
            meta.errors.length > 0
        )
      }
    >
      {(invalid) => (
        <CardTitle>
          <h1
            tabIndex={-1}
            id="auth-title"
            className="text-task-mobile/8 md:text-task-desktop/9 font-semibold tracking-tight focus:outline-none"
          >
            {invalid || rejected ? errorTitle : children}
          </h1>
        </CardTitle>
      )}
    </form.Subscribe>
  );
};

export const { useAppForm } = createFormHook({
  fieldComponents: {
    InviteField,
    ParticipationField,
    PasswordField,
    TextField,
  },
  fieldContext,
  formComponents: { Frame, Heading },
  formContext,
});
