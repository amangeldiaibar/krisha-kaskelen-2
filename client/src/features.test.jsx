import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, CompareProvider, ToastProvider } from './context.jsx';
import Home from './pages/Home.jsx';
import Compare from './pages/Compare.jsx';
import Admin from './pages/Admin.jsx';
import Listing from './pages/Listing.jsx';
import Support from './pages/Support.jsx';
import { ForgotPassword, ResetPassword } from './pages/Auth.jsx';
import { pageNumbers } from './components/Shared.jsx';
import ChatWidget from './components/ChatWidget.jsx';

const item = (over) => ({
  id: 1, title: 'Квартира', deal: 'rent', price: 120000, rooms: 1, area: 40, floor: 2, floors: 5, year: 2015, district: 'near_sdu', address: 'Абылай хана 12',
  description: 'd', phone: null, point: null, distanceKm: 1.2, source: { type: 'import', name: 't.me/x', url: 'https://t.me/x/1' }, photos: [], photosAreExamples: false,
  isOwner: false, canChat: false, dealStatus: 'available', canRequest: false, myRequest: null, isFavorite: false, duplicateOf: null, ...over,
});

/** Answers API calls by path, like the real server would. */
function mockApi(routes) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const path = url.replace(/^\/api/, '');
    calls.push({ path, method: options.method ?? 'GET', body: options.body ? JSON.parse(options.body) : null });
    const key = Object.keys(routes).find((prefix) => path.startsWith(prefix));
    const body = key ? (typeof routes[key] === 'function' ? routes[key](path) : routes[key]) : { error: 'not_found' };
    return { ok: Boolean(key), status: key ? 200 : 404, json: async () => body };
  }));
  return calls;
}

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

