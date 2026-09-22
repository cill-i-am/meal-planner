import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { HTMLProps } from "@base-ui/react/use-render";
import { m } from "motion/react";
import type * as React from "react";

type BaseMotionElementProps = React.ComponentPropsWithRef<"div"> & {
  baseProps: HTMLProps<HTMLDivElement>;
};

const NativeBaseElement = ({
  baseProps,
  ref,
  ...motionProps
}: BaseMotionElementProps) =>
  useRender({
    defaultTagName: "div",
    props: {
      ...mergeProps<"div">(baseProps, motionProps),
      children: baseProps.children,
    },
    ref,
  });

const BaseMotionElement = m.create(NativeBaseElement);

export { BaseMotionElement };
