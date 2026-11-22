import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from './api.js';
import { LANGS, translate } from './i18n.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api('/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' });
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, setUser, logout }), [user, ready, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export const MAX_COMPARE = 4;
const COMPARE_KEY = 'krisha-compare';
const CompareContext = createContext(null);

const readCompare = () => {
  try {
    const ids = JSON.parse(localStorage.getItem(COMPARE_KEY) ?? '[]');
    return Array.isArray(ids) ? ids.filter(Number.isInteger).slice(0, MAX_COMPARE) : [];
  } catch {
    return [];
  }
};

/** The ads picked for comparison. They stay in this browser and follow other open tabs. */
export function CompareProvider({ children }) {
  const [ids, setIds] = useState(readCompare);

  useEffect(() => {
    const sync = (event) => {
      if (event.key === COMPARE_KEY) setIds(readCompare());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const save = useCallback((next) => {
    setIds(next);
    try {
      localStorage.setItem(COMPARE_KEY, JSON.stringify(next));
    } catch {
      // Private windows may refuse storage. The list then lasts until the page closes.
    }
  }, []);

  const value = useMemo(() => ({
    ids,
    has: (id) => ids.includes(id),
    /** Returns false when the list is already full. */
    toggle: (id) => {
      if (ids.includes(id)) {
        save(ids.filter((item) => item !== id));
        return true;
      }
      if (ids.length >= MAX_COMPARE) return false;
      save([...ids, id]);
      return true;
    },
    remove: (id) => save(ids.filter((item) => item !== id)),
    replace: (next) => save([...new Set(next)].slice(0, MAX_COMPARE)),
    clear: () => save([]),
  }), [ids, save]);
  return <CompareContext.Provider value={value}>{children}</CompareContext.Provider>;
}

export const useCompare = () => useContext(CompareContext);

const ToastContext = createContext(() => {});
const TOAST_MS = 3500;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);
  const show = useCallback((text, kind = 'ok') => {
    const id = nextId.current++;
    setToasts((items) => [...items, { id, text, kind }]);
    setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), TOAST_MS);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => <div className={`toast ${toast.kind}`} key={toast.id}>{toast.text}</div>)}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

export function useI18n() {
  const { lang: param } = useParams();
  const lang = LANGS.includes(param) ? param : 'ru';
  return useMemo(() => {
    const t = (key, vars) => translate(lang, key, vars);
    const tError = (error) => {
      const code = error?.code && translate(lang, `err.${error.code}`) !== `err.${error.code}` ? error.code : 'generic';
      const field = error?.field ? translate(lang, FIELD_LABELS[error.field] ?? error.field) : '';
      return t(`err.${code}`, { field });
    };
    return { lang, t, tError, path: (rest = '') => `/${lang}${rest}` };
  }, [lang]);
}

const FIELD_LABELS = {
  title: 'adTitle', deal: 'deal', price: 'priceTenge', rooms: 'rooms', area: 'area', floor: 'floor', floors: 'floorsInBuilding', year: 'yearBuilt', district: 'district', address: 'address', description: 'description', phone: 'phone', name: 'fullName', email: 'email', password: 'password', text: 'reviews', message: 'dealMessage', date: 'dealDateRent', reason: 'adminReason', comment: 'reportComment', query: 'smartTitle', note: 'roommateNote', topic: 'supportTopic', reply: 'supportReply', login: 'phoneOrEmail', code: 'smsCode',
};

/** Loads data with loading and error states, and drops responses that arrive late. */
export function useFetch(path) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!path) return undefined;
    const controller = new AbortController();
    setState((previous) => ({ ...previous, error: null, loading: true }));
    api(path, { signal: controller.signal })
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => {
        // A failed background refresh keeps what is already on screen.
        if (error.name !== 'AbortError') {
          setState((previous) => (previous.data ? { ...previous, loading: false } : { data: null, error, loading: false }));
        }
      });
    return () => controller.abort();
  }, [path, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return { ...state, reload };
}

/** Refreshes on a timer while `active` is true. */
export function usePolling(reload, ms, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(reload, ms);
    return () => clearInterval(timer);
  }, [reload, ms, active]);
}