const show = (url, element, path) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <AuthProvider><ToastProvider><CompareProvider>
        <Routes><Route path={path} element={<>{element}<Where /></>} /></Routes>
      </CompareProvider></ToastProvider></AuthProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  localStorage.clear();
  // jsdom has <dialog> but cannot open it.
  HTMLDialogElement.prototype.showModal ??= function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close ??= function close() { this.open = false; };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('search by phrase', () => {
  it('sends the phrase, puts the filters in the address and shows them as chips', async () => {
    const calls = mockApi({
      '/auth/me': { user: null },
      '/search/parse': { filters: { deal: 'rent', rooms: '1', priceTo: 120000, maxKm: 1.5, features: ['furniture'] }, engine: 'ai' },
      '/listings': { sdu: { lat: 43.2, lon: 76.6 }, items: [] },
    });
    show('/ru', <Home />, '/:lang');
    fireEvent.change(screen.getByLabelText('Опишите, что ищете'), { target: { value: 'однушка до 120к рядом с SDU с мебелью' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('priceTo=120000'));
    const where = new URLSearchParams(screen.getByTestId('where').textContent.split('?')[1]);
    expect(Object.fromEntries(where)).toMatchObject({ deal: 'rent', rooms: '1', maxKm: '1.5', features: 'furniture' });
    expect(calls.find((call) => call.path === '/search/parse').body).toEqual({ query: 'однушка до 120к рядом с SDU с мебелью' });
    expect(await screen.findByText('разобрал ИИ')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Мебель/ })).toBeTruthy();
    // Removing a chip removes that filter only.
    fireEvent.click(screen.getByRole('button', { name: /Мебель/ }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).not.toContain('features'));
    expect(screen.getByTestId('where').textContent).toContain('priceTo=120000');
  });

  it('explains when nothing could be read from the phrase', async () => {
    mockApi({ '/auth/me': { user: null }, '/search/parse': { filters: {}, engine: 'rules' }, '/listings': { sdu: { lat: 43.2, lon: 76.6 }, items: [] } });
    show('/ru', <Home />, '/:lang');
    fireEvent.change(screen.getByLabelText('Опишите, что ищете'), { target: { value: 'привет' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toBe('/ru');
  });
});

describe('search pages', () => {
  it('numbers pages around the current one with gaps', () => {
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(1, 3)).toEqual([1, 2, 3]);
    expect(pageNumbers(5, 11)).toEqual([1, 'gap', 4, 5, 6, 'gap', 11]);
    expect(pageNumbers(11, 11)).toEqual([1, 'gap', 10, 11]);
  });

  it('shows the total, opens another page and keeps the filters', async () => {
    const calls = mockApi({
      '/auth/me': { user: null },
      '/listings': (path) => ({ sdu: { lat: 43.2, lon: 76.6 }, items: [item({ id: path.includes('page=2') ? 22 : 1 })], total: 45, page: path.includes('page=2') ? 2 : 1, pages: 3 }),
    });
    show('/ru?deal=rent', <Home />, '/:lang');
    expect(await screen.findByText('Найдено квартир: 45')).toBeTruthy();
    expect(screen.getByRole('button', { name: '1' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/ru?deal=rent&page=2'));
    await waitFor(() => expect(calls.some((call) => call.path === '/listings?deal=rent&page=2')).toBe(true));
    await waitFor(() => expect(screen.getByRole('button', { name: '2' }).getAttribute('aria-current')).toBe('page'));
  });
});

describe('flatmates', () => {
  it('adds the visitor to the list with a note and opens a chat with someone else on it', async () => {
    let list = [{ userId: 9, name: 'Аружан', avatar: null, note: 'Ищу соседку, 2 курс', createdAt: '2026-11-21T10:00:00Z', isMe: false }];
    const calls = mockApi({
      '/auth/me': { user: { id: 1, name: 'Dias', role: 'user' } },
      '/listings/5/roommates/9/conversation': { id: 77 },
      '/listings/5/roommates': () => ({ items: list, mine: list.some((person) => person.isMe) }),
      '/listings/5/reviews': { app: [], external: { status: 'unavailable', rating: null, count: 0, reviews: [] }, canReview: false },
      '/listings/5': { sdu: { lat: 43.2, lon: 76.6 }, item: item({ id: 5, roommateCount: 1, alsoPublished: [] }) },
    });
    show('/ru/listing/5', <Listing />, '/:lang/listing/:id');
    expect(await screen.findByText('Ищу соседку, 2 курс')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Ищу соседей/ }));
    fireEvent.change(screen.getByLabelText(/Пару слов о себе/), { target: { value: 'Не курю' } });
    list = [{ userId: 1, name: 'Dias', avatar: null, note: 'Не курю', createdAt: '2026-11-21T11:00:00Z', isMe: true }, ...list];
    fireEvent.click(screen.getByRole('button', { name: 'Добавить меня в список' }));
    await waitFor(() => expect(calls.find((call) => call.path === '/listings/5/roommates' && call.method === 'PUT')?.body).toEqual({ note: 'Не курю' }));
    expect(await screen.findByText('Вы в списке')).toBeTruthy();

    // The chat opens in the chat button's window, and the page stays.
    const opened = [];
    const onOpen = (event) => opened.push(event.detail.id);
    window.addEventListener('chat:open', onOpen);
    fireEvent.click(screen.getByRole('button', { name: 'Написать' }));
    await waitFor(() => expect(opened).toEqual([77]));
    window.removeEventListener('chat:open', onOpen);
    expect(calls.some((call) => call.path === '/listings/5/roommates/9/conversation' && call.method === 'POST')).toBe(true);
    expect(screen.getByText('Ищут соседей')).toBeTruthy();
  });
});

describe('support', () => {
  it('sends a message to the admins and shows their answer', async () => {
    let items = [{ id: 1, topic: 'listing', text: 'В объявлении неверная цена', status: 'answered', reply: 'Спасибо, исправили.', repliedAt: '2026-11-21T12:00:00Z', createdAt: '2026-11-21T10:00:00Z' }];
    const calls = mockApi({
      '/auth/me': { user: { id: 1, name: 'Dias', role: 'user' } },
      '/support': (path) => (path === '/support' ? { items } : {}),
    });
    show('/ru/support', <Support />, '/:lang/support');
    expect(await screen.findByText('Спасибо, исправили.')).toBeTruthy();
    expect(screen.getByText('Отвечено')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Тема'), { target: { value: 'idea' } });
    fireEvent.change(screen.getByLabelText('Сообщение'), { target: { value: 'Добавьте тёмную тему, пожалуйста' } });
    items = [{ id: 2, topic: 'idea', text: 'Добавьте тёмную тему, пожалуйста', status: 'open', reply: null, repliedAt: null, createdAt: '2026-11-21T13:00:00Z' }, ...items];
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ topic: 'idea', text: 'Добавьте тёмную тему, пожалуйста' }));
    expect(await screen.findByText('Ждёт ответа')).toBeTruthy();
  });

  it('lets an admin answer a message', async () => {
    const calls = mockApi({
      '/auth/me': { user: { id: 1, name: 'Admin', role: 'admin' } },
      '/admin/overview': { pendingListings: 0, rejectedListings: 0, liveListings: 3, pendingReviews: 0, rejectedReviews: 0, openReports: 0, openTickets: 1, users: 2, blockedUsers: 0, duplicatePairs: 0, sources: {} },
      '/admin/support/4': { status: 'answered' },
      '/admin/support': { items: [{ id: 4, topic: 'question', text: 'Как добавить фото?', status: 'open', reply: null, repliedBy: null, repliedAt: null, createdAt: '2026-11-21T10:00:00Z', author: { id: 2, name: 'Аружан', email: 'a@x.kz', phone: '+77001112244' } }] },
    });
    show('/ru/admin?tab=support', <Admin />, '/:lang/admin');
    expect(await screen.findByText('Как добавить фото?')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Ваш ответ'), { target: { value: 'Нажмите «Редактировать».' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ответить' }));
    await waitFor(() => expect(calls.find((call) => call.path === '/admin/support/4')?.body).toEqual({ reply: 'Нажмите «Редактировать».' }));
  });
});

