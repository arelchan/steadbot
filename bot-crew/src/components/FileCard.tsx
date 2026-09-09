import type React from 'react';
import type { FileRef } from '../types';
import { openPreview } from './Preview';
import { fileHref } from '../services/runtime';
import { t } from '../i18n';

export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function kindOf(f: FileRef): { icon: string; label: string } {
  const m = f.mime;
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  if (m.startsWith('image/')) return { icon: '▣', label: t('file.image') };
  if (m.startsWith('text/html')) return { icon: '◫', label: t('file.html') };
  if (m === 'application/pdf') return { icon: '▤', label: 'PDF' };
  if (ext === 'xlsx' || ext === 'csv') return { icon: '▦', label: ext === 'csv' ? 'CSV' : 'Excel' };
  if (ext === 'docx') return { icon: '▤', label: 'Word' };
  if (ext === 'pptx') return { icon: '▭', label: 'PPT' };
  if (ext === 'md') return { icon: '≡', label: 'Markdown' };
  if (m.startsWith('video/')) return { icon: '▶', label: t('file.video') };
  if (/^(js|mjs|ts|py|sh|json|yaml|yml|mmd)$/.test(ext)) return { icon: '‹›', label: ext.toUpperCase() };
  return { icon: '▫', label: ext ? ext.toUpperCase() : t('file.other') };
}

/** Plain click opens the preview modal; modifier/middle clicks keep the browser's own new-tab behaviour. */
const preview = (file: FileRef) => (e: React.MouseEvent) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  openPreview({ kind: 'file', file });
};

/** A file rendered in place of its path inside the text: compact chip (images: small thumbnail), opens the preview. */
export function FileChip({ file }: { file: FileRef }) {
  const k = kindOf(file);
  if (file.mime.startsWith('image/')) {
    return (
      <a className="file-chip img" href={fileHref(file)} target="_blank" rel="noopener noreferrer" title={file.path} onClick={preview(file)}>
        <img src={fileHref(file)} alt={file.name} loading="lazy" />
        <span className="fi-cap">{file.name} · {fmtSize(file.size)}</span>
      </a>
    );
  }
  return (
    <a className="file-chip" href={fileHref(file)} target="_blank" rel="noopener noreferrer" title={file.path} onClick={preview(file)}>
      <span className="fc-ic">{k.icon}</span>
      <span className="fc-name">{file.name}</span>
      <span className="fc-meta">{k.label} · {fmtSize(file.size)}</span>
      <span className="fc-open">{t('common.preview')}</span>
    </a>
  );
}

/** Deliverables a bot mentioned but whose path text isn't in the bubble (fallback): cards under the bubble. */
export function FileCards({ files }: { files: FileRef[] }) {
  return (
    <div className="files">
      {files.map((f) => {
        const k = kindOf(f);
        if (f.mime.startsWith('image/')) {
          return (
            <a key={f.path} className="file-img" href={fileHref(f)} target="_blank" rel="noopener noreferrer" title={f.name} onClick={preview(f)}>
              <img src={fileHref(f)} alt={f.name} loading="lazy" />
              <span className="fi-cap">{f.name} · {fmtSize(f.size)}</span>
            </a>
          );
        }
        return (
          <a key={f.path} className="file-card" href={fileHref(f)} target="_blank" rel="noopener noreferrer" title={f.path} onClick={preview(f)}>
            <span className="fc-ic">{k.icon}</span>
            <span className="fc-main">
              <span className="fc-name">{f.name}</span>
              <span className="fc-meta">{k.label} · {fmtSize(f.size)}</span>
            </span>
            <span className="fc-open">{t('common.preview')}</span>
          </a>
        );
      })}
    </div>
  );
}
