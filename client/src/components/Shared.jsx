import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { LANGS, LANG_LABELS, translate } from '../i18n.js';
import { useAuth, useFetch, useI18n, usePolling, useToast } from '../context.jsx';
import { fitView, project, spreadPins } from '../mapView.js';
import { PHONE_PATTERN, PHONE_PREFIX, formatPhoneInput } from '../phone.js';

export function Layout() {
  const { lang } = useParams();
  if (!LANGS.includes(lang)) return <Navigate to="/" replace />;
  return <LayoutBody />;
}

function LayoutBody() {
  const { lang, t, path } = useI18n();
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const rest = location.pathname.replace(/^\/[^/]+/, '') + location.search;
  const dealParam = new URLSearchParams(location.search).get('deal');
  const onHome = location.pathname === path();

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t('pageTitle');
  }, [lang, t]);

  return (
    <>
      <header>
        <div className="wrap">
          <Link className="logo" to={path()}>Krisha<span>Kaskelen</span></Link>
          <nav>
            <Link className={onHome && dealParam === 'rent' ? 'active' : undefined} to={path('?deal=rent')}>{t('rent')}</Link>
            <Link className={onHome && dealParam === 'buy' ? 'active' : undefined} to={path('?deal=buy')}>{t('buy')}</Link>
            <NavLink to={path('/post')}>{t('post')}</NavLink>
            {user ? (
              <>
                <NavLink to={path('/favorites')}>{t('favorites')}</NavLink>
                <NavLink to={path('/requests')}>{t('requests')}<RequestsBadge /></NavLink>
                <NavLink to={path('/chats')}>{t('chats')}</NavLink>
                <NavLink to={path('/mine')}>{t('myListings')}</NavLink>
                <button type="button" onClick={() => logout().then(() => navigate(path()))}>{t('logout')}</button>
              </>
            ) : (
              <>
                <NavLink to={path('/login')}>{t('login')}</NavLink>
                <NavLink to={path('/register')}>{t('signup')}</NavLink>
              </>
            )}
          </nav>
          <span className="lang" aria-label="Language">
            {LANGS.map((code) => (
              <Link key={code} to={`/${code}${rest}`} hrefLang={code} aria-current={code === lang ? 'true' : undefined}>{LANG_LABELS[code]}</Link>
            ))}
          </span>
        </div>
      </header>
      <div className="page" key={location.pathname}><Outlet /></div>
      <footer><div className="wrap">{t('footer')}</div></footer>
    </>
  );
}

function RequestsBadge() {
  const { data, reload } = useFetch('/requests');
  usePolling(reload, 10_000);
  const count = data?.incoming.filter((item) => item.status === 'pending').length ?? 0;
  return count > 0 ? <span className="badge">{count}</span> : null;
}

/** Keeps a phone number in one format and stops at its full length. */
export function PhoneInput({ value, onChange, name = 'phone', ...props }) {
  const { t } = useI18n();
  const set = (next) => onChange({ target: { name, value: next } });
  return (
    <>
      <input
        {...props}
        name={name}
        type="tel"
        inputMode="tel"
        value={value}
        pattern={PHONE_PATTERN}
        title={t('phoneHint')}
        placeholder="+7 700 000 00 00"
        onFocus={() => { if (!value) set(PHONE_PREFIX); }}
        onBlur={() => { if (value === PHONE_PREFIX) set(''); }}
        onChange={(event) => set(formatPhoneInput(event.target.value, value) || PHONE_PREFIX)}
      />
      <span className="hint">{t('phoneHint')}</span>
    </>
  );
}

/** Digits only, with a fixed maximum length. */
export function NumberInput({ value, onChange, name, maxDigits, ...props }) {
  return (
    <input
      {...props}
      name={name}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={value}
      maxLength={maxDigits}
      onChange={(event) => onChange({ target: { name, value: event.target.value.replace(/\D/g, '').slice(0, maxDigits) } })}
    />
  );
}

/** Drawn cover for ads without a photo. The hue depends only on the ad id. */
export function HouseArt({ id = 0, label }) {
  const hue = (Number(id) * 47 + 190) % 360;
  return (
    <div className="art" style={{ '--hue': hue }} aria-label={label} role="img">
      <svg viewBox="0 0 120 90" aria-hidden="true">
        <circle className="art-sun" cx="94" cy="20" r="9" />
        <path className="art-roof" d="M26 44 60 16l34 28z" />
        <rect className="art-wall" x="34" y="42" width="52" height="38" rx="2" />
        <rect className="art-window" x="42" y="50" width="11" height="11" rx="1.5" />
        <rect className="art-window delay" x="67" y="50" width="11" height="11" rx="1.5" />
        <rect className="art-door" x="55" y="62" width="10" height="18" rx="1.5" />
      </svg>
      <span>{label}</span>
    </div>
  );
}

