import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Logout as LogoutIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';

// ─── Constants ───────────────────────────────────────────────────────────────

const PIXELS_PER_MIN = 4;          // horizontal zoom: px per minute
const CHANNEL_COL_WIDTH = 150;     // px – left channel panel
const ROW_HEIGHT = 56;             // px – each channel row
const HEADER_HEIGHT = 36;          // px – time-slot header
const SLOT_MINUTES = 30;           // granularity of time-slot labels

// ─── Rating config ────────────────────────────────────────────────────────────

const RATING_CONFIG: Record<string, { color: string; label: string }> = {
  '-18': { color: '#d32f2f', label: '18' },
  '-16': { color: '#f57c00', label: '16' },
  '-12': { color: '#f9a825', label: '12' },
  '-10': { color: '#1565c0', label: '10' },
  'Tout public': { color: '#388e3c', label: 'TP' },
};

const RatingBadge: React.FC<{ rating: string }> = ({ rating }) => {
  const cfg = RATING_CONFIG[rating];
  if (!cfg) return null;
  return (
    <Box
      sx={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 16, height: 16, borderRadius: '50%', bgcolor: cfg.color,
        fontSize: '0.5rem', fontWeight: 700, color: '#fff', flexShrink: 0, lineHeight: 1,
      }}
    >
      {cfg.label}
    </Box>
  );
};

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
  subTitle?: string;
  desc?: string;
  categories: string[];
  date?: string;
  thumbnail?: string;
  episodeNum?: string;
  rating?: string;
  starRating?: string;
  hasSubtitles: boolean;
  credits: {
    directors: string[];
    actors: string[];
    presenters: string[];
    guests: string[];
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse "20240115083000 +0100" → UTC Date */
function parseXmltvDate(raw: string): Date {
  const s = raw.trim();
  const year   = parseInt(s.slice(0, 4), 10);
  const month  = parseInt(s.slice(4, 6), 10) - 1;
  const day    = parseInt(s.slice(6, 8), 10);
  const hour   = parseInt(s.slice(8, 10), 10);
  const minute = parseInt(s.slice(10, 12), 10);
  const second = parseInt(s.slice(12, 14), 10);

  const tzMatch = s.slice(14).match(/([+-])(\d{2})(\d{2})/);
  let offsetMs = 0;
  if (tzMatch) {
    const sign = tzMatch[1] === '+' ? 1 : -1;
    offsetMs = sign * (parseInt(tzMatch[2], 10) * 60 + parseInt(tzMatch[3], 10)) * 60000;
  }

  return new Date(Date.UTC(year, month, day, hour, minute, second) - offsetMs);
}

/** Convert xmltv_ns episode string "2.5." → "S3 E6" */
function formatEpisodeNum(raw: string): string {
  const parts = raw.split('.');
  const s = parts[0]?.trim();
  const e = parts[1]?.trim();
  if (s !== '' && e !== '' && s !== undefined && e !== undefined) {
    return `S${parseInt(s) + 1} E${parseInt(e) + 1}`;
  }
  if (e !== '' && e !== undefined) return `E${parseInt(e) + 1}`;
  return '';
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
        channelId:    el.getAttribute('channel') ?? '',
        start:        parseXmltvDate(startRaw),
        stop:         parseXmltvDate(stopRaw),
        title:        el.querySelector('title')?.textContent?.trim() ?? '—',
        subTitle:     el.querySelector('sub-title')?.textContent?.trim() || undefined,
        desc:         el.querySelector('desc')?.textContent?.trim() || undefined,
        categories:   Array.from(el.querySelectorAll('category')).map(c => c.textContent?.trim() ?? '').filter(Boolean),
        date:         el.querySelector('date')?.textContent?.trim() || undefined,
        thumbnail:    el.querySelector('icon')?.getAttribute('src') ?? undefined,
        episodeNum:   el.querySelector('episode-num[system="xmltv_ns"]')?.textContent?.trim() || undefined,
        rating:       el.querySelector('rating > value')?.textContent?.trim() || undefined,
        starRating:   el.querySelector('star-rating > value')?.textContent?.trim() || undefined,
        hasSubtitles: el.querySelector('subtitles') !== null,
        credits: {
          directors:  Array.from(el.querySelectorAll('credits > director')).map(n => n.textContent?.trim() ?? '').filter(Boolean),
          actors:     Array.from(el.querySelectorAll('credits > actor')).map(n => n.textContent?.trim() ?? '').filter(Boolean),
          presenters: Array.from(el.querySelectorAll('credits > presenter')).map(n => n.textContent?.trim() ?? '').filter(Boolean),
          guests:     Array.from(el.querySelectorAll('credits > guest')).map(n => n.textContent?.trim() ?? '').filter(Boolean),
        },
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
  const textColor = isCurrent ? '#fff' : theme.palette.text.primary;

  const formattedEpisode = prog.episodeNum ? formatEpisodeNum(prog.episodeNum) : '';

  const creditLines: string[] = [];
  if (prog.credits.directors.length)  creditLines.push(`Dir: ${prog.credits.directors.slice(0, 2).join(', ')}`);
  if (prog.credits.presenters.length) creditLines.push(prog.credits.presenters.slice(0, 2).join(', '));
  if (prog.credits.actors.length)     creditLines.push(`Cast: ${prog.credits.actors.slice(0, 3).join(', ')}`);
  if (prog.credits.guests.length)     creditLines.push(`Guests: ${prog.credits.guests.slice(0, 2).join(', ')}`);

  const tooltipContent = (
    <Box sx={{ maxWidth: 300, p: 0.5 }}>
      {prog.thumbnail && (
        <Box
          component="img"
          src={prog.thumbnail}
          alt={prog.title}
          sx={{ width: '100%', borderRadius: 1, mb: 0.75, display: 'block', objectFit: 'cover', maxHeight: 140 }}
        />
      )}
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.25 }}>{prog.title}</Typography>
      {prog.subTitle && (
        <Typography variant="caption" sx={{ display: 'block', opacity: 0.85, mb: 0.25 }}>
          {prog.subTitle}
        </Typography>
      )}
      <Typography variant="caption" sx={{ display: 'block', opacity: 0.7, mb: 0.25 }}>
        {formatTime(prog.start)} – {formatTime(prog.stop)}
        {formattedEpisode ? ` · ${formattedEpisode}` : ''}
        {prog.date ? ` · ${prog.date}` : ''}
      </Typography>
      {prog.categories.length > 0 && (
        <Typography variant="caption" sx={{ display: 'block', opacity: 0.6, mb: 0.25 }}>
          {prog.categories.join(' / ')}
        </Typography>
      )}
      {prog.desc && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, lineHeight: 1.4, opacity: 0.9 }}>
          {prog.desc}
        </Typography>
      )}
      {creditLines.length > 0 && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.75, fontStyle: 'italic' }}>
          {creditLines.join(' · ')}
        </Typography>
      )}
      {prog.starRating && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.25, opacity: 0.7 }}>
          {prog.starRating}
        </Typography>
      )}
      {prog.rating && (
        <Box sx={{ mt: 0.5 }}>
          <RatingBadge rating={prog.rating} />
        </Box>
      )}
    </Box>
  );

  return (
    <Tooltip title={tooltipContent} arrow placement="top">
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
          gap: '1px',
          overflow: 'hidden',
          cursor: 'default',
          border: `1px solid ${theme.palette.divider}`,
          transition: 'background-color 0.15s',
        }}
      >
        {/* Row 1: title + rating badge */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, overflow: 'hidden' }}>
          <Typography
            variant="caption"
            noWrap
            sx={{ color: textColor, fontWeight: isCurrent ? 600 : 400, lineHeight: 1.3, flex: 1 }}
          >
            {prog.title}
          </Typography>
          {prog.rating && widthMin >= 30 && <RatingBadge rating={prog.rating} />}
        </Box>

        {/* Row 2: subtitle */}
        {widthMin >= 45 && prog.subTitle && (
          <Typography
            variant="caption"
            noWrap
            sx={{ color: textColor, opacity: 0.65, fontSize: '0.62rem', lineHeight: 1.2 }}
          >
            {prog.subTitle}
          </Typography>
        )}

        {/* Row 3: time + CC + episode */}
        {widthMin >= 45 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography
              variant="caption"
              noWrap
              sx={{ color: textColor, opacity: 0.7, fontSize: '0.62rem' }}
            >
              {formatTime(prog.start)}
            </Typography>
            {prog.hasSubtitles && (
              <Typography sx={{ fontSize: '0.5rem', opacity: 0.6, color: textColor, lineHeight: 1 }}>
                CC
              </Typography>
            )}
            {widthMin >= 90 && formattedEpisode && (
              <Typography sx={{ fontSize: '0.5rem', opacity: 0.6, color: textColor, lineHeight: 1 }}>
                {formattedEpisode}
              </Typography>
            )}
          </Box>
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
  const [now, setNow] = useState(() => new Date());

  // Filter state
  const [filterInput, setFilterInput]           = useState('');
  const [pinnedChannelIds, setPinnedChannelIds] = useState<Set<string>>(new Set());
  const [hoveredChannelId, setHoveredChannelId] = useState<string | null>(null);

  // Split-panel refs
  const leftPanelRef  = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);

  // ── Tick every minute ────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

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
    if (!loading && rightPanelRef.current) {
      const nowDate = new Date();
      const minutesIn = (nowDate.getTime() - startOfDay(nowDate).getTime()) / 60000;
      const target = minutesIn * PIXELS_PER_MIN - rightPanelRef.current.clientWidth / 2;
      rightPanelRef.current.scrollLeft = Math.max(0, target);
    }
  }, [loading]);

  // ── Sync vertical scroll: right panel drives left panel ──────────────────
  const handleRightScroll = useCallback(() => {
    if (leftPanelRef.current && rightPanelRef.current) {
      leftPanelRef.current.scrollTop = rightPanelRef.current.scrollTop;
    }
  }, []);

  // ── Derived data ─────────────────────────────────────────────────────────
  const dayStart = selectedDay;
  const dayEnd   = useMemo(() => addDays(selectedDay, 1), [selectedDay]);

  const displayChannels = useMemo(() =>
    pinnedChannelIds.size > 0
      ? channels.filter(c => pinnedChannelIds.has(c.id))
      : channels,
    [channels, pinnedChannelIds]);

  const filterOptions = useMemo(() =>
    channels.filter(c =>
      !pinnedChannelIds.has(c.id) &&
      c.displayName.toLowerCase().includes(filterInput.toLowerCase())
    ),
    [channels, filterInput, pinnedChannelIds]);

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

  const nowOffsetPx = (now.getTime() - dayStart.getTime()) / 60000 * PIXELS_PER_MIN;
  const showNowLine = now >= dayStart && now < dayEnd;

  const rowBg = (channelId: string) =>
    hoveredChannelId === channelId
      ? (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)')
      : 'transparent';

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

      {/* ── Filter bar ── */}
      <Box sx={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.75,
        px: 2, py: 0.75,
        bgcolor: 'background.paper', borderBottom: `1px solid ${theme.palette.divider}`,
        flexShrink: 0,
      }}>
        <Autocomplete
          size="small"
          options={filterOptions}
          getOptionLabel={c => c.displayName}
          inputValue={filterInput}
          value={null}
          onInputChange={(_, v, reason) => { if (reason !== 'reset') setFilterInput(v); }}
          onChange={(_, channel) => {
            if (channel) {
              setPinnedChannelIds(prev => new Set([...prev, channel.id]));
              setFilterInput('');
            }
          }}
          filterOptions={x => x}  // filtering done in filterOptions memo
          noOptionsText="No channels found"
          sx={{ width: 210 }}
          renderInput={params => (
            <TextField
              {...params}
              placeholder="Filter channels…"
              size="small"
              slotProps={{
                input: {
                  ...params.InputProps,
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon sx={{ fontSize: 15, color: 'text.disabled' }} />
                    </InputAdornment>
                  ),
                },
              }}
            />
          )}
          renderOption={(props, channel) => (
            <li {...props} key={channel.id}>
              {channel.icon && (
                <Box component="img" src={channel.icon} alt=""
                  sx={{ width: 20, height: 20, mr: 1, objectFit: 'contain', flexShrink: 0 }} />
              )}
              <Typography variant="body2">{channel.displayName}</Typography>
            </li>
          )}
        />

        {[...pinnedChannelIds].map(id => {
          const ch = channels.find(c => c.id === id);
          if (!ch) return null;
          return (
            <Chip
              key={id}
              label={ch.displayName}
              size="small"
              avatar={ch.icon
                ? <Avatar src={ch.icon} sx={{ width: '18px !important', height: '18px !important' }} />
                : undefined}
              onDelete={() => setPinnedChannelIds(prev => { const n = new Set(prev); n.delete(id); return n; })}
              sx={{
                bgcolor: 'primary.main', color: '#fff',
                '& .MuiChip-deleteIcon': { color: 'rgba(255,255,255,0.7)' },
              }}
            />
          );
        })}

        {pinnedChannelIds.size > 0 && (
          <Chip
            label="Clear all"
            size="small"
            variant="outlined"
            onClick={() => setPinnedChannelIds(new Set())}
            sx={{ opacity: 0.7 }}
          />
        )}
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
        <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* ── Left panel: channel names (never scrolls horizontally) ── */}
          <Box
            ref={leftPanelRef}
            sx={{
              width: CHANNEL_COL_WIDTH,
              minWidth: CHANNEL_COL_WIDTH,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'hidden',
              overflowX: 'hidden',
              borderRight: `1px solid ${theme.palette.divider}`,
              bgcolor: 'background.paper',
              zIndex: 2,
            }}
          >
            {/* Corner spacer matching header height */}
            <Box sx={{
              height: HEADER_HEIGHT,
              minHeight: HEADER_HEIGHT,
              flexShrink: 0,
              borderBottom: `1px solid ${theme.palette.divider}`,
            }} />

            {displayChannels.map(channel => (
              <Box
                key={channel.id}
                onMouseEnter={() => setHoveredChannelId(channel.id)}
                onMouseLeave={() => setHoveredChannelId(null)}
                sx={{
                  height: ROW_HEIGHT,
                  minHeight: ROW_HEIGHT,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.5,
                  borderBottom: `1px solid ${theme.palette.divider}`,
                  bgcolor: rowBg(channel.id),
                  overflow: 'hidden',
                  transition: 'background-color 0.1s',
                }}
              >
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
            ))}
          </Box>

          {/* ── Right panel: scrollable time grid ── */}
          <Box
            ref={rightPanelRef}
            onScroll={handleRightScroll}
            sx={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }}
          >
            {/* Sticky time-slot header */}
            <Box sx={{
              position: 'sticky',
              top: 0,
              zIndex: 3,
              bgcolor: 'background.paper',
              borderBottom: `1px solid ${theme.palette.divider}`,
              height: HEADER_HEIGHT,
              width: gridWidth,
            }}>
              <Box sx={{ position: 'relative', height: '100%' }}>
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

            {/* Programme rows */}
            {displayChannels.map(channel => {
              const progs = programmesByChannel.get(channel.id) ?? [];
              return (
                <Box
                  key={channel.id}
                  onMouseEnter={() => setHoveredChannelId(channel.id)}
                  onMouseLeave={() => setHoveredChannelId(null)}
                  sx={{
                    position: 'relative',
                    width: gridWidth,
                    height: ROW_HEIGHT,
                    borderBottom: `1px solid ${theme.palette.divider}`,
                    bgcolor: rowBg(channel.id),
                    transition: 'background-color 0.1s',
                  }}
                >
                  {progs.map((p, i) => (
                    <ProgrammeBlock key={i} prog={p} dayStart={dayStart} dayEnd={dayEnd} />
                  ))}
                  {showNowLine && (
                    <Box sx={{
                      position: 'absolute',
                      left: nowOffsetPx,
                      top: 0, bottom: 0,
                      width: 2, bgcolor: 'primary.main', opacity: 0.4, zIndex: 1,
                      pointerEvents: 'none',
                    }} />
                  )}
                </Box>
              );
            })}
          </Box>

        </Box>
      )}
    </Box>
  );
};

export default XmltvViewer;
