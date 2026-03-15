import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  CircularProgress,
  IconButton,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Logout as LogoutIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';

// ─── Constants ───────────────────────────────────────────────────────────────

const PIXELS_PER_MIN = 4;          // horizontal zoom: px per minute
const CHANNEL_COL_WIDTH = 140;     // px – sticky left column
const ROW_HEIGHT = 52;             // px – each channel row
const HEADER_HEIGHT = 36;          // px – time-slot header
const SLOT_MINUTES = 30;           // granularity of time-slot labels

// ─── Types ───────────────────────────────────────────────────────────────────

interface Channel {
  id: string;
  displayName: string;
  icon?: string;
}

interface Programme {
  channelId: string;
  start: Date;
  stop: Date;
  title: string;
  desc?: string;
  category?: string;
}

// ─── XMLTV helpers ───────────────────────────────────────────────────────────

/** Parse "20240115083000 +0100" → UTC Date */
function parseXmltvDate(raw: string): Date {
  const s = raw.trim();
  const year   = parseInt(s.slice(0, 4), 10);
  const month  = parseInt(s.slice(4, 6), 10) - 1;
  const day    = parseInt(s.slice(6, 8), 10);
  const hour   = parseInt(s.slice(8, 10), 10);
  const minute = parseInt(s.slice(10, 12), 10);
  const second = parseInt(s.slice(12, 14), 10);

  // Parse optional timezone offset "+0100" or "-0500"
  const tzMatch = s.slice(14).match(/([+-])(\d{2})(\d{2})/);
  let offsetMs = 0;
  if (tzMatch) {
    const sign = tzMatch[1] === '+' ? 1 : -1;
    offsetMs = sign * (parseInt(tzMatch[2], 10) * 60 + parseInt(tzMatch[3], 10)) * 60000;
  }

  return new Date(Date.UTC(year, month, day, hour, minute, second) - offsetMs);
}

function parseXmltvDoc(xmlText: string): { channels: Channel[]; programmes: Programme[] } {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');

  const channels: Channel[] = Array.from(doc.querySelectorAll('channel')).map(el => ({
    id: el.getAttribute('id') ?? '',
    displayName: el.querySelector('display-name')?.textContent?.trim() ?? '',
    icon: el.querySelector('icon')?.getAttribute('src') ?? undefined,
  }));

  const programmes: Programme[] = Array.from(doc.querySelectorAll('programme'))
    .map(el => {
      const startRaw = el.getAttribute('start') ?? '';
      const stopRaw  = el.getAttribute('stop')  ?? '';
      return {
        channelId: el.getAttribute('channel') ?? '',
        start: parseXmltvDate(startRaw),
        stop:  parseXmltvDate(stopRaw),
        title: el.querySelector('title')?.textContent?.trim() ?? '—',
        desc:  el.querySelector('desc')?.textContent?.trim(),
        category: el.querySelector('category')?.textContent?.trim(),
      };
    })
    .filter(p => !isNaN(p.start.getTime()) && !isNaN(p.stop.getTime()));

  return { channels, programmes };
}

// ─── Day helpers ─────────────────────────────────────────────────────────────

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function formatDayLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// ─── ProgrammeBlock ──────────────────────────────────────────────────────────

interface ProgrammeBlockProps {
  prog: Programme;
  dayStart: Date;
  dayEnd: Date;
}

