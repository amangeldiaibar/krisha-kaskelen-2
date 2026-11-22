import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { LANGS, LANG_LABELS, translate } from '../i18n.js';
import { useAuth, useCompare, useFetch, useI18n, usePolling, useToast } from '../context.jsx';
import { COUNTRIES, countryByIso, countryOf, flagOf, formatNational, nationalOf, nationalPattern, phoneExample } from '../phone.js';
import ChatWidget from './ChatWidget.jsx';

/** Admin panel sections an admin may get one by one; matches the server. */
export const ADMIN_SECTIONS = ['listings', 'reviews', 'support', 'users'];

/** Whether an admin may work in a section. A null section is only for admins with every section. */
export function canAdmin(user, section) {
  if (user?.role !== 'admin') return false;
  if (!user.adminScopes) return true;
  return section !== null && user.adminScopes.includes(section);
}

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
          <Link className="logo" to={path()}><img src="/favicon.svg" alt="" width="30" height="30" />Krisha<span>Kaskelen</span></Link>
          <nav>
            <Link className={onHome && dealParam === 'rent' ? 'active' : undefined} to={path('?deal=rent')}>{t('rent')}</Link>
            <Link className={onHome && dealParam === 'buy' ? 'active' : undefined} to={path('?deal=buy')}>{t('buy')}</Link>
            <NavLink to={path('/favorites')}>{t('favorites')}</NavLink>
            <NavLink to={path('/support')}>{t('support')}</NavLink>
            <NavLink to={path('/post')}>{t('post')}</NavLink>
            {!user && (
              <>
                <NavLink className="nav-login" to={path('/login')}>{t('login')}</NavLink>
                <NavLink className="nav-signup" to={path('/register')}>{t('signup')}</NavLink>
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
      <CompareBar />
      <ChatWidget />
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
          {user.role === 'admin' && <NavLink role="menuitem" className="menu-admin" to={path('/admin')}>{t('admin')}</NavLink>}
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

/** A listing's price; a developer's layout shows its lowest price as "from …". */
export const listingPrice = (item, t) => (item.priceFrom && item.price !== null ? t('cardPriceFrom', { p: formatPrice(item.price) }) : formatPrice(item.price));

export const formatPrice = (value) => (value === null || value === undefined ? '' : `${String(value).replace(/\B(?=(\d{3})+$)/g, ' ')} ₸`);

/** Telegram channels are shown simply as "Telegram"; other sites by their name. */
export const sourceName = (source) => (/^t\.me\//i.test(source.name ?? '') ? 'Telegram' : source.name);

export function SourceBadge({ source }) {
  const { t } = useI18n();
  if (source.type === 'import') return <span className="source import">{t('sourceImport', { name: sourceName(source) })}</span>;
  return <span className="source">{t(source.type === 'test' ? 'sourceTest' : 'sourceApp')}</span>;
}

export function Distance({ km }) {
  const { t } = useI18n();
  return <span className="distance">{km === null ? t('distanceUnknown') : t('distanceSdu', { n: km })}</span>;
}

/** Shown when the owner proved by SMS that the number in the ad is theirs. */
export function PhoneVerified({ item }) {
  const { t } = useI18n();
  if (!item.phoneVerified) return null;
  return <span className="verified" title={t('phoneVerifiedHint')}>✓ {t('phoneVerified')}</span>;
}

/** "Updated 2 days ago", so people see how fresh an ad is before they call. */
export function Freshness({ date }) {
  const { t, lang } = useI18n();
  if (!date) return null;
  const days = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000));
  const when = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(-days, 'day');
  return <span className={`freshness${days > 14 ? ' old' : ''}`}>{t('updatedAgo', { when })}</span>;
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

/** Adds an ad to the comparison, or takes it out. */
export function CompareButton({ item, inline = false }) {
  const { t } = useI18n();
  const compare = useCompare();
  const toast = useToast();
  const active = compare.has(item.id);
  const label = active ? t('compareRemove') : t('compareAdd');

  function toggle(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!compare.toggle(item.id)) return toast(t('compareFull'), 'bad');
    if (!active) toast(t('toastCompareAdded'));
  }

  return (
    <button type="button" className={`cmp${inline ? ' cmp-inline' : ''}`} aria-pressed={active} aria-label={label} title={label} onClick={toggle}>
      ⇄{inline ? ` ${active ? t('compareRemove') : t('compare')}` : ''}
    </button>
  );
}

/** Sits at the bottom of every page while ads are picked for comparison. */
function CompareBar() {
  const { t, path } = useI18n();
  const { ids, clear } = useCompare();
  const location = useLocation();
  if (ids.length === 0 || location.pathname === path('/compare')) return null;
  return (
    <div className="compare-bar pop" role="region" aria-label={t('compareTitle')}>
      <span>{t('compareTitle')}: <b>{ids.length}</b> / 4</span>
      <Link className="btn small" to={path('/compare')}>{t('compareOpen', { n: ids.length })}</Link>
      <button type="button" className="btn ghost small" onClick={clear}>{t('compareClear')}</button>
    </div>
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

/** Lets an admin remove any ad for good, from the admin panel, a search card or the ad page. */
export function AdminDeleteButton({ id, onDone, className = 'btn ghost small' }) {
  const { t, tError } = useI18n();
  const toast = useToast();
  const dialog = useRef(null);
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      await api(`/admin/listings/${id}`, { method: 'DELETE' });
      dialog.current?.close();
      toast(t('toastDeleted'));
      onDone?.();
    } catch (failure) {
      toast(tError(failure), 'bad');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className={className} type="button" onClick={() => dialog.current?.showModal()}>{t('adminDelete')}</button>
      <dialog ref={dialog} className="dialog">
        <p>{t('adminDeleteConfirm', { n: id })}</p>
        <div className="actions" style={{ marginTop: 16 }}>
          <button className="btn danger solid" type="button" disabled={busy} onClick={confirm}>{t('adminDelete')}</button>
          <button className="btn ghost" type="button" onClick={() => dialog.current?.close()}>{t('deleteCancel')}</button>
        </div>
      </dialog>
    </>
  );
}

/** Sends a guest to sign in and brings them back to this page; contacts are for signed-in people. */
export function LoginForContacts({ className = 'btn', children }) {
  const { t, path } = useI18n();
  const location = useLocation();
  return (
    <Link className={className} to={path('/login')} state={{ from: location.pathname + location.search, reason: 'contacts' }} title={t('loginForContacts')}>
      {children ?? t('login')}
    </Link>
  );
}

export function DealCardButton({ item }) {
  const { t, path } = useI18n();
  if (item.dealStatus === 'closed') return <span className="status rejected">{t(`closed_${item.deal}`)}</span>;
  if (item.source.type === 'import') {
    return <a className="btn small" href={item.source.url} target="_blank" rel="noopener noreferrer nofollow" title={t('openOnSource', { name: sourceName(item.source) })}>{t('openShort')}</a>;
  }
  if (item.isOwner) return null;
  return <Link className="btn small" to={path(`/listing/${item.id}?deal=1`)}>{t(item.deal === 'rent' ? 'dealRentBtn' : 'dealBuyBtn')}</Link>;
}

/** Page numbers around the current one, with gaps: 1 … 4 5 6 … 11. */
export function pageNumbers(page, pages) {
  const shown = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...shown].sort((a, b) => a - b);
  return sorted.flatMap((n, index) => (index > 0 && n - sorted[index - 1] > 1 ? ['gap', n] : [n]));
}

export function Pager({ page, pages, onChange }) {
  const { t } = useI18n();
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label={t('pages')}>
      <button className="btn ghost small" type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}>← {t('prev')}</button>
      {pageNumbers(page, pages).map((n, index) =>
        n === 'gap' ? (
          <span key={`gap${index}`} className="meta">…</span>
        ) : (
          <button key={n} type="button" className={`page-num${n === page ? ' on' : ''}`} aria-current={n === page ? 'page' : undefined} onClick={() => onChange(n)}>{n}</button>
        ),
      )}
      <button className="btn ghost small" type="button" disabled={page >= pages} onClick={() => onChange(page + 1)}>{t('next')} →</button>
    </nav>
  );
}