describe('forgot password', () => {
  it('asks for a link and says it was sent without telling whether the account exists', async () => {
    const calls = mockApi({ '/auth/me': { user: null }, '/auth/forgot': { sent: true } });
    show('/ru/forgot', <ForgotPassword />, '/:lang/forgot');
    fireEvent.change(await screen.findByLabelText(/email/i), { target: { value: 'a@x.kz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить ссылку' }));
    expect(await screen.findByText(/мы отправили ссылку на его почту/)).toBeTruthy();
    expect(calls.find((call) => call.path === '/auth/forgot').body).toEqual({ login: 'a@x.kz', lang: 'ru' });
  });

  it('sets the new password from the link and checks both fields match', async () => {
    const calls = mockApi({ '/auth/me': { user: null }, '/auth/reset': { user: { id: 1, name: 'Dias', role: 'user' } } });
    const token = 'a'.repeat(64);
    show(`/ru/reset?token=${token}`, <ResetPassword />, '/:lang/reset');
    fireEvent.change(await screen.findByLabelText(/^Новый пароль/), { target: { value: 'new-password-1' } });
    fireEvent.change(screen.getByLabelText('Повторите пароль'), { target: { value: 'other-password' } });
    expect(screen.getByText('Пароли не совпадают.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Повторите пароль'), { target: { value: 'new-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить и войти' }));
    await waitFor(() => expect(calls.find((call) => call.path === '/auth/reset')?.body).toEqual({ token, password: 'new-password-1' }));
  });
});

describe('comparison page', () => {
  it('loads a shared link, marks the best values and removes an ad', async () => {
    const calls = mockApi({
      '/auth/me': { user: null },
      '/listings/compare': (path) => ({
        items: [
          { ...item({ id: 3, price: 150000, area: 50, distanceKm: 2.5 }), pricePerM2: 3000, reviewCount: 2, amenities: { furniture: true, pets: null, internet: false } },
          { ...item({ id: 7, price: 100000, area: 30, distanceKm: 0.8 }), pricePerM2: 3333, reviewCount: 0, amenities: { furniture: null, pets: null, internet: true } },
        ].filter((entry) => path.includes(String(entry.id))),
      }),
    });
    show('/ru/compare?ids=3,7', <Compare />, '/:lang/compare');
    const table = await screen.findByRole('table');
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/ru/compare'));
    expect(calls.some((call) => call.path === '/listings/compare?ids=3,7')).toBe(true);
    const row = (label) => within(table).getByRole('rowheader', { name: label }).closest('tr');
    expect(row('Цена').querySelector('.best').textContent).toContain('100 000');
    expect(row('Цена за м²').querySelector('.best').textContent).toContain('3 000');
    expect(row('До SDU').querySelector('.best').textContent).toContain('0.8');
    expect(within(row('Мебель')).getByText(/Есть/)).toBeTruthy();
    expect(within(row('Интернет')).getByText(/Нет/)).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('krisha-compare'))).toEqual([3, 7]);

    fireEvent.click(within(table).getAllByRole('button', { name: 'Убрать' })[0]);
    await waitFor(() => expect(JSON.parse(localStorage.getItem('krisha-compare'))).toEqual([7]));
    expect(await screen.findByText('Добавьте ещё одно объявление для сравнения.')).toBeTruthy();
  });
});

