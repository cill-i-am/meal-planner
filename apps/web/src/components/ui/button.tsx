import { clsx } from "clsx";
import type { ButtonHTMLAttributes } from "react";

export const Button = ({
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button className={clsx("button", className)} type={type} {...props} />
);
