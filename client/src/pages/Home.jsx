import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useFetch, useI18n } from '../context.jsx';
import { CountUp, ListingCard, ListingsMap, NumberInput, SkeletonCards, Status, formatPrice } from '../components/Shared.jsx';

const FILTERS = ['deal', 'rooms', 'priceFrom', 'priceTo', 'yearFrom', 'yearTo', 'district', 'maxKm', 'features', 'sort', 'q'];
const FEATURES = ['furniture', 'pets', 'internet', 'washer', 'parking', 'balcony', 'conditioner'];
const DISTANCES = ['1', '1.5', '3', '5'];
const SORTS = ['distance', 'price_asc', 'price_desc', 'new'];

const PRICE_DIGITS = 11;
const YEAR_DIGITS = 4;

function HeroStats({ items }) {
  const { t } = useI18n();
  const distances = items.map((item) => item.distanceKm).filter((value) => value !== null);
  const rents = items.filter((item) => item.deal === 'rent' && item.price).map((item) => item.price);
  return (
    <dl className="stats">
      <div><dt>{t('statAds')}</dt><dd><CountUp value={items.length} format={(value) => String(Math.round(value))} /></dd></div>
      {distances.length > 0 && <div><dt>{t('statNearest')}</dt><dd><CountUp value={Math.min(...distances)} format={(value) => value.toFixed(1)} /></dd></div>}
      {rents.length > 0 && <div><dt>{t('statFrom')}</dt><dd><CountUp value={Math.min(...rents)} format={(value) => formatPrice(Math.round(value / 1000) * 1000)} /></dd></div>}
    </dl>
  );
}

function DealTabs({ current }) {
  const { t, path } = useI18n();
  const tabs = [['', t('allDeals')], ['rent', t('rent')], ['buy', t('buy')]];
  return (
    <div className="tabs" role="group" aria-label={t('deal')}>
      {tabs.map(([value, label]) => (
        <Link key={value} className={`tab${current === value ? ' on' : ''}`} aria-current={current === value ? 'true' : undefined} to={path(value ? `?deal=${value}` : '')}>{label}</Link>
      ))}
    </div>
  );
}

const fromParams = (params) => Object.fromEntries(FILTERS.map((name) => [name, params.get(name) ?? '']));
const featureList = (value) => (value ? value.split(',').filter((name) => FEATURES.includes(name)) : []);

/** Filters from the phrase parser, in the same shape as the URL. */
const toParams = (filters) =>
  Object.fromEntries(Object.entries(filters).map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : String(value)]));

