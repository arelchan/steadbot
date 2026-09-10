import { createPortal } from 'react-dom';
import { useEffect } from 'react';
import { cx } from '../utils';
import { useT } from '../i18n';

/** In-app confirmation. Keeps the product's look instead of the browser's native dialog. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, onConfirm]);
  return createPortal(
    <div className="overlay" onClick={onCancel}>
      <div className="modal confirm" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal>
        <h2>{title}</h2>
        {message && <p className="lead">{message}</p>}
        <div className="actions">
          <button className="btn" onClick={onCancel}>{t('common.cancel')}</button>
          <button className={cx('btn primary', danger && 'danger')} onClick={onConfirm} autoFocus>{confirmLabel ?? t('common.confirm')}</button>
        </div>
      </div>
    </div>
    ,
    document.body,
  );
}
