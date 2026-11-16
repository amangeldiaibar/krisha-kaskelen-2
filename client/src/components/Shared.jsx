import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { LANGS, LANG_LABELS, translate } from '../i18n.js';
import { useAuth, useFetch, useI18n, usePolling, useToast } from '../context.jsx';
import { COUNTRIES, countryByIso, countryOf, flagOf, formatNational, nationalOf, nationalPattern, phoneExample } from '../phone.js';

export function Layout() {
  const { lang } = useParams();
  if (!LANGS.includes(lang)) return <Navigate to="/" replace />;
  return <LayoutBody />;
}

function LayoutBody() {
  const { lang, t, path } = useI18n();
  const { user } = useAuth();
  const location = useLocation();
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
            {!user && (
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
          {user && <ProfileMenu />}
        </div>
      </header>
      <div className="page" key={location.pathname}><Outlet /></div>
      <footer><div className="wrap">{t('footer')}</div></footer>
    </>
  );
}

/** The profile photo, or the first letter of the name when there is none. */
export function Avatar({ user, src = user.avatar, big = false }) {
  const className = `avatar${big ? ' big' : ''}`;
  if (src) return <img className={className} src={src} alt="" />;
  return <span className={className} aria-hidden="true">{user.name.trim().charAt(0).toUpperCase()}</span>;
}

function ProfileMenu() {
  const { t, path } = useI18n();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const { data, reload } = useFetch('/requests');
  usePolling(reload, 10_000);
  const pending = data?.incoming.filter((item) => item.status === 'pending').length ?? 0;
  const badge = pending > 0 ? <span className="badge">{pending}</span> : null;

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !box.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div className="profile" ref={box}>
      <button className="profile-btn" type="button" aria-haspopup="menu" aria-expanded={open} aria-label={t('accountMenu')} onClick={() => setOpen(!open)}>
        <Avatar user={user} />
        <span className="profile-name">{user.name}</span>
        {badge}
      </button>
      {open && (
        <div className="profile-menu pop" role="menu" onClick={() => setOpen(false)}>
          <NavLink role="menuitem" to={path('/settings')}>{t('settings')}</NavLink>
          <NavLink role="menuitem" to={path('/favorites')}>{t('favorites')}</NavLink>
          <NavLink role="menuitem" to={path('/mine')}>{t('myListings')}</NavLink>
          <NavLink role="menuitem" to={path('/requests')}>{t('requests')}{badge}</NavLink>
          <NavLink role="menuitem" to={path('/chats')}>{t('chats')}</NavLink>
          <button role="menuitem" type="button" onClick={() => logout().then(() => navigate(path()))}>{t('logout')}</button>
        </div>
      )}
    </div>
  );
}

/**
 * A country picker with its dialling code, and the rest of the number next to it.
 * The value stays one string, such as "+7 700 000 00 00".
 */
export function PhoneInput({ value, onChange, name = 'phone', ...props }) {
  const { t, lang } = useI18n();
  const [chosen, setChosen] = useState(null);
  const country = countryOf(value, chosen);
  const national = nationalOf(value, country);
  const names = useMemo(() => {
    try {
      return new Intl.DisplayNames([lang], { type: 'region' });
    } catch {
      return null;
    }
  }, [lang]);
  const set = (next, target = country) => onChange({ target: { name, value: next ? `+${target.code} ${next}` : '' } });
  const hint = t('phoneHint', { n: phoneExample(country) });
  return (
    <>
      <span className="phone-field">
        <select
          value={country.iso}
          aria-label={t('phoneCountry')}
          autoComplete="tel-country-code"
          onChange={(event) => {
            const next = countryByIso(event.target.value);
            setChosen(next.iso);
            set(formatNational(national.replace(/\D/g, ''), next), next);
          }}
        >
          {COUNTRIES.map((item) => (
            <option key={item.iso} value={item.iso}>{flagOf(item.iso)} +{item.code} {names?.of(item.iso) ?? item.iso}</option>
          ))}
        </select>
        <input
          {...props}
          name={name}
          type="tel"
          inputMode="tel"
          value={national}
          pattern={nationalPattern(country)}
          title={hint}
          placeholder={phoneExample(country).slice(country.code.length + 2)}
          onChange={(event) => set(formatNational(event.target.value, country, national))}
        />
      </span>
      <span className="hint">{hint}</span>
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

export { default as ListingsMap } from './ListingsMap.jsx';

export function RequireLogin({ children }) {
  const { user, ready } = useAuth();
  const { path } = useI18n();
  const location = useLocation();
  if (!ready) return <Status loading />;
  if (!user) return <Navigate to={path('/login')} replace state={{ from: location.pathname + location.search }} />;
  return children;
}

