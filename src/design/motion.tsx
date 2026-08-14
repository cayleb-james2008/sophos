// Motion layer — lightweight, dependency-free transitions built on CSS
// keyframes. Respects prefers-reduced-motion. P4/P5 can use these to animate
// their feature views without pulling in a motion library.

import React, { useEffect, useState } from "react";
import { tokens } from "./tokens";

type CSS = React.CSSProperties;

// ---------------------------------------------------------------------------
// useReducedMotion
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fade — mount fade-in
// ---------------------------------------------------------------------------

export function Fade({
  children,
  duration = tokens.motion.base,
  delay = 0,
  style,
}: {
  children: React.ReactNode;
  duration?: string;
  delay?: number;
  style?: CSS;
}) {
  const reduced = useReducedMotion();
  return (
    <div
      style={{
        animation: reduced ? undefined : `pa-fade-in ${duration} ${tokens.motion.ease} ${delay}ms both`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SlideUp — mount slide-up + fade
// ---------------------------------------------------------------------------

export function SlideUp({
  children,
  duration = tokens.motion.base,
  delay = 0,
  style,
}: {
  children: React.ReactNode;
  duration?: string;
  delay?: number;
  style?: CSS;
}) {
  const reduced = useReducedMotion();
  return (
    <div
      style={{
        animation: reduced
          ? undefined
          : `pa-slide-up ${duration} ${tokens.motion.easeOut} ${delay}ms both`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stagger — container that staggers its StaggerItem children
// ---------------------------------------------------------------------------

export function Stagger({
  children,
  step = 40,
  style,
}: {
  children: React.ReactNode;
  step?: number;
  style?: CSS;
}) {
  const reduced = useReducedMotion();
  const items = React.Children.toArray(children);
  return (
    <div style={style}>
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
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  style?: CSS;
}) {
  return (
    <SlideUp delay={delay} style={style}>
      {children}
    </SlideUp>
  );
}

// ---------------------------------------------------------------------------
// ViewTransition — re-animates its children whenever `transitionKey` changes.
// Use to animate between routed views.
// ---------------------------------------------------------------------------

export function ViewTransition({
  transitionKey,
  children,
  style,
}: {
  transitionKey: string;
  children: React.ReactNode;
  style?: CSS;
}) {
  const reduced = useReducedMotion();
  return (
    <div
      key={transitionKey}
      style={{
        height: "100%",
        animation: reduced ? undefined : `pa-fade-in ${tokens.motion.base} ${tokens.motion.easeOut}`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
