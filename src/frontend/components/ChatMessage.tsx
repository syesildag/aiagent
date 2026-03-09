import {
    SmartToy as BotIcon,
    ContentCopy as CopyIcon,
    Download as DownloadIcon,
    Person as PersonIcon,
    VolumeOff as VolumeOffIcon,
    VolumeUp as VolumeUpIcon
} from '@mui/icons-material';
import {
    Box,
    IconButton,
    ListItem,
    Tooltip,
    Typography
} from '@mui/material';
import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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

  const handleDownloadImage = (url: string, index: number) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `generated-image-${index + 1}.png`;
    a.click();
  };

  return (
    <ListItem
      sx={{
        py: 0.75,
        px: 0,
        animation: 'msgFadeIn 0.25s ease-out',
        '@keyframes msgFadeIn': {
          '0%': { opacity: 0, transform: 'translateY(6px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
      }}
    >
      <Box sx={{ width: '100%' }}>
        {isUser ? (
          // User message: coral-tinted bubble, right-aligned
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'flex-end',
              '&:hover .msg-actions': { opacity: 1 },
            }}
          >
            <Box sx={{ maxWidth: { xs: '90%', sm: '80%', md: '70%' } }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', mb: 0.5, gap: 0.75 }}>
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 500, color: 'text.secondary', fontSize: '0.72rem', letterSpacing: '0.04em' }}
                >
                  You
                </Typography>
                <Box
                  sx={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    bgcolor: 'primary.main',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <PersonIcon sx={{ fontSize: 11, color: 'white' }} />
                </Box>
              </Box>
              {message.imageUrls && message.imageUrls.length > 0 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: message.content ? 1 : 0, justifyContent: 'flex-end' }}>
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
                        borderRadius: 2,
                        objectFit: 'contain',
                        border: '1px solid',
                        borderColor: 'divider',
                      }}
                    />
                  ))}
                </Box>
              )}
              {message.content && (
                <Box
                  sx={{
                    bgcolor: (theme) => theme.palette.mode === 'dark'
                      ? 'rgba(255,107,107,0.12)'
                      : 'rgba(232,85,85,0.09)',
                    border: '1px solid',
                    borderColor: (theme) => theme.palette.mode === 'dark'
                      ? 'rgba(255,107,107,0.2)'
                      : 'rgba(232,85,85,0.2)',
                    borderRadius: '14px 14px 4px 14px',
                    px: 2,
                    py: 1.25,
                  }}
                >
                  <Typography
                    variant="body1"
                    sx={{
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontSize: '0.9375rem',
                      lineHeight: 1.6,
                      color: 'text.primary',
                    }}
                  >
                    {message.content}
                  </Typography>
                </Box>
              )}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', mt: 0.5, gap: 0.5 }}>
                <Typography variant="caption" sx={{ opacity: 0.4, fontSize: '0.7rem' }}>
                  {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Typography>
                {message.content && (
                  <Box className="msg-actions" sx={{ opacity: 0, transition: 'opacity 0.15s' }}>
                    <Tooltip title={copied ? 'Copied!' : 'Copy'} placement="top">
                      <IconButton size="small" onClick={handleCopy} sx={{ p: '2px', color: 'text.secondary' }}>
                        <CopyIcon sx={{ fontSize: 13 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                )}
              </Box>
            </Box>
          </Box>
        ) : (
          // Assistant message: editorial left-border style
          <Box
            sx={{
              display: 'flex',
              gap: 1.5,
              '&:hover .msg-actions': { opacity: 1 },
            }}
          >
            {/* Bot avatar */}
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

            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.75, gap: 0.75 }}>
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 500, color: 'text.secondary', fontSize: '0.72rem', letterSpacing: '0.04em' }}
                >
                  Assistant
                </Typography>
              </Box>
              {message.generatedImageUrls && message.generatedImageUrls.length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: message.content ? 1.5 : 0 }}>
                  {message.generatedImageUrls.map((url, i) => (
                    <Box key={i} sx={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
                      <Box
                        component="img"
                        src={url}
                        alt={`Generated image ${i + 1}`}
                        sx={{
                          display: 'block',
                          maxWidth: '100%',
                          maxHeight: 512,
                          borderRadius: 2,
                          objectFit: 'contain',
                          border: '1px solid',
                          borderColor: 'divider',
                        }}
                      />
                    </Box>
                  ))}
                </Box>
              )}
              {message.content && (
                <Box
                  sx={{
                    '& p': { my: 0.75, '&:first-of-type': { mt: 0 }, '&:last-of-type': { mb: 0 } },
                    '& pre': {
                      bgcolor: (theme) => theme.palette.mode === 'dark' ? '#0a0a0e' : '#f0ede8',
                      borderRadius: 2,
                      p: '14px 16px',
                      overflow: 'auto',
                      my: 1.5,
                      border: '1px solid',
                      borderColor: 'divider',
                      fontSize: '0.8125rem',
                      fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                      lineHeight: 1.7,
                      position: 'relative',
                    },
                    '& code': {
                      fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                      fontSize: '0.8125em',
                      bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)',
                      px: '5px',
                      py: '1px',
                      borderRadius: '4px',
                      border: '1px solid',
                      borderColor: 'divider',
                    },
                    '& pre code': { bgcolor: 'transparent', p: 0, border: 'none', borderRadius: 0 },
                    '& ul, & ol': { pl: 2.5, my: 0.75 },
                    '& li': { mb: 0.4, lineHeight: 1.65 },
                    '& blockquote': {
                      borderLeft: '3px solid',
                      borderColor: 'primary.main',
                      pl: 2,
                      ml: 0,
                      my: 1,
                      color: 'text.secondary',
                      fontStyle: 'italic',
                      opacity: 0.85,
                    },
                    '& h1, & h2, & h3, & h4': {
                      my: 1.25,
                      lineHeight: 1.3,
                      fontWeight: 600,
                      letterSpacing: '-0.01em',
                    },
                    '& h1': { fontSize: '1.3em' },
                    '& h2': { fontSize: '1.15em' },
                    '& h3': { fontSize: '1.05em' },
                    '& table': { borderCollapse: 'collapse', width: '100%', my: 1.5, fontSize: '0.875em' },
                    '& th': {
                      border: '1px solid',
                      borderColor: 'divider',
                      p: '6px 12px',
                      textAlign: 'left',
                      bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
                      fontWeight: 600,
                    },
                    '& td': { border: '1px solid', borderColor: 'divider', p: '6px 12px', textAlign: 'left' },
                    '& tr:hover td': {
                      bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                    },
                    '& a': { color: 'primary.main', textDecorationThickness: '1px', textUnderlineOffset: '3px' },
                    '& strong': { fontWeight: 600 },
                    '& hr': { border: 'none', borderTop: '1px solid', borderColor: 'divider', my: 2 },
                    wordBreak: 'break-word',
                    fontSize: '0.9375rem',
                    lineHeight: 1.65,
                  }}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {message.content}
                  </ReactMarkdown>
                </Box>
              )}

              <Box sx={{ display: 'flex', alignItems: 'center', mt: 0.75, gap: 0.5 }}>
                <Typography variant="caption" sx={{ opacity: 0.4, fontSize: '0.7rem' }}>
                  {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Typography>
                {(message.content || (message.generatedImageUrls && message.generatedImageUrls.length > 0)) && (
                  <Box className="msg-actions" sx={{ opacity: 0, transition: 'opacity 0.15s', display: 'flex', gap: 0.25 }}>
                    {message.generatedImageUrls && message.generatedImageUrls.map((url, i) => (
                      <Tooltip key={i} title={`Download image${message.generatedImageUrls!.length > 1 ? ` ${i + 1}` : ''}`} placement="top">
                        <IconButton size="small" onClick={() => handleDownloadImage(url, i)} sx={{ p: '2px', color: 'text.secondary' }}>
                          <DownloadIcon sx={{ fontSize: 13 }} />
                        </IconButton>
                      </Tooltip>
                    ))}
                    {message.content && (
                      <>
                        <Tooltip title={isSpeaking ? 'Stop' : 'Read aloud'} placement="top">
                          <IconButton
                            size="small"
                            onClick={isSpeaking ? onStopSpeaking : onSpeak}
                            sx={{
                              p: '2px',
                              color: isSpeaking ? 'primary.main' : 'text.secondary',
                            }}
                          >
                            {isSpeaking ? <VolumeOffIcon sx={{ fontSize: 13 }} /> : <VolumeUpIcon sx={{ fontSize: 13 }} />}
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={copied ? 'Copied!' : 'Copy'} placement="top">
                          <IconButton size="small" onClick={handleCopy} sx={{ p: '2px', color: 'text.secondary' }}>
                            <CopyIcon sx={{ fontSize: 13 }} />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                  </Box>
                )}
              </Box>
            </Box>
          </Box>
        )}
      </Box>
    </ListItem>
  );
};
