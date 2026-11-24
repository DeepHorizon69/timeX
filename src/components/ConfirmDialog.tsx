import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger' | 'warning';
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Batal',
  variant = 'primary',
  onConfirm,
  onCancel,
}) => {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancel.current?.focus();
    setError(null);
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);
  if (!open) return null;

  return createPortal(
    <div
      className="dialog-backdrop"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          event.preventDefault();
          onCancel();
        }
        if (event.key !== 'Tab') return;
        const controls = dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href]'
        );
        if (!controls?.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div
        ref={dialog}
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="dialog-title">
          {title}
        </h2>
        <div className="dialog-body">{description}</div>
        {error && (
          <p role="alert" className="inline-alert inline-alert--error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            ref={cancel}
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${
              variant === 'danger'
                ? 'btn--danger'
                : variant === 'warning'
                  ? 'btn--warning'
                  : 'btn--primary'
            }`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } catch (failure) {
                setError(
                  failure instanceof Error
                    ? failure.message
                    : 'Tindakan gagal. Coba lagi.'
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Menyimpan…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
