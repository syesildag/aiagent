import {
    CheckCircle as ApproveIcon,
    Cancel as DenyIcon,
    ExpandMore as ExpandMoreIcon,
    Loop as ContinueIcon,
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
import { ToolApproval } from '../../types';

const CONTINUE_ITERATIONS_TOOL = '__continue_iterations__';

interface CardProps {
  approval: ToolApproval;
  onApprove: () => void;
  onDeny: () => void;
}

// ── Shared shell ────────────────────────────────────────────────────────────

interface ShellProps {
  approval: ToolApproval;
  accentColor: 'warning' | 'info';
  header: React.ReactNode;
  approveLabel: string;
  approveColor: 'success' | 'info';
  ApproveIcon: React.ElementType;
  denyLabel: string;
  onApprove: () => void;
  onDeny: () => void;
  children?: React.ReactNode;
}

const ApprovalCardShell: React.FC<ShellProps> = ({
  approval, accentColor, header,
  approveLabel, approveColor, ApproveIcon: AppIcon,
  denyLabel, onApprove, onDeny, children,
}) => {
  const isPending = approval.status === 'pending';
  const borderColor = approval.status === 'approved'
    ? 'success.main'
    : approval.status === 'denied'
    ? 'error.main'
    : `${accentColor}.main`;

  return (
    <ListItem sx={{ justifyContent: 'flex-start', py: 1 }}>
      <Paper elevation={2} sx={{ maxWidth: { xs: '95%', sm: '80%' }, width: '100%', borderLeft: 4, borderColor, p: 2, bgcolor: 'background.paper' }}>
        {header}
        {children}
        {isPending && (
          <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
            <Button variant="contained" color={approveColor} size="small" startIcon={<AppIcon />} onClick={onApprove} sx={{ flexGrow: 1 }}>
              {approveLabel}
            </Button>
            <Button variant="outlined" color="error" size="small" startIcon={<DenyIcon />} onClick={onDeny} sx={{ flexGrow: 1 }}>
              {denyLabel}
            </Button>
          </Box>
        )}
      </Paper>
    </ListItem>
  );
};

// ── Dangerous tool approval ──────────────────────────────────────────────────

const DangerousToolCard: React.FC<CardProps> = ({ approval, onApprove, onDeny }) => {
  const isPending = approval.status === 'pending';

  const header = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
      <WarningIcon color="warning" fontSize="small" />
      <Typography variant="subtitle2" fontWeight="bold" color="warning.dark">Tool Approval Required</Typography>
      {!isPending && (
        <Chip size="small" label={approval.status === 'approved' ? 'Approved' : 'Denied'} color={approval.status === 'approved' ? 'success' : 'error'} sx={{ ml: 'auto' }} />
      )}
    </Box>
  );

  return (
    <ApprovalCardShell
      approval={approval} accentColor="warning" header={header}
      approveLabel="Approve" approveColor="success" ApproveIcon={ApproveIcon}
      denyLabel="Deny" onApprove={onApprove} onDeny={onDeny}
    >
      <Typography variant="body2" sx={{ fontFamily: 'monospace', mb: 0.5 }}>
        <strong>Tool:</strong>{' '}
        <Box component="span" sx={{ color: 'primary.main' }}>{approval.toolName}</Box>
      </Typography>

      {approval.description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{approval.description}</Typography>
      )}

      {approval.args && Object.keys(approval.args).length > 0 && (
        <Accordion disableGutters elevation={0} sx={{ bgcolor: 'action.hover', my: 1 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />} sx={{ minHeight: 32, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
            <Typography variant="caption" color="text.secondary">Arguments</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ p: 1 }}>
            {Object.entries(approval.args).map(([key, value]) => {
              const propSchema = approval.schema?.properties?.[key];
              const isRequired = approval.schema?.required?.includes(key);
              return (
                <Box key={key} sx={{ mb: 1, '&:last-child': { mb: 0 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                    <Typography variant="caption" fontWeight="bold" sx={{ fontFamily: 'monospace' }}>{key}</Typography>
                    {isRequired && <Chip label="required" size="small" color="warning" variant="outlined" sx={{ height: 16, fontSize: '0.6rem', px: 0 }} />}
                    {propSchema?.type && <Chip label={String(propSchema.type)} size="small" variant="outlined" sx={{ height: 16, fontSize: '0.6rem', px: 0 }} />}
                  </Box>
                  {propSchema?.description && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>{String(propSchema.description)}</Typography>
                  )}
                  <Box component="pre" sx={{ m: 0, fontSize: '0.72rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'text.primary' }}>
                    {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
                  </Box>
                </Box>
              );
            })}
          </AccordionDetails>
        </Accordion>
      )}
    </ApprovalCardShell>
  );
};

// ── Iteration continuation ───────────────────────────────────────────────────

const IterationContinuationCard: React.FC<CardProps> = ({ approval, onApprove, onDeny }) => {
  const isPending = approval.status === 'pending';
  const count = approval.args?.iterations_completed as number | undefined;

  const header = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
      <ContinueIcon color="info" fontSize="small" />
      <Typography variant="subtitle2" fontWeight="bold" color="info.dark">Max Iterations Reached</Typography>
      {!isPending && (
        <Chip size="small" label={approval.status === 'approved' ? 'Continued' : 'Stopped'} color={approval.status === 'approved' ? 'success' : 'error'} sx={{ ml: 'auto' }} />
      )}
    </Box>
  );

  return (
    <ApprovalCardShell
      approval={approval} accentColor="info" header={header}
      approveLabel="Continue" approveColor="info" ApproveIcon={ContinueIcon}
      denyLabel="Stop" onApprove={onApprove} onDeny={onDeny}
    >
      <Typography variant="body2" color="text.secondary">
        {count !== undefined
          ? `The agent used ${count} iteration${count === 1 ? '' : 's'} and needs more to finish. Allow it to continue?`
          : approval.description}
      </Typography>
    </ApprovalCardShell>
  );
};

// ── Public dispatcher ────────────────────────────────────────────────────────

export const ToolApprovalCard: React.FC<CardProps> = (props) =>
  props.approval.toolName === CONTINUE_ITERATIONS_TOOL
    ? <IterationContinuationCard {...props} />
    : <DangerousToolCard {...props} />;