const ProgrammeBlock: React.FC<ProgrammeBlockProps> = ({ prog, dayStart, dayEnd }) => {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);

  const visStart = prog.start < dayStart ? dayStart : prog.start;
  const visStop  = prog.stop  > dayEnd   ? dayEnd   : prog.stop;
  const leftMin  = (visStart.getTime() - dayStart.getTime()) / 60000;
  const widthMin = (visStop.getTime()  - visStart.getTime()) / 60000;
  if (widthMin <= 0) return null;

  const now = new Date();
  const isCurrent = prog.start <= now && now < prog.stop;

  const bg = isCurrent
    ? theme.palette.primary.main
    : theme.palette.mode === 'dark' ? '#2a2a38' : '#e8e8f0';
  const textColor = isCurrent
    ? '#fff'
    : theme.palette.text.primary;

  const tooltipContent = [
    `${formatTime(prog.start)} – ${formatTime(prog.stop)}`,
    prog.desc,
    prog.category ? `[${prog.category}]` : undefined,
  ].filter(Boolean).join('\n');

  return (
    <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tooltipContent}</span>} arrow>
      <Box
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        sx={{
          position: 'absolute',
          left: leftMin * PIXELS_PER_MIN,
          width: widthMin * PIXELS_PER_MIN - 2,
          top: 2,
          bottom: 2,
          bgcolor: hovered
            ? (isCurrent ? theme.palette.primary.dark : theme.palette.action.hover)
            : bg,
          borderRadius: 1,
          px: 0.75,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          overflow: 'hidden',
          cursor: 'default',
          border: `1px solid ${theme.palette.divider}`,
          transition: 'background-color 0.15s',
        }}
      >
        <Typography
          variant="caption"
          noWrap
          sx={{ color: textColor, fontWeight: isCurrent ? 600 : 400, lineHeight: 1.3 }}
        >
          {prog.title}
        </Typography>
        {widthMin >= 45 && (
          <Typography variant="caption" noWrap sx={{ color: textColor, opacity: 0.7, fontSize: '0.65rem' }}>
            {formatTime(prog.start)}
          </Typography>
        )}
      </Box>
    </Tooltip>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

interface XmltvViewerProps {
  session: string;
}

