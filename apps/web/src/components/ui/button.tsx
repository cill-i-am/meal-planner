import { clsx } from "clsx";
import type { ButtonHTMLAttributes } from "react";

export const Button = ({
  className,
  type = "button",
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
}) => (
  <button
    className={clsx(
      "button",
      variant === "secondary" && "button-secondary",
      className
    )}
    type={type}
    {...props}
  />
);