describe('admin panel', () => {
  it('is refused to ordinary users', async () => {
    mockApi({ '/auth/me': { user: { id: 1, name: 'A', role: 'user' } } });
    show('/ru/admin', <Admin />, '/:lang/admin');
    expect(await screen.findByText('У вас нет доступа к этой странице.')).toBeTruthy();
  });

  it('lets an admin delete a broken ad straight from the search results', async () => {
    let items = [item({ id: 5, title: 'Сломанное объявление' })];
    const calls = mockApi({
      '/auth/me': { user: { id: 1, name: 'Admin', role: 'admin' } },
      '/admin/listings/5': () => {
        items = [];
        return {};
      },
      '/listings': () => ({ sdu: { lat: 43.2, lon: 76.6 }, items }),
    });
    show('/ru', <Home />, '/:lang');
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }));
    expect(screen.getByText('Удалить объявление №5 навсегда? Вместе с ним удалятся фото, отзывы и чаты.')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Удалить' }).at(-1));
    await waitFor(() => expect(calls.some((call) => call.path === '/admin/listings/5' && call.method === 'DELETE')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull());
  });

  it('lets a guest open the original ad without signing in', async () => {
    mockApi({ '/auth/me': { user: null }, '/listings': { sdu: { lat: 43.2, lon: 76.6 }, items: [item({ id: 5 })] } });
    show('/ru', <Home />, '/:lang');
    const open = await screen.findByRole('link', { name: 'Открыть' });
    expect(open.getAttribute('href')).toBe('https://t.me/x/1');
  });

  it('writes "from" only before the price of a developer layout', async () => {
    mockApi({ '/auth/me': { user: null }, '/listings': { sdu: { lat: 43.2, lon: 76.6 }, items: [
      item({ id: 5, deal: 'buy', price: 19999990 }),
      item({ id: 6, deal: 'buy', price: 30331500, priceFrom: true }),
    ] } });
    show('/ru', <Home />, '/:lang');
    expect(await screen.findByText('от 30 331 500 ₸')).toBeTruthy();
    expect(screen.getByText('19 999 990 ₸')).toBeTruthy();
  });

  it('names Telegram channels simply as Telegram and keeps the open button short', async () => {
    mockApi({ '/auth/me': { user: { id: 2, name: 'Dias', role: 'user' } }, '/listings': { sdu: { lat: 43.2, lon: 76.6 }, items: [item({ id: 5 })] } });
    show('/ru', <Home />, '/:lang');
    expect(await screen.findByText('Источник: Telegram')).toBeTruthy();
    const open = screen.getByRole('link', { name: 'Открыть' });
    expect(open.getAttribute('href')).toBe('https://t.me/x/1');
    expect(open.getAttribute('title')).toBe('Открыть на Telegram');
  });

  it('does not show the delete button to ordinary visitors', async () => {
    mockApi({ '/auth/me': { user: null }, '/listings': { sdu: { lat: 43.2, lon: 76.6 }, items: [item({ id: 5 })] } });
    show('/ru', <Home />, '/:lang');
    await screen.findAllByText(/120 000/);
    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull();
  });

  it('filters ads by missing details and shows what each ad lacks', async () => {
    const row = (id, over) => ({ id, title: `Объявление ${id}`, deal: 'rent', price: 120000, rooms: 1, area: 38, floor: 2, address: 'Абылай хана 12', description: 'текст', status: 'approved', source: { type: 'import', name: 'krisha.kz', url: 'https://krisha.kz/a/show/1' }, cover: null, owner: null, reportCount: 0, duplicateOf: null, createdAt: '2026-11-20T10:00:00Z', photoCount: 4, distanceKm: 1.2, missing: [], ...over });
    const calls = mockApi({
      '/auth/me': { user: { id: 1, name: 'Admin', role: 'admin' } },
      '/admin/listings': (path) => ({
        items: path.includes('data=no_point') ? [row(8, { distanceKm: null, photoCount: 0, missing: ['point', 'photos'] })] : [row(7)],
        total: 1, page: 1, pageSize: 50,
      }),
    });
    show('/ru/admin?tab=listings', <Admin />, '/:lang/admin');
    expect(await screen.findByText('До SDU: 1.2 км')).toBeTruthy();
    expect(screen.getByText('Фото: 4')).toBeTruthy();
    expect(screen.getByText('Все данные на месте')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Все данные'), { target: { value: 'no_point' } });
    expect(await screen.findByText('Не хватает: расстояния до SDU, фото')).toBeTruthy();
    expect(calls.some((call) => call.path === '/admin/listings?data=no_point')).toBe(true);
    expect(screen.getByTestId('where').textContent).toContain('data=no_point');
  });

  it('makes a user an admin after a confirmation', async () => {
    const calls = mockApi({
      '/auth/me': { user: { id: 1, name: 'Admin', role: 'admin' } },
      '/admin/overview': { pendingListings: 0, rejectedListings: 0, liveListings: 3, pendingReviews: 0, rejectedReviews: 0, openReports: 0, openTickets: 0, users: 2, blockedUsers: 0, duplicatePairs: 0, sources: {} },
      '/admin/users/2/admin': { role: 'admin' },
      '/admin/users': { items: [
        { id: 1, name: 'Admin', email: 'a@x.kz', phone: '+77001112233', role: 'admin', blocked: false, createdAt: '2026-11-20T10:00:00Z', listingCount: 0, reportCount: 0, isMe: true },
        { id: 2, name: 'Аружан', email: 'b@x.kz', phone: '+77001112244', role: 'user', blocked: false, createdAt: '2026-11-20T10:00:00Z', listingCount: 1, reportCount: 0, isMe: false },
      ] },
    });
    show('/ru/admin?tab=users', <Admin />, '/:lang/admin');
    // No button on one's own row.
    const buttons = await screen.findAllByRole('button', { name: 'Назначить администратором' });
    expect(buttons.length).toBe(1);
    fireEvent.click(buttons[0]);
    expect(screen.getByText('Назначить Аружан администратором?')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Назначить администратором' }).at(-1));
    await waitFor(() => expect(calls.find((call) => call.path === '/admin/users/2/admin')?.body).toEqual({ admin: true, sections: ['listings', 'reviews', 'support', 'users'] }));
  });

  it('gives a new admin only the ticked sections, and hides other tabs from them', async () => {
    const calls = mockApi({
      '/auth/me': { user: { id: 1, name: 'Admin', role: 'admin' } },
      '/admin/overview': { pendingListings: 0, rejectedListings: 0, liveListings: 3, pendingReviews: 0, rejectedReviews: 0, openReports: 0, openTickets: 0, users: 2, blockedUsers: 0, duplicatePairs: 0, sources: {} },
      '/admin/users/2/admin': { role: 'admin', sections: ['reviews'] },
      '/admin/users': { items: [
        { id: 2, name: 'Аружан', email: 'b@x.kz', phone: '+77001112244', role: 'user', adminSections: [], blocked: false, createdAt: '2026-11-20T10:00:00Z', listingCount: 1, reportCount: 0, isMe: false },
      ] },
    });
    show('/ru/admin?tab=users', <Admin />, '/:lang/admin');
    fireEvent.click(await screen.findByRole('button', { name: 'Назначить администратором' }));
    for (const name of ['Объявления и экран: модерация, удаление, дубликаты, жалобы', 'Обращения в службу заботы', 'Пользователи: блокировка']) {
      fireEvent.click(screen.getByLabelText(name));
    }
    fireEvent.click(screen.getAllByRole('button', { name: 'Назначить администратором' }).at(-1));
    await waitFor(() => expect(calls.find((call) => call.path === '/admin/users/2/admin')?.body).toEqual({ admin: true, sections: ['reviews'] }));
  });

  it('shows a limited admin only their tabs', async () => {
    mockApi({
      '/auth/me': { user: { id: 3, name: 'Helper', role: 'admin', adminScopes: ['reviews'] } },
      '/admin/overview': { pendingListings: 1, rejectedListings: 0, liveListings: 3, pendingReviews: 2, rejectedReviews: 0, openReports: 0, openTickets: 0, users: 2, blockedUsers: 0, duplicatePairs: 0, sources: {} },
    });
    show('/ru/admin', <Admin />, '/:lang/admin');
    expect(await screen.findByRole('button', { name: /Отзывы/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Пользователи/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Объявления/ })).toBeNull();
  });

  it('shows counts and merges a duplicate pair', async () => {
    const summary = (id, source) => ({ id, title: `Объявление ${id}`, deal: 'rent', price: 120000, rooms: 1, area: 38, floor: null, address: 'Абылай хана 12', description: 'текст', status: 'approved', source, cover: null, owner: null, reportCount: 0, duplicateOf: null, createdAt: '2026-11-20T10:00:00Z' });
    const calls = mockApi({
      '/auth/me': { user: { id: 1, name: 'Admin', role: 'admin' } },
      '/admin/overview': { pendingListings: 2, rejectedListings: 0, liveListings: 15, pendingReviews: 0, rejectedReviews: 0, openReports: 1, users: 4, blockedUsers: 0, duplicatePairs: 1, sources: { krisha: 10, telegram: 5 } },
      '/admin/duplicates/merge': { keepId: 4, duplicateId: 9 },
      '/admin/duplicates': { items: [{ a: summary(4, { type: 'import', name: 'krisha.kz', url: 'https://krisha.kz/a/show/1' }), b: summary(9, { type: 'import', name: 't.me/x', url: 'https://t.me/x/9' }), score: 0.83, reasons: ['same_place', 'same_area'] }], total: 1 },
    });
    show('/ru/admin', <Admin />, '/:lang/admin');
    expect(await screen.findByText('Возможные дубли')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Возможные дубли/ }));
    expect(await screen.findByText('Совпадение 83%')).toBeTruthy();
    expect(screen.getByText('тот же адрес')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Оставить это' })[0]);
    await waitFor(() => expect(calls.find((call) => call.path === '/admin/duplicates/merge')?.body).toEqual({ keepId: 4, duplicateId: 9 }));
  });
});

