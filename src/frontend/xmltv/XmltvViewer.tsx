import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  Divider,
  GlobalStyles,
  IconButton,
  InputAdornment,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Close as CloseIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  Logout as LogoutIcon,
  MyLocation as NowIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { useAuth } from '../components/auth/AuthContext';

// ─── Constants ───────────────────────────────────────────────────────────────

const PIXELS_PER_MIN = 4;
const CHANNEL_COL_WIDTH = 160;
const MOBILE_ICON_COL_WIDTH = 44;
const ROW_HEIGHT = 62;
const HEADER_HEIGHT = 42;
const SLOT_MINUTES = 30;

// ─── Rating config ────────────────────────────────────────────────────────────

const RATING_CONFIG: Record<string, { color: string; label: string }> = {
  '-18': { color: '#ef4444', label: '18' },
  '-16': { color: '#f97316', label: '16' },
  '-12': { color: '#eab308', label: '12' },
  '-10': { color: '#3b82f6', label: '10' },
  'Tout public': { color: '#22c55e', label: 'TP' },
};

// ─── Category accent colors ───────────────────────────────────────────────────

const CATEGORY_ACCENT: [string, string][] = [
  ['sport',         '#38bdf8'],
  ['football',      '#38bdf8'],
  ['film',          '#c084fc'],
  ['téléfilm',      '#c084fc'],
  ['cinéma',        '#c084fc'],
  ['série',         '#34d399'],
  ['feuilleton',    '#34d399'],
  ['documentaire',  '#fbbf24'],
  ['magazine',      '#fb923c'],
  ['jeu',           '#f472b6'],
  ['divertissement','#e879f9'],
  ['information',   '#60a5fa'],
  ['journal',       '#60a5fa'],
  ['actualité',     '#60a5fa'],
  ['jeunesse',      '#86efac'],
  ['musique',       '#f9a8d4'],
  ['comédie',       '#fdba74'],
  ['animation',     '#6ee7b7'],
];

function getCategoryAccent(categories: string[]): string {
  for (const cat of categories) {
    const lc = cat.toLowerCase();
    for (const [key, color] of CATEGORY_ACCENT) {
      if (lc.includes(key)) return color;
    }
  }
  return 'rgba(140,140,160,0.5)';
}

// ─── RatingBadge ─────────────────────────────────────────────────────────────

