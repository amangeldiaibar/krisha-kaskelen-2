import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, useFetch, useI18n, useLiveChat, usePolling, useToast } from '../context.jsx';
import { Avatar, DeleteListingButton, ListingCard, PhoneInput, RequireLogin, SkeletonCards, Status, formatPrice } from '../components/Shared.jsx';

function FavoritesBody() {
  const { t } = useI18n();
  const { data, loading, error, reload } = useFetch('/favorites');
  return (
    <>
      <Status loading={loading && !data} error={error} onRetry={reload} />
      {data?.items.length === 0 && <p className="state">{t('noFavorites')}</p>}
      <div className="list" style={{ marginTop: 16 }}>
        {data?.items.map((item, index) => <ListingCard key={item.id} item={item} index={index} onFavoriteChange={reload} onRemoved={reload} />)}
      </div>
    </>
  );
}

export function Favorites() {
  const { t } = useI18n();
  return <main className="wrap formpage"><h1>{t('favorites')}</h1><RequireLogin><FavoritesBody /></RequireLogin></main>;
}

function MineBody() {
  const { t, path } = useI18n();
  const { data, loading, error, reload } = useFetch('/listings/mine');
  usePolling(reload, 3000, Boolean(data?.items.some((item) => item.status === 'pending')));
  return (
    <>
      <Status loading={loading && !data} error={error} onRetry={reload} />
      {data?.items.length === 0 && <p className="state">{t('noOwnAds')}</p>}
      {data?.items.map((item) => (
        <section className="panel" key={item.id}>
          <h2>{item.title}</h2>
          <span className={`status ${item.status}`}>{t(`status_${item.status}`)}</span>
          {item.moderationReason === 'no_ai_key' && <p className="hint" style={{ marginTop: 6 }}>{t('noAiPublished')}</p>}
          {item.dealStatus === 'closed' && <span className="status rejected" style={{ marginLeft: 6 }}>{t(`closed_${item.deal}`)}</span>}
          {item.status === 'rejected' && item.moderationReason && <p className="meta" style={{ marginTop: 6 }}>{t('moderationReason', { r: item.moderationReason })}</p>}
          <div className="actions">
            <Link className="btn ghost" to={path(`/listing/${item.id}`)}>{t('toListing')}</Link>
            <Link className="btn ghost" to={path(`/listing/${item.id}/edit`)}>{t('edit')}</Link>
            <DeleteListingButton item={item} onDeleted={reload} />
          </div>
        </section>
      ))}
    </>
  );
}

export function MyListings() {
  const { t } = useI18n();
  return <main className="wrap formpage"><h1>{t('myListings')}</h1><RequireLogin><MineBody /></RequireLogin></main>;
}

function RequestCard({ request, incoming, onChanged }) {
  const { t, tError, path } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function run(action, message) {
    setBusy(true);
    try {
      await api(`/requests/${request.id}/${action}`, { method: 'POST' });
      toast(t(message));
      onChanged();
    } catch (failure) {
      toast(tError(failure), 'bad');
      setBusy(false);
    }
  }

  const tel = request.person.phone.replace(/[^+\d]/g, '');
  return (
    <section className="panel reveal">
      <h2><Link to={path(`/listing/${request.listing.id}`)}>{request.listing.title}</Link></h2>
      <p className="meta">{t(request.listing.deal === 'rent' ? 'dealTitleRent' : 'dealTitleBuy')} · {formatPrice(request.listing.price)}</p>
      <span className={`status ${{ accepted: 'approved', declined: 'rejected', cancelled: 'rejected' }[request.status] ?? 'pending'}`}>{t(`request_${request.status}`)}</span>
      <p style={{ marginTop: 8 }}>{request.person.name} · <a className="link" href={`tel:${tel}`}>{request.person.phone}</a></p>
      {request.date && <p className="meta">{t('requestDate', { d: request.date })}</p>}
      {request.message && <blockquote className="prose" style={{ marginTop: 8 }}>{request.message}</blockquote>}
      {incoming && request.status === 'pending' && (
        <div className="actions">
          <button className="btn" type="button" disabled={busy} onClick={() => run('accept', 'toastAccepted')}>{t('accept')}</button>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => run('decline', 'toastDeclined')}>{t('decline')}</button>
        </div>
      )}
      {!incoming && request.status === 'pending' && (
        <div className="actions">
          <button className="btn ghost" type="button" disabled={busy} onClick={() => run('cancel', 'toastCancelled')}>{t('dealCancelRequest')}</button>
        </div>
      )}
    </section>
  );
}

