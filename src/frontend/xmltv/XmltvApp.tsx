import React, { useState } from 'react';
import { createTheme, CssBaseline, ThemeProvider } from '@mui/material';
import { AuthProvider } from '../components/AuthProvider';
import { useAuth } from '../context/AuthContext';
import { LoginScreen } from '../components/LoginScreen';
import XmltvViewer from './XmltvViewer';

const AuthGate: React.FC = () => {
  const { isAuthenticated, session } = useAuth();
  if (!isAuthenticated || !session) return <LoginScreen />;
  return <XmltvViewer session={session} />;
};

const XmltvApp: React.FC = () => {
  const [darkMode, setDarkMode] = useState(true);

  const theme = createTheme({
    palette: {
      mode: darkMode ? 'dark' : 'light',
      primary: { main: '#ff6b6b' },
      background: {
        default: darkMode ? '#0c0c10' : '#f5f5f5',
        paper: darkMode ? '#1a1a24' : '#ffffff',
      },
    },
    typography: { fontFamily: "'Outfit', sans-serif" },
  });

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider
        agentName="xmltv"
        loginTitle="📺 TV Guide"
        darkMode={darkMode}
        toggleDarkMode={() => setDarkMode(d => !d)}
      >
        <AuthGate />
      </AuthProvider>
    </ThemeProvider>
  );
};

export default XmltvApp;
