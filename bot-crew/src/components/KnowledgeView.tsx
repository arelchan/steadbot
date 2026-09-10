import { useEffect, useRef, useState } from 'react';
import { knowledge, type KDoc, type KDocDetail, type KTopic } from '../services/agent';
import { useT } from '../i18n';
import { cx } from '../utils';

/**
 * 资料: documents the user hands the crew, split by the engine into a tree of topics. The other half of
 * what a bot knows — memory grows out of the conversation, this is handed over — so it sits beside 记忆
 * as its own tab, with the same list-and-reading-pane shape.
 *
 * Everything here is shared: a document has no owner, and every bot searches the same library.
 */
export function KnowledgeView() {
  const t = useT();
  const [alive, setAlive] = useState(true);
  const [docs, setDocs] = useState<KDoc[]>([]);
  const [cats, setCats] = useState<{ id: string; docs: number }[]>([]);
  const [cat, setCat] = useState<string | undefined>();
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<KDocDetail | null>(null);
  const [topic, setTopic] = useState<KTopic | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ topic: KTopic; doc: string; score: number }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const load = () => void knowledge.docs().then((r) => { setAlive(r.alive); setDocs(r.items); setCats(r.categories); setSel((s) => s ?? r.items[0]?.docId ?? null); });
  useEffect(load, []);
  // A document takes a minute or more to split; while one is in flight, keep checking for it.
  useEffect(() => {
    if (!busy) return;
    const h = setInterval(() => void knowledge.docs().then((r) => {
      setDocs(r.items);
      setCats(r.categories);
      if (r.items.some((d) => d.title === busy)) setBusy(null);
    }), 5000);
    return () => clearInterval(h);
  }, [busy]);
  useEffect(() => {
    setTopic(null);
    if (!sel) { setDetail(null); return; }
    void knowledge.doc(sel).then((r) => setDetail(r.doc));
  }, [sel]);
  useEffect(() => {
    if (!q.trim()) { setHits(null); return; }
    const h = setTimeout(() => void knowledge.search(q).then((r) => setHits(r.hits)), 350);
    return () => clearTimeout(h);
  }, [q]);

  const take = async (f: File) => {
    const title = f.name.replace(/\.[a-z0-9]+$/i, '');
    setBusy(title);
    const ok = await knowledge.add(f, title);
    if (!ok) setBusy(null);
  };
  const shown = cat ? docs.filter((d) => d.category === cat) : docs;

  if (!alive) return <div className="mem-empty"><span className="k">Knowledge</span><span>{t('mem.off')}</span></div>;
  return (
    <>
      <div className="mem-bar">
        <div className="mem-tabs">
          <button className={cx('mem-tab', !cat && 'on')} onClick={() => setCat(undefined)}>{t('mem.allBots')}<span>{docs.length}</span></button>
          {cats.map((c) => (
            <button key={c.id} className={cx('mem-tab', cat === c.id && 'on')} onClick={() => setCat(c.id)}>{c.id}<span>{c.docs}</span></button>
          ))}
        </div>
        <input className="mem-search" placeholder={t('kn.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="mem-body">
        {!docs.length && !busy ? (
          <div className="mem-empty">
            <span className="k">Knowledge</span>
            <span>{t('common.none')}</span>
            <button className="link" onClick={() => file.current?.click()}>{t('kn.add')}</button>
          </div>
        ) : (
          <div
            className={cx('mem-split', !detail && !hits && 'solo')}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void take(f); }}
          >
            <div className="mem-list">
              {hits ? (
                <>
                  <div className="mem-count">{t('mem.found', { n: String(hits.length) })}</div>
                  {hits.map((h) => (
                    <button key={h.topic.id} className={cx('mem-it', topic?.id === h.topic.id && 'on')} onClick={() => void knowledge.topic(h.topic.id).then((r) => setTopic(r.topic))}>
                      <div className="h"><b>{h.topic.name}</b></div>
                      <div className="s">{h.topic.summary}</div>
                      <div className="meta"><span>{h.doc}</span></div>
                    </button>
                  ))}
                </>
              ) : (
                <>
                  {busy && <div className="mem-it"><div className="h"><b>{busy}</b></div><div className="meta"><span>{t('kn.reading')}</span></div></div>}
                  {shown.map((d) => (
                    <button key={d.docId} className={cx('mem-it', sel === d.docId && 'on')} onClick={() => setSel(d.docId)}>
                      <div className="h"><b>{d.title}</b><span className="r">{d.at.slice(5, 10)}</span></div>
                      <div className="meta"><span>{d.category}</span><span>{t('kn.topics', { n: String(d.topics) })}</span></div>
                    </button>
                  ))}
                  <button className="mem-add" onClick={() => file.current?.click()}>{t('kn.add')}</button>
                </>
              )}
            </div>
            {(topic || detail) && (
              <div className="mem-pane">
                {topic ? (
                  <>
                    <h4>{topic.name}</h4>
                    <div className="meta"><span>{topic.path}</span>{!hits && <button className="link" onClick={() => setTopic(null)}>{t('kn.backToDoc')}</button>}</div>
                    {(topic.content ?? topic.summary).split(/\n\s*\n/).map((p, i) => <p key={i}>{p}</p>)}
                  </>
                ) : detail ? (
                  <>
                    <h4>{detail.title}</h4>
                    <div className="meta">
                      <span>{detail.category}</span>
                      {detail.source && <span>{detail.source}</span>}
                      <button className="link danger" onClick={async () => { if (await knowledge.remove(detail.docId)) { setSel(null); load(); } }}>{t('kn.remove')}</button>
                    </div>
                    <p>{detail.summary}</p>
                    <div className="mem-grp">{t('kn.topicList', { n: String(detail.topics.length) })}</div>
                    {detail.topics.map((tp) => (
                      <button key={tp.id} className="kn-topic" onClick={() => void knowledge.topic(tp.id).then((r) => setTopic(r.topic))}>
                        <b>{tp.name}</b>
                        <span>{tp.summary}</span>
                      </button>
                    ))}
                  </>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>
      <input ref={file} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void take(f); e.target.value = ''; }} />
    </>
  );
}
