import {
    Add as AddIcon,
    Chat as ChatIcon,
    ChevronLeft as ChevronLeftIcon,
    ChevronRight as ChevronRightIcon,
    DeleteOutline as DeleteIcon,
} from '@mui/icons-material';
import {
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
import { useAuth } from '../context/AuthContext';

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
        if (open) refresh();
    }, [open, refresh, activeConversationId]);

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

    const drawerWidth = 260;

    const drawerSx = {
        width: drawerWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
            width: drawerWidth,
            boxSizing: 'border-box',
            top: 64, // below AppBar
            height: 'calc(100% - 64px)',
        },
    };

    const drawerContent = (
        <>
            <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, py: 1, gap: 1 }}>
                <ChatIcon fontSize="small" color="action" />
                <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
                    History
                </Typography>
                <Tooltip title="New conversation">
                    <IconButton size="small" onClick={onNewConversation}>
                        <AddIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            </Box>
            <Divider />
            <List dense sx={{ overflow: 'auto', flexGrow: 1 }}>
                {conversations.length === 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 1, display: 'block' }}>
                        No past conversations
                    </Typography>
                )}
                {conversations.map(conv => (
                    <ListItemButton
                        key={conv.id}
                        selected={conv.id === activeConversationId}
                        onClick={() => onSelectConversation(conv.id)}
                        sx={{
                            borderRadius: 1, mx: 0.5, my: 0.25,
                            '& .delete-btn': { opacity: 0 },
                            '&:hover .delete-btn': { opacity: 1 },
                        }}
                    >
                        <ListItemText
                            primary={conv.title}
                            secondary={new Date(conv.updatedAt).toLocaleDateString()}
                            slotProps={{
                                primary: { noWrap: true, variant: 'body2' },
                                secondary: { variant: 'caption' },
                            }}
                        />
                        <Tooltip title="Delete" placement="right">
                            <IconButton
                                className="delete-btn"
                                size="small"
                                onClick={e => handleDelete(e, conv.id)}
                                sx={{ p: '2px', color: 'error.main', flexShrink: 0 }}
                            >
                                <DeleteIcon fontSize="inherit" />
                            </IconButton>
                        </Tooltip>
                    </ListItemButton>
                ))}
            </List>
        </>
    );

    return (
        <>
            {/* Toggle button always visible */}
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
                        boxShadow: 1,
                        transition: 'left 225ms',
                    }}
                >
                    {open ? <ChevronLeftIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
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
                <Drawer
                    variant="persistent"
                    anchor="left"
                    open={open}
                    onClose={() => setOpen(false)}
                    sx={drawerSx}
                >
                    {drawerContent}
                </Drawer>
            )}
        </>
    );
};
