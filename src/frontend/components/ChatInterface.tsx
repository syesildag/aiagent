import {
    SmartToy as BotIcon,
    Logout as LogoutIcon,
    Send as SendIcon,
    AttachFile as AttachFileIcon,
    Close as CloseIcon,
    StopCircle as StopIcon,
    VolumeOff as VolumeOffIcon,
    VolumeUp as VolumeUpIcon,
    DarkMode as DarkModeIcon,
    LightMode as LightModeIcon,
    Download as DownloadIcon,
    MoreVert as MoreVertIcon,
} from '@mui/icons-material';
import {
    Alert,
    AppBar,
    Box,
    Button,

    Container,
    Dialog,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    IconButton,
    List,
    ListItem,
    ListItemIcon,
    ListItemText,
    Menu,
    MenuItem,
    Paper,
    Select,
    SelectChangeEvent,
    TextField,
    Toolbar,
    Tooltip,
    Typography
} from '@mui/material';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Message, ToolApproval } from '../types';
import { ChatMessage } from './ChatMessage';
import { ConversationSidebar } from './ConversationSidebar';
import { ToolApprovalCard } from './ToolApprovalCard';

export const ChatInterface: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<{ dataUrl: string; base64: string; mimeType: string; name: string }[]>([]);
  const [previewFile, setPreviewFile] = useState<{ dataUrl: string; base64: string; mimeType: string; name: string } | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [currentModel, setCurrentModel] = useState('');
  const [availableAgents, setAvailableAgents] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Tracks approved (toolName::args) combos within the current streaming session
  const sessionApprovedRef = useRef<Set<string>>(new Set());
  // Mirrors messages state so useCallback closures can read current messages without stale closures
  const messagesRef = useRef<Message[]>([]);
  const { session, username, agentName, darkMode, toggleDarkMode, logout } = useAuth();
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [autoSpeak, setAutoSpeak] = useState<boolean>(
    () => localStorage.getItem('autoSpeak') !== 'false'
  );
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [mobileMenuAnchor, setMobileMenuAnchor] = useState<null | HTMLElement>(null);
  const [compressingCount, setCompressingCount] = useState(0);


  const toggleAutoSpeak = () => {
    setAutoSpeak(prev => {
      const next = !prev;
      localStorage.setItem('autoSpeak', String(next));
      if (!next) {
        window.speechSynthesis.cancel();
        setSpeakingMsgId(null);
      }
      return next;
    });
  };

  /** Start reading a message aloud. When interrupt=true (manual), cancels any ongoing speech first.
   *  When interrupt=false (auto-speak), queues after the current utterance. */
  const speakMessage = useCallback((msgId: string, text: string, interrupt = true) => {
    if (interrupt) window.speechSynthesis.cancel();
    if (!text.trim()) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setSpeakingMsgId(null);
    utterance.onerror = () => setSpeakingMsgId(null);
    window.speechSynthesis.speak(utterance);
    setSpeakingMsgId(msgId);
  }, []);

  /** Stop any ongoing speech. */
  const stopSpeaking = useCallback(() => {
    window.speechSynthesis.cancel();
    setSpeakingMsgId(null);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    messagesRef.current = messages;
    scrollToBottom();
  }, [messages]);

  // Fetch model info and available agents on mount
  useEffect(() => {
    fetch(`/info/${agentName}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) {
          setAvailableModels(data.models ?? []);
          setCurrentModel(data.model ?? '');
        }
      })
      .catch(() => {/* non-critical */});

    fetch('/agents')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setAvailableAgents(data.agents ?? []); })
      .catch(() => {/* non-critical */});
  }, [agentName]);

  // Global paste handler: captures images pasted from clipboard
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItems = items.filter(item => item.type.startsWith('image/'));
      if (imageItems.length === 0) return;
      e.preventDefault();
      const files = imageItems.map(item => item.getAsFile()).filter(Boolean) as File[];
      setCompressingCount(prev => prev + files.length);
      Promise.all(files.map(f => processFile(f))).then(results => {
        setAttachedFiles(prev => {
          const existingNames = new Set(prev.map(f => f.name));
          return [...prev, ...results.filter(r => !existingNames.has(r.name))];
        });
      }).finally(() => {
        setCompressingCount(prev => prev - files.length);
      });
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const handleModelChange = (e: SelectChangeEvent<string>) => {
    const model = e.target.value;
    fetch(`/model/${agentName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session, model }),
    })
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(() => {
        setCurrentModel(model);
      })
      .catch(() => setError('Failed to switch model'));
  };

  /**
   * Resize an image File to at most MAX_DIM×MAX_DIM pixels and re-encode as
   * JPEG at JPEG_QUALITY, keeping the original data URL format expected by the
   * rest of the component. Non-image files are passed through unchanged.
   */
  const processFile = (
    f: File,
  ): Promise<{ dataUrl: string; base64: string; mimeType: string; name: string }> => {
    const MAX_DIM = 1920;
    const JPEG_QUALITY = 0.85;

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = ev => {
        const rawDataUrl = ev.target?.result as string;

        // Non-image: return as-is
        if (!f.type.startsWith('image/')) {
          const [header, base64] = rawDataUrl.split(',');
          const mimeType = header.replace('data:', '').replace(';base64', '');
          return resolve({ dataUrl: rawDataUrl, base64, mimeType, name: f.name });
        }

        // Image: resize via canvas if needed
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          let { width, height } = img;
          if (width > MAX_DIM || height > MAX_DIM) {
            if (width >= height) {
              height = Math.round((height * MAX_DIM) / width);
              width = MAX_DIM;
            } else {
              width = Math.round((width * MAX_DIM) / height);
              height = MAX_DIM;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('Canvas context unavailable'));
          ctx.drawImage(img, 0, 0, width, height);

          // Iteratively reduce quality until base64 payload fits within a safe
          // size budget. LLM APIs often have hard HTTP body size limits unrelated
          // to the model's token context window, so large iPhone photos can trigger
          // 413 Payload Too Large errors even after dimension-based resizing.
          const MAX_BASE64_BYTES = 500 * 1024; // 500 KB base64 string length
          const MIN_QUALITY = 0.3;
          let quality = JPEG_QUALITY;
          let dataUrl = canvas.toDataURL('image/jpeg', quality);
          while (dataUrl.length > MAX_BASE64_BYTES && quality > MIN_QUALITY) {
            quality = Math.max(quality - 0.1, MIN_QUALITY);
            dataUrl = canvas.toDataURL('image/jpeg', quality);
          }

          const [header, base64] = dataUrl.split(',');
          const mimeType = header.replace('data:', '').replace(';base64', '');
          resolve({ dataUrl, base64, mimeType, name: f.name });
        };
        img.src = rawDataUrl;
      };
      reader.readAsDataURL(f);
    });
  };

  const handleFilesSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputEl = e.target;
    const files = Array.from(inputEl.files ?? []);
    if (files.length === 0) return;

    const oversized = files.filter(f => f.size > 15 * 1024 * 1024);
    if (oversized.length > 0) {
      setError(`File(s) too large (max 15 MB each): ${oversized.map(f => f.name).join(', ')}`);
      inputEl.value = '';
      return;
    }

    // Reset the input immediately so the same file can be re-selected later and
    // so a subsequent picker session cannot have its File objects invalidated by
    // a delayed reset from this session's Promise callback. The File objects are
    // already captured in the `files` array above (via Array.from), so they
    // remain valid for FileReader regardless of the input being cleared.
    inputEl.value = '';

    // Read (and resize/compress images) in parallel.
    setCompressingCount(prev => prev + files.length);
    Promise.all(files.map(f => processFile(f))).then(results => {
      setAttachedFiles(prev => {
        // Deduplicate by name so reopening the same file doesn't add a duplicate
        const existingNames = new Set(prev.map(f => f.name));
        const fresh = results.filter(r => !existingNames.has(r.name));
        return [...prev, ...fresh];
      });
    }).catch(() => {
      setError('Failed to read selected file(s)');
    }).finally(() => {
      setCompressingCount(prev => prev - files.length);
    });
  };

  const handleRemoveFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSendMessage = useCallback(async () => {
    if (!inputMessage.trim() || !session) return;

    const filesCopy = attachedFiles;
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputMessage,
      timestamp: new Date(),
      imageUrls: filesCopy.length > 0 ? filesCopy.map(f => f.dataUrl) : undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputMessage('');
    setAttachedFiles([]);
    setLoading(true);
    setError('');
    setLastFailedPrompt(null);

    sessionApprovedRef.current.clear();

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const body: Record<string, unknown> = {
        session: session!,
        prompt: inputMessage,
        ...(activeConversationId ? { conversationId: activeConversationId } : {}),
      };
      if (filesCopy.length > 0) {
        body.files = filesCopy.map(f => ({ base64: f.base64, mimeType: f.mimeType, name: f.name }));
      }

      const response = await fetch(`/chat/${agentName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Session expired or invalid — clear local session and show login screen
          await logout();
          return;
        }
        throw new Error('Failed to get response');
      }

      // Handle streaming response (NDJSON protocol)
      // Each line is a JSON event: {t:'text',v:'...'} or {t:'approval',...}
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      let assistantMsgId: string | null = null;

      /** Ensure the assistant placeholder bubble exists, return its id */
      const ensureAssistantMsg = (): string => {
        if (!assistantMsgId) {
          assistantMsgId = String(Date.now() + 1);
          setMessages(prev => [
            ...prev,
            { id: assistantMsgId!, role: 'assistant', content: '', timestamp: new Date() },
          ]);
        }
        return assistantMsgId;
      };

      if (reader) {
        let ndJsonBuffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          ndJsonBuffer += decoder.decode(value, { stream: true });
          const lines = ndJsonBuffer.split('\n');
          ndJsonBuffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const event = JSON.parse(trimmed) as { t: string; v?: string; id?: string; tool?: string; args?: Record<string, unknown>; desc?: string; schema?: ToolApproval['schema'] };
              if (event.t === 'error') {
                // Server-side error surfaced over the NDJSON stream
                setError(event.v ?? 'Server error');
                setLastFailedPrompt(userMessage.content);
              } else if (event.t === 'conversation' && event.id) {
                setActiveConversationId(Number(event.id));
              } else if (event.t === 'text' && event.v !== undefined) {
                const msgId = ensureAssistantMsg();
                assistantContent += event.v;
                setMessages(prev =>
                  prev.map(m => m.id === msgId ? { ...m, content: assistantContent } : m),
                );
              } else if (event.t === 'approval' && event.id) {
                const approval: ToolApproval = {
                  id: event.id,
                  toolName: event.tool ?? event.id,
                  args: event.args ?? {},
                  description: event.desc ?? '',
                  status: 'pending',
                  schema: event.schema,
                };
                const sessionKey = `${approval.toolName}::${JSON.stringify(approval.args)}`;
                if (sessionApprovedRef.current.has(sessionKey)) {
                  // Same tool+args already approved this session — auto-approve and show as pre-approved
                  approval.status = 'approved';
                  void handleApproval(event.id, true);
                }
                setMessages(prev => [
                  ...prev,
                  { id: event.id!, role: 'tool_approval', content: '', timestamp: new Date(), approval },
                ]);
              }
            } catch {
              // Fallback: treat unrecognised lines as raw text
              const msgId = ensureAssistantMsg();
              assistantContent += line;
              setMessages(prev =>
                prev.map(m => m.id === msgId ? { ...m, content: assistantContent } : m),
              );
            }
          }
        }
        // Auto-read the completed assistant response aloud
        if (autoSpeak && assistantMsgId && assistantContent) {
          speakMessage(assistantMsgId, assistantContent, false);
        }
      } else {
        // Non-streaming fallback: parse NDJSON body
        const rawBody = await response.text();
        let content = '';
        try {
          for (const line of rawBody.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const event = JSON.parse(trimmed);
            if (event.t === 'text') content += event.v ?? '';
          }
        } catch {
          content = rawBody; // fallback
        }
        const assistantMessage: Message = {
          id: String(Date.now() + 1),
          role: 'assistant',
          content,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, assistantMessage]);
        // Auto-read the completed assistant response aloud
        if (autoSpeak && content) speakMessage(assistantMessage.id, content, false);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled — not an error
      } else {
        setError(err instanceof Error ? err.message : 'An error occurred');
        setLastFailedPrompt(userMessage.content);
      }
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  }, [inputMessage, session, agentName, attachedFiles, speakMessage, autoSpeak]);

  const handleCancel = () => {
    abortControllerRef.current?.abort();
  };

  const handleRetry = () => {
    if (!lastFailedPrompt) return;
    setInputMessage(lastFailedPrompt);
    setLastFailedPrompt(null);
    setError('');
  };

  const handleNewConversation = () => {
    setMessages([]);
    setActiveConversationId(null);
    setError('');
  };

  const handleLoadConversation = useCallback(async (convId: number) => {
    if (!session) return;
    try {
      const res = await fetch(`/conversations/${convId}/messages?session=${encodeURIComponent(session)}`);
      if (!res.ok) return;
      const data = await res.json() as { messages: { id: number; role: string; content: string; timestamp: string }[] };
      const loaded: Message[] = data.messages.map(m => ({
        id: String(m.id),
        role: m.role as Message['role'],
        content: m.content,
        timestamp: new Date(m.timestamp),
      }));
      setMessages(loaded);
      setActiveConversationId(convId);
    } catch { /* non-critical */ }
  }, [session]);

  const handleExport = () => {
    const lines = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `**${m.role === 'user' ? 'You' : agentName}** _(${m.timestamp.toLocaleString()})_\n\n${m.content}`)
      .join('\n\n---\n\n');
    const blob = new Blob([lines], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Send the user's approval/denial decision to the server. */
  const handleApproval = useCallback(async (approvalId: string, approved: boolean) => {
    // Update the card status instantly
    setMessages(prev =>
      prev.map(m =>
        m.approval?.id === approvalId
          ? { ...m, approval: { ...m.approval!, status: approved ? ('approved' as const) : ('denied' as const) } }
          : m,
      ),
    );
    // Remember approved combos so subsequent identical tool calls are auto-approved
    if (approved) {
      const approvedMsg = messagesRef.current.find(m => m.approval?.id === approvalId);
      if (approvedMsg?.approval) {
        const key = `${approvedMsg.approval.toolName}::${JSON.stringify(approvedMsg.approval.args)}`;
        sessionApprovedRef.current.add(key);
      }
    }
    try {
      await fetch(`/chat/approve/${approvalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session, approved }),
      });
    } catch {
      setError('Failed to send approval decision');
    }
  }, [session]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <ConversationSidebar
        activeConversationId={activeConversationId}
        onSelectConversation={handleLoadConversation}
        onNewConversation={handleNewConversation}
        onConversationDeleted={(id) => { if (id === activeConversationId) handleNewConversation(); }}
      />
      <AppBar position="static" elevation={0}>
        <Toolbar sx={{ gap: 0.5, minHeight: { xs: 56, sm: 64 } }}>
          <BotIcon sx={{ mr: { xs: 0.5, sm: 0.75 }, flexShrink: 0, fontSize: 20, color: 'primary.main' }} />
          <Typography
            variant="h6"
            sx={{
              fontSize: { xs: '0.875rem', sm: '1rem', md: '1.1rem' },
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flexShrink: 1,
              minWidth: 0,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              color: 'primary.main',
            }}
          >
            {agentName}
          </Typography>

          {/* Model selector — next to agent name, all screen sizes */}
          {availableModels.length > 0 && (
            <FormControl size="small" sx={{ mx: 1, minWidth: { xs: 100, sm: 160 }, flexShrink: 0 }}>
              <Select
                value={currentModel}
                onChange={handleModelChange}
                disabled={loading}
                sx={{
                  color: 'text.secondary',
                  fontSize: { xs: '0.7rem', sm: '0.8rem' },
                  fontFamily: "'Outfit', sans-serif",
                  '.MuiOutlinedInput-notchedOutline': { borderColor: 'divider' },
                  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'primary.main' },
                  '.MuiSvgIcon-root': { color: 'text.secondary' },
                  borderRadius: 1.5,
                }}
              >
                {availableModels.map(m => (
                  <MenuItem key={m} value={m} sx={{ fontSize: '0.8rem', fontFamily: "'Outfit', sans-serif" }}>{m}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {/* Spacer */}
          <Box sx={{ flexGrow: 1 }} />

          {/* AppBar right controls — theme toggle + overflow menu (all screen sizes) */}
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <IconButton color="inherit" onClick={toggleDarkMode} size="small">
              {darkMode ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
            <IconButton color="inherit" onClick={e => setMobileMenuAnchor(e.currentTarget)} size="small">
              <MoreVertIcon />
            </IconButton>
          </Box>
          <Menu
            anchorEl={mobileMenuAnchor}
            open={Boolean(mobileMenuAnchor)}
            onClose={() => setMobileMenuAnchor(null)}
          >
            <MenuItem disabled sx={{ fontSize: '0.75rem', opacity: 0.6, minHeight: 0, py: 0.5 }}>
              {username}
            </MenuItem>
            <Divider />
            {availableAgents.length > 1 && [
              <MenuItem disabled key="agent-label" sx={{ fontSize: '0.7rem', opacity: 0.5, minHeight: 0, py: 0.25 }}>Agent</MenuItem>,
              ...availableAgents.map(a => (
                <MenuItem
                  key={a}
                  selected={a === agentName}
                  onClick={() => { setMobileMenuAnchor(null); window.location.href = `/front/${a}`; }}
                  sx={{ fontSize: '0.85rem' }}
                >
                  {a}
                </MenuItem>
              )),
              <Divider key="agent-divider" />,
            ]}
            <MenuItem onClick={() => { setMobileMenuAnchor(null); toggleAutoSpeak(); }} sx={{ fontSize: '0.85rem' }}>
              <ListItemIcon>{autoSpeak ? <VolumeUpIcon fontSize="small" /> : <VolumeOffIcon fontSize="small" />}</ListItemIcon>
              <ListItemText>{autoSpeak ? 'Read aloud: on' : 'Read aloud: off'}</ListItemText>
            </MenuItem>
            <MenuItem
              onClick={() => { setMobileMenuAnchor(null); handleExport(); }}
              disabled={messages.length === 0}
              sx={{ fontSize: '0.85rem' }}
            >
              <ListItemIcon><DownloadIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Export</ListItemText>
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => { setMobileMenuAnchor(null); logout(); }} sx={{ fontSize: '0.85rem' }}>
              <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Logout</ListItemText>
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      {error && (
        <Alert
          severity="error"
          onClose={() => { setError(''); setLastFailedPrompt(null); }}
          action={lastFailedPrompt ? (
            <Button color="inherit" size="small" onClick={handleRetry}>
              Retry
            </Button>
          ) : undefined}
        >
          {error}
        </Alert>
      )}

      <Box
        sx={{
          flexGrow: 1,
          overflow: 'auto',
          overscrollBehavior: 'contain',
          bgcolor: 'background.default',
          p: { xs: 1, sm: 2 },
        }}
      >
        <Container maxWidth="md">
          <List sx={{ width: '100%' }}>
            {messages.length === 0 && (
              <Box
                sx={{
                  textAlign: 'center',
                  py: { xs: 6, sm: 10 },
                  px: 2,
                  animation: 'fadeIn 0.5s ease-out',
                  '@keyframes fadeIn': {
                    '0%': { opacity: 0, transform: 'translateY(12px)' },
                    '100%': { opacity: 1, transform: 'translateY(0)' },
                  },
                }}
              >
                <Box
                  sx={{
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    bgcolor: (t) => t.palette.mode === 'dark' ? 'rgba(255,107,107,0.1)' : 'rgba(232,85,85,0.08)',
                    border: '1px solid',
                    borderColor: (t) => t.palette.mode === 'dark' ? 'rgba(255,107,107,0.2)' : 'rgba(232,85,85,0.18)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    mx: 'auto',
                    mb: 2.5,
                  }}
                >
                  <BotIcon sx={{ fontSize: 30, color: 'primary.main', opacity: 0.85 }} />
                </Box>
                <Typography
                  sx={{
                    fontWeight: 600,
                    fontSize: { xs: '1rem', sm: '1.125rem' },
                    letterSpacing: '-0.02em',
                    color: 'text.primary',
                    mb: 0.75,
                  }}
                >
                  {agentName}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 300, mx: 'auto', lineHeight: 1.6 }}>
                  Ask me anything — I'm ready to help.
                </Typography>
              </Box>
            )}
            {messages.map((message) =>
              message.role === 'tool_approval' && message.approval ? (
                <ToolApprovalCard
                  key={message.id}
                  approval={message.approval}
                  onApprove={() => handleApproval(message.approval!.id, true)}
                  onDeny={() => handleApproval(message.approval!.id, false)}
                />
              ) : (
                <ChatMessage
                  key={message.id}
                  message={message}
                  isSpeaking={speakingMsgId === message.id}
                  onSpeak={() => speakMessage(message.id, message.content)}
                  onStopSpeaking={stopSpeaking}
                />
              )
            )}
            {loading && (
              <ListItem sx={{ justifyContent: 'flex-start', py: 0.75 }}>
                <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                  <Box
                    sx={{
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      bgcolor: 'primary.main',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      mt: 0.25,
                      opacity: 0.9,
                    }}
                  >
                    <BotIcon sx={{ fontSize: 14, color: 'white' }} />
                  </Box>
                  <Box sx={{ display: 'flex', gap: '4px', alignItems: 'center', height: 26 }}>
                    {[0, 1, 2].map(i => (
                      <Box
                        key={i}
                        sx={{
                          width: 5,
                          height: 5,
                          borderRadius: '50%',
                          bgcolor: 'primary.main',
                          animation: 'pulse 1.4s ease-in-out infinite',
                          animationDelay: `${i * 0.18}s`,
                          opacity: 0.7,
                          '@keyframes pulse': {
                            '0%, 60%, 100%': { transform: 'scale(0.6)', opacity: 0.3 },
                            '30%': { transform: 'scale(1)', opacity: 0.9 },
                          },
                        }}
                      />
                    ))}
                  </Box>
                </Box>
              </ListItem>
            )}
            <div ref={messagesEndRef} />
          </List>
        </Container>
      </Box>

      <Paper
        elevation={0}
        sx={{
          p: { xs: 1, sm: 1.5 },
          borderTop: 1,
          borderColor: 'divider',
          bgcolor: 'background.default',
          pb: { xs: 'max(8px, env(safe-area-inset-bottom))', sm: 1.5 },
        }}
      >
        <Container maxWidth="md">
          {/* Attached file previews */}
          {(attachedFiles.length > 0 || compressingCount > 0) && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
              {attachedFiles.map((file, index) => (
                <Box key={index} sx={{ position: 'relative', display: 'inline-block' }}>
                  {file.mimeType.startsWith('image/') ? (
                    <Box
                      component="img"
                      src={file.dataUrl}
                      alt={file.name}
                      title={file.name}
                      onClick={() => setPreviewFile(file)}
                      sx={{
                        height: 72,
                        maxWidth: 120,
                        borderRadius: 1,
                        border: '1px solid',
                        borderColor: 'divider',
                        objectFit: 'cover',
                        cursor: 'pointer',
                      }}
                    />
                  ) : (
                    <Box
                      title={file.name}
                      onClick={() => setPreviewFile(file)}
                      sx={{
                        height: 72,
                        maxWidth: 120,
                        borderRadius: 1,
                        border: '1px solid',
                        borderColor: 'divider',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        p: 1,
                        bgcolor: 'grey.100',
                        cursor: 'pointer',
                        '&:hover': { borderColor: 'primary.main' },
                      }}
                    >
                      <Typography variant="caption" sx={{ wordBreak: 'break-all', textAlign: 'center', lineHeight: 1.2 }}>
                        {file.name}
                      </Typography>
                    </Box>
                  )}
                  <IconButton
                    size="small"
                    onClick={() => handleRemoveFile(index)}
                    sx={{
                      position: 'absolute',
                      top: -8,
                      right: -8,
                      bgcolor: 'background.paper',
                      border: '1px solid',
                      borderColor: 'divider',
                      p: '2px',
                      '&:hover': { bgcolor: 'error.light', color: 'white' },
                    }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
              {/* Compression-in-progress placeholders */}
              {Array.from({ length: compressingCount }).map((_, i) => (
                <Box
                  key={`compressing-${i}`}
                  sx={{
                    '@keyframes cpFade': {
                      '0%, 100%': { opacity: 0.45, borderColor: 'primary.main' },
                      '50%': { opacity: 1, borderColor: 'primary.light' },
                    },
                    '@keyframes cpBar': {
                      '0%, 60%, 100%': { transform: 'scaleY(0.3)', opacity: 0.25 },
                      '30%': { transform: 'scaleY(1)', opacity: 1 },
                    },
                    height: 72,
                    width: 72,
                    borderRadius: 1,
                    border: '1px dashed',
                    borderColor: 'primary.main',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 0.75,
                    animation: 'cpFade 1.8s ease-in-out infinite',
                  }}
                >
                  <Box sx={{ display: 'flex', gap: '3px', alignItems: 'center', height: 14 }}>
                    {[0, 1, 2].map(d => (
                      <Box
                        key={d}
                        sx={{
                          width: 3,
                          height: 14,
                          borderRadius: '2px',
                          bgcolor: 'primary.main',
                          animation: 'cpBar 1.1s ease-in-out infinite',
                          animationDelay: `${d * 0.18}s`,
                        }}
                      />
                    ))}
                  </Box>
                  <Typography sx={{
                    fontFamily: 'monospace',
                    fontSize: '0.52rem',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'text.secondary',
                    lineHeight: 1,
                  }}>
                    cmp
                  </Typography>
                </Box>
              ))}
            </Box>
          )}

          {/* File preview dialog */}
          <Dialog
            open={previewFile !== null}
            onClose={() => setPreviewFile(null)}
            maxWidth="lg"
            fullWidth
          >
            {previewFile && (
              <>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1 }}>
                  <Typography variant="subtitle1" noWrap sx={{ flex: 1, mr: 1 }}>{previewFile.name}</Typography>
                  <IconButton size="small" onClick={() => setPreviewFile(null)}>
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </DialogTitle>
                <DialogContent dividers sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                  {previewFile.mimeType.startsWith('image/') ? (
                    <Box
                      component="img"
                      src={previewFile.dataUrl}
                      alt={previewFile.name}
                      sx={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain', borderRadius: 1 }}
                    />
                  ) : (
                    <Box
                      component="pre"
                      sx={{
                        width: '100%',
                        maxHeight: '75vh',
                        overflow: 'auto',
                        m: 0,
                        p: 1,
                        fontSize: '0.8rem',
                        fontFamily: 'monospace',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        bgcolor: 'grey.100',
                        borderRadius: 1,
                      }}
                    >
                      {(() => { try { return atob(previewFile.base64); } catch { return previewFile.dataUrl; } })()}
                    </Box>
                  )}
                </DialogContent>
              </>
            )}
          </Dialog>

          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
            {/* Hidden file input — multiple files allowed, all types accepted */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={handleFilesSelect}
            />

            {/* Attach button */}
            <Tooltip title="Attach files">
              <span>
                <IconButton
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  color={attachedFiles.length > 0 ? 'primary' : 'default'}
                >
                  <AttachFileIcon />
                </IconButton>
              </span>
            </Tooltip>

            <TextField
              fullWidth
              multiline
              maxRows={4}
              placeholder="Type your message..."
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              variant="outlined"
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 3,
                  bgcolor: 'background.paper',
                  fontSize: '0.9375rem',
                  transition: 'box-shadow 0.2s',
                  '&.Mui-focused': {
                    boxShadow: (t) => `0 0 0 3px ${t.palette.mode === 'dark' ? 'rgba(255,107,107,0.15)' : 'rgba(232,85,85,0.12)'}`,
                  },
                },
              }}
            />
            {loading ? (
              <Tooltip title="Cancel">
                <span>
                  <IconButton
                    color="error"
                    onClick={handleCancel}
                    sx={{ display: { xs: 'flex', sm: 'none' }, flexShrink: 0 }}
                  >
                    <StopIcon />
                  </IconButton>
                  <Button
                    variant="outlined"
                    color="error"
                    onClick={handleCancel}
                    endIcon={<StopIcon />}
                    sx={{ minWidth: 90, display: { xs: 'none', sm: 'flex' }, flexShrink: 0 }}
                  >
                    Cancel
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <Tooltip title="Send (Enter)">
                <span>
                  <IconButton
                    color="primary"
                    onClick={handleSendMessage}
                    disabled={!inputMessage.trim()}
                    sx={{
                      display: { xs: 'flex', sm: 'none' },
                      flexShrink: 0,
                      bgcolor: inputMessage.trim() ? 'primary.main' : 'transparent',
                      color: inputMessage.trim() ? 'white' : 'text.disabled',
                      '&:hover': { bgcolor: 'primary.dark' },
                      '&.Mui-disabled': { bgcolor: 'transparent' },
                    }}
                  >
                    <SendIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                  <Button
                    variant="contained"
                    onClick={handleSendMessage}
                    disabled={!inputMessage.trim()}
                    endIcon={<SendIcon sx={{ fontSize: 16 }} />}
                    sx={{
                      minWidth: 90,
                      display: { xs: 'none', sm: 'flex' },
                      flexShrink: 0,
                      borderRadius: 2.5,
                      py: 1.2,
                      fontWeight: 600,
                    }}
                  >
                    Send
                  </Button>
                </span>
              </Tooltip>
            )}
          </Box>
        </Container>
      </Paper>
    </Box>
  );
};
