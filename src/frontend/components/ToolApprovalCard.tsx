import {
    CheckCircle as ApproveIcon,
    Cancel as DenyIcon,
    ExpandMore as ExpandMoreIcon,
    Warning as WarningIcon,
} from '@mui/icons-material';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Box,
    Button,
    Chip,
    ListItem,
    Paper,
    Typography,
} from '@mui/material';
import React from 'react';
import { ToolApproval } from '../types';

interface ToolApprovalCardProps {
  approval: ToolApproval;
  onApprove: () => void;
  onDeny: () => void;
}

export const ToolApprovalCard: React.FC<ToolApprovalCardProps> = ({
  approval,
  onApprove,
  onDeny,
}) => {
  const isPending = approval.status === 'pending';

  return (
    <ListItem sx={{ justifyContent: 'flex-start', py: 1 }}>
      <Paper
        elevation={2}
        sx={{
          maxWidth: { xs: '95%', sm: '80%' },
          width: '100%',
          borderLeft: 4,
          borderColor:
            approval.status === 'approved'
              ? 'success.main'
              : approval.status === 'denied'
              ? 'error.main'
              : 'warning.main',
          p: 2,
          bgcolor: 'background.paper',
        }}
      >
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <WarningIcon color="warning" fontSize="small" />
          <Typography variant="subtitle2" fontWeight="bold" color="warning.dark">
            Tool Approval Required
          </Typography>
          {!isPending && (
            <Chip
              size="small"
              label={approval.status === 'approved' ? 'Approved' : 'Denied'}
              color={approval.status === 'approved' ? 'success' : 'error'}
              sx={{ ml: 'auto' }}
            />
          )}
        </Box>

        {/* Tool name */}
        <Typography variant="body2" sx={{ fontFamily: 'monospace', mb: 0.5 }}>
          <strong>Tool:</strong>{' '}
          <Box component="span" sx={{ color: 'primary.main' }}>
            {approval.toolName}
          </Box>
        </Typography>

        {/* Description */}
        {approval.description && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {approval.description}
          </Typography>
        )}

        {/* Arguments (collapsible) */}
        {approval.args && Object.keys(approval.args).length > 0 && (
          <Accordion disableGutters elevation={0} sx={{ bgcolor: 'grey.50', mb: 1.5 }}>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon fontSize="small" />}
              sx={{ minHeight: 32, '& .MuiAccordionSummary-content': { my: 0.5 } }}
            >
              <Typography variant="caption" color="text.secondary">
                Arguments
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 1 }}>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  fontSize: '0.72rem',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  color: 'text.primary',
                }}
              >
                {JSON.stringify(approval.args, null, 2)}
              </Box>
            </AccordionDetails>
          </Accordion>
        )}

        {/* Action buttons */}
        {isPending && (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant="contained"
              color="success"
              size="small"
              startIcon={<ApproveIcon />}
              onClick={onApprove}
              sx={{ flexGrow: 1 }}
            >
              Approve
            </Button>
            <Button
              variant="outlined"
              color="error"
              size="small"
              startIcon={<DenyIcon />}
              onClick={onDeny}
              sx={{ flexGrow: 1 }}
            >
              Deny
            </Button>
          </Box>
        )}
      </Paper>
    </ListItem>
  );
};
