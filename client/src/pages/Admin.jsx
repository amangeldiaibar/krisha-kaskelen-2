import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, useFetch, useI18n, useToast } from '../context.jsx';
import { HouseArt, RequireLogin, SkeletonCards, SourceBadge, Status, formatPrice, listingLabel } from '../components/Shared.jsx';

const TABS = ['overview', 'listings', 'duplicates', 'reports', 'reviews', 'users', 'log'];
const LOCALES = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' };

function useDate() {
  const { lang } = useI18n();
  return (value) => new Date(value).toLocaleString(LOCALES[lang], { dateStyle: 'medium', timeStyle: 'short' });
}

/** Runs an admin action, shows a toast, and reloads the list. */
function useAction(onDone) {
  const { t, tError } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (url, options, message = 'toastDone') => {
    setBusy(true);
    try {
      await api(url, { method: 'POST', ...options });
      toast(t(message));
      onDone();
      return true;
    } catch (failure) {
      toast(tError(failure), 'bad');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}

/** Approve at once, or reject with a reason the author will see. */
function ModerationActions({ url, status, onDone, suggestedReason = '' }) {
  const { t } = useI18n();
  const { run, busy } = useAction(onDone);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState(suggestedReason);

  if (rejecting) {
    return (
      <form
        className="reject-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (await run(url, { body: { decision: 'reject', reason } })) setRejecting(false);
        }}
      >
        <label>{t('adminReason')}
          <input value={reason} minLength={3} maxLength={500} required autoFocus placeholder={t('adminReasonPh')} onChange={(event) => setReason(event.target.value)} />
        </label>
        <div className="actions">
          <button className="btn danger solid small" type="submit" disabled={busy}>{t('reject')}</button>
          <button className="btn ghost small" type="button" onClick={() => setRejecting(false)}>{t('dealCancel')}</button>
        </div>
      </form>
    );
  }
  return (
    <>
      {status !== 'approved' && <button className="btn small" type="button" disabled={busy} onClick={() => run(url, { body: { decision: 'approve' } })}>{t('approve')}</button>}
      {status !== 'rejected' && <button className="btn danger small" type="button" disabled={busy} onClick={() => setRejecting(true)}>{t('reject')}</button>}
    </>
  );
}

