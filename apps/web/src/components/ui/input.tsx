import { clsx } from "clsx";
import type { InputHTMLAttributes } from "react";

export const Input = ({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={clsx("input", className)} {...props} />
);