function RequestsBody() {
  const { t } = useI18n();
  const { data, loading, error, reload } = useFetch('/requests');
  usePolling(reload, 8000);
  if (!data) return loading ? <SkeletonCards count={2} /> : <Status error={error} onRetry={reload} />;
  return (
    <>
      <h2 style={{ marginTop: 16 }}>{t('incoming')}</h2>
      {data.incoming.length === 0 && <p className="state">{t('noRequests')}</p>}
      {data.incoming.map((request) => <RequestCard key={request.id} request={request} incoming onChanged={reload} />)}
      <h2 style={{ marginTop: 24 }}>{t('outgoing')}</h2>
      {data.outgoing.length === 0 && <p className="state">{t('noRequests')}</p>}
      {data.outgoing.map((request) => <RequestCard key={request.id} request={request} onChanged={reload} />)}
    </>
  );
}

export function Requests() {
  const { t } = useI18n();
  return <main className="wrap formpage"><h1>{t('requests')}</h1><RequireLogin><RequestsBody /></RequireLogin></main>;
}

function ChatsBody() {
  const { t, path } = useI18n();
  const { data, loading, error, reload } = useFetch('/conversations');
  useLiveChat(reload);
  return (
    <section className="panel">
      <Status loading={loading && !data} error={error} onRetry={reload} />
      {data?.items.length === 0 && <p className="state">{t('noChats')}</p>}
      {data?.items.map((item) => (
        <Link className="linkrow" key={item.id} to={path(`/chats/${item.id}`)}>
          <b>{item.title}</b>
          <div className="meta">{item.otherName}{item.lastMessage ? ` · ${item.lastMessage}` : ''}</div>
        </Link>
      ))}
    </section>
  );
}

export function Chats() {
  const { t } = useI18n();
  return <main className="wrap formpage"><h1>{t('chats')}</h1><RequireLogin><ChatsBody /></RequireLogin></main>;
}

function ChatBody() {
  const { id } = useParams();
  const { t, tError, path } = useI18n();
  const { data, loading, error, reload } = useFetch(`/conversations/${id}/messages`);
  const [text, setText] = useState('');
  const [sendError, setSendError] = useState(null);
  const list = useRef(null);
  const count = data?.items.length ?? 0;

  useLiveChat(reload);

  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [count]);

  async function send(event) {
    event.preventDefault();
    setSendError(null);
    try {
      await api(`/conversations/${id}/messages`, { method: 'POST', body: { text } });
      setText('');
    } catch (failure) {
      setSendError(failure);
    }
  }

  if (!data) return <Status loading={loading} error={error} onRetry={reload} />;
  return (
    <section className="panel">
      <h2><Link to={path(`/listing/${data.listingId}`)}>{data.title}</Link></h2>
      <div className="chat" ref={list} aria-live="polite">
        {count === 0 && <p className="meta">{t('noMessages')}</p>}
        {data.items.map((message) => (
          <div className={`bubble pop prose${message.isMine ? ' mine' : ''}`} key={message.id}>{message.text}</div>
        ))}
      </div>
      <form className="chatform" onSubmit={send}>
        <input type="text" value={text} onChange={(event) => setText(event.target.value)} placeholder={t('messagePh')} aria-label={t('messagePh')} required maxLength={2000} />
        <button className="btn" type="submit">{t('send')}</button>
      </form>
      {sendError && <p className="error-text" role="alert">{tError(sendError)}</p>}
    </section>
  );
}

export function Chat() {
  const { t } = useI18n();
  return <main className="wrap formpage"><h1>{t('chats')}</h1><RequireLogin><ChatBody /></RequireLogin></main>;
}

