# React Frontend for AI Agent Chat

## Overview

This is a complete React + TypeScript + Material-UI chat interface for the AI Agent system. It provides a modern, responsive UI with authentication and real-time streaming chat capabilities.

## Features

- **Authentication**: Login screen with Basic Auth
- **Real-time Chat**: Streaming responses from AI agents
- **Material-UI**: Modern, responsive design
- **Session Management**: Persistent sessions using sessionStorage
- **Multi-Agent Support**: Switch between different AI agents
- **TypeScript**: Full type safety
- **Message History**: View conversation history with timestamps

## Building the Frontend

### Install Dependencies

```bash
npm install
```

### Build Frontend Bundle

```bash
npm run build:frontend
```

This compiles the React application into a single JavaScript bundle at `dist/frontend/bundle.js`.

### Build Backend Only

```bash
npm run build
```

This builds only the TypeScript backend. The frontend bundle is preserved.

### Build Everything (Recommended)

```bash
npm run build:all
```

This performs a clean build of both the backend TypeScript and the frontend React bundle.

### Important Build Notes

- `npm run clean` - Removes only backend files (`dist/src`, `dist/examples`), **preserves frontend**
- `npm run clean:all` - Removes entire `dist` folder
- `npm run build` - Backend only, **safe to run without rebuilding frontend**
- `npm run build:frontend` - Frontend only
- `npm run build:all` - Complete clean build of everything

**TIP**: After running `npm run build:all` once, you can run just `npm run build` for backend changes without rebuilding the frontend.

## Usage

### 1. Start the Server

```bash
# Build everything first
npm run build:all

# Start the server
npm start
```

### 2. Access the Frontend

Open your browser and navigate to:

```
https://localhost:3000/front/general
```

Replace `general` with any available agent name:
- `https://localhost:3000/front/general` - General AI Agent
- `https://localhost:3000/front/weather` - Weather Agent (if configured)
- `https://localhost:3000/front/custom` - Custom agents you create

### 3. Login

Use your configured credentials (default from `.env`):
- Username: From `DEFAULT_USERNAME` in `.env`
- Password: From `DEFAULT_PASSWORD` in `.env`

### 4. Chat

- Type your message in the input field
- Press Enter or click Send
- Watch the AI response stream in real-time

## Project Structure

```
src/frontend/
├── ChatApp.tsx       # Main React application
├── index.tsx         # React entry point
└── ...

src/utils/
└── frontendTemplate.ts   # HTML template generator

webpack.config.js     # Webpack configuration
.babelrc             # Babel configuration
```

## Components

### ChatApp.tsx

Main application with the following features:

1. **AuthProvider** - Global authentication context
   - Login/logout functionality
   - Session management with sessionStorage
   - Agent name and username tracking

2. **LoginScreen** - Authentication UI
   - Username/password form
   - Error handling
   - Loading states

3. **ChatInterface** - Main chat UI
   - Message list with user/assistant avatars
   - Real-time streaming support
   - Input field with multi-line support
   - Send button with loading state
   - App bar with logout button

4. **ChatMessage** - Individual message component
   - User vs assistant styling
   - Timestamps
   - Proper text wrapping

### API Integration

The frontend communicates with these endpoints:

- `POST /login` - Authentication
- `POST /logout` - End session
- `POST /chat/:agent` - Send messages (supports streaming)

## Technology Stack

- **React 18** - UI library
- **TypeScript** - Type safety
- **Material-UI v5** - UI components
- **Emotion** - CSS-in-JS styling
- **Webpack 5** - Bundler
- **Babel 7** - Transpiler

## Development

### Webpack Configuration

See `webpack.config.js` for build configuration. Key features:
- TypeScript/TSX support via Babel
- Source maps in development
- Minification in production
- CSS loading

### Environment

The frontend automatically detects the agent name from the URL path.

### Session Storage

Authentication tokens are stored in `sessionStorage`:
- `session` - Session token
- `username` - Current username

## Customization

### Themes

The app supports a Material-UI theme. To enable dark mode toggle, uncomment the theme switching logic in `ChatApp.tsx`.

### Styling

All styling uses Material-UI's `sx` prop and theme system. Modify the theme in `ChatApp.tsx`:

```typescript
const theme = createTheme({
  palette: {
    mode: darkMode ? 'dark' : 'light',
    primary: {
      main: '#1976d2', // Change primary color
    },
    secondary: {
      main: '#dc004e', // Change secondary color
    },
  },
});
```

### Agent-Specific Features

To add agent-specific features, modify the `ChatInterface` component to check `agentName` from the auth context:

```typescript
const { agentName } = useAuth();

if (agentName === 'weather') {
  // Show weather-specific UI
}
```

## Troubleshooting

### Bundle Not Found Error

**Error**: `ENOENT: no such file or directory, open '.../dist/frontend/bundle.js'`

**Solution**:
```bash
# Build everything from scratch
npm run build:all

# Or just build the frontend
npm run build:frontend
```

### Bundle Disappearing After Backend Build

**Issue**: The frontend bundle exists but disappears after running certain commands.

**Solution**: Use the correct build commands:
- ✅ `npm run build:all` - Complete clean build
- ✅ `npm run build` - Backend only (preserves frontend)
- ✅ `npm run build:frontend` - Frontend only
- ❌ `npm run clean:all` followed by `npm run build` - This will delete frontend bundle!

Always use `npm run build:all` for a complete rebuild.

### Module Not Found Errors

Reinstall dependencies:

```bash
rm -rf node_modules package-lock.json
npm install
```

### TypeScript Errors

Check that type definitions are installed:

```bash
npm install --save-dev @types/react @types/react-dom
```

### Build Errors

Clean and rebuild everything:

```bash
npm run clean:all
npm run build:all
```

Or clean backend only (preserves frontend):

```bash
npm run clean
npm run build
```

## Production Deployment

For production deployment:

1. Build the frontend:
   ```bash
   NODE_ENV=production npm run build:frontend
   ```

2. Build the backend:
   ```bash
   npm run build
   ```

3. Start the server:
   ```bash
   NODE_ENV=production npm start
   ```

The bundle will be minified and optimized for production.

## Security Notes

- Always use HTTPS in production
- Store session tokens securely
- Implement proper CORS configuration
- Use environment variables for sensitive data
- Keep dependencies updated

## Known Limitations

- Bundle size is ~400KB (can be optimized with code splitting)
- No offline support
- Session expires based on server configuration
- Streaming requires browser support for ReadableStream

## Future Enhancements

- [ ] Dark mode toggle
- [ ] Message editing
- [ ] Message deletion
- [ ] File upload support
- [ ] Code syntax highlighting
- [ ] Export conversation history
- [ ] Keyboard shortcuts
- [ ] Accessibility improvements
- [ ] Mobile optimization
- [ ] Progressive Web App (PWA) support
