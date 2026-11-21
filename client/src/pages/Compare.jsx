import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MAX_COMPARE, useCompare, useFetch, useI18n, useToast } from '../context.jsx';
import { DealCardButton, HouseArt, SkeletonCards, SourceBadge, Status, formatPrice, listingLabel } from '../components/Shared.jsx';

const AMENITIES = ['furniture', 'pets', 'internet', 'washer', 'parking', 'balcony', 'conditioner'];

/**
 * The index of the best value in a row, or -1 when there is nothing to pick:
 * fewer than two known values, or all of them equal.
 */
function bestIndex(values, better) {
  const known = values.map((value, index) => ({ value, index })).filter(({ value }) => value !== null && value !== undefined);
  if (known.length < 2 || known.every(({ value }) => value === known[0].value)) return -1;
  return known.reduce((best, item) => (better(item.value, best.value) ? item : best)).index;
}
const lower = (a, b) => a < b;
const higher = (a, b) => a > b;

function Amenity({ value }) {
  const { t } = useI18n();
  if (value === true) return <span className="amenity yes">✓ {t('amenityYes')}</span>;
  if (value === false) return <span className="amenity no">✕ {t('amenityNo')}</span>;
  return <span className="amenity unknown">{t('amenityUnknown')}</span>;
}

function CompareTable({ items, onRemove }) {
  const { t, path } = useI18n();
  // Rent and sale prices cannot be compared with each other.
  const sameDeal = items.every((item) => item.deal === items[0].deal);
  const rows = [
    { label: t('price'), values: items.map((item) => item.price), better: sameDeal ? lower : null, show: (item) => `${formatPrice(item.price)}${item.deal === 'rent' ? ` / ${t('perMonth')}` : ''}` },
    { label: t('pricePerM2'), values: items.map((item) => item.pricePerM2), better: sameDeal ? lower : null, show: (item) => formatPrice(item.pricePerM2) },
    { label: t('rooms'), values: items.map((item) => item.rooms), show: (item) => (item.rooms === 0 ? t('studio') : item.rooms) },
    { label: t('area'), values: items.map((item) => item.area), better: higher, show: (item) => (item.area ? `${item.area} м²` : null) },
    { label: t('floor'), values: items.map((item) => item.floor), show: (item) => (item.floor ? (item.floors ? t('floorOf', { a: item.floor, b: item.floors }) : item.floor) : null) },
    { label: t('yearBuilt'), values: items.map((item) => item.year), better: higher, show: (item) => item.year },
    { label: t('district'), values: items.map((item) => item.district), show: (item) => (item.district ? t(item.district) : null) },
    { label: t('distanceToSdu'), values: items.map((item) => item.distanceKm), better: lower, show: (item) => (item.distanceKm === null ? null : t('kmShort', { n: item.distanceKm })) },
    { label: t('reviewCount'), values: items.map((item) => item.reviewCount), better: higher, show: (item) => item.reviewCount },
    { label: t('photosCount'), values: items.map((item) => item.photos.length), show: (item) => item.photos.length },
  ];

  return (
    <div className="compare-scroll" tabIndex={0} aria-label={t('compareTitle')}>
      <table className="compare">
        <thead>
          <tr>
            <th scope="col"><span className="visually-hidden">{t('compareTitle')}</span></th>
            {items.map((item) => (
              <th scope="col" key={item.id}>
                <Link to={path(`/listing/${item.id}`)} className="compare-photo">
                  {item.photos[0] ? <img src={item.photos[0]} alt="" loading="lazy" /> : <HouseArt id={item.id} label={t('noPhoto')} />}
                </Link>
                <Link className="compare-name" to={path(`/listing/${item.id}`)}>{[listingLabel(t, item), item.address].filter(Boolean).join(' · ') || item.title}</Link>
                <button type="button" className="link compare-remove" onClick={() => onRemove(item.id)}>{t('compareRemoveOne')}</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const best = row.better ? bestIndex(row.values, row.better) : -1;
            return (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {items.map((item, index) => (
                  <td key={item.id} className={index === best ? 'best' : undefined}>
                    {row.show(item) ?? '—'}
                    {index === best && <span className="best-tag">{t('compareBest')}</span>}
                  </td>
                ))}
              </tr>
            );
          })}
          <tr>
            <th scope="row">{t('source')}</th>
            {items.map((item) => <td key={item.id}><SourceBadge source={item.source} /></td>)}
          </tr>
          {AMENITIES.map((name) => (
            <tr key={name}>
              <th scope="row">{t(`amenity_${name}`)}</th>
              {items.map((item) => <td key={item.id}><Amenity value={item.amenities[name]} /></td>)}
            </tr>
          ))}
          <tr>
            <th scope="row"><span className="visually-hidden">{t('dealRentBtn')}</span></th>
            {items.map((item) => <td key={item.id}><DealCardButton item={item} /></td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function Compare() {
  const { t, lang } = useI18n();
  const compare = useCompare();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const shared = params.get('ids');

  // A shared link replaces this browser's list, then the address goes back to plain /compare.
  useEffect(() => {
    if (shared === null) return;
    compare.replace(shared.split(',').map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, MAX_COMPARE));
    setParams({}, { replace: true });
    // Runs once per shared link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared]);

  const ids = compare.ids.join(',');
  const { data, loading, error, reload } = useFetch(shared === null && ids ? `/listings/compare?ids=${ids}` : null);
  const items = ids && data ? data.items : [];
  const [pruned, setPruned] = useState(false);

  // Ads that were deleted or hidden since they were picked leave the list.
  useEffect(() => {
    if (!data || data.items.length >= compare.ids.length || loading) return;
    setPruned(true);
    compare.replace(data.items.map((item) => item.id));
    // compare changes with every list update, and only the loaded answer matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, loading]);

  async function share() {
    const url = `${window.location.origin}/${lang}/compare?ids=${ids}`;
    try {
      await navigator.clipboard.writeText(url);
      toast(t('toastLinkCopied'));
    } catch {
      window.prompt(t('compareShare'), url);
    }
  }

  return (
    <main className="wrap comparepage">
      <div className="compare-head">
        <h1>{t('compareTitle')}</h1>
        {compare.ids.length > 0 && (
          <div className="actions">
            <button type="button" className="btn ghost small" onClick={share}>{t('compareShare')}</button>
            <button type="button" className="btn ghost small" onClick={compare.clear}>{t('compareClear')}</button>
          </div>
        )}
      </div>
      {compare.ids.length === 0 && <p className="state">{t('compareEmpty')}</p>}
      {loading && !data && <SkeletonCards count={1} />}
      <Status error={error} onRetry={reload} />
      {pruned && <p className="notice">{t('compareMissing')}</p>}
      {items.length === 1 && <p className="meta">{t('compareNeedMore')}</p>}
      {items.length > 0 && (
        <>
          <CompareTable items={items} onRemove={compare.remove} />
          <p className="hint" style={{ marginTop: 10 }}>{t('compareAmenitiesNote')}</p>
        </>
      )}
    </main>
  );
}
