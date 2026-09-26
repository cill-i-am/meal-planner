import { LazyMotion, MotionConfig, domMax } from "motion/react";
import type { ReactNode } from "react";

const MotionProvider = ({ children }: { children: ReactNode }) => (
  <MotionConfig reducedMotion="user">
    <LazyMotion features={domMax} strict>
      {children}
    </LazyMotion>
  </MotionConfig>
);

export { MotionProvider };
