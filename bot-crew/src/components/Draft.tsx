import { agent } from '../services/agent';
import { Composer } from './Thread';
import { useT } from '../i18n';

/** 新 bot 的空窗口：第一条消息发出时才生成 bot。 */
export function Draft() {
  const t = useT();
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
          <div className="de-s">{t('draft.sub')}</div>
        </div>
      </div>
      <Composer threadId="draft-bot" placeholder={t('draft.placeholder')} onSend={(text) => agent.onDraftMessage(text)} />
    </section>
  );
}
