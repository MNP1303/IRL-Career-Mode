"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Eraser, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/shared/primitives";
import { AttackHint, Pitch, pointerToCell, usePitchOrientation } from "@/components/pitch/pitch";
import { PITCH, ZONE_COLS, ZONE_ROWS } from "@/lib/domain";
import { describeCell } from "@/lib/heatmap";
import type { ZoneCell } from "@/lib/schema";

type Brush = "1" | "2" | "3" | "erase";
const BRUSHES = [
  { value: "1", label: "Light" },
  { value: "2", label: "Medium" },
  { value: "3", label: "Heavy" },
  { value: "erase", label: <Eraser className="size-4" />, ariaLabel: "Erase" },
] as const;

const CELL_WIDTH = PITCH.length / ZONE_COLS;
const CELL_HEIGHT = PITCH.width / ZONE_ROWS;
const INTENSITY_OPACITY = { 1: 0.3, 2: 0.56, 3: 0.86 } as const;

function withCell(cells: ZoneCell[], col: number, row: number, brush: Brush) {
  const rest = cells.filter((cell) => cell.col !== col || cell.row !== row);
  if (brush === "erase") return rest;
  return [...rest, { col, row, intensity: Number(brush) as ZoneCell["intensity"] }];
}

/** Drag or tap to mark where you played. Tapping a matching cell clears it. */
export function ZonePainter({
  value,
  onChange,
}: {
  value: ZoneCell[];
  onChange: (cells: ZoneCell[]) => void;
}) {
  const orientation = usePitchOrientation();
  const group = useRef<SVGGElement>(null);
  const [brush, setBrush] = useState<Brush>("2");
  const [cursor, setCursor] = useState<{ col: number; row: number } | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const painting = useRef(false);
  const dragged = useRef(false);
  const lastCell = useRef<string | null>(null);

  function paint(col: number, row: number) {
    onChange(withCell(value, col, row, brush));
  }

  function onPointerDown(event: PointerEvent<SVGRectElement>) {
    const cell = pointerToCell(event, group.current);
    if (!cell) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    painting.current = true;
    dragged.current = false;
    lastCell.current = `${cell.col}-${cell.row}`;
    const existing = value.find((entry) => entry.col === cell.col && entry.row === cell.row);
    if (existing && String(existing.intensity) === brush) {
      onChange(withCell(value, cell.col, cell.row, "erase"));
    } else {
      paint(cell.col, cell.row);
    }
  }

  function onPointerMove(event: PointerEvent<SVGRectElement>) {
    const cell = pointerToCell(event, group.current);
    setCursor(cell);
    if (!painting.current || !cell) return;
    const key = `${cell.col}-${cell.row}`;
    if (key === lastCell.current) return;
    lastCell.current = key;
    dragged.current = true;
    paint(cell.col, cell.row);
  }

  function stopPainting() {
    painting.current = false;
  }

  function onKeyDown(event: KeyboardEvent<SVGGElement>) {
    const current = cursor ?? { col: 6, row: 4 };
    const moves: Record<string, [number, number]> =
      orientation === "portrait"
        ? { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
        : { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setCursor({
        col: Math.min(ZONE_COLS - 1, Math.max(0, current.col + move[0])),
        row: Math.min(ZONE_ROWS - 1, Math.max(0, current.row + move[1])),
      });
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      setCursor(current);
      paint(current.col, current.row);
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Brush"
          value={brush}
          onChange={setBrush}
          options={BRUSHES}
          size="sm"
        />
        <div className="flex items-center gap-3">
          <AttackHint orientation={orientation} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={value.length === 0}
            onClick={() => onChange([])}
          >
            <Trash2 />
            Clear
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-[70vh] sm:max-w-none">
        <Pitch
          orientation={orientation}
          label="Activity zone map"
          groupRef={group}
          className="max-h-[62vh] sm:max-h-none"
        >
          {Array.from({ length: ZONE_COLS - 1 }, (_, index) => (
            <line
              key={`col-${index}`}
              x1={(index + 1) * CELL_WIDTH}
              x2={(index + 1) * CELL_WIDTH}
              y1="0"
              y2={PITCH.width}
              stroke="#fff"
              strokeOpacity="0.07"
              strokeWidth="0.12"
            />
          ))}
          {Array.from({ length: ZONE_ROWS - 1 }, (_, index) => (
            <line
              key={`row-${index}`}
              y1={(index + 1) * CELL_HEIGHT}
              y2={(index + 1) * CELL_HEIGHT}
              x1="0"
              x2={PITCH.length}
              stroke="#fff"
              strokeOpacity="0.07"
              strokeWidth="0.12"
            />
          ))}

          {value.map((cell) => (
            <rect
              key={`${cell.col}-${cell.row}`}
              x={cell.col * CELL_WIDTH + 0.3}
              y={cell.row * CELL_HEIGHT + 0.3}
              width={CELL_WIDTH - 0.6}
              height={CELL_HEIGHT - 0.6}
              rx="0.7"
              fill="var(--primary)"
              fillOpacity={INTENSITY_OPACITY[cell.intensity]}
            />
          ))}

          {cursor ? (
            <rect
              x={cursor.col * CELL_WIDTH}
              y={cursor.row * CELL_HEIGHT}
              width={CELL_WIDTH}
              height={CELL_HEIGHT}
              rx="0.7"
              fill="none"
              stroke={keyboard ? "var(--primary)" : "#fff"}
              strokeOpacity={keyboard ? 1 : 0.55}
              strokeWidth="0.3"
              className="pointer-events-none"
            />
          ) : null}

          <g
            role="application"
            aria-roledescription="activity zone painter"
            aria-label="Use the arrow keys to move and Space to mark a zone with the selected brush"
            tabIndex={0}
            onKeyDown={onKeyDown}
            onFocus={() => setKeyboard(true)}
            onBlur={() => setKeyboard(false)}
            className="outline-none"
          >
            <rect
              width={PITCH.length}
              height={PITCH.width}
              fill="transparent"
              className="cursor-crosshair touch-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={stopPainting}
              onPointerCancel={stopPainting}
              onPointerLeave={() => {
                if (!painting.current) setCursor(null);
              }}
            />
          </g>
        </Pitch>
      </div>

      <p className="mt-2 min-h-5 text-sm text-muted-foreground" aria-live="polite">
        {cursor ? `${describeCell(cursor.col, cursor.row)} · ` : ""}
        {value.length === 0
          ? "No zones marked. Skip this if you don't remember, it's optional."
          : `${value.length} ${value.length === 1 ? "zone" : "zones"} marked`}
      </p>
    </div>
  );
}
