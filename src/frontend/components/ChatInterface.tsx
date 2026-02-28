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
import { isVisionModel, Message } from '../types';
import { ChatMessage } from './ChatMessage';

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

      // Handle streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';

      if (reader) {
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, assistantMessage]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          assistantContent += chunk;

          setMessages((prev) => {
            const updated = [...prev];
            const lastMessage = updated[updated.length - 1];
            if (lastMessage.role === 'assistant') {
              lastMessage.content = assistantContent;
            }
            return updated;
          });
        }
      } else {
        // Non-streaming fallback
        const text = await response.text();
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: text,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppBar position="static">
        <Toolbar>
          <BotIcon sx={{ mr: 2 }} />
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            AI Agent: {agentName}
          </Typography>
          {availableModels.length > 0 && (
            <FormControl size="small" sx={{ mr: 2, minWidth: 180 }}>
              <Select
                value={currentModel}
                onChange={handleModelChange}
                disabled={loading}
                sx={{
                  color: 'inherit',
                  '.MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.5)' },
                  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'white' },
                  '.MuiSvgIcon-root': { color: 'inherit' },
                  fontSize: '0.85rem',
                }}
              >
                {availableModels.map(m => (
                  <MenuItem key={m} value={m} sx={{ fontSize: '0.85rem' }}>{m}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          <Typography variant="body2" sx={{ mr: 2 }}>
            {username}
          </Typography>
          <IconButton color="inherit" onClick={logout}>
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
          bgcolor: 'background.default',
          p: 2,
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
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
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
          p: 2,
          borderTop: 1,
          borderColor: 'divider',
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
                <Button
                  variant="outlined"
                  color="error"
                  onClick={handleCancel}
                  endIcon={<StopIcon />}
                  sx={{ minWidth: 100 }}
                >
                  Cancel
                </Button>
              </Tooltip>
            ) : (
              <Button
                variant="contained"
                onClick={handleSendMessage}
                disabled={!inputMessage.trim()}
                endIcon={<SendIcon />}
                sx={{ minWidth: 100 }}
              >
                Send
              </Button>
            )}
          </Box>
        </Container>
      </Paper>
    </Box>
  );
};
