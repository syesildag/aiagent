import React from 'react';
import { Tooltip, useTheme } from '@mui/material';

interface ContextMeterProps {
  used: number;
  max: number;
}

/**
 * Small SVG donut chart showing context window usage.
 * Color shifts green → yellow → orange → red as usage rises.
 */
export default function ContextMeter({ used, max }: ContextMeterProps) {
  const theme = useTheme();
  const pct = max > 0 ? Math.min(used / max, 1) : 0;
  const pctDisplay = Math.round(pct * 100);

  // Pick fill color based on usage threshold
  let color: string;
  if (pct < 0.7) {
    color = theme.palette.success.main;
  } else if (pct < 0.85) {
    color = theme.palette.warning.main;
  } else if (pct < 0.95) {
    color = (theme.palette.warning as any).dark ?? theme.palette.warning.main;
  } else {
    color = theme.palette.error.main;
  }

  // SVG donut math: circle r=10, circumference = 2πr ≈ 62.83
  const radius = 10;
  const cx = 14;
  const cy = 14;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct);

  const usedK = used >= 1000 ? `${(used / 1000).toFixed(1)}k` : String(used);
  const maxK = max >= 1000 ? `${(max / 1000).toFixed(1)}k` : String(max);
  const tooltipTitle = `Context: ${usedK} / ${maxK} tokens (${pctDisplay}%)`;

  return (
    <Tooltip title={tooltipTitle} placement="top">
      <svg
        width={28}
        height={28}
        viewBox="0 0 28 28"
        style={{
          cursor: 'default',
          flexShrink: 0,
          display: 'block',
        }}
        aria-label={tooltipTitle}
      >
        {/* Background track */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={theme.palette.action.disabledBackground}
          strokeWidth={4}
        />
        {/* Usage arc — starts from top (rotate -90°) */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dashoffset 0.4s ease, stroke 0.4s ease' }}
        />
        {/* Center percentage label */}
        <text
          x={cx}
          y={cy + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={pctDisplay >= 100 ? 5.5 : 6}
          fontFamily={theme.typography.fontFamily}
          fontWeight={600}
          fill={color}
        >
          {pctDisplay}%
        </text>
      </svg>
    </Tooltip>
  );
}
