import React from 'react';
import { Tooltip } from '@mui/material';

interface Props {
  used: number;
  max: number;
  size?: number;
}

function getColor(ratio: number): string {
  if (ratio >= 0.9) return '#f44336';
  if (ratio >= 0.8) return '#ff9800';
  if (ratio >= 0.6) return '#ffeb3b';
  return '#4caf50';
}

export const ContextPieChart: React.FC<Props> = ({ used, max, size = 28 }) => {
  const ratio = max > 0 ? Math.min(used / max, 1) : 0;
  const pct = Math.round(ratio * 100);
  const r = size / 2 - 2;
  const cx = size / 2;
  const circ = 2 * Math.PI * r;
  const sw = size * 0.18;

  return (
    <Tooltip title={`Context: ${pct}% (${used.toLocaleString()} / ${max.toLocaleString()} tokens)`} arrow>
      <svg
        width={size}
        height={size}
        style={{ flexShrink: 0, cursor: 'default', display: 'block' }}
        aria-label={`Context usage ${pct}%`}
      >
        {/* Background track */}
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={sw} />
        {/* Filled arc */}
        {ratio > 0 && (
          <circle
            cx={cx} cy={cx} r={r}
            fill="none"
            stroke={getColor(ratio)}
            strokeWidth={sw}
            strokeDasharray={`${circ * ratio} ${circ * (1 - ratio)}`}
            transform={`rotate(-90 ${cx} ${cx})`}
            strokeLinecap="butt"
          />
        )}
      </svg>
    </Tooltip>
  );
};
