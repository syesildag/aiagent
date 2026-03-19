import {
    Add as AddIcon,
    ChevronLeft as ChevronLeftIcon,
    ChevronRight as ChevronRightIcon,
    DeleteOutline as DeleteIcon,
    DeleteSweep as DeleteSweepIcon,
    ChatBubbleOutline as ChatIcon,
} from '@mui/icons-material';
import {
    Backdrop,
    Box,
    Divider,
    Drawer,
    IconButton,
    List,
    ListItemButton,
    ListItemText,
    SwipeableDrawer,
    Tooltip,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';

interface Conversation {
    id: number;
    title: string;
    updatedAt: string;
}

interface ConversationSidebarProps {
    activeConversationId: number | null;
    onSelectConversation: (id: number) => void;
    onNewConversation: () => void;
    onConversationDeleted?: (id: number) => void;
}

function formatRelativeDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 2) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const ConversationSidebar: React.FC<ConversationSidebarProps> = ({
    activeConversationId,
    onSelectConversation,
    onNewConversation,
    onConversationDeleted,
}) => {
    const { session } = useAuth();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const [open, setOpen] = useState(false);
    const [conversations, setConversations] = useState<Conversation[]>([]);

    const refresh = useCallback(() => {
        if (!session) return;
        fetch(`/conversations?session=${encodeURIComponent(session)}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data) setConversations(data.conversations ?? []); })
            .catch(() => {});
    }, [session]);

    useEffect(() => {
        refresh();
    }, [refresh, activeConversationId]);

    const handleDeleteAll = useCallback(() => {
        if (!session || conversations.length === 0) return;
        fetch(`/conversations?session=${encodeURIComponent(session)}`, { method: 'DELETE' })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data?.ok) {
                    setConversations([]);
                    onConversationDeleted?.(-1);
                }
            })
            .catch(() => {});
    }, [session, conversations.length, onConversationDeleted]);

    const handleDelete = useCallback((e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        if (!session) return;
        fetch(`/conversations/${id}?session=${encodeURIComponent(session)}`, { method: 'DELETE' })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data?.ok) {
                    setConversations(prev => prev.filter(c => c.id !== id));
                    onConversationDeleted?.(id);
                }
            })
            .catch(() => {});
    }, [session, onConversationDeleted]);

    const drawerWidth = 264;

    const drawerSx = {
        width: drawerWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
            width: drawerWidth,
            boxSizing: 'border-box',
            top: 64,
            height: 'calc(100% - 64px)',
        },
    };

    const drawerContent = (
        <>
            {/* Header */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    px: 2,
                    py: 1.5,
                    gap: 1,
                }}
            >
                <ChatIcon sx={{ fontSize: 15, color: 'text.secondary', opacity: 0.6 }} />
                <Typography
                    variant="caption"
                    sx={{
                        flexGrow: 1,
                        fontWeight: 600,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: 'text.secondary',
                        fontSize: '0.68rem',
                    }}
                >
                    History
                </Typography>
                {conversations.length > 0 && (
                    <Tooltip title="Delete all conversations">
                        <IconButton
                            size="small"
                            onClick={handleDeleteAll}
                            sx={{
                                color: 'text.secondary',
                                border: '1px solid',
                                borderColor: 'divider',
                                borderRadius: 1.5,
                                p: '3px',
                                '&:hover': {
                                    color: 'error.main',
                                    borderColor: 'error.main',
                                    bgcolor: (t) => t.palette.mode === 'dark' ? 'rgba(255,107,107,0.08)' : 'rgba(232,85,85,0.06)',
                                },
                            }}
                        >
                            <DeleteSweepIcon sx={{ fontSize: 15 }} />
                        </IconButton>
                    </Tooltip>
                )}
                <Tooltip title="New conversation">
                    <IconButton
                        size="small"
                        onClick={onNewConversation}
                        sx={{
                            color: 'text.secondary',
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1.5,
                            p: '3px',
                            '&:hover': {
                                color: 'primary.main',
                                borderColor: 'primary.main',
                                bgcolor: (t) => t.palette.mode === 'dark' ? 'rgba(255,107,107,0.08)' : 'rgba(232,85,85,0.06)',
                            },
                        }}
                    >
                        <AddIcon sx={{ fontSize: 15 }} />
                    </IconButton>
                </Tooltip>
            </Box>
            <Divider />
            <List dense sx={{ overflow: 'auto', flexGrow: 1, pt: 0.5 }}>
                {conversations.length === 0 && (
                    <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
                        <ChatIcon sx={{ fontSize: 28, color: 'text.disabled', mb: 1 }} />
                        <Typography variant="caption" color="text.disabled" sx={{ display: 'block', fontSize: '0.75rem' }}>
                            No conversations yet
                        </Typography>
                    </Box>
                )}
                {conversations.map(conv => (
                    <ListItemButton
                        key={conv.id}
                        selected={conv.id === activeConversationId}
                        onClick={() => onSelectConversation(conv.id)}
                        sx={{
                            borderRadius: 0,
                            mx: 0,
                            my: 0,
                            px: 2,
                            py: 1,
                            borderLeft: '2px solid transparent',
                            ...(conv.id === activeConversationId && {
                                borderLeftColor: 'primary.main',
                                bgcolor: (t) => t.palette.mode === 'dark' ? 'rgba(255,107,107,0.07)' : 'rgba(232,85,85,0.06)',
                                '&:hover': {
                                    bgcolor: (t) => t.palette.mode === 'dark' ? 'rgba(255,107,107,0.1)' : 'rgba(232,85,85,0.09)',
                                },
                            }),
                            '& .delete-btn': { opacity: 0 },
                            '&:hover .delete-btn': { opacity: 1 },
                            '&:hover': {
                                bgcolor: (t) => t.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
                            },
                        }}
                    >
                        <ListItemText
                            primary={conv.title}
                            secondary={formatRelativeDate(conv.updatedAt)}
                            slotProps={{
                                primary: {
                                    noWrap: true,
                                    sx: {
                                        fontSize: '0.8125rem',
                                        fontWeight: conv.id === activeConversationId ? 500 : 400,
                                        color: conv.id === activeConversationId ? 'text.primary' : 'text.secondary',
                                        fontFamily: "'Outfit', sans-serif",
                                    },
                                },
                                secondary: {
                                    sx: {
                                        fontSize: '0.7rem',
                                        fontFamily: "'Outfit', sans-serif",
                                        color: 'text.disabled',
                                    },
                                },
                            }}
                        />
                        <Tooltip title="Delete" placement="right">
                            <IconButton
                                className="delete-btn"
                                size="small"
                                onClick={e => handleDelete(e, conv.id)}
                                sx={{
                                    p: '3px',
                                    color: 'error.main',
                                    flexShrink: 0,
                                    opacity: 0.7,
                                    '&:hover': { opacity: 1 },
                                }}
                            >
                                <DeleteIcon sx={{ fontSize: 14 }} />
                            </IconButton>
                        </Tooltip>
                    </ListItemButton>
                ))}
            </List>
        </>
    );

    return (
        <>
            {/* Toggle button */}
            <Tooltip title={open ? 'Hide history' : 'Show history'}>
                <IconButton
                    onClick={() => setOpen(o => !o)}
                    size="small"
                    sx={{
                        position: 'fixed',
                        left: open ? drawerWidth - 16 : 8,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        zIndex: theme => theme.zIndex.drawer + 1,
                        bgcolor: 'background.paper',
                        border: '1px solid',
                        borderColor: 'divider',
                        boxShadow: 2,
                        transition: open
                  ? 'left 225ms cubic-bezier(0, 0, 0.2, 1)'
                  : 'left 195ms cubic-bezier(0.4, 0, 0.6, 1)',
                        borderRadius: 1.5,
                        p: '5px',
                        '&:hover': {
                            borderColor: 'primary.main',
                            color: 'primary.main',
                        },
                    }}
                >
                    {open ? <ChevronLeftIcon sx={{ fontSize: 16 }} /> : <ChevronRightIcon sx={{ fontSize: 16 }} />}
                </IconButton>
            </Tooltip>

            {isMobile ? (
                <SwipeableDrawer
                    anchor="left"
                    open={open}
                    onOpen={() => setOpen(true)}
                    onClose={() => setOpen(false)}
                    swipeAreaWidth={20}
                    disableSwipeToOpen={false}
                    sx={drawerSx}
                >
                    {drawerContent}
                </SwipeableDrawer>
            ) : (
                <>
                    <Backdrop
                        open={open}
                        invisible
                        onClick={() => setOpen(false)}
                        sx={{ zIndex: theme => theme.zIndex.drawer - 1 }}
                    />
                    <Drawer
                        variant="persistent"
                        anchor="left"
                        open={open}
                        onClose={() => setOpen(false)}
                        sx={drawerSx}
                    >
                        {drawerContent}
                    </Drawer>
                </>
            )}
        </>
    );
};
