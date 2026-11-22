import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, useI18n } from '../context.jsx';

/** Opens the chat button's window on a conversation, from anywhere on the site. */
export const openChat = (id) => window.dispatchEvent(new CustomEvent('chat:open', { detail: { id } }));

const PREVIEW_MS = 6000;
/** As long as the window's closing animation in style.css. */
const CLOSE_MS = 220;

function Face({ name, src }) {
  if (src) return <img className="avatar" src={src} alt="" />;
  return <span className="avatar" aria-hidden="true">{(name ?? '?').trim().charAt(0).toUpperCase()}</span>;
}

/** "14:05" for today, "21 нояб." for older messages. */
function when(date, lang) {
  if (!date) return '';
  const d = new Date(date);
  const today = new Date().toDateString() === d.toDateString();
  return new Intl.DateTimeFormat(lang, today ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' }).format(d);
}

function Thread({ id, onBack, onClose, onRead }) {
  const { t, tError, path, lang } = useI18n();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const list = useRef(null);
  const input = useRef(null);

  const load = useCallback(async () => {
    try {
      setData(await api(`/conversations/${id}/messages`));
      await api(`/conversations/${id}/read`, { method: 'POST' });
      onRead();
    } catch (failure) {
      setError(failure);
    }
  }, [id, onRead]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('chat:message', load);
    return () => window.removeEventListener('chat:message', load);
  }, [load]);

  const count = data?.items.length ?? 0;
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [count]);
  useEffect(() => { input.current?.focus(); }, [id]);

  async function send(event) {
    event.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const message = await api(`/conversations/${id}/messages`, { method: 'POST', body: { text } });
      setText('');
      setData((old) => (old && !old.items.some((item) => item.id === message.id) ? { ...old, items: [...old.items, message] } : old));
    } catch (failure) {
      setError(failure);
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }

  return (
    <>
      <div className="cw-head">
        <button type="button" className="cw-icon" onClick={onBack} aria-label={t('backToChats')}>←</button>
        {data && <Face name={data.otherName} src={data.otherAvatar} />}
        <div className="cw-title">
          <b>{data?.otherName ?? '…'}</b>
          {data && <Link to={path(`/listing/${data.listingId}`)}>{data.title}</Link>}
        </div>
        <button type="button" className="cw-icon" onClick={onClose} aria-label={t('closeChats')}>×</button>
      </div>
      <div className="cw-messages" ref={list} aria-live="polite">
        {data && count === 0 && <p className="meta cw-empty">{t('noMessages')}</p>}
        {data?.items.map((message) => (
          <div className={`cw-bubble${message.isMine ? ' mine' : ''}`} key={message.id}>
            <span className="prose">{message.text}</span>
            <time>{when(message.createdAt, lang)}</time>
          </div>
        ))}
      </div>
      {error && <p className="error-text cw-error" role="alert">{tError(error)}</p>}
      <form className="cw-form" onSubmit={send}>
        <input ref={input} type="text" value={text} onChange={(event) => setText(event.target.value)} placeholder={t('messagePh')} aria-label={t('messagePh')} maxLength={2000} />
        <button className="btn" type="submit" disabled={sending || !text.trim()} aria-label={t('send')}>➤</button>
      </form>
    </>
  );
}

