import { useEffect, useMemo, useState } from 'react';
import { Row, Pick } from './Field';
import { cx } from '../utils';
import { useT } from '../i18n';
import { fetchModels, refreshModels, saveModels } from '../services/models';
import type { ModelChoice, ModelMeta, ModelSlot, ModelsPage, ModelsPatch } from '../types';

/**
 * 设置 › 模型.
 *
 * One row per job a model does here — talking, thinking cheap, looking at pictures, working a screen, drawing,
 * searching, vectorising, re-ranking — and each row picks its own provider and model. Providers are what the rows
 * are made of, not a step to walk through first: nobody sits down wanting to "add Anthropic", they want the eyes
 * to be better. A row whose provider has no key says so and asks for one right there, and the key it is given is
 * shared with every other row that picks the same provider.
 */

const MANUAL = '__manual__';
/** the key field opened from the 钥匙 list rather than from a row */
const KEYS_ROW = '__keys__';

const short = (spec: string) => spec.replace(/^[a-z0-9-]+\//, '');
const providerOf = (spec?: string) => (spec && spec.includes('/') ? spec.slice(0, spec.indexOf('/')) : undefined);
const idOf = (spec?: string) => (spec && spec.includes('/') ? spec.slice(spec.indexOf('/') + 1) : (spec ?? ''));
const providerName = (p: ModelsPage, id: string) => p.providers.find((x) => x.id === id)?.name ?? id;

export function ModelsTab() {
  const t = useT();
  const [page, setPage] = useState<ModelsPage>();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  /** where a key is being typed right now: which row asked, and for whom */
  const [asking, setAsking] = useState<{ slot: string; provider: string }>();

  useEffect(() => {
    let alive = true;
    fetchModels()
      .then((p) => alive && setPage(p))
      .catch((e: Error) => alive && setErr(e.message === 'old' ? t('models.oldVersion') : t('models.fetchFail')));
    return () => {
      alive = false;
    };
  }, []);

  const apply = async (patch: ModelsPatch) => {
    setBusy(true);
    try {
      setPage(await saveModels(patch));
      setErr('');
    } catch {
      setErr(t('models.saveFail'));
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setBusy(true);
    try {
      setPage(await refreshModels());
    } catch {
      /* the list already on screen still works */
    } finally {
      setBusy(false);
    }
  };

  if (err && !page) return <div className="quiet">{err}</div>;
  if (!page) return <div className="quiet">{t('common.loading')}</div>;

  const keyed = page.providers.filter((p) => p.keyed);
  const giveKey = (id: string, v?: string) => {
    setAsking(undefined);
    if (v !== undefined) void apply({ keys: { [id]: v } });
  };
  const asker = asking ? page.providers.find((p) => p.id === asking.provider) : undefined;


  return (
    <div className={cx('models', busy && 'busy')}>
      <div className="set-rows">
        {page.slots.map((s) => (
          <SlotView key={s.id} slot={s} page={page} asking={asking} onAsk={setAsking} onKey={giveKey} onPatch={(p) => void apply(p)} />
        ))}
      </div>

      <h4>
        {t('models.keys')}
        <span className="h4-aside">
          <button className="link" onClick={() => void refresh()} disabled={busy}>{t('models.refresh')}</button>
        </span>
      </h4>
      {keyed.length === 0 ? (
        <div className="quiet">{t('models.noKeys')}</div>
      ) : (
        <ul className="usage-list">
          {keyed.map((p) => (
            <li key={p.id}>
              <span className="ul-n">{p.name}</span>
              <span className="ul-v">{t(`models.source.${p.keyed}`)}</span>
              <span className="ul-c">
                {p.keyed === 'app' ? (
                  <>
                    <button className="link" onClick={() => setAsking({ slot: KEYS_ROW, provider: p.id })}>{t('models.replace')}</button>
                    <span className="sep">·</span>
                    <button className="link" onClick={() => void apply({ keys: { [p.id]: null } })}>{t('models.remove')}</button>
                  </>
                ) : (
                  t('models.notHere')
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {asking?.slot === KEYS_ROW && asker && <KeyAsk provider={asker} onDone={(v) => giveKey(asker.id, v)} />}
      {err && <div className="quiet">{err}</div>}
    </div>
  );
}

function SlotView({
  slot,
  page,
  asking,
  onAsk,
  onKey,
  onPatch,
}: {
  slot: ModelSlot;
  page: ModelsPage;
  asking?: { slot: string; provider: string };
  onAsk: (at: { slot: string; provider: string } | undefined) => void;
  onKey: (providerId: string, key?: string) => void;
  onPatch: (p: ModelsPatch) => void;
}) {
  const t = useT();
  // The provider a row is on is the one its model belongs to — until the user picks a different one and has not
  // yet picked a model from it. That in-between lives here, and is forgotten the moment the server answers.
  const settled = slot.only ?? providerOf(slot.value) ?? providerOf(slot.effective) ?? '';
  const [picking, setPicking] = useState<{ from: string; to: string }>();
  const prov = picking?.from === settled ? picking.to : settled;
  const setProv = (to: string) => setPicking({ from: settled, to });
  const [manual, setManual] = useState(false);

  // The rows pinned to one provider carry their own list; the rest read the provider's catalog.
  const list: ModelChoice[] = useMemo(() => page.models[slot.only ? slot.id : prov] ?? [], [page, prov, slot.id, slot.only]);
  const visible = slot.needs === 'vision' ? list.filter((m) => m.vision) : list;
  const chosen = providerOf(slot.value) === prov || slot.only ? idOf(slot.value) : '';
  const spec = (id: string) => (slot.only ? id : `${prov}/${id}`);
  const provider = page.providers.find((p) => p.id === (slot.only ?? prov));
  const open = !!provider && asking?.slot === slot.id;
  // A hand-written id: the catalog cannot price it, so the row asks for the numbers itself.
  const unknown = !!slot.effective && slot.effective !== 'off' && !!slot.value && !list.some((x) => x.id === idOf(slot.value));

  const empty = slot.inherits
    ? t('models.inherit', { what: t(`models.slot.${slot.inherits}`) })
    : slot.auto
      ? t('models.auto')
      : slot.fallback
        ? t('models.default', { model: short(slot.fallback) })
        : t('models.none');

  // Three things the row can say about itself, in the order they matter: what it is for, who is the only one who
  // can do it, and — the only one that asks for anything — that whoever it is set to has no key.
  const aside = slot.pinned ? t('models.pinned') : slot.only ? t('models.only', { who: providerName(page, slot.only) }) : '';
  const note = (
    <>
      {t(`models.what.${slot.id}`)}
      {aside && ` · ${aside}`}
      {slot.blocked && provider && !open && (
        <>
          {' · '}
          <button className="link warn" onClick={() => onAsk({ slot: slot.id, provider: provider.id })}>{t('models.needKey', { who: provider.name })}</button>
        </>
      )}
    </>
  );

  return (
    <>
      <Row label={t(`models.slot.${slot.id}`)} note={note}>
        {!slot.only && (
          <Pick
            value={prov}
            onChange={(v) => {
              setManual(false);
              setProv(v);
              onAsk(v && !page.providers.find((p) => p.id === v)?.keyed ? { slot: slot.id, provider: v } : undefined);
              // A row cannot be half-changed: picking a new provider drops the old provider's model.
              if (slot.value && providerOf(slot.value) !== v) onPatch({ slots: { [slot.id]: null } });
            }}
          >
            <option value="">{t('models.pickProvider')}</option>
            <optgroup label={t('models.connected')}>
              {page.providers.filter((p) => p.keyed).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </optgroup>
            <optgroup label={t('models.others')}>
              {page.providers.filter((p) => !p.keyed).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </optgroup>
          </Pick>
        )}
        {manual ? (
          <input
            className="in mono"
            defaultValue={chosen}
            autoFocus
            onFocus={(e) => e.target.select()}
            placeholder={t('models.manualHint')}
            onBlur={(e) => {
              const v = e.target.value.trim();
              setManual(false);
              onPatch({ slots: { [slot.id]: v ? spec(v) : null } });
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <Pick
            value={chosen}
            onChange={(v) => (v === MANUAL ? setManual(true) : onPatch({ slots: { [slot.id]: v ? spec(v) : null } }))}
          >
            <option value="">{empty}</option>
            {slot.offable && <option value="off">{t('models.off')}</option>}
            {/* A model typed by hand, or one the catalog has since dropped, still shows as the row's answer. */}
            {chosen && chosen !== 'off' && !visible.some((m) => m.id === chosen) && <option value={chosen}>{list.find((m) => m.id === chosen)?.name ?? chosen}</option>}
            {visible.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.costIn ? ` · $${m.costIn}/${m.costOut ?? 0}` : ''}
              </option>
            ))}
            <option value={MANUAL}>{t('models.manual')}</option>
          </Pick>
        )}
      </Row>
      {open && provider && <KeyAsk provider={provider} onDone={(v) => onKey(provider.id, v)} />}
      {unknown && <MetaAsk key={slot.effective} meta={slot.meta} onSave={(m) => onPatch({ meta: { [slot.effective!]: m } })} />}
    </>
  );
}

/**
 * A model id nobody's catalog has heard of. pi will talk to it either way, but it has to be told how big the
 * context is and what a token costs, or the 用量 page quietly reports zero for everything it does.
 */
function MetaAsk({ meta, onSave }: { meta?: ModelMeta; onSave: (m: ModelMeta) => void }) {
  const t = useT();
  const [m, setM] = useState<ModelMeta>(meta ?? {});
  const num = (k: 'contextWindow' | 'maxTokens' | 'costIn' | 'costOut', label: string) => (
    <label className="ma-f">
      <span>{label}</span>
      <input
        className="in"
        inputMode="decimal"
        defaultValue={m[k] ?? ''}
        onBlur={(e) => {
          const v = e.target.value.trim() === '' ? undefined : Number(e.target.value);
          const next = { ...m, [k]: Number.isFinite(v) ? v : undefined };
          setM(next);
          onSave(next);
        }}
      />
    </label>
  );
  return (
    <div className="key-ask meta-ask">
      <span className="ka-l">{t('models.unknownModel')}</span>
      {num('contextWindow', t('models.ctx'))}
      {num('maxTokens', t('models.maxOut'))}
      {num('costIn', t('models.priceIn'))}
      {num('costOut', t('models.priceOut'))}
    </div>
  );
}

/** The one place a key is typed. It never comes back: the server only ever says which provider has one and whence. */
function KeyAsk({ provider, onDone }: { provider: { id: string; name: string; apiKey?: string }; onDone: (v?: string) => void }) {
  const t = useT();
  const [v, setV] = useState('');
  return (
    <div className="key-ask">
      <span className="ka-l">{provider.apiKey ?? t('models.keyOf', { who: provider.name })}</span>
      <input
        className="in mono"
        type="password"
        autoFocus
        value={v}
        placeholder={t('models.keyPlaceholder')}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && v.trim() && onDone(v.trim())}
      />
      <button className="btn sm" disabled={!v.trim()} onClick={() => onDone(v.trim())}>{t('models.save')}</button>
      <button className="link" onClick={() => onDone(undefined)}>{t('common.cancel')}</button>
    </div>
  );
}
