import { useEffect, useMemo, useRef, useState } from 'react';
import { Row, Pick } from './Field';
import { cx } from '../utils';
import { useT } from '../i18n';
import { fetchModels, lastModels, saveModels } from '../services/models';
import type { ModelChoice, ModelMeta, ModelSlot, ModelsPage, ModelsPatch, SlotId } from '../types';

/**
 * 设置 › 模型.
 *
 * One row per job a model does here — talking, thinking cheap, looking at pictures, working a screen, drawing,
 * searching, vectorising, re-ranking — and every row is a whole answer on its own: which provider, whose key,
 * which model. Providers are what the rows are made of, not a step to walk through first; nobody sits down
 * wanting to "add Anthropic", they want the eyes to be better.
 *
 * Keys belong to the row and only to the row: what is typed here pays for this job and nothing else. A row left
 * empty runs on whatever the machine itself was deployed with, and says so.
 */

const MANUAL = '__manual__';

const short = (spec: string) => spec.replace(/^[a-z0-9-]+\//, '');
const providerOf = (spec?: string) => (spec && spec.includes('/') ? spec.slice(0, spec.indexOf('/')) : undefined);
const idOf = (spec?: string) => (spec && spec.includes('/') ? spec.slice(spec.indexOf('/') + 1) : (spec ?? ''));

export function ModelsTab() {
  const t = useT();
  // Whatever the last visit ended with is drawn immediately and corrected when the answer lands, so reopening the
  // window is not a wait for a round trip that almost always says the same thing.
  const [page, setPage] = useState<ModelsPage | undefined>(lastModels);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  /** the row whose key field is open right now */
  const [asking, setAsking] = useState<SlotId>();
  /** providers whose catalog we have already asked for, so a row does not ask twice while it is on the way */
  const asked = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    fetchModels()
      .then((p) => alive && setPage(p))
      .catch((e: Error) => alive && setErr(e.message === 'old' ? t('models.oldVersion') : t('models.fetchFail')));
    return () => {
      alive = false;
    };
  }, []);

  /**
   * A row has moved to a provider whose catalog never travelled with the page; fetch that one list. No busy
   * state: nothing on the page is wrong while it is on the way, only that one model list is still empty, and
   * greying out all eight rows for it is what made switching provider feel like a page load.
   */
  const need = (provider: string) => {
    if (asked.current.has(provider)) return;
    asked.current.add(provider);
    fetchModels(provider)
      .then(setPage)
      .catch(() => asked.current.delete(provider));
  };

  /**
   * `want` is the provider a row has just moved to: its catalog comes back with the save, in the same trip.
   *
   * Choosing a provider or a model draws the choice immediately and lets the save catch up — the server's answer
   * for those is the same thing the row already shows, and waiting for it (greyed out, twice, over whatever
   * network the box is behind) is what made every switch feel like a reload. A key is different: what the row is
   * running on afterwards is the server's to say, so that one waits.
   */
  const apply = async (patch: ModelsPatch, want?: string, now = false) => {
    if (want) asked.current.add(want);
    if (now) setPage((p) => p && guess(p, patch));
    else setBusy(true);
    try {
      setPage(await saveModels(patch, want));
      setErr('');
    } catch {
      setErr(t('models.saveFail'));
      if (want) asked.current.delete(want);
      void fetchModels().then(setPage).catch(() => undefined);
    } finally {
      if (!now) setBusy(false);
    }
  };

  if (err && !page) return <div className="quiet">{err}</div>;
  if (!page) return <div className="quiet">{t('common.loading')}</div>;

  return (
    <div className={cx('models', busy && 'busy')}>
      <div className="set-rows">
        {page.slots.map((s) => (
          <SlotView
            key={s.id}
            slot={s}
            page={page}
            open={asking === s.id}
            onAsk={setAsking}
            onKey={(v) => {
              setAsking(undefined);
              if (v !== undefined) void apply({ keys: { [s.id]: v || null } });
            }}
            onPatch={(p, want) => void apply(p, want, true)}
            onNeed={need}
          />
        ))}
      </div>
      {err && <div className="models-foot quiet">{err}</div>}
    </div>
  );
}

/**
 * The page as it will be once the server has agreed: the rows this patch names, carrying what was just chosen.
 * Inheritance and defaults are the server's to work out, so a row left empty here simply shows its empty label —
 * which is what it will say anyway a moment later.
 */