function ChatList({ items, onPick }) {
  const { t, lang } = useI18n();
  if (!items) return <p className="meta cw-empty">{t('loading')}</p>;
  if (items.length === 0) return <p className="meta cw-empty">{t('noChats')}</p>;
  return (
    <div className="cw-list">
      {items.map((item) => (
        <button type="button" key={item.id} className={`cw-row${item.unread ? ' unread' : ''}`} onClick={() => onPick(item.id)}>
          <Face name={item.otherName} src={item.otherAvatar} />
          <span className="cw-row-body">
            <span className="cw-row-top"><b>{item.otherName}</b><time>{when(item.lastAt, lang)}</time></span>
            <span className="cw-row-ad">{item.flatmate ? `👥 ${item.title}` : item.title}</span>
            <span className="cw-row-last">
              <span>{item.lastMessage ? `${item.lastMine ? t('youPrefix') : ''}${item.lastMessage}` : t('noMessages')}</span>
              {item.unread > 0 && <span className="cw-count">{item.unread}</span>}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** The round chat button at the bottom right: unread count, a preview of new messages, and the whole chat in a window. */
export default function ChatWidget() {
  const { user } = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  // The window stays on screen while it animates away, then leaves.
  const [closing, setClosing] = useState(false);
  const shown = open && !closing;
  const [active, setActive] = useState(null);
  const [chats, setChats] = useState(null);
  const [unread, setUnread] = useState(0);
  const [preview, setPreview] = useState(null);
  const state = useRef({ open, active });
  state.current = { open, active };
  const onChatsPage = /^\/[^/]+\/chats(\/|$)/.test(location.pathname);

  const reload = useCallback(async () => {
    try {
      const data = await api('/conversations');
      setChats(data.items);
      setUnread(data.unread);
    } catch {
      // The button stays as it was; the next message or reopening tries again.
    }
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    reload();
    const source = new EventSource('/api/events');
    let opened = false;
    source.onopen = () => {
      if (opened) reload();
      opened = true;
    };
    source.onmessage = (event) => {
      let message = null;
      try { message = JSON.parse(event.data); } catch { return; }
      reload();
      window.dispatchEvent(new CustomEvent('chat:message', { detail: message }));
      const { open: isOpen, active: current } = state.current;
      const seen = isOpen && current === message.conversationId;
      if (message.senderId !== user.id && !seen) setPreview(message);
    };
    return () => source.close();
  }, [user, reload]);

  useEffect(() => {
    if (!preview) return undefined;
    const timer = setTimeout(() => setPreview(null), PREVIEW_MS);
    return () => clearTimeout(timer);
  }, [preview]);

  const hide = useCallback(() => setClosing(true), []);
  useEffect(() => {
    if (!closing) return undefined;
    const timer = setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, CLOSE_MS);
    return () => clearTimeout(timer);
  }, [closing]);

  useEffect(() => {
    const show = (event) => {
      setActive(event.detail?.id ?? null);
      setOpen(true);
      setClosing(false);
      setPreview(null);
      reload();
    };
    window.addEventListener('chat:open', show);
    return () => window.removeEventListener('chat:open', show);
  }, [reload]);

  useEffect(() => {
    if (!shown) return undefined;
    const close = (event) => { if (event.key === 'Escape') hide(); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [shown, hide]);

  if (!user || onChatsPage) return null;

  return (
    <div className="cw">
      {open && (
        <section className={`cw-panel${closing ? ' closing' : ''}`} role="dialog" aria-label={t('chats')}>
          {active ? (
            <Thread id={active} onBack={() => { setActive(null); reload(); }} onClose={hide} onRead={reload} />
          ) : (
            <>
              <div className="cw-head">
                <b className="cw-title">{t('chats')}</b>
                <button type="button" className="cw-icon" onClick={hide} aria-label={t('closeChats')}>×</button>
              </div>
              <ChatList items={chats} onPick={setActive} />
            </>
          )}
        </section>
      )}
      {preview && !open && (
        <button type="button" className="cw-preview" onClick={() => openChat(preview.conversationId)}>
          <b>{t('newMessageFrom', { name: preview.senderName })}</b>
          <span>{preview.text}</span>
        </button>
      )}
      <button
        type="button"
        className={`cw-button${shown ? ' open' : ''}`}
        onClick={() => {
          setPreview(null);
          if (shown) return hide();
          setOpen(true);
          setClosing(false);
          reload();
        }}
        aria-label={shown ? t('closeChats') : unread ? t('unreadCount', { n: unread }) : t('openChats')}
        aria-expanded={shown}
      >
        {shown ? <span className="cw-x">×</span> : (
          <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path fill="currentColor" d="M12 3C6.5 3 2 6.8 2 11.5c0 2.4 1.2 4.6 3.1 6.1L4 21l4.1-2.1c1.2.4 2.5.6 3.9.6 5.5 0 10-3.8 10-8.5S17.5 3 12 3z" /></svg>
        )}
        {!shown && unread > 0 && <span className="cw-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
    </div>
  );
}
