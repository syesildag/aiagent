import {
    SmartToy as BotIcon,
    Logout as LogoutIcon,
    Send as SendIcon,
    AttachFile as AttachFileIcon,
    Close as CloseIcon,
    StopCircle as StopIcon,
    VolumeOff as VolumeOffIcon,
    VolumeUp as VolumeUpIcon
} from '@mui/icons-material';
import {
    Alert,
    AppBar,
    Box,
    Button,
    CircularProgress,
    Container,
    FormControl,
    IconButton,
    List,
    ListItem,
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
import { isVisionModel, Message, ToolApproval } from '../types';
import { ChatMessage } from './ChatMessage';
import { ToolApprovalCard } from './ToolApprovalCard';

export const ChatInterface: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<{ dataUrl: string; base64: string; mimeType: string; name: string }[]>([]);
  const [supportsVision, setSupportsVision] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [currentModel, setCurrentModel] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { session, username, agentName, logout } = useAuth();
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [autoSpeak, setAutoSpeak] = useState<boolean>(
    () => localStorage.getItem('autoSpeak') !== 'false'
  );

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

  /** Start reading a message aloud, cancelling any previous utterance. */
  const speakMessage = useCallback((msgId: string, text: string) => {
    window.speechSynthesis.cancel();
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
    scrollToBottom();
  }, [messages]);

  // Fetch model info to determine if vision/image attachment is supported
  useEffect(() => {
    fetch(`/info/${agentName}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) {
          setAvailableModels(data.models ?? []);
          setCurrentModel(data.model ?? '');
          setSupportsVision(isVisionModel(data.model ?? ''));
        }
      })
      .catch(() => {/* non-critical */});
  }, [agentName]);

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
        setSupportsVision(isVisionModel(model));
      })
      .catch(() => setError('Failed to switch model'));
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

    // Read each file as a data URL in parallel.
    // NOTE: reset the input ONLY after reading so that File objects remain valid
    // throughout the async read; resetting early can invalidate FileList entries
    // in some browsers, resulting in only the last-read file being retained.
    Promise.all(
      files.map(
        f =>
          new Promise<{ dataUrl: string; base64: string; mimeType: string; name: string }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = ev => {
              const dataUrl = ev.target?.result as string;
              const [header, base64] = dataUrl.split(',');
              const mimeType = header.replace('data:', '').replace(';base64', '');
              resolve({ dataUrl, base64, mimeType, name: f.name });
            };
            reader.onerror = reject;
            reader.readAsDataURL(f);
          }),
      ),
    ).then(results => {
      setAttachedFiles(prev => {
        // Deduplicate by name so reopening the same file doesn't add a duplicate
        const existingNames = new Set(prev.map(f => f.name));
        const fresh = results.filter(r => !existingNames.has(r.name));
        return [...prev, ...fresh];
      });
      inputEl.value = ''; // Reset after reading so the same file can be re-selected
    }).catch(() => {
      setError('Failed to read selected file(s)');
      inputEl.value = '';
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

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const body: Record<string, unknown> = {
        session: session!,
        prompt: inputMessage,
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
              const event = JSON.parse(trimmed) as { t: string; v?: string; id?: string; tool?: string; args?: Record<string, unknown>; desc?: string };
              if (event.t === 'text' && event.v !== undefined) {
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
                };
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
          speakMessage(assistantMsgId, assistantContent);
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
        if (autoSpeak && content) speakMessage(assistantMessage.id, content);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled — not an error
      } else {
        setError(err instanceof Error ? err.message : 'An error occurred');
      }
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  }, [inputMessage, session, agentName, attachedFiles, speakMessage, autoSpeak]);

  const handleCancel = () => {
    abortControllerRef.current?.abort();
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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <AppBar position="static">
        <Toolbar sx={{ gap: 0.5 }}>
          <BotIcon sx={{ mr: { xs: 0.5, sm: 1 }, flexShrink: 0 }} />
          <Typography
            variant="h6"
            sx={{
              flexGrow: 1,
              fontSize: { xs: '0.85rem', sm: '1.1rem', md: '1.25rem' },
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {agentName}
          </Typography>
          {availableModels.length > 0 && (
            <FormControl
              size="small"
              sx={{ mr: 0.5, minWidth: { xs: 110, sm: 160 }, flexShrink: 0 }}
            >
              <Select
                value={currentModel}
                onChange={handleModelChange}
                disabled={loading}
                sx={{
                  color: 'inherit',
                  '.MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.5)' },
                  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'white' },
                  '.MuiSvgIcon-root': { color: 'inherit' },
                  fontSize: { xs: '0.7rem', sm: '0.85rem' },
                }}
              >
                {availableModels.map(m => (
                  <MenuItem key={m} value={m} sx={{ fontSize: '0.85rem' }}>{m}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          {/* Hide username on phones to save space */}
          <Typography variant="body2" sx={{ mr: 0.5, display: { xs: 'none', sm: 'block' }, flexShrink: 0 }}>
            {username}
          </Typography>
          <Tooltip title={autoSpeak ? 'Auto read-aloud on' : 'Auto read-aloud off'}>
            <IconButton color="inherit" onClick={toggleAutoSpeak} size="small" sx={{ flexShrink: 0 }}>
              {autoSpeak ? <VolumeUpIcon /> : <VolumeOffIcon />}
            </IconButton>
          </Tooltip>
          <IconButton color="inherit" onClick={logout} size="small" sx={{ flexShrink: 0 }}>
            <LogoutIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      {error && (
        <Alert severity="error" onClose={() => setError('')}>
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
              <Box sx={{ textAlign: 'center', py: 8 }}>
                <BotIcon sx={{ fontSize: 80, color: 'text.disabled', mb: 2 }} />
                <Typography variant="h6" color="text.secondary">
                  Start a conversation with {agentName}
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
              <ListItem sx={{ justifyContent: 'center', py: 2 }}>
                <CircularProgress size={24} />
              </ListItem>
            )}
            <div ref={messagesEndRef} />
          </List>
        </Container>
      </Box>

      <Paper
        elevation={3}
        sx={{
          p: { xs: 1, sm: 2 },
          borderTop: 1,
          borderColor: 'divider',
          // Safe area padding for devices with home indicator
          pb: { xs: 'max(8px, env(safe-area-inset-bottom))', sm: 2 },
        }}
      >
        <Container maxWidth="md">
          {/* Attached file previews */}
          {attachedFiles.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
              {attachedFiles.map((file, index) => (
                <Box key={index} sx={{ position: 'relative', display: 'inline-block' }}>
                  {file.mimeType.startsWith('image/') ? (
                    <Box
                      component="img"
                      src={file.dataUrl}
                      alt={file.name}
                      title={file.name}
                      sx={{
                        height: 72,
                        maxWidth: 120,
                        borderRadius: 1,
                        border: '1px solid',
                        borderColor: 'divider',
                        objectFit: 'cover',
                      }}
                    />
                  ) : (
                    <Box
                      title={file.name}
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
            </Box>
          )}

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
              onKeyPress={handleKeyPress}
              disabled={loading}
              variant="outlined"
            />
            {loading ? (
              <Tooltip title="Cancel">
                {/* Show icon-only on xs, text button on sm+ */}
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
              <Tooltip title="Send">
                <span>
                  {/* Icon-only on xs */}
                  <IconButton
                    color="primary"
                    onClick={handleSendMessage}
                    disabled={!inputMessage.trim()}
                    sx={{ display: { xs: 'flex', sm: 'none' }, flexShrink: 0 }}
                  >
                    <SendIcon />
                  </IconButton>
                  <Button
                    variant="contained"
                    onClick={handleSendMessage}
                    disabled={!inputMessage.trim()}
                    endIcon={<SendIcon />}
                    sx={{ minWidth: 90, display: { xs: 'none', sm: 'flex' }, flexShrink: 0 }}
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
