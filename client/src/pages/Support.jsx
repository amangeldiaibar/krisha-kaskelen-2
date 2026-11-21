import { useState } from 'react';
import { api } from '../api.js';
import { useFetch, useI18n, usePolling, useToast } from '../context.jsx';
import { RequireLogin, Status } from '../components/Shared.jsx';

export const SUPPORT_TOPICS = ['question', 'listing', 'account', 'complaint', 'idea', 'other'];
const ANSWER_POLL_MS = 15_000;
const LOCALES = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' };

function SupportBody() {
  const { t, tError, lang } = useI18n();
  const toast = useToast();
  const { data, loading, error, reload } = useFetch('/support');
  const [topic, setTopic] = useState('question');
  const [text, setText] = useState('');
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);
  // While a message waits, the page checks for the answer now and then.
  usePolling(reload, ANSWER_POLL_MS, Boolean(data?.items.some((item) => item.status === 'open')));
  const date = (value) => new Date(value).toLocaleString(LOCALES[lang], { dateStyle: 'medium', timeStyle: 'short' });

  async function send(event) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      await api('/support', { method: 'POST', body: { topic, text } });
      setText('');
      toast(t('toastSupportSent'));
      reload();
    } catch (problem) {
      setFailure(problem);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="panel stack" onSubmit={send}>
        <h2>{t('supportWrite')}</h2>
        <label>{t('supportTopic')}
          <select value={topic} onChange={(event) => setTopic(event.target.value)}>
            {SUPPORT_TOPICS.map((name) => <option key={name} value={name}>{t(`topic_${name}`)}</option>)}
          </select>
        </label>
        <label>{t('supportText')}
          <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={t('supportTextPh')} required minLength={10} maxLength={3000} />
        </label>
        {failure && <p className="error-text" role="alert">{tError(failure)}</p>}
        <div><button className="btn" type="submit" disabled={busy}>{t('supportSend')}</button></div>
      </form>

      <section className="panel">
        <h2>{t('supportMine')}</h2>
        <Status loading={loading && !data} error={error} onRetry={reload} />
        {data?.items.length === 0 && <p className="meta">{t('supportNone')}</p>}
        <div className="tickets">
          {data?.items.map((item) => (
            <article className="ticket" key={item.id}>
              <div className="ticket-head">
                <b>{t(`topic_${item.topic}`)}</b>
                <span className={`status ticket-${item.status}`}>{t(`ticket_${item.status}`)}</span>
                <span className="meta">{date(item.createdAt)}</span>
              </div>
              <p className="prose">{item.text}</p>
              {item.reply && (
                <div className="ticket-reply">
                  <span className="meta">{t('supportAnswer')} · {date(item.repliedAt)}</span>
                  <p className="prose">{item.reply}</p>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

export default function Support() {
  const { t } = useI18n();
  return (
    <main className="wrap formpage">
      <h1>{t('support')}</h1>
      <p className="meta" style={{ marginBottom: 16 }}>{t('supportIntro')}</p>
      <RequireLogin><SupportBody /></RequireLogin>
    </main>
  );
}