export function ListingCard({ item, index = 0, onFavoriteChange, onHover, onRemoved }) {
  const { t, path } = useI18n();
  const { user } = useAuth();
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
      <CompareButton item={item} />
      <Link to={path(`/listing/${item.id}`)} className="ph">
        {item.photos[0] ? <img src={item.photos[0]} alt={item.title} loading="lazy" /> : <HouseArt id={item.id} label={t('noPhoto')} />}
        {item.photos[0] && item.photosAreExamples && <span className="photo-note">{t('examplePhoto')}</span>}
      </Link>
      <div className="body">
        <Link to={path(`/listing/${item.id}`)} className="price">
          {listingPrice(item, t)}{item.deal === 'rent' ? ` / ${t('perMonth')}` : ''}
        </Link>
        <div className="meta">{heading} · {place}</div>
        <Distance km={item.distanceKm} />
        <Freshness date={item.updatedAt} />
        <PhoneVerified item={item} />
        <div className="tags">
          {item.rooms > 0 && <span className="tag">{t('roomCount', { n: item.rooms })}</span>}
          {item.rooms === 0 && <span className="tag">{t('studio')}</span>}
          {item.floor && <span className="tag">{t('floorTag', { n: item.floor })}</span>}
          {item.year && <span className="tag">{t('builtTag', { n: item.year })}</span>}
          {item.roommateCount > 0 && <span className="tag roommates-tag">👥 {t('roommatesTag', { n: item.roommateCount })}</span>}
        </div>
        <div className="card-foot">
          <SourceBadge source={item.source} />
          <DealCardButton item={item} />
          {canAdmin(user, 'listings') && <AdminDeleteButton id={item.id} onDone={onRemoved} className="btn danger small" />}
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

