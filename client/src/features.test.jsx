import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, CompareProvider, ToastProvider } from './context.jsx';
import Home from './pages/Home.jsx';
import Compare from './pages/Compare.jsx';
import Admin from './pages/Admin.jsx';

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

  it('does not show the delete button to ordinary visitors', async () => {
    mockApi({ '/auth/me': { user: null }, '/listings': { sdu: { lat: 43.2, lon: 76.6 }, items: [item({ id: 5 })] } });
    show('/ru', <Home />, '/:lang');
    await screen.findAllByText(/120 000/);
    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull();
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
