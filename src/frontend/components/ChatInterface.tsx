import {
    SmartToy as BotIcon,
    Logout as LogoutIcon,
    Send as SendIcon,
    AttachFile as AttachFileIcon,
    Close as CloseIcon,
    StopCircle as StopIcon
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
  const [attachedImage, setAttachedImage] = useState<{ dataUrl: string; base64: string; mimeType: string } | null>(null);
  const [supportsVision, setSupportsVision] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [currentModel, setCurrentModel] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { session, username, agentName, logout } = useAuth();

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
        if (!isVisionModel(model)) setAttachedImage(null);
      })
      .catch(() => setError('Failed to switch model'));
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      setError('Image must be smaller than 15 MB');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      // dataUrl is "data:<mimeType>;base64,<data>"
      const [header, base64] = dataUrl.split(',');
      const mimeType = header.replace('data:', '').replace(';base64', '');
      setAttachedImage({ dataUrl, base64, mimeType });
    };
    reader.readAsDataURL(file);

    // Reset file input so the same file can be re-selected if needed
    e.target.value = '';
  };

  const handleRemoveImage = () => {
    setAttachedImage(null);
  };

  const handleSendMessage = useCallback(async () => {
    if (!inputMessage.trim() || !session) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputMessage,
      timestamp: new Date(),
      imageUrl: attachedImage?.dataUrl,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputMessage('');
    const imageCopy = attachedImage;
    setAttachedImage(null);
    setLoading(true);
    setError('');

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const body: Record<string, string> = {
        session: session!,
        prompt: inputMessage,
      };
      if (imageCopy) {
        body.imageBase64 = imageCopy.base64;
        body.imageMimeType = imageCopy.mimeType;
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
  }, [inputMessage, session, agentName, attachedImage]);

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
                <ChatMessage key={message.id} message={message} />
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
          {/* Image preview */}
          {attachedImage && (
            <Box sx={{ position: 'relative', display: 'inline-block', mb: 1 }}>
              <Box
                component="img"
                src={attachedImage.dataUrl}
                alt="attachment preview"
                sx={{
                  height: 72,
                  borderRadius: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                  objectFit: 'cover',
                }}
              />
              <IconButton
                size="small"
                onClick={handleRemoveImage}
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
          )}

          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleImageSelect}
            />

            {/* Attach button — only shown for vision-capable models */}
            {supportsVision && (
              <Tooltip title="Attach image">
                <span>
                  <IconButton
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading}
                    color={attachedImage ? 'primary' : 'default'}
                  >
                    <AttachFileIcon />
                  </IconButton>
                </span>
              </Tooltip>
            )}

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
