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
import React, { useState } from 'react';
import { Message } from '../types';

interface ChatMessageProps {
  message: Message;
  isSpeaking?: boolean;
  onSpeak?: () => void;
  onStopSpeaking?: () => void;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message, isSpeaking = false, onSpeak, onStopSpeaking }) => {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
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
          {message.imageUrls && message.imageUrls.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: message.content ? 1 : 0 }}>
              {message.imageUrls.map((url, i) => (
                <Box
                  key={i}
                  component="img"
                  src={url}
                  alt={`attachment ${i + 1}`}
                  sx={{
                    display: 'block',
                    maxWidth: '100%',
                    maxHeight: 240,
                    borderRadius: 1,
                    objectFit: 'contain',
                  }}
                />
              ))}
            </Box>
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
                <Tooltip title={isSpeaking ? 'Stop' : 'Read aloud'} placement="top">
                  <IconButton
                    size="small"
                    onClick={isSpeaking ? onStopSpeaking : onSpeak}
                    sx={{
                      opacity: isSpeaking ? 1 : 0.5,
                      '&:hover': { opacity: 1 },
                      p: '2px',
                      color: isSpeaking ? 'primary.main' : 'text.secondary',
                    }}
                  >
                    {isSpeaking ? <VolumeOffIcon fontSize="inherit" /> : <VolumeUpIcon fontSize="inherit" />}
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
