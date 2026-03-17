import {
    createTheme,
    CssBaseline,
    ThemeProvider
} from '@mui/material';
import React, { useState } from 'react';
import { AuthProvider } from './components/auth/AuthProvider';
import { ChatInterface } from './components/chat/ChatInterface';
import { LoginScreen } from './components/auth/LoginScreen';
import { useAuth } from './components/auth/AuthContext';

const CORAL = '#ff6b6b';
const CORAL_DARK = '#e85555';
const CORAL_LIGHT = '#ff8e8e';

// Main App Component
const ChatApp: React.FC<{ agentName: string }> = ({ agentName }) => {
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') !== 'false');

  const theme = createTheme({
    palette: {
      mode: darkMode ? 'dark' : 'light',
      primary: {
        main: darkMode ? CORAL : CORAL_DARK,
        light: darkMode ? CORAL_LIGHT : '#ff8e8e',
        dark: '#c43c3c',
        contrastText: '#ffffff',
      },
      secondary: {
        main: darkMode ? '#7b8cde' : '#5c6bc0',
        contrastText: '#ffffff',
      },
      background: {
        default: darkMode ? '#0c0c10' : '#faf9f7',
        paper: darkMode ? '#15151c' : '#ffffff',
      },
      text: {
        primary: darkMode ? '#e8e6e3' : '#1a1a2e',
        secondary: darkMode ? '#8b8994' : '#6b6880',
      },
      divider: darkMode ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)',
    },
    breakpoints: {
      values: { xs: 0, sm: 480, md: 768, lg: 1024, xl: 1280 },
    },
    typography: {
      fontFamily: "'Outfit', sans-serif",
      fontWeightLight: 300,
      fontWeightRegular: 400,
      fontWeightMedium: 500,
      fontWeightBold: 600,
      h4: { fontSize: 'clamp(1.25rem, 5vw, 2.125rem)', fontWeight: 600, letterSpacing: '-0.02em' },
      h5: { fontWeight: 600, letterSpacing: '-0.02em' },
      h6: { fontSize: 'clamp(0.95rem, 3vw, 1.1rem)', fontWeight: 600, letterSpacing: '-0.01em' },
      subtitle1: { fontWeight: 500, letterSpacing: '-0.01em' },
      subtitle2: { fontWeight: 500, letterSpacing: '-0.005em' },
      body1: { letterSpacing: '0.01em', lineHeight: 1.65 },
      body2: { letterSpacing: '0.01em', lineHeight: 1.6 },
      button: { fontFamily: "'Outfit', sans-serif", fontWeight: 500, letterSpacing: '0.02em' },
    },
    shape: {
      borderRadius: 10,
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          '*, *::before, *::after': { boxSizing: 'border-box' },
          '::-webkit-scrollbar': { width: '6px', height: '6px' },
          '::-webkit-scrollbar-track': { background: 'transparent' },
          '::-webkit-scrollbar-thumb': {
            background: darkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.15)',
            borderRadius: '3px',
          },
          '::-webkit-scrollbar-thumb:hover': {
            background: darkMode ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.25)',
          },
        },
      },
      MuiToolbar: {
        styleOverrides: {
          root: {
            paddingLeft: 12,
            paddingRight: 12,
            '@media (min-width: 480px)': {
              paddingLeft: 16,
              paddingRight: 16,
            },
          },
        },
      },
      MuiContainer: {
        defaultProps: { disableGutters: false },
        styleOverrides: {
          root: {
            paddingLeft: 8,
            paddingRight: 8,
            '@media (min-width: 480px)': {
              paddingLeft: 16,
              paddingRight: 16,
            },
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            backgroundColor: darkMode ? 'rgba(12,12,16,0.85)' : 'rgba(250,249,247,0.85)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            borderBottom: `1px solid ${darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)'}`,
            boxShadow: 'none',
            color: darkMode ? '#e8e6e3' : '#1a1a2e',
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            textTransform: 'none',
            fontWeight: 500,
          },
          contained: {
            boxShadow: 'none',
            '&:hover': { boxShadow: 'none' },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            ...(darkMode && {
              border: '1px solid rgba(255,255,255,0.06)',
            }),
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundImage: 'none',
            backgroundColor: darkMode ? '#10101a' : '#f5f4f2',
            borderRight: `1px solid ${darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)'}`,
          },
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-root': {
              borderRadius: 10,
              fontFamily: "'Outfit', sans-serif",
            },
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            fontFamily: "'Outfit', sans-serif",
            fontSize: '0.875rem',
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            fontFamily: "'Outfit', sans-serif",
          },
        },
      },
    },
  });

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider agentName={agentName} darkMode={darkMode} toggleDarkMode={() => setDarkMode(d => { const next = !d; localStorage.setItem('darkMode', String(next)); return next; })}>
        <AuthContent />
      </AuthProvider>
    </ThemeProvider>
  );
};

const AuthContent: React.FC = () => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <ChatInterface /> : <LoginScreen />;
};

export default ChatApp;