function DeleteAction({ id, onDone }) {
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
      onDone();
    } catch (failure) {
      toast(tError(failure), 'bad');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="btn ghost small" type="button" onClick={() => dialog.current?.showModal()}>{t('adminDelete')}</button>
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

function Cover({ item }) {
  const { t } = useI18n();
  return <div className="admin-cover ph">{item.cover ? <img src={item.cover} alt="" loading="lazy" /> : <HouseArt id={item.id} label={t('noPhoto')} />}</div>;
}

function Decision({ item }) {
  const { t } = useI18n();
  if (!item.moderationReason && !item.moderatedBy) return null;
  const who = item.moderatedBy ? t('moderatedBy', { n: item.moderatedBy }) : t('aiDecision');
  return <p className="meta">{who}{item.moderationReason && item.moderationReason !== 'no_ai_key' ? `: ${item.moderationReason}` : ''}</p>;
}

function Overview({ data, onOpen }) {
  const { t } = useI18n();
  const tiles = [
    ['ov_pending', data.pendingListings, () => onOpen('listings', { status: 'pending' }), data.pendingListings > 0],
    ['ov_reports', data.openReports, () => onOpen('reports'), data.openReports > 0],
    ['ov_duplicates', data.duplicatePairs, () => onOpen('duplicates'), data.duplicatePairs > 0],
    ['ov_reviews', data.pendingReviews, () => onOpen('reviews', { status: 'pending' }), data.pendingReviews > 0],
    ['ov_live', data.liveListings, () => onOpen('listings', { status: 'approved' })],
    ['ov_rejected', data.rejectedListings, () => onOpen('listings', { status: 'rejected' })],
    ['ov_users', data.users, () => onOpen('users')],
    ['ov_blocked', data.blockedUsers, () => onOpen('users')],
  ];
  const sources = Object.entries(data.sources);
  const most = Math.max(1, ...sources.map(([, n]) => n));
  return (
    <>
      <div className="tiles">
        {tiles.map(([key, value, open, urgent]) => (
          <button key={key} type="button" className={`tile${urgent ? ' urgent' : ''}`} onClick={open}>
            <span className="tile-value">{value}</span>
            <span className="tile-label">{t(key)}</span>
          </button>
        ))}
      </div>
      <section className="panel">
        <h2>{t('ov_sources')}</h2>
        {sources.length === 0 && <p className="meta">{t('noItems')}</p>}
        <div className="bars">
          {sources.map(([source, n]) => (
            <div className="bar-row" key={source}>
              <span>{t(`source_${source}`)}</span>
              <span className="bar"><span style={{ width: `${(n / most) * 100}%` }} /></span>
              <b>{n}</b>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function ListingsTab({ params, setFilter }) {
  const { t, path } = useI18n();
  const query = new URLSearchParams(Object.entries(params).filter(([key, value]) => value && key !== 'tab')).toString();
  const { data, loading, error, reload } = useFetch(`/admin/listings?${query}`);
  const [q, setQ] = useState(params.q ?? '');
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const page = Number(params.page) || 1;

  return (
    <>
      <form className="admin-filters" onSubmit={(event) => { event.preventDefault(); setFilter({ q, page: '' }); }}>
        <select aria-label={t('statusAll')} value={params.status ?? ''} onChange={(event) => setFilter({ status: event.target.value, page: '' })}>
          <option value="">{t('statusAll')}</option>
          {['pending', 'approved', 'rejected'].map((status) => <option key={status} value={status}>{t(`status_${status}`)}</option>)}
        </select>
        <select aria-label={t('sourceAll')} value={params.source ?? ''} onChange={(event) => setFilter({ source: event.target.value, page: '' })}>
          <option value="">{t('sourceAll')}</option>
          {['app', 'telegram', 'krisha', 'test'].map((source) => <option key={source} value={source}>{t(`source_${source}`)}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={params.reported === '1'} onChange={(event) => setFilter({ reported: event.target.checked ? '1' : '', page: '' })} />{t('onlyReported')}</label>
        <input type="search" value={q} placeholder={t('adminSearchPh')} onChange={(event) => setQ(event.target.value)} />
        <button className="btn small" type="submit">{t('search')}</button>
      </form>
      {loading && !data && <SkeletonCards count={2} />}
      <Status error={error} onRetry={reload} />
      {data?.items.length === 0 && <p className="state">{t('noItems')}</p>}
      {data?.items.map((item) => (
        <article className="panel admin-row" key={item.id}>
          <Cover item={item} />
          <div className="admin-main">
            <div className="admin-title">
              <Link className="link" to={path(`/listing/${item.id}`)}>#{item.id} {item.title}</Link>
              <span className={`status ${item.status}`}>{t(`status_${item.status}`)}</span>
              {item.reportCount > 0 && <span className="status rejected">{t('reportsCount', { n: item.reportCount })}</span>}
              {item.duplicateOf && <span className="status pending">{t('copyOf', { n: item.duplicateOf })}</span>}
            </div>
            <p className="meta">
              {formatPrice(item.price)}{item.deal === 'rent' ? ` / ${t('perMonth')}` : ''} · {[listingLabel(t, item), item.area ? `${item.area} м²` : null, item.address].filter(Boolean).join(' · ')}
            </p>
            <div className="admin-tags">
              <SourceBadge source={item.source} />
              {item.owner
                ? <span className="meta">{item.owner.name} · {item.owner.phone} · {item.owner.email}{item.owner.blocked ? ` · ${t('blockedLabel')}` : ''}</span>
                : <span className="meta">{t('importedAd')}</span>}
            </div>
            <Decision item={item} />
            <details>
              <summary>{t('description')}</summary>
              <p className="prose">{item.description}</p>
            </details>
            <div className="actions">
              <ModerationActions url={`/admin/listings/${item.id}/moderate`} status={item.status} onDone={reload} />
              {item.duplicateOf && <UnmergeButton id={item.id} onDone={reload} />}
              <DeleteAction id={item.id} onDone={reload} />
            </div>
          </div>
        </article>
      ))}
      {pages > 1 && (
        <div className="pager">
          <button className="btn ghost small" type="button" disabled={page <= 1} onClick={() => setFilter({ page: String(page - 1) })}>{t('prev')}</button>
          <span className="meta">{t('pageOf', { a: page, b: pages })}</span>
          <button className="btn ghost small" type="button" disabled={page >= pages} onClick={() => setFilter({ page: String(page + 1) })}>{t('next')}</button>
        </div>
      )}
    </>
  );
}

function UnmergeButton({ id, onDone }) {
  const { t } = useI18n();
  const { run, busy } = useAction(onDone);
  return <button className="btn ghost small" type="button" disabled={busy} onClick={() => run(`/admin/listings/${id}/unmerge`)}>{t('unmerge')}</button>;
}

function DuplicateSide({ item, other, onDone }) {
  const { t, path } = useI18n();
  const date = useDate();
  const { run, busy } = useAction(onDone);
  return (
    <div className="dup-side">
      <Cover item={item} />
      <Link className="link" to={path(`/listing/${item.id}`)}>#{item.id} {item.title}</Link>
      <p className="price-sm">{formatPrice(item.price)}{item.deal === 'rent' ? ` / ${t('perMonth')}` : ''}</p>
      <dl className="dup-facts">
        <dt>{t('rooms')}</dt><dd>{item.rooms === 0 ? t('studio') : item.rooms ?? '—'}</dd>
        <dt>{t('area')}</dt><dd>{item.area ?? '—'}</dd>
        <dt>{t('floor')}</dt><dd>{item.floor ?? '—'}</dd>
        <dt>{t('address')}</dt><dd>{item.address ?? '—'}</dd>
      </dl>
      <div className="admin-tags">
        <SourceBadge source={item.source} />
        <span className={`status ${item.status}`}>{t(`status_${item.status}`)}</span>
      </div>
      <p className="meta">{date(item.createdAt)}</p>
      <p className="dup-text">{item.description}</p>
      <button className="btn small" type="button" disabled={busy} onClick={() => run('/admin/duplicates/merge', { body: { keepId: item.id, duplicateId: other.id } }, 'toastMerged')}>{t('keepThis')}</button>
    </div>
  );
}

function DuplicatesTab() {
  const { t } = useI18n();
  const { data, loading, error, reload } = useFetch('/admin/duplicates');
  const { run, busy } = useAction(reload);
  return (
    <>
      <p className="hint">{t('dupHelp')}</p>
      {loading && !data && <SkeletonCards count={1} />}
      <Status error={error} onRetry={reload} />
      {data?.items.length === 0 && <p className="state">{t('noItems')}</p>}
      {data?.items.map(({ a, b, score, reasons }) => (
        <article className="panel dup" key={`${a.id}:${b.id}`}>
          <div className="dup-head">
            <span className="score" style={{ '--score': score }}><span>{t('dupScore', { n: Math.round(score * 100) })}</span></span>
            <span className="reasons">{reasons.map((reason) => <span className="tag" key={reason}>{t(`reason_${reason}`)}</span>)}</span>
            <button className="btn ghost small" type="button" disabled={busy} onClick={() => run('/admin/duplicates/dismiss', { body: { a: a.id, b: b.id } }, 'toastNotDuplicate')}>{t('notDuplicate')}</button>
          </div>
          <div className="dup-pair">
            <DuplicateSide item={a} other={b} onDone={reload} />
            <DuplicateSide item={b} other={a} onDone={reload} />
          </div>
        </article>
      ))}
    </>
  );
}

function ReportsTab({ params, setFilter }) {
  const { t, path } = useI18n();
  const date = useDate();
  const status = params.status || 'open';
  const { data, loading, error, reload } = useFetch(`/admin/reports?status=${status}`);
  const { run, busy } = useAction(reload);
  return (
    <>
      <div className="seg" role="group">
        {['open', 'resolved', 'dismissed'].map((value) => (
          <button key={value} type="button" className={value === status ? 'on' : undefined} aria-pressed={value === status} onClick={() => setFilter({ status: value })}>{t(`report_status_${value}`)}</button>
        ))}
      </div>
      {loading && !data && <SkeletonCards count={1} />}
      <Status error={error} onRetry={reload} />
      {data?.items.length === 0 && <p className="state">{t('noItems')}</p>}
      {data?.items.map((report) => (
        <article className="panel" key={report.id}>
          <div className="admin-title">
            <Link className="link" to={path(`/listing/${report.listing.id}`)}>#{report.listing.id} {report.listing.title}</Link>
            <span className={`status ${report.listing.status}`}>{t(`status_${report.listing.status}`)}</span>
          </div>
          <p><b>{t(`report_${report.reason}`)}</b></p>
          {report.comment && <blockquote className="prose">{report.comment}</blockquote>}
          <p className="meta">{t('reportBy', { n: report.reporter.name })} · {date(report.createdAt)}{report.listing.openReports > 1 ? ` · ${t('openReportsOnAd', { n: report.listing.openReports })}` : ''}</p>
          {report.status === 'open' && (
            <div className="actions">
              {report.listing.status !== 'rejected' && (
                <ModerationActions url={`/admin/listings/${report.listing.id}/moderate`} status="approved" suggestedReason={t(`report_${report.reason}`)} onDone={reload} />
              )}
              <button className="btn ghost small" type="button" disabled={busy} onClick={() => run(`/admin/reports/${report.id}`, { body: { status: 'resolved' } })}>{t('reportResolve')}</button>
              <button className="btn ghost small" type="button" disabled={busy} onClick={() => run(`/admin/reports/${report.id}`, { body: { status: 'dismissed' } })}>{t('reportDismiss')}</button>
            </div>
          )}
        </article>
      ))}
    </>
  );
}

function ReviewsTab({ params, setFilter }) {
  const { t, path } = useI18n();
  const date = useDate();
  const status = params.status ?? '';
  const { data, loading, error, reload } = useFetch(`/admin/reviews${status ? `?status=${status}` : ''}`);
  return (
    <>
      <div className="seg" role="group">
        {['', 'pending', 'approved', 'rejected'].map((value) => (
          <button key={value || 'all'} type="button" className={value === status ? 'on' : undefined} aria-pressed={value === status} onClick={() => setFilter({ status: value })}>{value ? t(`status_${value}`) : t('statusAll')}</button>
        ))}
      </div>
      {loading && !data && <SkeletonCards count={1} />}
      <Status error={error} onRetry={reload} />
      {data?.items.length === 0 && <p className="state">{t('noItems')}</p>}
      {data?.items.map((review) => (
        <article className="panel" key={review.id}>
          <blockquote className="prose">{review.text}</blockquote>
          <p className="meta">{review.author.name} · {date(review.createdAt)} · <Link className="link" to={path(`/listing/${review.listing.id}`)}>{t('onAd', { t: review.listing.title })}</Link></p>
          <span className={`status ${review.status}`}>{t(`status_${review.status}`)}</span>
          <Decision item={review} />
          <div className="actions"><ModerationActions url={`/admin/reviews/${review.id}/moderate`} status={review.status} onDone={reload} /></div>
        </article>
      ))}
    </>
  );
}

function UsersTab({ params, setFilter }) {
  const { t } = useI18n();
  const date = useDate();
  const [q, setQ] = useState(params.q ?? '');
  const { data, loading, error, reload } = useFetch(`/admin/users${params.q ? `?q=${encodeURIComponent(params.q)}` : ''}`);
  const { run, busy } = useAction(reload);
  return (
    <>
      <form className="admin-filters" onSubmit={(event) => { event.preventDefault(); setFilter({ q }); }}>
        <input type="search" value={q} placeholder={t('userSearchPh')} onChange={(event) => setQ(event.target.value)} />
        <button className="btn small" type="submit">{t('search')}</button>
      </form>
      {loading && !data && <SkeletonCards count={1} />}
      <Status error={error} onRetry={reload} />
      {data?.items.length === 0 && <p className="state">{t('noItems')}</p>}
      <div className="panel user-list">
        {data?.items.map((person) => (
          <div className="user-row" key={person.id}>
            <div>
              <b>{person.name}</b>
              {person.isMe && <span className="meta"> ({t('you')})</span>}
              {person.role === 'admin' && <span className="status approved">{t('roleAdmin')}</span>}
              {person.blocked && <span className="status rejected">{t('blockedLabel')}</span>}
              <div className="meta">{person.email} · {person.phone} · {date(person.createdAt)}</div>
              <div className="meta">{t('userAds', { n: person.listingCount })}{person.reportCount > 0 ? ` · ${t('reportsCount', { n: person.reportCount })}` : ''}</div>
            </div>
            {person.role !== 'admin' && (
              <button
                className={`btn small ${person.blocked ? 'ghost' : 'danger'}`}
                type="button"
                disabled={busy}
                onClick={() => run(`/admin/users/${person.id}/block`, { body: { blocked: !person.blocked } })}
              >
                {person.blocked ? t('unblock') : t('block')}
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function LogTab() {
  const { t } = useI18n();
  const date = useDate();
  const { data, loading, error, reload } = useFetch('/admin/log');
  return (
    <section className="panel">
      <Status loading={loading && !data} error={error} onRetry={reload} />
      {data?.items.length === 0 && <p className="state">{t('noItems')}</p>}
      <ol className="log">
        {data?.items.map((entry) => (
          <li key={entry.id}>
            <span className="meta">{date(entry.createdAt)}</span>{' '}
            <b>{entry.admin ?? '—'}</b> {t(`log_${entry.action}`)} {t(`target_${entry.targetType}`)} #{entry.targetId}
            {entry.note && <span className="meta"> · {entry.note}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function AdminBody() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [search, setSearch] = useSearchParams();
  const params = Object.fromEntries(search.entries());
  const tab = TABS.includes(params.tab) ? params.tab : 'overview';
  const overview = useFetch(user.role === 'admin' ? '/admin/overview' : null);

  if (user.role !== 'admin') return <p className="state error">{t('err.forbidden')}</p>;

  const open = (next, filters = {}) => {
    setSearch({ tab: next, ...filters });
    overview.reload();
  };
  const setFilter = (changes) => setSearch(Object.fromEntries(Object.entries({ ...params, tab, ...changes }).filter(([, value]) => value)));
  const counts = overview.data ? { listings: overview.data.pendingListings, duplicates: overview.data.duplicatePairs, reports: overview.data.openReports, reviews: overview.data.pendingReviews } : {};

  return (
    <>
      <nav className="admin-tabs" aria-label={t('admin')}>
        {TABS.map((name) => (
          <button key={name} type="button" className={name === tab ? 'on' : undefined} aria-current={name === tab ? 'page' : undefined} onClick={() => open(name)}>
            {t(`tab_${name}`)}{counts[name] > 0 && <span className="badge">{counts[name]}</span>}
          </button>
        ))}
      </nav>
      {tab === 'overview' && (overview.data ? <Overview data={overview.data} onOpen={open} /> : <Status loading={overview.loading} error={overview.error} onRetry={overview.reload} />)}
      {tab === 'listings' && <ListingsTab key={params.q} params={params} setFilter={setFilter} />}
      {tab === 'duplicates' && <DuplicatesTab />}
      {tab === 'reports' && <ReportsTab params={params} setFilter={setFilter} />}
      {tab === 'reviews' && <ReviewsTab params={params} setFilter={setFilter} />}
      {tab === 'users' && <UsersTab key={params.q} params={params} setFilter={setFilter} />}
      {tab === 'log' && <LogTab />}
    </>
  );
}

export default function Admin() {
  const { t } = useI18n();
  return (
    <main className="wrap adminpage">
      <h1>{t('admin')}</h1>
      <RequireLogin><AdminBody /></RequireLogin>
    </main>
  );
}
