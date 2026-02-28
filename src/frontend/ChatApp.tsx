import {
    createTheme,
    CssBaseline,
    ThemeProvider
} from '@mui/material';
import React, { useState } from 'react';
import { AuthProvider } from './components/AuthProvider';
import { ChatInterface } from './components/ChatInterface';
import { LoginScreen } from './components/LoginScreen';
import { useAuth } from './context/AuthContext';

// Main App Component
const ChatApp: React.FC<{ agentName: string }> = ({ agentName }) => {
  const [darkMode, setDarkMode] = useState(false);

  const theme = createTheme({
    palette: {
      mode: darkMode ? 'dark' : 'light',
      primary: {
        main: '#1976d2',
      },
      secondary: {
        main: '#dc004e',
      },
    },
    breakpoints: {
      values: { xs: 0, sm: 480, md: 768, lg: 1024, xl: 1280 },
    },
    typography: {
      // Prevent text from being too large on small screens
      h4: { fontSize: 'clamp(1.25rem, 5vw, 2.125rem)' },
      h6: { fontSize: 'clamp(0.95rem, 3vw, 1.25rem)' },
    },
    components: {
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
    },
  });

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider agentName={agentName}>
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
