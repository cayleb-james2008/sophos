// Motion layer — lightweight, dependency-free transitions built on CSS
// keyframes. Respects prefers-reduced-motion. P4/P5 can use these to animate
// their feature views without pulling in a motion library.
//
// Animation timing is passed via CSS custom properties so the host stays
// free of inline style composition. The class `.pa-fade` / `.pa-slide-up` /
// `.pa-view-transition` defines the static part of the animation, while the
// caller can tune duration / delay through `--pa-motion-duration` and
// `--pa-motion-delay`.

import React, { useEffect, useState } from "react";
import { tokens } from "./tokens";
import "./motion.css";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function motionVars(duration: string, delay: number): React.CSSProperties {
  return {
    "--pa-motion-duration": duration,
    "--pa-motion-delay": `${delay}ms`,
  } as React.CSSProperties;
}

export function Fade({
  children,
  duration = tokens.motion.base,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  duration?: string;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <div
      className={[reduced ? null : "pa-fade", className].filter(Boolean).join(" ") || undefined}
      style={motionVars(duration, delay)}
    >
      {children}
    </div>
  );
}

export function SlideUp({
  children,
  duration = tokens.motion.base,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  duration?: string;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <div
      className={[reduced ? null : "pa-slide-up", className].filter(Boolean).join(" ") || undefined}
      style={motionVars(duration, delay)}
    >
      {children}
    </div>
  );
}

export function Stagger({
  children,
  step = 40,
  className,
}: {
  children: React.ReactNode;
  step?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const items = React.Children.toArray(children);
  return (
    <div className={className}>
      {items.map((child, i) =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<{ delay?: number }>, {
              delay: reduced ? 0 : i * step,
            })
          : child,
      )}
    </div>
  );
}

export function StaggerItem({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <SlideUp delay={delay} className={className}>
      {children}
    </SlideUp>
  );
}

export function ViewTransition({
  transitionKey,
  children,
  className,
}: {
  transitionKey: string;
  children: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <div
      key={transitionKey}
      className={[reduced ? null : "pa-view-transition", className].filter(Boolean).join(" ") || undefined}
      style={motionVars(tokens.motion.base, 0)}
    >
      {children}
    </div>
  );
}