function guess(page: ModelsPage, patch: ModelsPatch): ModelsPage {
  const slots = patch.slots ?? {};
  if (!Object.keys(slots).length) return page;
  return {
    ...page,
    slots: page.slots.map((s) => (s.id in slots ? { ...s, value: slots[s.id] ?? undefined, effective: slots[s.id] ?? undefined, meta: undefined } : s)),
  };
}

function SlotView({
  slot,
  page,
  open,
  onAsk,
  onKey,
  onPatch,
  onNeed,
}: {
  slot: ModelSlot;
  page: ModelsPage;
  open: boolean;
  onAsk: (id: SlotId | undefined) => void;
  onKey: (key?: string) => void;
  onPatch: (p: ModelsPatch, want?: string) => void;
  onNeed: (provider: string) => void;
}) {
  const t = useT();
  // The provider a row is on is the one its model belongs to — until the user picks a different one and has not
  // yet picked a model from it. That in-between lives here and outlasts the save that clears the old model, which
  // is the moment the row has no provider of its own at all.
  const settled = providerOf(slot.value) ?? providerOf(slot.effective) ?? slot.only?.[0] ?? '';
  const [picked, setPicked] = useState<string>();
  const prov = picked ?? settled;
  const [manual, setManual] = useState(false);

  // Chat and vision rows read the provider's own catalog; drawing, vectors and re-ranking have no catalog to read,
  // so they carry a short list per provider — and where there is none, the row is a text field.
  const listKey = slot.needs === 'chat' || slot.needs === 'vision' ? prov : `${slot.needs}:${prov}`;
  // A list that never travelled with the page is not an empty list: until it arrives the row waits rather than
  // deciding this provider has no catalog and turning itself into a text field.
  const loaded = !prov || listKey in page.models;
  const list: ModelChoice[] = useMemo(() => page.models[listKey] ?? [], [page, listKey]);
  useEffect(() => {
    if (prov && !loaded) onNeed(prov);
  }, [prov, loaded]);
  const visible = slot.needs === 'vision' ? list.filter((m) => m.vision) : list;
  const chosen = providerOf(slot.value) === prov ? idOf(slot.value) : '';
  const spec = (id: string) => `${prov}/${id}`;
  const provider = page.providers.find((p) => p.id === prov);
  const typeIt = manual || (!!prov && loaded && list.length === 0);
  // Chat and vision rows can go to any provider pi carries; the four rows this server calls itself name the
  // vendors whose protocol it actually speaks, and those include a few pi has never heard of (`chat: false`).
  const choices = slot.only ? page.providers.filter((p) => slot.only!.includes(p.id)) : page.providers.filter((p) => p.chat);
  // A hand-written id: the catalog cannot price it, so the row asks for the numbers itself.
  const unknown = loaded && !!slot.effective && !!slot.value && !list.some((x) => x.id === idOf(slot.value));

  // What "nothing chosen" means for this row — unless the user has just moved the row to another provider, in
  // which case the inherited model or the shipped default is on the wrong one and the row is simply waiting.
  const drifted = !!prov && !!slot.effective && providerOf(slot.effective) !== prov;
  const empty = !loaded
    ? t('common.loading')
    : drifted
    ? t('models.pickModel')
    : slot.inherits
      ? t('models.inherit', { what: t(`models.slot.${slot.inherits}`) })
      : slot.auto
        ? t('models.auto')
        : slot.fallback
          ? t('models.default', { model: short(slot.fallback) })
          : t('models.none');

  // The note line carries the job and one way in — 配置钥匙, or 更新钥匙 once this row has one of its own. What
  // the row is running on today is said inside the panel, where there is room to say it properly.
  const keyWord = slot.key ? t('models.updateKey') : t('models.setKey');

  return (
    <>
      <Row
        label={t(`models.slot.${slot.id}`)}
        note={
          <>
            {t(`models.what.${slot.id}`)}
            <span className="sep">·</span>
            {/* A row nothing can pay for says so where it is read, not only inside the panel. */}
            {slot.blocked && !slot.pinned && (
              <>
                <span className="warn">{t('models.noKeyTag')}</span>
                <span className="sep">·</span>
              </>
            )}
            {slot.pinned ? (
              t('models.pinned')
            ) : (
              <button className="link" onClick={() => onAsk(slot.id)}>{keyWord}</button>
            )}
          </>
        }
      >
        <Pick
          placeholder={t('models.pickProvider')}
          value={prov}
          onChange={(v) => {
            setManual(false);
            setPicked(v);
            // A row cannot be half-changed: picking a new provider drops the old provider's model. That save and
            // this provider's model list are the same round trip — `v` rides along with the patch.
            if (slot.value && providerOf(slot.value) !== v) onPatch({ slots: { [slot.id]: null } }, v);
            else if (v) onNeed(v);
            if (v && !page.providers.find((p) => p.id === v)?.keyed) onAsk(slot.id);
          }}
        >
          <optgroup label={t('models.connected')}>
            {choices.filter((p) => p.keyed).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </optgroup>
          <optgroup label={t('models.others')}>
            {choices.filter((p) => !p.keyed).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </optgroup>
        </Pick>
        {typeIt ? (
          <input
            className="in mono"
            defaultValue={chosen}
            autoFocus
            onFocus={(e) => e.target.select()}
            placeholder={t('models.manualHint')}
            onBlur={(e) => {
              const v = e.target.value.trim();
              setManual(false);
              if (v !== chosen) onPatch({ slots: { [slot.id]: v ? spec(v) : null } });
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <Pick
            value={chosen}
            // What runs when this row has not been given a model of its own — inherited, shipped, or picked per
            // call. It is the row's state, not something to choose, so it reads in the field and the ✕ is how
            // you go back to it.
            placeholder={empty}
            onClear={slot.value ? () => onPatch({ slots: { [slot.id]: null } }) : undefined}
            clearTitle={empty}
            onChange={(v) => (v === MANUAL ? setManual(true) : onPatch({ slots: { [slot.id]: v ? spec(v) : null } }))}
          >
            {/* First, not buried under three hundred models: an id this catalog has never heard of is the one
                thing the list itself cannot offer, and whoever wants it already knows it. */}
            {list.length > 0 && <option value={MANUAL}>{t('models.manual')}</option>}
            {/* A model typed by hand, or one the catalog has since dropped, still shows as the row's answer. */}
            {chosen && !visible.some((m) => m.id === chosen) && <option value={chosen}>{list.find((m) => m.id === chosen)?.name ?? chosen}</option>}
            {visible.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.costIn ? ` · $${m.costIn}/${m.costOut ?? 0}` : ''}
              </option>
            ))}
          </Pick>
        )}
      </Row>
      {open && (
        <KeyPanel
          label={provider?.apiKey ?? t('models.keyOf', { who: provider?.name ?? '' })}
          has={!!slot.key}
          // What this row would run on at the provider now shown, which is not always the one the server answered
          // about: the user may have just moved the row somewhere its key does not exist.
          ambient={!!provider?.keyed}
          onDone={onKey}
        />
      )}
      {unknown && <MetaAsk key={slot.effective} meta={slot.meta} onSave={(m) => onPatch({ meta: { [slot.effective!]: m } })} />}
    </>
  );
}

/**
 * The one place a key is typed, opened from the row it belongs to. It says what that row is running on today —
 * its own key, the machine's, or nothing — and the key itself never comes back from the server: what is stored is
 * only ever reported as "this row has one", so typing here replaces rather than edits.
 */
function KeyPanel({ label, has, ambient, onDone }: { label: string; has: boolean; ambient: boolean; onDone: (v?: string) => void }) {
  const t = useT();
  const [v, setV] = useState('');
  const none = !has && !ambient;
  return (
    <div className="key-ask">
      <div className="ka-top">
        <span className="ka-t">{label}</span>
        <span className={cx('ka-s', none && 'warn')}>{has ? t('models.keyHas') : none ? t('models.keyNone') : t('models.keyAmbient')}</span>
      </div>
      <div className="ka-row">
        <input
          className="in mono"
          type="password"
          autoFocus
          value={v}
          placeholder={has ? t('models.keyReplace') : t('models.keyPlaceholder')}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && v.trim() && onDone(v.trim())}
        />
        <button className="btn sm" disabled={!v.trim()} onClick={() => onDone(v.trim())}>{has ? t('models.update') : t('models.save')}</button>
        {has && <button className="link" onClick={() => onDone('')}>{t('models.dropKey')}</button>}
        <button className="link" onClick={() => onDone(undefined)}>{t('common.cancel')}</button>
      </div>
    </div>
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
