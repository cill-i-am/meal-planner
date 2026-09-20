import { clsx } from "clsx";
import type { HTMLAttributes } from "react";

const skeletonVariants = {
  line: "skeleton-line",
  "short-line": "skeleton-line short",
  title: "skeleton-title",
};

export const Skeleton = ({
  className,
  variant = "line",
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  variant?: keyof typeof skeletonVariants;
}) => (
  <div
    aria-hidden="true"
    className={clsx("skeleton", skeletonVariants[variant], className)}
    {...props}
  />
);