/** Counts up to a value once it is known. */
export function CountUp({ value, format = String }) {
  const [shown, setShown] = useState(value);
  const previous = useRef(0);

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setShown(value);
      previous.current = value;
      return undefined;
    }
    const from = previous.current;
    const started = performance.now();
    let frame;
    const step = (now) => {
      const progress = Math.min(1, (now - started) / 700);
      const eased = 1 - (1 - progress) ** 3;
      setShown(from + (value - from) * eased);
      if (progress < 1) frame = requestAnimationFrame(step);
      else previous.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{format(shown)}</>;
}

export function SkeletonCards({ count = 3 }) {
  return (
    <div className="skeletons" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="card skeleton" key={index}>
          <div className="ph shimmer" />
          <div className="body">
            <div className="line shimmer wide" />
            <div className="line shimmer" />
            <div className="line shimmer short" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function LanguagePicker() {
  return (
    <main className="wrap auth">
      <h1 className="logo" style={{ color: 'var(--brand)' }}>Krisha<span>Kaskelen</span></h1>
      <p className="meta">{translate('ru', 'choose')}</p>
      <section className="panel stack" style={{ display: 'grid', gap: 10 }}>
        <Link className="btn full" to="/en">English</Link>
        <Link className="btn full" to="/ru">Русский</Link>
        <Link className="btn full" to="/kk">Қазақша</Link>
      </section>
    </main>
  );
}

export function Status({ loading, error, onRetry }) {
  const { t, tError } = useI18n();
  if (loading) return <p className="state" role="status">{t('loading')}</p>;
  if (error) {
    return (
      <div className="state error" role="alert">
        <p>{tError(error)}</p>
        {onRetry && <button className="btn" type="button" onClick={onRetry} style={{ marginTop: 8 }}>{t('retry')}</button>}
      </div>
    );
  }
  return null;
}

export const formatPrice = (value) => (value === null || value === undefined ? '' : `${String(value).replace(/\B(?=(\d{3})+$)/g, ' ')} ₸`);

export function SourceBadge({ source }) {
  const { t } = useI18n();
  if (source.type === 'import') return <span className="source import">{t('sourceImport', { name: source.name })}</span>;
  return <span className="source">{t(source.type === 'test' ? 'sourceTest' : 'sourceApp')}</span>;
}

export function Distance({ km }) {
  const { t } = useI18n();
  return <span className="distance">{km === null ? t('distanceUnknown') : t('distanceSdu', { n: km })}</span>;
}

export function listingLabel(t, item) {
  if (item.rooms === 0) return t('studio');
  return item.rooms ? t('roomApartment', { n: item.rooms }) : '';
}

export function FavoriteButton({ item, inline = false, onChange }) {
  const { user } = useAuth();
  const { t, path } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [active, setActive] = useState(item.isFavorite);
  const [busy, setBusy] = useState(false);

  useEffect(() => setActive(item.isFavorite), [item.isFavorite]);

  async function toggle(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!user) return navigate(path('/login'), { state: { from: location.pathname + location.search } });
    setBusy(true);
    try {
      await api(`/favorites/${item.id}`, { method: active ? 'DELETE' : 'PUT' });
      setActive(!active);
      toast(t(active ? 'toastFavRemoved' : 'toastFavAdded'));
      onChange?.();
    } catch {
      toast(t('err.generic'), 'bad');
    } finally {
      setBusy(false);
    }
  }

  const label = active ? t('favRemove') : t('favAdd');
  return (
    <button type="button" className={`fav${inline ? ' fav-inline' : ''}`} aria-pressed={active} aria-label={label} title={label} disabled={busy} onClick={toggle}>
      {active ? '♥' : '♡'}{inline ? ` ${label}` : ''}
    </button>
  );
}

/** Asks before deleting, because the ad cannot be restored. */
export function DeleteListingButton({ item, onDeleted }) {
  const { t, tError } = useI18n();
  const toast = useToast();
  const dialog = useRef(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await api(`/listings/${item.id}`, { method: 'DELETE' });
      dialog.current?.close();
      toast(t('toastDeleted'));
      onDeleted();
    } catch (failure) {
      toast(tError(failure), 'bad');
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn danger" type="button" onClick={() => dialog.current?.showModal()}>{t('deleteAd')}</button>
      <dialog ref={dialog} className="dialog">
        <h2>{t('deleteTitle')}</h2>
        <p className="meta" style={{ marginTop: 6 }}>{item.title}</p>
        <p style={{ marginTop: 10 }}>{t('deleteText')}</p>
        <div className="actions" style={{ marginTop: 16 }}>
          <button className="btn danger solid" type="button" disabled={busy} onClick={confirm}>{t('deleteAd')}</button>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => dialog.current?.close()}>{t('deleteCancel')}</button>
        </div>
      </dialog>
    </>
  );
}

