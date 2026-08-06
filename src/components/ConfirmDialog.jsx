import {
  Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
} from '@mui/material';
import { t } from '../strings.js';

/** Shared confirm/cancel dialog for destructive actions (delete, bulk-clear). */
export default function ConfirmDialog({
  open, title, body, onConfirm, onCancel, confirmLabel = t.remove, confirmTestId, cancelTestId,
}) {
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{body}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} data-testid={cancelTestId}>{t.cancel}</Button>
        <Button onClick={onConfirm} color="error" autoFocus data-testid={confirmTestId}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
