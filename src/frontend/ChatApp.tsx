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
