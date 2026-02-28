import {
    SmartToy as BotIcon,
    ContentCopy as CopyIcon,
    Person as PersonIcon
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
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
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
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.5 }}>
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
