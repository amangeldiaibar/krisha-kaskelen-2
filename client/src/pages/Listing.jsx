import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, useFetch, useI18n, usePolling, useToast } from '../context.jsx';
import { DeleteListingButton, Distance, FavoriteButton, HouseArt, ListingsMap, SkeletonCards, SourceBadge, Status, formatPrice, listingLabel } from '../components/Shared.jsx';

const PENDING_POLL_MS = 3000;

/** Full-screen photo viewer with arrows, keyboard and swipe support. */
function PhotoViewer({ photos, start, title, onClose }) {
  const { t } = useI18n();
  const dialog = useRef(null);
  const touchX = useRef(null);
  const [index, setIndex] = useState(start);
  const count = photos.length;
  const go = (step) => setIndex((current) => (current + step + count) % count);

  useEffect(() => {
    dialog.current?.showModal?.();
    const onKey = (event) => {
      if (event.key === 'ArrowRight') go(1);
      if (event.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // go only depends on count, which is fixed while the viewer is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <dialog
      ref={dialog}
      className="viewer"
      onClose={onClose}
      onClick={(event) => event.target === event.currentTarget && dialog.current.close()}
      onTouchStart={(event) => { touchX.current = event.touches[0].clientX; }}
      onTouchEnd={(event) => {
        const moved = event.changedTouches[0].clientX - (touchX.current ?? 0);
        if (Math.abs(moved) > 40) go(moved < 0 ? 1 : -1);
      }}
    >
      <img key={photos[index]} src={photos[index]} alt={`${title} ${index + 1}`} />
      <span className="viewer-count">{t('photoCount', { a: index + 1, b: count })}</span>
      <button type="button" className="viewer-btn close" aria-label={t('closeViewer')} onClick={() => dialog.current.close()}>×</button>
      {count > 1 && (
        <>
          <button type="button" className="viewer-btn prev" aria-label={t('prevPhoto')} onClick={() => go(-1)}>‹</button>
          <button type="button" className="viewer-btn next" aria-label={t('nextPhoto')} onClick={() => go(1)}>›</button>
        </>
      )}
    </dialog>
  );
}

function Gallery({ item }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(null);
  const photos = item.photos;
  if (photos.length === 0) {
    return (
      <div className="gallery count-3">
        {[0, 1, 2].map((index) => <div className="ph" key={index}><HouseArt id={item.id + index} label={t('noPhoto')} /></div>)}
      </div>
    );
  }
  const shown = photos.slice(0, 3);
  const extra = photos.length - shown.length;
  return (
    <>
      <div className={`gallery count-${shown.length}`}>
        {shown.map((photo, index) => (
          <button type="button" className="ph zoomable" key={photo} aria-label={t('openPhoto', { n: index + 1 })} onClick={() => setOpen(index)}>
            {item.photosAreExamples && index === 0 && <span className="photo-note">{t('examplePhoto')}</span>}
            <img src={photo} alt={`${item.title} ${index + 1}`} />
            {extra > 0 && index === shown.length - 1 && <span className="more">{t('morePhotos', { n: extra })}</span>}
          </button>
        ))}
      </div>
      {photos.length > 3 && (
        <div className="thumbs">
          {photos.map((photo, index) => (
            <button type="button" key={photo} aria-label={t('openPhoto', { n: index + 1 })} onClick={() => setOpen(index)}>
              <img src={photo} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {open !== null && <PhotoViewer photos={photos} start={open} title={item.title} onClose={() => setOpen(null)} />}
    </>
  );
}
const REQUEST_POLL_MS = 8000;

function DealDialog({ item, onClose, onSent }) {
  const { t, tError } = useI18n();
  const toast = useToast();
  const dialog = useRef(null);
  const [date, setDate] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const isRent = item.deal === 'rent';

  useEffect(() => {
    dialog.current?.showModal?.();
  }, []);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/listings/${item.id}/requests`, { method: 'POST', body: { date: date || null, message } });
      toast(t(isRent ? 'dealSentRent' : 'dealSentBuy'));
      onSent();
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="dialog" onClose={onClose} onClick={(event) => event.target === dialog.current && onClose()}>
      <form className="stack" onSubmit={submit}>
        <h2>{t(isRent ? 'dealTitleRent' : 'dealTitleBuy')}</h2>
        <p className="meta">{item.title} · {formatPrice(item.price)}{isRent ? ` / ${t('perMonth')}` : ''}</p>
        <label>{t(isRent ? 'dealDateRent' : 'dealDateBuy')}
          <input type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>{t('dealMessage')}
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder={t('dealMessagePh')} maxLength={1000} />
        </label>
        <p className="hint">{t('dealNote')}</p>
        {error && <p className="error-text" role="alert">{tError(error)}</p>}
        <div className="actions">
          <button className="btn" type="submit" disabled={busy}>{t('dealSend')}</button>
          <button className="btn ghost" type="button" onClick={onClose}>{t('dealCancel')}</button>
        </div>
      </form>
    </dialog>
  );
}

function DealPanel({ item, onChanged }) {
  const { user, ready } = useAuth();
  const { t, tError, path } = useI18n();
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const wantsDeal = params.get('deal') === '1';
  const isRent = item.deal === 'rent';

  const start = () => {
    if (!user) {
      navigate(path('/login'), { state: { from: `${location.pathname}?deal=1` } });
      return;
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!wantsDeal || !ready) return;
    setParams({}, { replace: true });
    if (item.canRequest && item.myRequest?.status !== 'pending') start();
    // Runs once for the ?deal=1 link from a card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsDeal, ready]);

  async function run(url, message) {
    try {
      await api(url, { method: 'POST' });
      toast(t(message));
      onChanged();
    } catch (failure) {
      toast(tError(failure), 'bad');
    }
  }

  if (item.dealStatus === 'closed') {
    return (
      <div className="dealbox">
        <span className="status rejected">{t(`closed_${item.deal}`)}</span>
        {item.myRequest?.status === 'accepted' && <p className="meta">{t('dealAccepted')}</p>}
        {item.isOwner && <button className="btn ghost" type="button" onClick={() => run(`/listings/${item.id}/reopen`, 'toastReopened')}>{t('reopen')}</button>}
      </div>
    );
  }
  if (item.source.type === 'import') {
    return <a className="btn full" href={item.source.url} target="_blank" rel="noopener noreferrer nofollow">{t('openOnSource', { name: item.source.name })}</a>;
  }
  if (item.isOwner) {
    return <Link className="btn ghost full" to={path('/requests')}>{t('requests')}</Link>;
  }
  if (!item.canRequest) return null;

  const request = item.myRequest;
  if (request?.status === 'pending') {
    return (
      <div className="dealbox">
        <span className="status pending">{t('dealPending')}</span>
        <button className="btn ghost" type="button" onClick={() => run(`/requests/${request.id}/cancel`, 'toastCancelled')}>{t('dealCancelRequest')}</button>
      </div>
    );
  }
  return (
    <div className="dealbox">
      {request?.status === 'declined' && <p className="meta">{t('dealDeclined')}</p>}
      <button className="btn full cta" type="button" onClick={start}>{t(isRent ? 'dealRentBtn' : 'dealBuyBtn')}</button>
      {open && <DealDialog item={item} onClose={() => setOpen(false)} onSent={() => { setOpen(false); onChanged(); }} />}
    </div>
  );
}

function ReviewForm({ listingId, onSent }) {
  const { lang, t, tError } = useI18n();
  const toast = useToast();
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/listings/${listingId}/reviews`, { method: 'POST', body: { text, lang } });
      setText('');
      toast(t('toastReview'));
      onSent();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} style={{ marginTop: 12 }}>
      <label>{t('leaveReview')}
        <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={t('reviewPh')} required minLength={5} maxLength={2000} />
      </label>
      {error && <p className="error-text" role="alert">{tError(error)}</p>}
      <div><button className="btn" type="submit" disabled={busy}>{t('send')}</button></div>
    </form>
  );
}

function Reviews({ listing }) {
  const { user } = useAuth();
  const { t, path } = useI18n();
  const location = useLocation();
  const { data, loading, error, reload } = useFetch(`/listings/${listing.id}/reviews`);
  usePolling(reload, PENDING_POLL_MS, Boolean(data?.app.some((review) => review.isMine && review.status === 'pending')));

  return (
    <section className="panel">
      <h2>{t('reviews')}</h2>
      <Status loading={loading && !data} error={error} onRetry={reload} />
      {data && (
        <>
          <h3 className="meta">{t('reviewsApp')}</h3>
          {data.app.length === 0 && <p className="meta">{t('noReviews')}</p>}
          {data.app.map((review) => (
            <div className="review" key={review.id}>
              <blockquote className="prose">{review.text}</blockquote>
              <span className="meta">{review.isMine ? t('yourReview') : review.author}</span>
              {review.isMine && review.status && <span className={`status ${review.status}`}>{t(`status_${review.status}`)}</span>}
              {review.isMine && review.moderationReason && review.status === 'rejected' && <span className="meta">{t('moderationReason', { r: review.moderationReason })}</span>}
            </div>
          ))}
          {data.canReview && <ReviewForm listingId={listing.id} onSent={reload} />}
          {!user && <p className="alt"><Link to={path('/login')} state={{ from: location.pathname }}>{t('loginToReview')}</Link></p>}

          <h3 className="meta" style={{ marginTop: 16 }}>{t('reviewsDgis')}</h3>
          {data.external.rating !== null && <p className="meta">{t('dgisRating', { r: data.external.rating, n: data.external.count })}</p>}
          {data.external.status === 'unavailable' && <p className="meta">{t('dgisUnavailable')}</p>}
          {data.external.status === 'error' && <p className="meta">{t('dgisError')}</p>}
          {(data.external.status === 'no_match' || (data.external.status === 'ok' && data.external.reviews.length === 0)) && <p className="meta">{t('dgisNoMatch')}</p>}
          {data.external.reviews.map((review) => (
            <div className="review" key={review.id}>
              <blockquote className="prose">{review.text}</blockquote>
              <span className="meta">{review.author ?? '2GIS'} · 2GIS</span>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function ContactPanel({ item }) {
  const { user } = useAuth();
  const { t, path, tError } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState(null);

  async function openChat() {
    if (!user) return navigate(path('/login'), { state: { from: location.pathname } });
    try {
      const { id } = await api(`/listings/${item.id}/conversation`, { method: 'POST' });
      navigate(path(`/chats/${id}`));
    } catch (failure) {
      setError(failure);
    }
  }

  if (item.source.type === 'import') {
    return (
      <section className="panel">
        <h2>{t('contacts')}</h2>
        <p className="meta">{t('sourceContacts')}</p>
        <a className="btn" style={{ marginTop: 8 }} href={item.source.url} target="_blank" rel="noopener noreferrer nofollow">{t('openSource')}</a>
      </section>
    );
  }
  return (
    <section className="panel">
      <h2>{t('owner')}</h2>
      <div className="meta">{t('callOwner')}</div>
      <a className="phone" href={`tel:${item.phone.replace(/[^+\d]/g, '')}`}>{item.phone}</a>
      <div className="actions">
        <a className="btn" href={`tel:${item.phone.replace(/[^+\d]/g, '')}`}>{t('call')}</a>
        {item.canChat && <button className="btn ghost" type="button" onClick={openChat}>{t('writeOwner')}</button>}
      </div>
      {error && <p className="error-text" role="alert">{tError(error)}</p>}
    </section>
  );
}

export default function Listing() {
  const { id } = useParams();
  const { t, path } = useI18n();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useFetch(`/listings/${id}`);
  const waiting = data?.item.status === 'pending';
  const hasOpenRequest = data?.item.myRequest?.status === 'pending';
  usePolling(reload, waiting ? PENDING_POLL_MS : REQUEST_POLL_MS, Boolean(waiting || hasOpenRequest));

  if (!data) {
    return (
      <main className="wrap" style={{ paddingTop: 24 }}>
        {loading && <SkeletonCards count={1} />}
        <Status error={error} onRetry={reload} />
      </main>
    );
  }
  const { item, sdu } = data;
  const label = [listingLabel(t, item), item.area ? `${item.area} м²` : null].filter(Boolean).join(', ');

  return (
    <main className="wrap">
      <p className="crumb"><Link to={path()}>{t('allApartments')}</Link> / {label}</p>
      {item.isOwner && item.status !== 'approved' && (
        <p className="notice">
          <span className={`status ${item.status}`}>{t(`status_${item.status}`)}</span>
          {item.moderationReason && ` ${t('moderationReason', { r: item.moderationReason })}`}
        </p>
      )}
      <div className="detail">
        <div>
          <Gallery item={item} />
          <section className="panel">
            <h2>{item.title}</h2>
            <SourceBadge source={item.source} />
            <dl style={{ marginTop: 12 }}>
              <dt>{t('price')}</dt>
              <dd>{formatPrice(item.price)}{item.deal === 'rent' ? ` / ${t('perMonth')}` : ''}</dd>
              {item.year && <><dt>{t('yearBuilt')}</dt><dd>{item.year}</dd></>}
              {item.rooms !== null && <><dt>{t('rooms')}</dt><dd>{item.rooms === 0 ? t('studio') : item.rooms}</dd></>}
              {item.floor && <><dt>{t('floor')}</dt><dd>{item.floors ? t('floorOf', { a: item.floor, b: item.floors }) : item.floor}</dd></>}
              {item.district && <><dt>{t('district')}</dt><dd>{t(item.district)}</dd></>}
              {item.address && <><dt>{t('address')}</dt><dd>{item.address}</dd></>}
            </dl>
          </section>
          <section className="panel">
            <h2>{t('description')}</h2>
            <p className="prose">{item.description}</p>
          </section>
          <section className="panel">
            <h2>{t('location')}</h2>
            <p style={{ marginBottom: 8 }}><Distance km={item.distanceKm} /></p>
            <ListingsMap items={[item]} sdu={sdu} height={260} />
          </section>
          <Reviews listing={item} />
        </div>
        <aside className="side">
          <section className="panel">
            <div className="price">{formatPrice(item.price)}</div>
            {item.deal === 'rent' && <div className="meta">{t('perMonthLong')}</div>}
            <DealPanel item={item} onChanged={reload} />
            <div className="actions">
              <FavoriteButton item={item} inline />
              {item.isOwner && <Link className="btn ghost" to={path(`/listing/${item.id}/edit`)}>{t('edit')}</Link>}
              {item.isOwner && <DeleteListingButton item={item} onDeleted={() => navigate(path('/mine'))} />}
            </div>
          </section>
          <ContactPanel item={item} />
        </aside>
      </div>
    </main>
  );
}