const XmltvViewer: React.FC<XmltvViewerProps> = ({ session }) => {
  const theme = useTheme();
  const { logout } = useAuth();

  const [channels, setChannels]     = useState<Channel[]>([]);
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date>(startOfDay(new Date()));

  const gridRef = useRef<HTMLDivElement>(null);

  // ── Fetch XMLTV data ──────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/xmltv/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session }),
      });
      if (res.status === 401) { logout(); return; }
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const xml = await res.text();
      const { channels: ch, programmes: pr } = parseXmltvDoc(xml);
      setChannels(ch);
      setProgrammes(pr);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load guide data');
    } finally {
      setLoading(false);
    }
  }, [session, logout]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Scroll to current time on load ───────────────────────────────────────
  useEffect(() => {
    if (!loading && gridRef.current) {
      const now = new Date();
      const dayStart = startOfDay(now);
      const minutesIn = (now.getTime() - dayStart.getTime()) / 60000;
      const scrollTarget = CHANNEL_COL_WIDTH + minutesIn * PIXELS_PER_MIN - 200;
      gridRef.current.scrollLeft = Math.max(0, scrollTarget);
    }
  }, [loading]);

  // ── Derived data for selected day ─────────────────────────────────────────
  const dayStart = selectedDay;
  const dayEnd   = useMemo(() => addDays(selectedDay, 1), [selectedDay]);

  const programmesByChannel = useMemo(() => {
    const map = new Map<string, Programme[]>();
    for (const p of programmes) {
      if (p.stop <= dayStart || p.start >= dayEnd) continue;
      const list = map.get(p.channelId) ?? [];
      list.push(p);
      map.set(p.channelId, list);
    }
    return map;
  }, [programmes, dayStart, dayEnd]);

  // Time-slot labels for the header
  const timeSlots = useMemo(() => {
    const slots: Date[] = [];
    const t = new Date(dayStart);
    while (t < dayEnd) {
      slots.push(new Date(t));
      t.setMinutes(t.getMinutes() + SLOT_MINUTES);
    }
    return slots;
  }, [dayStart, dayEnd]);

  const totalDayMinutes = 24 * 60;
  const gridWidth = totalDayMinutes * PIXELS_PER_MIN;

  const now = new Date();
  const nowOffsetPx = (now.getTime() - dayStart.getTime()) / 60000 * PIXELS_PER_MIN;
  const showNowLine = now >= dayStart && now < dayEnd;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100dvh', bgcolor: 'background.default' }}>

      {/* ── Toolbar ── */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1,
        bgcolor: 'background.paper', borderBottom: `1px solid ${theme.palette.divider}`,
        flexShrink: 0,
      }}>
        <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main', mr: 'auto' }}>
          📺 TV Guide
        </Typography>

        {/* Day navigation */}
        <IconButton size="small" onClick={() => setSelectedDay(d => addDays(d, -1))}>
          <ChevronLeftIcon />
        </IconButton>
        <Typography variant="body2" sx={{ minWidth: 130, textAlign: 'center', fontWeight: 500 }}>
          {formatDayLabel(selectedDay)}
        </Typography>
        <IconButton size="small" onClick={() => setSelectedDay(d => addDays(d, 1))}>
          <ChevronRightIcon />
        </IconButton>

        <Tooltip title="Refresh">
          <span>
            <IconButton size="small" onClick={loadData} disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Logout">
          <IconButton size="small" onClick={logout}>
            <LogoutIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {/* ── Content ── */}
      {loading && (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CircularProgress color="primary" />
        </Box>
      )}

      {error && !loading && (
        <Box sx={{ p: 3 }}>
          <Alert severity="error" action={
            <IconButton size="small" onClick={loadData}><RefreshIcon fontSize="small" /></IconButton>
          }>{error}</Alert>
        </Box>
      )}

      {!loading && !error && (
        <Box ref={gridRef} sx={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          {/* Sticky time-slot header */}
          <Box sx={{
            display: 'flex',
            position: 'sticky',
            top: 0,
            zIndex: 3,
            bgcolor: 'background.paper',
            borderBottom: `1px solid ${theme.palette.divider}`,
            height: HEADER_HEIGHT,
          }}>
            {/* Corner cell */}
            <Box sx={{
              width: CHANNEL_COL_WIDTH, minWidth: CHANNEL_COL_WIDTH,
              position: 'sticky', left: 0, zIndex: 4,
              bgcolor: 'background.paper', borderRight: `1px solid ${theme.palette.divider}`,
            }} />
            {/* Time labels */}
            <Box sx={{ position: 'relative', width: gridWidth, flexShrink: 0 }}>
              {timeSlots.map(slot => (
                <Typography
                  key={slot.getTime()}
                  variant="caption"
                  sx={{
                    position: 'absolute',
                    left: (slot.getTime() - dayStart.getTime()) / 60000 * PIXELS_PER_MIN,
                    top: '50%', transform: 'translateY(-50%)',
                    px: 0.5, whiteSpace: 'nowrap',
                    color: 'text.secondary', fontSize: '0.7rem',
                  }}
                >
                  {formatTime(slot)}
                </Typography>
              ))}
              {/* Now indicator in header */}
              {showNowLine && (
                <Box sx={{
                  position: 'absolute',
                  left: nowOffsetPx,
                  top: 0, bottom: 0,
                  width: 2, bgcolor: 'primary.main', opacity: 0.8,
                }} />
              )}
            </Box>
          </Box>

          {/* Channel rows */}
          {channels.map(channel => {
            const progs = programmesByChannel.get(channel.id) ?? [];
            return (
              <Box
                key={channel.id}
                sx={{
                  display: 'flex',
                  height: ROW_HEIGHT,
                  borderBottom: `1px solid ${theme.palette.divider}`,
                  '&:hover': { bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' },
                }}
              >
                {/* Sticky channel label */}
                <Box sx={{
                  width: CHANNEL_COL_WIDTH, minWidth: CHANNEL_COL_WIDTH,
                  position: 'sticky', left: 0, zIndex: 2,
                  bgcolor: 'background.paper',
                  borderRight: `1px solid ${theme.palette.divider}`,
                  display: 'flex', alignItems: 'center', gap: 1, px: 1.5,
                  overflow: 'hidden',
                }}>
                  {channel.icon && (
                    <Box
                      component="img"
                      src={channel.icon}
                      alt=""
                      sx={{ width: 24, height: 24, objectFit: 'contain', flexShrink: 0 }}
                    />
                  )}
                  <Typography variant="caption" noWrap sx={{ fontWeight: 500 }}>
                    {channel.displayName}
                  </Typography>
                </Box>

                {/* Programme blocks */}
                <Box sx={{ position: 'relative', width: gridWidth, flexShrink: 0 }}>
                  {progs.map((p, i) => (
                    <ProgrammeBlock key={i} prog={p} dayStart={dayStart} dayEnd={dayEnd} />
                  ))}
                  {/* Now indicator line */}
                  {showNowLine && (
                    <Box sx={{
                      position: 'absolute',
                      left: nowOffsetPx,
                      top: 0, bottom: 0,
                      width: 2, bgcolor: 'primary.main', opacity: 0.5, zIndex: 1,
                    }} />
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
};

export default XmltvViewer;
