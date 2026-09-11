import { useState } from 'react';
import { agent } from '../services/agent';
import { Composer } from './Thread';
import { useT } from '../i18n';

const EXAMPLES = ['draft.eg1', 'draft.eg2', 'draft.eg3', 'draft.eg4'] as const;

/** 新 bot 的空窗口：第一条消息发出时才生成 bot。 */
export function Draft() {
  const t = useT();
  const [seed, setSeed] = useState<{ text: string; n: number }>();
  return (
    <section className="col thread draft">
      <header className="hd">
        <span className="avatar draft-av">?</span>
        <div className="who">
          <span className="n quiet-n">{t('draft.new')}</span>
        </div>
      </header>
      <div className="msgs draft-body">
        <div className="draft-empty">
          <div className="de-t">{t('draft.title')}</div>
          <Composer threadId="draft-bot" placeholder={t('draft.placeholder')} seed={seed} onSend={(text) => agent.onDraftMessage(text)} />
          <div className="de-eg">
            {EXAMPLES.map((k) => (
              <button key={k} onClick={() => setSeed((s) => ({ text: t(k), n: (s?.n ?? 0) + 1 }))}>{t(k)}</button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
