import type { CSSProperties } from "react";
import { FAMILY_LABEL } from "../song/deck";
import { BOXES } from "../song/leitner";
import { FAMILY_META } from "../overview/modes";
import type { MixReason, UnitPreview, UnitStatus } from "../overview/summary";
import { Glyph } from "./Glyph";
import "../overview/unit-card.css";

const STATUS_LABEL: Record<UnitStatus, string> = {
  due: "Due",
  next: "New",
  "in-box": "In progress",
  mastered: "Review",
};

function statusText(unit: UnitPreview): string {
  if (unit.status === "in-box" && unit.box > 0) return `Box ${unit.box}`;
  return STATUS_LABEL[unit.status];
}

export function UnitCard({
  unit,
  label,
  onOpen,
  compact = false,
}: {
  unit: UnitPreview;
  label?: string;
  reason?: MixReason;
  onOpen: () => void;
  compact?: boolean;
}) {
  const meta = FAMILY_META[unit.family];
  const family = FAMILY_LABEL[unit.family];
  const title = unit.title.replace(/^Learn\s+/i, "");
  return (
    <button
      type="button"
      className={`tutor-unit ${compact ? "is-compact" : ""}`}
      style={{ "--fam": meta.color } as CSSProperties}
      onClick={onOpen}
      aria-label={`${label ?? family}: ${unit.title}, ${unit.where}, ${unit.bpm} bpm`}
      title={unit.detail}
    >
      <span className="tutor-unit-icon">
        <Glyph name={meta.glyph} size={20} />
      </span>
      <span className="tutor-unit-body">
        <strong className="tutor-unit-title">{title}</strong>
        <span className="tutor-unit-meta">
          <span>{label ?? family}</span>
          {unit.where && unit.where.trim().toLowerCase() !== title.trim().toLowerCase() ? <span>{unit.where}</span> : null}
          <span className="tutor-unit-tempo"><span aria-hidden="true">♩</span> {unit.bpm}</span>
        </span>
      </span>
      <span className="tutor-unit-evidence">
        {unit.box > 0 ? (
          <span className="tutor-unit-marks" aria-label={`Box ${unit.box} of ${BOXES}`}>
            {Array.from({ length: BOXES }, (_, i) => <i key={i} className={i < unit.box ? "is-filled" : ""} />)}
          </span>
        ) : null}
        <span className="tutor-unit-status" data-status={unit.status}>{statusText(unit)}</span>
      </span>
      <span className="tutor-unit-open"><Glyph name="arrow" size={16} /></span>
    </button>
  );
}
