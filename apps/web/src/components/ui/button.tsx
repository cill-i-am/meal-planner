import type { ButtonHTMLAttributes } from "react";

import { cn } from "../../lib/cn.js";

export const Button = ({
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button className={cn("button", className)} type={type} {...props} />
);