export function DealCardButton({ item }) {
  const { t, path } = useI18n();
  if (item.dealStatus === 'closed') return <span className="status rejected">{t(`closed_${item.deal}`)}</span>;
  if (item.source.type === 'import') {
    return <a className="btn small" href={item.source.url} target="_blank" rel="noopener noreferrer nofollow">{t('openOnSource', { name: item.source.name })}</a>;
  }
  if (item.isOwner) return null;
  return <Link className="btn small" to={path(`/listing/${item.id}?deal=1`)}>{t(item.deal === 'rent' ? 'dealRentBtn' : 'dealBuyBtn')}</Link>;
}

export function ListingCard({ item, index = 0, onFavoriteChange, onHover }) {
  const { t, path } = useI18n();
  const place = [item.district ? t(item.district) : null, t('kaskelen')].filter(Boolean).join(', ');
  const heading = [listingLabel(t, item), item.area ? `${item.area} м²` : null].filter(Boolean).join(', ');
  return (
    <article
      className="card reveal"
      style={{ '--i': index }}
      onMouseEnter={() => onHover?.(item.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <FavoriteButton item={item} onChange={onFavoriteChange} />
      <Link to={path(`/listing/${item.id}`)} className="ph">
        {item.photos[0] ? <img src={item.photos[0]} alt={item.title} loading="lazy" /> : <HouseArt id={item.id} label={t('noPhoto')} />}
        {item.photos[0] && item.photosAreExamples && <span className="photo-note">{t('examplePhoto')}</span>}
      </Link>
      <div className="body">
        <Link to={path(`/listing/${item.id}`)} className="price">
          {formatPrice(item.price)}{item.deal === 'rent' ? ` / ${t('perMonth')}` : ''}
        </Link>
        <div className="meta">{heading} · {place}</div>
        <Distance km={item.distanceKm} />
        <div className="tags">
          {item.rooms > 0 && <span className="tag">{t('roomCount', { n: item.rooms })}</span>}
          {item.rooms === 0 && <span className="tag">{t('studio')}</span>}
          {item.floor && <span className="tag">{t('floorTag', { n: item.floor })}</span>}
          {item.year && <span className="tag">{t('builtTag', { n: item.year })}</span>}
        </div>
        <div className="card-foot">
          <SourceBadge source={item.source} />
          <DealCardButton item={item} />
        </div>
      </div>
    </article>
  );
}

const MAP_HEIGHT = 340;
const MAX_WIDTH = 1280;

/** A 2GIS image from our server, with our own clickable pins on top. */
const pinLabel = (price) => {
  if (!price) return '•';
  return price >= 1_000_000 ? `${(price / 1_000_000).toFixed(1)}M` : `${Math.round(price / 1000)}k`;
};

export function ListingsMap({ items, sdu, height = MAP_HEIGHT, activeId = null }) {
  const { t, path } = useI18n();
  const [box, setBox] = useState(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!box) return undefined;
    const update = () => setWidth(Math.min(MAX_WIDTH, Math.floor(box.clientWidth / 20) * 20));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(box);
    return () => observer.disconnect();
  }, [box]);

  const located = items.filter((item) => item.point);
  const view = width && sdu ? fitView([sdu, ...located.map((item) => item.point)], width, height) : null;
  const pins = view
    ? spreadPins([sdu, ...located.map((item) => item.point)].map((point) => project(point, view, width, height)))
    : [];
  const pinStyle = (index) => ({ left: pins[index].x, top: pins[index].y });

  return (
    <div ref={setBox}>
      <div className="mapbox" style={{ width: width || '100%', height }}>
        {view && (
          <>
            <img
              alt={t('mapAlt')}
              src={`/api/map/image?lat=${view.center.lat.toFixed(5)}&lon=${view.center.lon.toFixed(5)}&z=${view.zoom}&w=${width}&h=${height}`}
            />
            <span className="pin sdu" style={pinStyle(0)} title="SDU University">{t('sduPin')}</span>
            {located.map((item, index) => (
              <Link key={item.id} className={`pin${item.id === activeId ? ' active' : ''}`} style={pinStyle(index + 1)} to={path(`/listing/${item.id}`)} title={item.title}>
                {pinLabel(item.price)}
              </Link>
            ))}
          </>
        )}
      </div>
      <p className="meta mapnote">{t('mapNote')}</p>
    </div>
  );
}


export function RequireLogin({ children }) {
  const { user, ready } = useAuth();
  const { path } = useI18n();
  const location = useLocation();
  if (!ready) return <Status loading />;
  if (!user) return <Navigate to={path('/login')} replace state={{ from: location.pathname + location.search }} />;
  return children;
}

