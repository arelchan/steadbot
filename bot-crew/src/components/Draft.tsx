import { agent } from '../services/agent';
import { Composer } from './Thread';

/** 新 bot 的空窗口：第一条消息发出时才生成 bot。 */
export function Draft() {
  return (
    <section className="col thread draft">
      <header className="hd">
        <span className="avatar draft-av">?</span>
        <div className="who">
          <span className="n quiet-n">新 bot</span>
        </div>
      </header>
      <div className="msgs draft-body">
        <div className="draft-empty">
          <div className="de-t">说一句你想让它管什么</div>
          <div className="de-s">比如「帮我盯竞品动态，每周五给我一页纸」。它会照这句话给自己起名、定职责，然后马上开始办这件事。之后随时可以在右边改。</div>
        </div>
      </div>
      <Composer threadId="draft-bot" placeholder="第一句话，说清它管什么…" onSend={(text) => agent.onDraftMessage(text)} />
    </section>
  );
}