/** A free-text box: the server turns the phrase into filters, with Gemini or with rules. */
function SmartSearch({ initial, onFilters }) {
  const { t, tError } = useI18n();
  const [query, setQuery] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function run(text) {
    const phrase = text.trim();
    if (phrase.length < 2) return;
    setQuery(phrase);
    setBusy(true);
    setMessage(null);
    try {
      const { filters, engine } = await api('/search/parse', { method: 'POST', body: { query: phrase } });
      if (Object.keys(filters).length === 0) setMessage(t('smartNothing'));
      else onFilters(filters, phrase, engine);
    } catch (failure) {
      setMessage(tError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="smart" role="search" onSubmit={(event) => { event.preventDefault(); run(query); }}>
      <label htmlFor="smart-query" className="smart-label">{t('smartTitle')}</label>
      <div className="smart-row">
        <input id="smart-query" type="search" value={query} maxLength={300} placeholder={t('smartPh')} onChange={(event) => setQuery(event.target.value)} />
        <button className="btn" type="submit" disabled={busy || query.trim().length < 2}>{busy ? '…' : t('smartGo')}</button>
      </div>
      <div className="smart-examples">
        <span>{t('smartExamples')}</span>
        {['smartEx1', 'smartEx2', 'smartEx3'].map((key) => (
          <button key={key} type="button" className="chip-btn" disabled={busy} onClick={() => run(t(key))}>{t(key)}</button>
        ))}
      </div>
      {message && <p className="smart-message" role="alert">{message}</p>}
    </form>
  );
}

/** Every applied filter as a chip that removes it. */
function ActiveFilters({ applied, engine, onRemove, onReset }) {
  const { t } = useI18n();
  const chips = [];
  if (applied.deal) chips.push(['deal', t(applied.deal)]);
  if (applied.rooms) chips.push(['rooms', applied.rooms === '0' ? t('studio') : t('roomApartment', { n: applied.rooms })]);
  if (applied.priceFrom) chips.push(['priceFrom', t('chipPriceFrom', { p: formatPrice(applied.priceFrom) })]);
  if (applied.priceTo) chips.push(['priceTo', t('chipPriceTo', { p: formatPrice(applied.priceTo) })]);
  if (applied.yearFrom) chips.push(['yearFrom', t('chipYearFrom', { n: applied.yearFrom })]);
  if (applied.yearTo) chips.push(['yearTo', t('chipYearTo', { n: applied.yearTo })]);
  if (applied.district) chips.push(['district', t(applied.district)]);
  if (applied.maxKm) chips.push(['maxKm', t('chipKm', { n: applied.maxKm })]);
  for (const name of featureList(applied.features)) chips.push([`feature:${name}`, t(`amenity_${name}`)]);
  if (applied.sort && applied.sort !== 'distance') chips.push(['sort', t(`sort_${applied.sort}`)]);
  if (chips.length === 0) return null;
  return (
    <div className="active-filters" aria-live="polite">
      {applied.q && <span className="meta">{t('smartUnderstood')}</span>}
      {chips.map(([key, label]) => (
        <button key={key} type="button" className="chip" onClick={() => onRemove(key)} aria-label={`${label} ×`}>{label} <span aria-hidden="true">×</span></button>
      ))}
      {applied.q && engine && <span className="engine">{t(engine === 'ai' ? 'smartByAi' : 'smartByRules')}</span>}
      <button type="button" className="link reset" onClick={onReset}>{t('smartReset')}</button>
    </div>
  );
}

export default function Home() {
  const { t } = useI18n();
  const [hoveredId, setHoveredId] = useState(null);
  const [params, setParams] = useSearchParams();
  const query = params.toString();
  const applied = fromParams(params);
  const [draft, setDraft] = useState({ query, values: applied });
  const [engine, setEngine] = useState(null);
  // The header links change the URL directly, so the form follows the URL.
  const values = draft.query === query ? draft.values : applied;
  const { data, loading, error, reload } = useFetch(`/listings${query ? `?${query}` : ''}`);

  const change = (event) => setDraft({ query, values: { ...values, [event.target.name]: event.target.value } });
  const toggleFeature = (name) => {
    const list = featureList(values.features);
    const next = list.includes(name) ? list.filter((item) => item !== name) : [...list, name];
    setDraft({ query, values: { ...values, features: next.join(',') } });
  };
  const apply = (next) => setParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value !== '' && value !== undefined)));
  const submit = (event) => {
    event.preventDefault();
    apply(values);
  };
  const fromPhrase = (filters, phrase, how) => {
    setEngine(how);
    apply({ ...toParams(filters), q: phrase });
  };
  const removeFilter = (key) => {
    if (key.startsWith('feature:')) {
      const name = key.slice('feature:'.length);
      return apply({ ...applied, features: featureList(applied.features).filter((item) => item !== name).join(',') });
    }
    apply({ ...applied, [key]: '' });
  };

  return (
    <>
      <section className="hero">
        <div className="wrap">
          <h1>{t('heroTitle')}</h1>
          <p>{t('heroText')}</p>
          <SmartSearch key={applied.q} initial={applied.q} onFilters={fromPhrase} />
          <DealTabs current={applied.deal} />
          {data && <HeroStats items={data.items} />}
        </div>
      </section>
      <main className="wrap layout">
        <form className="filter" aria-label={t('filters')} onSubmit={submit}>
          <h2>{t('filters')}</h2>
          <label>{t('deal')}
            <select name="deal" value={values.deal} onChange={change}>
              <option value="">{t('any')}</option>
              <option value="rent">{t('rent')}</option>
              <option value="buy">{t('buy')}</option>
            </select>
          </label>
          <label>{t('rooms')}
            <select name="rooms" value={values.rooms} onChange={change}>
              <option value="">{t('any')}</option>
              <option value="0">{t('studio')}</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3+">3+</option>
            </select>
          </label>
          <div className="row">
            <label>{t('priceFrom')}<NumberInput name="priceFrom" maxDigits={PRICE_DIGITS} placeholder="0" value={values.priceFrom} onChange={change} /></label>
            <label>{t('priceTo')}<NumberInput name="priceTo" maxDigits={PRICE_DIGITS} placeholder="500000" value={values.priceTo} onChange={change} /></label>
          </div>
          <div className="row">
            <label>{t('builtFrom')}<NumberInput name="yearFrom" maxDigits={YEAR_DIGITS} placeholder="2000" value={values.yearFrom} onChange={change} /></label>
            <label>{t('builtTo')}<NumberInput name="yearTo" maxDigits={YEAR_DIGITS} placeholder="2026" value={values.yearTo} onChange={change} /></label>
          </div>
          <label>{t('district')}
            <select name="district" value={values.district} onChange={change}>
              <option value="">{t('any')}</option>
              <option value="near_sdu">{t('near_sdu')}</option>
              <option value="center">{t('center')}</option>
              <option value="new">{t('new')}</option>
            </select>
          </label>
          <label>{t('maxKm')}
            <select name="maxKm" value={values.maxKm} onChange={change}>
              <option value="">{t('any')}</option>
              {[...new Set([...DISTANCES, values.maxKm].filter(Boolean))].map((km) => <option key={km} value={km}>{t('withinKm', { n: km })}</option>)}
            </select>
          </label>
          <fieldset className="features">
            <legend>{t('featuresLabel')}</legend>
            {FEATURES.map((name) => (
              <label className="check" key={name}>
                <input type="checkbox" checked={featureList(values.features).includes(name)} onChange={() => toggleFeature(name)} />
                {t(`amenity_${name}`)}
              </label>
            ))}
          </fieldset>
          <label>{t('sortBy')}
            <select name="sort" value={values.sort || 'distance'} onChange={change}>
              {SORTS.map((sort) => <option key={sort} value={sort}>{t(`sort_${sort}`)}</option>)}
            </select>
          </label>
          <button className="btn" type="submit">{t('showResults')}</button>
        </form>
        <section className="list" aria-live="polite">
          {loading && !data && <SkeletonCards />}
          <Status error={error} onRetry={reload} />
          <ActiveFilters applied={applied} engine={engine} onRemove={removeFilter} onReset={() => apply({})} />
          {data && (
            <>
              <section className="panel" style={{ marginTop: 0 }}>
                <ListingsMap items={data.items} sdu={data.sdu} activeId={hoveredId} />
              </section>
              <h2>{t('found', { n: data.items.length })}</h2>
              {data.items.length === 0 && <p className="state">{t('empty')}</p>}
              {data.items.map((item, index) => <ListingCard key={item.id} item={item} index={index} onHover={setHoveredId} onRemoved={reload} />)}
            </>
          )}
        </section>
      </main>
    </>
  );
}