describe('chat button', () => {
  it('shows unread messages, a preview of a new one, and the whole chat in its window', async () => {
    const streams = [];
    vi.stubGlobal('EventSource', class { constructor() { streams.push(this); } close() {} });
    let unread = 2;
    const calls = mockApi({
      '/auth/me': { user: { id: 1, name: 'Dias', role: 'user' } },
      '/conversations/7/messages': (path) => (path.endsWith('/messages') ? { title: 'Квартира у SDU', listingId: 5, otherName: 'Аружан', otherAvatar: null, items: [{ id: 1, text: 'Здравствуйте', isMine: false, createdAt: '2026-11-22T09:00:00Z' }] } : {}),
      '/conversations/7/read': () => { unread = 0; return {}; },
      '/conversations': () => ({ unread, items: [{ id: 7, listingId: 5, title: 'Квартира у SDU', otherName: 'Аружан', otherAvatar: null, lastMessage: 'Здравствуйте', lastAt: '2026-11-22T09:00:00Z', lastMine: false, unread, flatmate: false }] }),
    });
    show('/ru', <ChatWidget />, '/:lang');
    const button = await screen.findByRole('button', { name: 'Непрочитанных сообщений: 2' });
    expect(button.textContent).toContain('2');

    streams[0].onmessage({ data: JSON.stringify({ type: 'message', conversationId: 7, senderId: 9, senderName: 'Аружан', text: 'Квартира ещё свободна?' }) });
    expect(await screen.findByText('Новое сообщение от Аружан')).toBeTruthy();

    fireEvent.click(screen.getByText('Квартира ещё свободна?'));
    expect(await screen.findByRole('dialog', { name: 'Сообщения' })).toBeTruthy();
    expect(await screen.findByText('Здравствуйте', { selector: '.cw-bubble span' })).toBeTruthy();
    await waitFor(() => expect(calls.some((call) => call.path === '/conversations/7/read' && call.method === 'POST')).toBe(true));

    fireEvent.change(screen.getByLabelText('Напишите сообщение'), { target: { value: 'Да' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(calls.find((call) => call.path === '/conversations/7/messages' && call.method === 'POST')?.body).toEqual({ text: 'Да' }));
  });
});
