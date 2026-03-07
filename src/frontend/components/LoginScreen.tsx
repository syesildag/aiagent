import {
    DarkMode as DarkModeIcon,
    LightMode as LightModeIcon,
    Visibility,
    VisibilityOff
} from '@mui/icons-material';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    IconButton,
    InputAdornment,
    TextField,
    Tooltip,
    Typography
} from '@mui/material';
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export const LoginScreen: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { login, agentName, darkMode, toggleDarkMode } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        height: '100dvh',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        px: { xs: 2, sm: 3 },
        // Geometric dot-grid background
        backgroundImage: (theme) => theme.palette.mode === 'dark'
          ? 'radial-gradient(circle, rgba(255,107,107,0.12) 1px, transparent 1px)'
          : 'radial-gradient(circle, rgba(232,85,85,0.12) 1px, transparent 1px)',
        backgroundSize: '28px 28px',
      }}
    >
      <Tooltip title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
        <IconButton
          onClick={toggleDarkMode}
          sx={{
            position: 'absolute',
            top: 16,
            right: 16,
            color: 'text.secondary',
            '&:hover': { color: 'primary.main' },
          }}
          aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? <LightModeIcon /> : <DarkModeIcon />}
        </IconButton>
      </Tooltip>

      <Box
        sx={{
          width: '100%',
          maxWidth: 400,
          animation: 'fadeSlideUp 0.4s ease-out',
          '@keyframes fadeSlideUp': {
            '0%': { opacity: 0, transform: 'translateY(16px)' },
            '100%': { opacity: 1, transform: 'translateY(0)' },
          },
        }}
      >
        {/* Card with top coral accent bar */}
        <Box
          sx={{
            bgcolor: 'background.paper',
            borderRadius: 3,
            overflow: 'hidden',
            border: '1px solid',
            borderColor: 'divider',
            boxShadow: (theme) => theme.palette.mode === 'dark'
              ? '0 24px 64px rgba(0,0,0,0.6)'
              : '0 16px 48px rgba(0,0,0,0.1)',
          }}
        >
          {/* Coral accent top bar */}
          <Box sx={{ height: 3, bgcolor: 'primary.main' }} />

          <Box sx={{ p: { xs: 3, sm: 4 } }}>
            {/* Identity mark */}
            <Box sx={{ mb: { xs: 2.5, sm: 4 } }}>
              <Typography
                variant="h5"
                sx={{
                  fontWeight: 300,
                  letterSpacing: '-0.03em',
                  color: 'text.primary',
                  lineHeight: 1.2,
                  mb: 0.5,
                }}
              >
                AI Agent
              </Typography>
              <Typography
                sx={{
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  letterSpacing: '-0.03em',
                  color: 'primary.main',
                  lineHeight: 1.1,
                }}
              >
                {agentName}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 1.5, fontWeight: 400 }}
              >
                Sign in to continue
              </Typography>
            </Box>

            {error && (
              <Alert
                severity="error"
                sx={{
                  mb: 2.5,
                  borderRadius: 2,
                  fontSize: '0.85rem',
                  fontFamily: "'Outfit', sans-serif",
                }}
              >
                {error}
              </Alert>
            )}

            <form onSubmit={handleSubmit}>
              <TextField
                fullWidth
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                margin="normal"
                required
                autoFocus
                disabled={loading}
                sx={{ mb: 0.5 }}
              />
              <TextField
                fullWidth
                label="Password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                margin="normal"
                required
                disabled={loading}
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          onClick={() => setShowPassword((s) => !s)}
                          edge="end"
                          tabIndex={-1}
                          size="small"
                        >
                          {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                        </IconButton>
                      </InputAdornment>
                    )
                  }
                }}
              />
              <Button
                fullWidth
                type="submit"
                variant="contained"
                size="large"
                disabled={loading}
                sx={{
                  mt: 3,
                  py: 1.4,
                  fontSize: '1rem',
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                  borderRadius: 2.5,
                }}
              >
                {loading ? <CircularProgress size={22} sx={{ color: 'inherit' }} /> : 'Sign in'}
              </Button>
            </form>
          </Box>
        </Box>

        {/* Subtle footer */}
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', textAlign: 'center', mt: 2.5, opacity: 0.5 }}
        >
          AI Agent Platform
        </Typography>
      </Box>
    </Box>
  );
};
