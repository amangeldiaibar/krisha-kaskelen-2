import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFetch, useI18n } from '../context.jsx';
import { CountUp, ListingCard, ListingsMap, NumberInput, SkeletonCards, Status, formatPrice } from '../components/Shared.jsx';

const FILTERS = ['deal', 'rooms', 'priceFrom', 'priceTo', 'yearFrom', 'yearTo', 'district'];

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

export default function Home() {
  const { t } = useI18n();
  const [hoveredId, setHoveredId] = useState(null);
  const [params, setParams] = useSearchParams();
  const query = params.toString();
  const applied = fromParams(params);
  const [draft, setDraft] = useState({ query, values: applied });
  // The header links change the URL directly, so the form follows the URL.
  const values = draft.query === query ? draft.values : applied;
  const { data, loading, error, reload } = useFetch(`/listings${query ? `?${query}` : ''}`);

  const change = (event) => setDraft({ query, values: { ...values, [event.target.name]: event.target.value } });
  const submit = (event) => {
    event.preventDefault();
    setParams(Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '')));
  };

  return (
    <>
      <section className="hero">
        <div className="wrap">
          <h1>{t('heroTitle')}</h1>
          <p>{t('heroText')}</p>
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
          <button className="btn" type="submit">{t('showResults')}</button>
        </form>
        <section className="list" aria-live="polite">
          {loading && !data && <SkeletonCards />}
          <Status error={error} onRetry={reload} />
          {data && (
            <>
              <section className="panel" style={{ marginTop: 0 }}>
                <ListingsMap items={data.items} sdu={data.sdu} activeId={hoveredId} />
              </section>
              <h2>{t('found', { n: data.items.length })}</h2>
              {data.items.length === 0 && <p className="state">{t('empty')}</p>}
              {data.items.map((item, index) => <ListingCard key={item.id} item={item} index={index} onHover={setHoveredId} />)}
            </>
          )}
        </section>
      </main>
    </>
  );
}