function ProfileForm() {
  const { t, tError } = useI18n();
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [values, setValues] = useState({ name: user.name, phone: user.phone });
  const [photo, setPhoto] = useState(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const change = (event) => setValues({ ...values, [event.target.name]: event.target.value });

  useEffect(() => {
    if (!photo) return undefined;
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => {
      URL.revokeObjectURL(url);
      setPreview(null);
    };
  }, [photo]);

  async function submit(event) {
    event.preventDefault();
    setError(null);
    const body = new FormData();
    body.set('name', values.name);
    body.set('phone', values.phone);
    if (photo) body.set('photo', photo);
    else if (removePhoto) body.set('removePhoto', '1');
    try {
      const data = await api('/auth/profile', { method: 'PUT', body });
      setUser(data.user);
      setPhoto(null);
      setRemovePhoto(false);
      toast(t('toastProfileSaved'));
    } catch (failure) {
      setError(failure);
    }
  }

  const shown = preview ?? (removePhoto ? null : user.avatar);
  return (
    <section className="panel">
      <h2>{t('profile')}</h2>
      <form className="stack" onSubmit={submit}>
        <div className="avatar-edit">
          <Avatar user={user} src={shown} big />
          <div className="actions">
            <label className="btn ghost small">
              {t('choosePhoto')}
              <input className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" aria-label={t('profilePhoto')} onChange={(event) => { setPhoto(event.target.files[0] ?? null); setRemovePhoto(false); event.target.value = ''; }} />
            </label>
            {shown && <button className="btn danger small" type="button" onClick={() => { setPhoto(null); setRemovePhoto(true); }}>{t('removePhoto')}</button>}
          </div>
        </div>
        <label>{t('fullName')}<input type="text" name="name" value={values.name} onChange={change} required minLength={2} maxLength={100} autoComplete="name" /></label>
        <label>{t('phone')}<PhoneInput value={values.phone} onChange={change} required autoComplete="tel" /></label>
        <label>{t('email')}<input type="email" value={user.email} disabled /></label>
        {error && <p className="error-text" role="alert">{tError(error)}</p>}
        <button className="btn" type="submit">{t('save')}</button>
      </form>
    </section>
  );
}

function PasswordForm() {
  const { t, tError } = useI18n();
  const toast = useToast();
  const empty = { current: '', password: '', password2: '' };
  const [values, setValues] = useState(empty);
  const [error, setError] = useState(null);
  const change = (event) => setValues({ ...values, [event.target.name]: event.target.value });
  const mismatch = values.password2 !== '' && values.password !== values.password2;

  async function submit(event) {
    event.preventDefault();
    if (mismatch) return;
    setError(null);
    try {
      await api('/auth/password', { method: 'POST', body: { current: values.current, password: values.password } });
      setValues(empty);
      toast(t('toastPasswordChanged'));
    } catch (failure) {
      setError(failure);
    }
  }

  return (
    <section className="panel">
      <h2>{t('changePassword')}</h2>
      <form className="stack" onSubmit={submit}>
        <label>{t('currentPassword')}<input type="password" name="current" value={values.current} onChange={change} required maxLength={200} autoComplete="current-password" /></label>
        <label>{t('newPassword')}<input type="password" name="password" value={values.password} onChange={change} minLength={8} maxLength={200} required autoComplete="new-password" /><span className="hint">{t('atLeast8')}</span></label>
        <label>{t('repeatPassword')}<input type="password" name="password2" value={values.password2} onChange={change} minLength={8} maxLength={200} required autoComplete="new-password" /></label>
        {mismatch && <p className="error-text" role="alert">{t('passwordsDiffer')}</p>}
        {error && <p className="error-text" role="alert">{tError(error)}</p>}
        <button className="btn" type="submit" disabled={mismatch}>{t('changePassword')}</button>
      </form>
    </section>
  );
}

export function Settings() {
  const { t } = useI18n();
  return <main className="wrap formpage"><h1>{t('settings')}</h1><RequireLogin><ProfileForm /><PasswordForm /></RequireLogin></main>;
}
