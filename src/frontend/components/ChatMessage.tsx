import {
    SmartToy as BotIcon,
    ContentCopy as CopyIcon,
    Person as PersonIcon,
    VolumeOff as VolumeOffIcon,
    VolumeUp as VolumeUpIcon
} from '@mui/icons-material';
import {
    Avatar,
    Box,
    IconButton,
    ListItem,
    Paper,
    Tooltip,
    Typography
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import { Message } from '../types';

interface ChatMessageProps {
  message: Message;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  // Stop speech if this message is unmounted mid-playback
  useEffect(() => {
    return () => {
      if (speaking) window.speechSynthesis.cancel();
    };
  }, [speaking]);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSpeak = () => {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(message.content);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    // Cancel any ongoing speech from other messages before starting
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  };

  return (
    <ListItem
      sx={{
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        py: 1,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          flexDirection: isUser ? 'row-reverse' : 'row',
          maxWidth: { xs: '92%', sm: '80%' },
        }}
      >
        <Avatar
          sx={{
            bgcolor: isUser ? 'primary.main' : 'secondary.main',
            mx: 1,
          }}
        >
          {isUser ? <PersonIcon /> : <BotIcon />}
        </Avatar>
        <Paper
          elevation={1}
          sx={{
            p: 2,
            bgcolor: isUser ? 'primary.light' : 'grey.100',
            color: isUser ? 'primary.contrastText' : 'text.primary',
          }}
        >
          {message.imageUrl && (
            <Box
              component="img"
              src={message.imageUrl}
              alt="attachment"
              sx={{
                display: 'block',
                maxWidth: '100%',
                maxHeight: 320,
                borderRadius: 1,
                mb: message.content ? 1 : 0,
                objectFit: 'contain',
              }}
            />
          )}
          <Typography
            variant="body1"
            sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >
            {message.content}
          </Typography>
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              mt: 0.5,
              opacity: 0.7,
            }}
          >
            {message.timestamp.toLocaleTimeString()}
          </Typography>
          {message.content && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.5, gap: 0.5 }}>
              {!isUser && (
                <Tooltip title={speaking ? 'Stop' : 'Read aloud'} placement="top">
                  <IconButton
                    size="small"
                    onClick={handleSpeak}
                    sx={{
                      opacity: speaking ? 1 : 0.5,
                      '&:hover': { opacity: 1 },
                      p: '2px',
                      color: speaking ? 'primary.main' : 'text.secondary',
                    }}
                  >
                    {speaking ? <VolumeOffIcon fontSize="inherit" /> : <VolumeUpIcon fontSize="inherit" />}
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip title={copied ? 'Copied!' : 'Copy'} placement="top">
                <IconButton
                  size="small"
                  onClick={handleCopy}
                  sx={{
                    opacity: 0.5,
                    '&:hover': { opacity: 1 },
                    p: '2px',
                    color: isUser ? 'primary.contrastText' : 'text.secondary',
                  }}
                >
                  <CopyIcon fontSize="inherit" />
                </IconButton>
              </Tooltip>
            </Box>
          )}
        </Paper>
      </Box>
    </ListItem>
  );
};
