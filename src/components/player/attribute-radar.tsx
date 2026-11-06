"use client";

import { useRef } from "react";
import { ATTRIBUTES, type AttributeKey, type Attributes } from "@/lib/domain";
import { RULES } from "@/lib/engine/rules";
import { EASE, gsap, prefersReducedMotion, useGSAP } from "@/lib/gsap";

// Clockwise from the top, grouped so attacking skills sit together.
const AXES: AttributeKey[] = ["pac", "sho", "pas", "dri", "def", "phy"];
const CENTER = 150;
const RADIUS = 104;
// Starting the scale above zero makes strengths and gaps readable at a glance.
const SCALE_MIN = 25;

function point(index: number, value: number) {
  const angle = (Math.PI * 2 * index) / AXES.length - Math.PI / 2;
  const distance = ((value - SCALE_MIN) / (99 - SCALE_MIN)) * RADIUS;
  return [CENTER + Math.cos(angle) * distance, CENTER + Math.sin(angle) * distance] as const;
}

function polygon(values: number[]) {
  return values.map((value, index) => point(index, value).join(",")).join(" ");
}

export function AttributeRadar({ attributes }: { attributes: Attributes }) {
  const values = AXES.map((key) => attributes[key]);
  const baseline = AXES.map(() => RULES.attributes.baseline);
  const shape = useRef<SVGPolygonElement>(null);
  const dots = useRef<(SVGCircleElement | null)[]>([]);
  // What's on screen right now, so a change grows from here rather than restarting.
  const shown = useRef<number[] | null>(null);
  const key = values.join();

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const draw = (current: number[]) => {
        shape.current?.setAttribute("points", polygon(current));
        current.forEach((value, index) => {
          const [x, y] = point(index, value);
          dots.current[index]?.setAttribute("cx", String(x));
          dots.current[index]?.setAttribute("cy", String(y));
        });
      };
      // The first draw grows out of the starting baseline, which is the story the chart tells.
      const proxy = [...(shown.current ?? baseline)];
      draw(proxy);
      gsap.to(proxy, {
        ...Object.fromEntries(values.map((value, index) => [index, value])),
        duration: 0.9,
        delay: shown.current ? 0 : 0.2,
        ease: EASE.settle,
        onUpdate: () => draw(proxy),
        onComplete: () => {
          shown.current = values;
        },
      });
      shown.current = proxy;
    },
    { dependencies: [key] },
  );

  return (
    <svg
      viewBox="0 0 300 300"
      className="mx-auto block w-full max-w-[320px]"
      role="img"
      aria-label={`Attribute radar: ${AXES.map((key) => `${ATTRIBUTES[key].name} ${Math.round(attributes[key])}`).join(", ")}`}
    >
      {[50, 75, 99].map((ring) => (
        <polygon
          key={ring}
          points={polygon(AXES.map(() => ring))}
          fill="none"
          stroke="#fff"
          strokeOpacity={ring === 99 ? 0.14 : 0.07}
        />
      ))}
      {AXES.map((key, index) => {
        const [x, y] = point(index, 99);
        return <line key={key} x1={CENTER} y1={CENTER} x2={x} y2={y} stroke="#fff" strokeOpacity="0.07" />;
      })}
      <polygon points={polygon(baseline)} fill="#fff" fillOpacity="0.04" stroke="#fff" strokeOpacity="0.28" />
      <polygon
        ref={shape}
        points={polygon(values)}
        fill="var(--primary)"
        fillOpacity="0.16"
        stroke="var(--primary)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {AXES.map((axis, index) => {
        const [x, y] = point(index, values[index]);
        return (
          <circle
            key={axis}
            ref={(node) => {
              dots.current[index] = node;
            }}
            cx={x}
            cy={y}
            r="4"
            fill="var(--primary)"
            stroke="var(--card)"
            strokeWidth="2"
          />
        );
      })}
      {AXES.map((key, index) => {
        const [x, y] = point(index, 118);
        return (
          <text key={key} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontFamily="var(--font-montserrat)">
            <tspan fontWeight="700" fontSize="15" fill="#f5f5f5">
              {Math.round(attributes[key])}
            </tspan>
            <tspan dx="4" fontWeight="600" fontSize="12" fill="#a3a3a3" letterSpacing="0.5">
              {ATTRIBUTES[key].code}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}
