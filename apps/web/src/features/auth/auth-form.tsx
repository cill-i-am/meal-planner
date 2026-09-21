import {
  createFormHook,
  createFormHookContexts,
  useStore,
} from "@tanstack/react-form";
import type { AnyFieldMeta } from "@tanstack/react-form";
import { useRef, useState } from "react";
import type { ComponentProps, ReactNode } from "react";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "../../components/ui/field.js";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "../../components/ui/input-group.js";
import { Input } from "../../components/ui/input.js";
import { cn } from "../../lib/utils.js";

const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly disabled: boolean;
  readonly serverError?: string | undefined;
  readonly autoComplete: string;
  readonly description?: string;
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
      <Input {...inputProps} type={props.type ?? "text"} />
      {isInvalid && (
        <FieldError id={`${props.id}-error`} errors={errors}>
          {errors.length === 0 ? props.serverError : undefined}
        </FieldError>
      )}
    </Field>
  );
};

const PasswordField = (props: FieldProps) => {
  const { errors, isInvalid, inputProps } = useAuthField(props);
  const [visible, setVisible] = useState(false);
  return (
    <Field data-invalid={isInvalid} data-disabled={props.disabled}>
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <InputGroup>
        <InputGroupInput {...inputProps} type={visible ? "text" : "password"} />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="sm"
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            aria-controls={props.id}
            onClick={() => setVisible(!visible)}
            disabled={props.disabled}
          >
            {visible ? "Hide" : "Show"}
          </InputGroupButton>
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
}: {
  readonly children: ReactNode;
  readonly pending: boolean;
}) => {
  const form = useFormContext();
  const element = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={element}
      className="max-w-auth flex w-full flex-col gap-5"
      noValidate
      aria-labelledby="auth-title"
      aria-busy={pending}
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await form.handleSubmit();
        element.current
          ?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')
          ?.focus();
      }}
    >
      {children}
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
  className,
}: {
  readonly children: ReactNode;
  readonly errorTitle: string;
  readonly rejected: boolean;
} & Pick<ComponentProps<"h1">, "className">) => {
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
        <h1
          tabIndex={-1}
          id="auth-title"
          className={cn(
            "font-auth m-0 pb-2 tracking-tight focus:outline-none",
            invalid || rejected
              ? "text-task-mobile/8 font-semibold md:text-4xl/10"
              : className
          )}
        >
          {invalid || rejected ? errorTitle : children}
        </h1>
      )}
    </form.Subscribe>
  );
};

export const { useAppForm: useAuthForm } = createFormHook({
  fieldComponents: { PasswordField, TextField },
  fieldContext,
  formComponents: { Frame, Heading },
  formContext,
});