const RatingBadge: React.FC<{ rating: string }> = ({ rating }) => {
  const cfg = RATING_CONFIG[rating];
  if (!cfg) return null;
  return (
    <Box
      sx={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 16, height: 16, borderRadius: '3px', flexShrink: 0,
        bgcolor: cfg.color + '20',
        border: `1px solid ${cfg.color}55`,
        color: cfg.color,
        fontSize: '0.48rem', fontWeight: 700, lineHeight: 1,
        letterSpacing: '-0.01em',
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
  onMobileOpen: (prog: Programme) => void;
  isSelected: boolean;
  onSelect: () => void;
}

const ProgrammeBlock: React.FC<ProgrammeBlockProps> = ({ prog, dayStart, dayEnd, onMobileOpen, isSelected, onSelect }) => {
  const [hovered, setHovered] = useState(false);
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const visStart = prog.start < dayStart ? dayStart : prog.start;
  const visStop  = prog.stop  > dayEnd   ? dayEnd   : prog.stop;
  const leftMin  = (visStart.getTime() - dayStart.getTime()) / 60000;
  const widthMin = (visStop.getTime()  - visStart.getTime()) / 60000;
  if (widthMin <= 0) return null;

  const now = new Date();
  const isCurrent = prog.start <= now && now < prog.stop;
  const accent = getCategoryAccent(prog.categories);
  const formattedEpisode = prog.episodeNum ? formatEpisodeNum(prog.episodeNum) : '';

  const creditLines: string[] = [];
  if (prog.credits.directors.length)  creditLines.push(`Dir: ${prog.credits.directors.slice(0, 2).join(', ')}`);
  if (prog.credits.presenters.length) creditLines.push(prog.credits.presenters.slice(0, 2).join(', '));
  if (prog.credits.actors.length)     creditLines.push(`Cast: ${prog.credits.actors.slice(0, 3).join(', ')}`);
  if (prog.credits.guests.length)     creditLines.push(`Guests: ${prog.credits.guests.slice(0, 2).join(', ')}`);

  const tooltipContent = (
    <Box sx={{ maxWidth: 300, maxHeight: '60vh', overflowY: 'auto', p: 0.25 }}>
      {prog.thumbnail && (
        <Box
          component="img"
          src={prog.thumbnail}
          alt={prog.title}
          sx={{ width: '100%', borderRadius: '6px', mb: 1, display: 'block', objectFit: 'cover', maxHeight: 140 }}
        />
      )}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 0.25 }}>
        <Typography sx={{ fontWeight: 700, fontSize: '0.8rem', lineHeight: 1.3, flex: 1 }}>
          {prog.title}
        </Typography>
        {prog.rating && <RatingBadge rating={prog.rating} />}
      </Box>
      {prog.subTitle && (
        <Typography variant="caption" sx={{ display: 'block', opacity: 0.7, mb: 0.25, fontStyle: 'italic' }}>
          {prog.subTitle}
        </Typography>
      )}
      <Typography
        variant="caption"
        sx={{ display: 'block', opacity: 0.55, fontFamily: '"Courier New", monospace', letterSpacing: '0.04em', mb: 0.5 }}
      >
        {formatTime(prog.start)} – {formatTime(prog.stop)}
        {formattedEpisode ? ` · ${formattedEpisode}` : ''}
        {prog.date ? ` · ${prog.date}` : ''}
      </Typography>
      {prog.categories.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.5 }}>
          {prog.categories.slice(0, 3).map(cat => (
            <Box
              key={cat}
              sx={{
                fontSize: '0.58rem', px: 0.6, py: 0.1, borderRadius: '3px',
                bgcolor: getCategoryAccent([cat]) + '22',
                border: `1px solid ${getCategoryAccent([cat])}44`,
                color: getCategoryAccent([cat]),
                lineHeight: 1.6,
              }}
            >
              {cat}
            </Box>
          ))}
        </Box>
      )}
      {prog.desc && (
        <Typography
          variant="caption"
          sx={{ display: 'block', lineHeight: 1.5, opacity: 0.8, mb: creditLines.length ? 0.5 : 0 }}
        >
          {prog.desc}
        </Typography>
      )}
      {creditLines.length > 0 && (
        <Typography variant="caption" sx={{ display: 'block', opacity: 0.55, fontStyle: 'italic', lineHeight: 1.4 }}>
          {creditLines.join(' · ')}
        </Typography>
      )}
      {prog.starRating && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.5, fontFamily: '"Courier New", monospace' }}>
          {prog.starRating}
        </Typography>
      )}
    </Box>
  );

  return (
    <Tooltip
      title={isMobile ? '' : tooltipContent}
      open={isSelected && !isMobile}
      disableHoverListener
      disableFocusListener
      disableTouchListener
      arrow
      placement="top"
      slotProps={{
        tooltip: { style: { overflow: 'visible', padding: 0 } },
        popper: {
          modifiers: [
            { name: 'preventOverflow', enabled: true, options: { boundary: 'viewport', padding: 8, altAxis: true } },
            { name: 'flip', enabled: true, options: { fallbackPlacements: ['bottom', 'right', 'left'] } },
          ],
        },
      }}
    >
      <Box
        onClick={(e) => {
          if (isMobile) {
            e.stopPropagation();
            onMobileOpen(prog);
          } else {
            e.stopPropagation();
            onSelect();
          }
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        sx={{
          position: 'absolute',
          left: leftMin * PIXELS_PER_MIN,
          width: widthMin * PIXELS_PER_MIN - 2,
          top: 4,
          bottom: 4,
          bgcolor: isCurrent
            ? 'rgba(255,107,107,0.1)'
            : hovered
              ? (isDark ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.06)')
              : (isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.03)'),
          borderRadius: '4px',
          border: `1px solid ${
            isCurrent
              ? 'rgba(255,107,107,0.35)'
              : hovered
                ? (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.15)')
                : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)')
          }`,
          borderLeft: `2px solid ${isCurrent ? '#ff6b6b' : accent}`,
          px: 0.75,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: '1px',
          overflow: 'hidden',
          cursor: 'pointer',
          transition: 'background-color 0.12s, border-color 0.12s',
        }}
      >
        {/* Row 1: title + rating */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, overflow: 'hidden' }}>
          <Typography
            variant="caption"
            noWrap
            sx={{
              fontWeight: isCurrent ? 600 : 500,
              lineHeight: 1.3,
              flex: 1,
              color: isCurrent
                ? (isDark ? '#ffe4e4' : '#b91c1c')
                : (isDark ? 'rgba(228,228,248,0.92)' : 'rgba(20,20,30,0.88)'),
              fontSize: '0.72rem',
            }}
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
            sx={{
              color: isCurrent
                ? (isDark ? 'rgba(255,228,228,0.6)' : 'rgba(150,0,0,0.6)')
                : (isDark ? 'rgba(200,200,230,0.5)' : 'rgba(40,40,60,0.6)'),
              fontSize: '0.62rem',
              lineHeight: 1.2,
              fontStyle: 'italic',
            }}
          >
            {prog.subTitle}
          </Typography>
        )}

        {/* Row 3: time + indicators */}
        {widthMin >= 45 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography
              noWrap
              sx={{
                color: isCurrent
                  ? (isDark ? 'rgba(255,228,228,0.55)' : 'rgba(120,0,0,0.55)')
                  : (isDark ? 'rgba(180,180,210,0.45)' : 'rgba(60,60,80,0.5)'),
                fontSize: '0.6rem',
                fontFamily: '"Courier New", monospace',
                letterSpacing: '0.03em',
                lineHeight: 1,
              }}
            >
              {formatTime(prog.start)}
            </Typography>
            {prog.hasSubtitles && (
              <Box sx={{
                fontSize: '0.48rem', lineHeight: 1, px: 0.4, py: 0.1, borderRadius: '2px',
                border: isDark ? '1px solid rgba(255,255,255,0.15)' : '1px solid rgba(0,0,0,0.2)',
                color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.35)',
              }}>
                CC
              </Box>
            )}
            {widthMin >= 90 && formattedEpisode && (
              <Typography sx={{ fontSize: '0.6rem', color: isDark ? 'rgba(180,180,210,0.4)' : 'rgba(60,60,80,0.5)', fontFamily: '"Courier New", monospace', lineHeight: 1 }}>
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
  const { logout, darkMode, toggleDarkMode } = useAuth();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [channels, setChannels]     = useState<Channel[]>([]);
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date>(startOfDay(new Date()));
  const [now, setNow] = useState(() => new Date());

  // Filter state
  const [filterInput, setFilterInput]           = useState('');
  const [pinnedChannelIds, setPinnedChannelIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('xmltv_pinned_channels');
      return stored ? new Set<string>(JSON.parse(stored)) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });

  useEffect(() => {
    localStorage.setItem('xmltv_pinned_channels', JSON.stringify([...pinnedChannelIds]));
  }, [pinnedChannelIds]);

  const [hoveredChannelId, setHoveredChannelId] = useState<string | null>(null);
  const [mobileProg, setMobileProg] = useState<Programme | null>(null);
  const [selectedProg, setSelectedProg] = useState<Programme | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== 'undefined' ? window.innerWidth >= 600 : true
  );

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

  // ── Go-to-now ─────────────────────────────────────────────────────────────
  const scrollToNow = useCallback(() => {
    if (!rightPanelRef.current) return;
    setSelectedDay(startOfDay(new Date()));
    const minutesIn = (new Date().getTime() - startOfDay(new Date()).getTime()) / 60000;
    const target = minutesIn * PIXELS_PER_MIN - rightPanelRef.current.clientWidth / 2;
    rightPanelRef.current.scrollLeft = Math.max(0, target);
  }, []);

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

  const isDark = theme.palette.mode === 'dark';
  const rowHoverBg = isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.025)';
  const panelBorderColor = isDark ? 'rgba(255,255,255,0.06)' : theme.palette.divider;
  const panelBg = isDark ? '#0e0e1c' : 'background.paper';

  // Shared channel list used in both drawer (mobile) and persistent panel (desktop)
  const channelListContent = displayChannels.map(channel => (
    <Box
      key={channel.id}
      onMouseEnter={() => setHoveredChannelId(channel.id)}
      onMouseLeave={() => setHoveredChannelId(null)}
      sx={{
        height: ROW_HEIGHT, minHeight: ROW_HEIGHT,
        display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5,
        borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.04)' : theme.palette.divider}`,
        bgcolor: hoveredChannelId === channel.id ? rowHoverBg : 'transparent',
        overflow: 'hidden',
        transition: 'background-color 0.1s',
      }}
    >
      {channel.icon ? (
        <Box component="img" src={channel.icon} alt=""
          sx={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0, opacity: 0.9 }} />
      ) : (
        <Box sx={{
          width: 28, height: 28, flexShrink: 0, borderRadius: '6px',
          bgcolor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Typography sx={{ fontSize: '0.7rem', opacity: 0.3 }}>📺</Typography>
        </Box>
      )}
      <Typography noWrap sx={{ fontWeight: 500, fontSize: '0.75rem', color: isDark ? 'rgba(220,220,245,0.8)' : 'text.primary' }}>
        {channel.displayName}
      </Typography>
    </Box>
  ));

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Global keyframes for the now-line glow */}
      <GlobalStyles styles={`
        @keyframes nowGlow {
          0%, 100% { box-shadow: 0 0 4px 1px rgba(255,107,107,0.45); opacity: 0.9; }
          50%       { box-shadow: 0 0 10px 3px rgba(255,107,107,0.75); opacity: 1; }
        }
        @keyframes nowGlowFaint {
          0%, 100% { box-shadow: 0 0 3px 1px rgba(255,107,107,0.25); opacity: 0.55; }
          50%       { box-shadow: 0 0 7px 2px rgba(255,107,107,0.45); opacity: 0.8; }
        }
      `} />

      {/* ── Mobile programme detail dialog ── */}
      <Dialog
        open={mobileProg !== null}
        onClose={() => setMobileProg(null)}
        fullWidth
        maxWidth="xs"
        slotProps={{ paper: { sx: { m: 2, borderRadius: '12px' } } }}
      >
        {mobileProg && (
          <>
            {/* ── Close button — outside DialogContent so it stays visible when scrolling ── */}
            <IconButton
              onClick={() => setMobileProg(null)}
              size="small"
              sx={{
                position: 'absolute',
                top: 8,
                right: 8,
                zIndex: 1,
                width: 32,
                height: 32,
                bgcolor: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)',
                border: isDark ? '1px solid rgba(255,255,255,0.30)' : '1px solid rgba(0,0,0,0.30)',
                color: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)',
                borderRadius: '50%',
                transition: 'background-color 0.15s, color 0.15s, border-color 0.15s',
                '&:hover': {
                  bgcolor: isDark ? 'rgba(255,107,107,0.25)' : 'rgba(220,0,0,0.25)',
                  borderColor: isDark ? 'rgba(255,107,107,0.65)' : 'rgba(200,0,0,0.65)',
                  color: isDark ? '#ff6b6b' : '#c62828',
                },
              }}
            >
              <CloseIcon sx={{ fontSize: '1rem' }} />
            </IconButton>
            <DialogContent sx={{ p: 2 }}>
            {mobileProg.thumbnail && (
              <Box component="img" src={mobileProg.thumbnail} alt={mobileProg.title}
                sx={{ width: '100%', borderRadius: '8px', mb: 1.5, display: 'block', objectFit: 'cover', maxHeight: 160 }} />
            )}
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 0.5, pr: mobileProg.thumbnail ? 0 : 3.5 }}>
              <Typography sx={{ fontWeight: 700, fontSize: '1rem', lineHeight: 1.3, flex: 1 }}>
                {mobileProg.title}
              </Typography>
              {mobileProg.rating && <RatingBadge rating={mobileProg.rating} />}
            </Box>
            {mobileProg.subTitle && (
              <Typography variant="body2" sx={{ opacity: 0.7, mb: 0.5, fontStyle: 'italic' }}>
                {mobileProg.subTitle}
              </Typography>
            )}
            <Typography variant="caption" sx={{ display: 'block', opacity: 0.55, fontFamily: '"Courier New", monospace', letterSpacing: '0.04em', mb: 1 }}>
              {formatTime(mobileProg.start)} – {formatTime(mobileProg.stop)}
              {mobileProg.episodeNum ? ` · ${formatEpisodeNum(mobileProg.episodeNum)}` : ''}
              {mobileProg.date ? ` · ${mobileProg.date}` : ''}
            </Typography>
            {mobileProg.categories.length > 0 && (
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                {mobileProg.categories.slice(0, 4).map(cat => (
                  <Box key={cat} sx={{
                    fontSize: '0.65rem', px: 0.75, py: 0.2, borderRadius: '4px',
                    bgcolor: getCategoryAccent([cat]) + '22',
                    border: `1px solid ${getCategoryAccent([cat])}44`,
                    color: getCategoryAccent([cat]),
                    lineHeight: 1.6,
                  }}>
                    {cat}
                  </Box>
                ))}
              </Box>
            )}
            {mobileProg.desc && (
              <>
                <Divider sx={{ my: 1 }} />
                <Typography variant="body2" sx={{ lineHeight: 1.6, opacity: 0.85 }}>
                  {mobileProg.desc}
                </Typography>
              </>
            )}
            {[
              ...mobileProg.credits.directors.length  ? [`Dir: ${mobileProg.credits.directors.slice(0, 2).join(', ')}`]  : [],
              ...mobileProg.credits.presenters.length ? [mobileProg.credits.presenters.slice(0, 2).join(', ')]            : [],
              ...mobileProg.credits.actors.length     ? [`Cast: ${mobileProg.credits.actors.slice(0, 3).join(', ')}`]     : [],
            ].map((line, i) => (
              <Typography key={i} variant="caption" sx={{ display: 'block', opacity: 0.55, fontStyle: 'italic', mt: 0.5 }}>
                {line}
              </Typography>
            ))}
          </DialogContent>
          </>
        )}
      </Dialog>

      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100dvh', bgcolor: 'background.default' }}>

        {/* ── Toolbar ── */}
        <Box sx={{
          display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5, px: 2, py: 0.75,
          bgcolor: isDark ? '#0e0e1c' : 'background.paper',
          borderBottom: `1px solid ${panelBorderColor}`,
          flexShrink: 0,
          minHeight: 48,
        }}>
          {/* Title */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, order: 1 }}>
            <Typography sx={{
              fontWeight: 800, fontSize: '0.9rem', letterSpacing: '0.12em',
              textTransform: 'uppercase', color: 'primary.main', lineHeight: 1,
            }}>
              TV Guide
            </Typography>
          </Box>

          {/* Day navigation — second row on mobile */}
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 0.25,
            order: { xs: 3, sm: 2 },
            width: { xs: '100%', sm: 'auto' },
            justifyContent: { xs: 'center', sm: 'flex-start' },
            pb: { xs: 0.5, sm: 0 },
            bgcolor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'}`,
            borderRadius: '8px',
            px: 0.25,
          }}>
            <IconButton size="small" onClick={() => setSelectedDay(d => addDays(d, -1))}
              sx={{ color: 'text.secondary', '&:hover': { color: 'text.primary' } }}>
              <ChevronLeftIcon sx={{ fontSize: 18 }} />
            </IconButton>
            <Typography sx={{
              minWidth: 120, textAlign: 'center', fontWeight: 600,
              fontSize: '0.78rem', letterSpacing: '0.02em', color: 'text.primary',
            }}>
              {formatDayLabel(selectedDay)}
            </Typography>
            <IconButton size="small" onClick={() => setSelectedDay(d => addDays(d, 1))}
              sx={{ color: 'text.secondary', '&:hover': { color: 'text.primary' } }}>
              <ChevronRightIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>

          {/* Action buttons */}
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 0.25,
            order: { xs: 2, sm: 3 },
            ml: { xs: 0, sm: 0.5 },
            bgcolor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'}`,
            borderRadius: '8px',
            px: 0.25,
          }}>
            <Tooltip title="Go to now">
              <IconButton size="small" onClick={scrollToNow}
                sx={{ color: 'primary.main', '&:hover': { bgcolor: 'rgba(255,107,107,0.1)' } }}>
                <NowIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Box sx={{ width: 1, height: 16, bgcolor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }} />
            <Tooltip title="Refresh">
              <span>
                <IconButton size="small" onClick={loadData} disabled={loading}
                  sx={{ color: 'text.secondary', '&:hover': { color: 'text.primary' } }}>
                  <RefreshIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Box sx={{ width: 1, height: 16, bgcolor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }} />
            <Tooltip title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
              <IconButton size="small" onClick={toggleDarkMode}
                sx={{ color: 'text.secondary', '&:hover': { color: 'text.primary' } }}>
                {darkMode ? <LightModeIcon sx={{ fontSize: 16 }} /> : <DarkModeIcon sx={{ fontSize: 16 }} />}
              </IconButton>
            </Tooltip>
            <Box sx={{ width: 1, height: 16, bgcolor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }} />
            <Tooltip title="Logout">
              <IconButton size="small" onClick={logout}
                sx={{ color: 'text.secondary', '&:hover': { color: '#ef4444' } }}>
                <LogoutIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* ── Filter bar ── */}
        <Box sx={{
          display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.75,
          px: 2, py: 0.75,
          bgcolor: isDark ? '#0b0b18' : 'rgba(0,0,0,0.02)',
          borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : theme.palette.divider}`,
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
            filterOptions={x => x}
            noOptionsText="No channels found"
            sx={{
              width: 200,
              '& .MuiOutlinedInput-root': {
                borderRadius: '8px',
                bgcolor: isDark ? 'rgba(255,255,255,0.04)' : undefined,
                '& fieldset': { borderColor: isDark ? 'rgba(255,255,255,0.08)' : undefined },
                '&:hover fieldset': { borderColor: isDark ? 'rgba(255,255,255,0.15)' : undefined },
                '&.Mui-focused fieldset': { borderColor: 'primary.main' },
              },
            }}
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
                        <SearchIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                      </InputAdornment>
                    ),
                    sx: { fontSize: '0.78rem' },
                  },
                }}
              />
            )}
            renderOption={(props, channel) => (
              <li {...props} key={channel.id} style={{ padding: '6px 10px' }}>
                {channel.icon && (
                  <Box component="img" src={channel.icon} alt=""
                    sx={{ width: 20, height: 20, mr: 1, objectFit: 'contain', flexShrink: 0 }} />
                )}
                <Typography sx={{ fontSize: '0.8rem' }}>{channel.displayName}</Typography>
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
                  ? <Avatar src={ch.icon} sx={{ width: '16px !important', height: '16px !important' }} />
                  : undefined}
                onDelete={() => setPinnedChannelIds(prev => { const n = new Set(prev); n.delete(id); return n; })}
                sx={{
                  height: 24,
                  bgcolor: 'rgba(255,107,107,0.15)',
                  border: '1px solid rgba(255,107,107,0.3)',
                  color: '#ff9a9a',
                  fontSize: '0.72rem',
                  borderRadius: '6px',
                  '& .MuiChip-deleteIcon': { color: 'rgba(255,150,150,0.6)', fontSize: 14, '&:hover': { color: 'rgba(255,150,150,0.9)' } },
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
              sx={{
                height: 24, fontSize: '0.7rem', borderRadius: '6px',
                borderColor: isDark ? 'rgba(255,255,255,0.12)' : undefined,
                color: 'text.disabled',
                '&:hover': { borderColor: 'rgba(255,255,255,0.25)', color: 'text.secondary' },
              }}
            />
          )}
        </Box>

        {/* ── Loading ── */}
        {loading && (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
            <Box sx={{ position: 'relative', width: 44, height: 44 }}>
              <CircularProgress size={44} thickness={1.5} sx={{ color: 'primary.main', opacity: 0.7 }} />
              <Box sx={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.1rem',
              }}>
                📺
              </Box>
            </Box>
            <Typography sx={{
              color: 'text.disabled', fontSize: '0.65rem', letterSpacing: '0.18em',
              textTransform: 'uppercase', fontFamily: '"Courier New", monospace',
            }}>
              Loading guide
            </Typography>
          </Box>
        )}

        {/* ── Error ── */}
        {error && !loading && (
          <Box sx={{ p: 3 }}>
            <Alert severity="error" action={
              <IconButton size="small" onClick={loadData}><RefreshIcon fontSize="small" /></IconButton>
            }>{error}</Alert>
          </Box>
        )}

        {/* ── Grid ── */}
        {!loading && !error && (
          <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

            {/* ── Mobile: narrow icon-only strip (always visible) ── */}
            {isMobile && (
              <Box
                ref={leftPanelRef}
                onClick={() => { if (mobileProg) setMobileProg(null); }}
                sx={{
                  width: MOBILE_ICON_COL_WIDTH, minWidth: MOBILE_ICON_COL_WIDTH, flexShrink: 0,
                  display: 'flex', flexDirection: 'column',
                  overflowY: 'hidden', overflowX: 'hidden',
                  borderRight: `1px solid ${panelBorderColor}`,
                  bgcolor: panelBg,
                  zIndex: 2,
                }}
              >
                <Box sx={{ height: HEADER_HEIGHT, minHeight: HEADER_HEIGHT, flexShrink: 0,
                  borderBottom: `1px solid ${panelBorderColor}` }} />
                {displayChannels.map(channel => (
                  <Tooltip key={channel.id} title={channel.displayName} placement="right" arrow>
                    <Box
                      sx={{
                        height: ROW_HEIGHT, minHeight: ROW_HEIGHT,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.04)' : theme.palette.divider}`,
                      }}
                    >
                      {channel.icon ? (
                        <Box component="img" src={channel.icon} alt=""
                          sx={{ width: 26, height: 26, objectFit: 'contain', opacity: 0.9 }} />
                      ) : (
                        <Box sx={{
                          width: 26, height: 26, borderRadius: '5px', flexShrink: 0,
                          bgcolor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Typography sx={{ fontSize: '0.65rem', opacity: 0.35 }}>📺</Typography>
                        </Box>
                      )}
                    </Box>
                  </Tooltip>
                ))}
              </Box>
            )}

            {/* ── Desktop: persistent left panel ── */}
            {!isMobile && sidebarOpen && (
              <Box
                ref={leftPanelRef}
                sx={{
                  width: CHANNEL_COL_WIDTH, minWidth: CHANNEL_COL_WIDTH, flexShrink: 0,
                  display: 'flex', flexDirection: 'column',
                  overflowY: 'hidden', overflowX: 'hidden',
                  borderRight: `1px solid ${panelBorderColor}`,
                  bgcolor: panelBg,
                  zIndex: 2,
                }}
              >
                <Box sx={{ height: HEADER_HEIGHT, minHeight: HEADER_HEIGHT, flexShrink: 0,
                  borderBottom: `1px solid ${panelBorderColor}` }} />
                {channelListContent}
              </Box>
            )}

            {/* ── Right panel: scrollable time grid ── */}
            <Box
              ref={rightPanelRef}
              onScroll={handleRightScroll}
              onClick={() => { if (mobileProg) setMobileProg(null); setSelectedProg(null); }}
              sx={{
                flex: 1, overflowX: 'auto', overflowY: 'auto',
                // Subtle vertical grid lines aligned with time slots
                backgroundImage: isDark
                  ? `repeating-linear-gradient(90deg, transparent, transparent ${SLOT_MINUTES * PIXELS_PER_MIN - 1}px, rgba(255,255,255,0.025) ${SLOT_MINUTES * PIXELS_PER_MIN - 1}px, rgba(255,255,255,0.025) ${SLOT_MINUTES * PIXELS_PER_MIN}px)`
                  : `repeating-linear-gradient(90deg, transparent, transparent ${SLOT_MINUTES * PIXELS_PER_MIN - 1}px, rgba(0,0,0,0.04) ${SLOT_MINUTES * PIXELS_PER_MIN - 1}px, rgba(0,0,0,0.04) ${SLOT_MINUTES * PIXELS_PER_MIN}px)`,
                backgroundAttachment: 'local',
              }}
            >
              {/* Sticky time-slot header */}
              <Box sx={{
                position: 'sticky', top: 0, zIndex: 3,
                bgcolor: isDark ? '#0e0e1c' : 'background.paper',
                borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : theme.palette.divider}`,
                height: HEADER_HEIGHT, width: gridWidth,
              }}>
                <Box sx={{ position: 'relative', height: '100%' }}>
                  {timeSlots.map((slot, i) => {
                    const isHour = slot.getMinutes() === 0;
                    return (
                      <Box
                        key={slot.getTime()}
                        sx={{
                          position: 'absolute',
                          left: (slot.getTime() - dayStart.getTime()) / 60000 * PIXELS_PER_MIN,
                          top: 0, bottom: 0,
                          display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                          pb: 0.75,
                        }}
                      >
                        <Typography
                          sx={{
                            fontSize: isHour ? '0.68rem' : '0.6rem',
                            fontWeight: isHour ? 600 : 400,
                            fontFamily: '"Courier New", monospace',
                            color: isHour
                              ? (isDark ? 'rgba(220,220,248,0.7)' : 'text.secondary')
                              : (isDark ? 'rgba(160,160,200,0.4)' : 'rgba(0,0,0,0.3)'),
                            letterSpacing: '0.04em',
                            pl: 0.5,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {i === 0 ? '' : formatTime(slot)}
                        </Typography>
                        {/* Tick mark */}
                        <Box sx={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: 1,
                          height: isHour ? '45%' : '25%',
                          bgcolor: isHour
                            ? (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)')
                            : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'),
                        }} />
                      </Box>
                    );
                  })}

                  {/* Now-line in header with time bubble */}
                  {showNowLine && (
                    <Box sx={{
                      position: 'absolute',
                      left: nowOffsetPx,
                      top: 0, bottom: 0,
                      zIndex: 4, pointerEvents: 'none',
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                    }}>
                      <Box sx={{
                        transform: 'translateX(-50%)',
                        bgcolor: 'primary.main',
                        color: '#fff',
                        fontSize: '0.58rem',
                        fontWeight: 700,
                        fontFamily: '"Courier New", monospace',
                        px: 0.75, py: 0.2,
                        borderRadius: '0 0 4px 4px',
                        whiteSpace: 'nowrap',
                        letterSpacing: '0.05em',
                        boxShadow: '0 2px 8px rgba(255,107,107,0.5)',
                        flexShrink: 0,
                      }}>
                        {formatTime(now)}
                      </Box>
                      <Box sx={{
                        flex: 1, width: 2,
                        transform: 'translateX(-50%)',
                        bgcolor: 'primary.main',
                        animation: 'nowGlow 2.5s ease-in-out infinite',
                      }} />
                    </Box>
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
                      borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.04)' : theme.palette.divider}`,
                      bgcolor: hoveredChannelId === channel.id ? rowHoverBg : 'transparent',
                      transition: 'background-color 0.1s',
                    }}
                  >
                    {progs.map((p, i) => (
                      <ProgrammeBlock
                        key={i}
                        prog={p}
                        dayStart={dayStart}
                        dayEnd={dayEnd}
                        onMobileOpen={setMobileProg}
                        isSelected={selectedProg === p}
                        onSelect={() => setSelectedProg(prev => prev === p ? null : p)}
                      />
                    ))}
                    {showNowLine && (
                      <Box sx={{
                        position: 'absolute',
                        left: nowOffsetPx,
                        top: 0, bottom: 0,
                        width: 2,
                        transform: 'translateX(-50%)',
                        bgcolor: 'primary.main',
                        animation: 'nowGlowFaint 2.5s ease-in-out infinite',
                        zIndex: 1,
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
    </>
  );
};

export default XmltvViewer;
