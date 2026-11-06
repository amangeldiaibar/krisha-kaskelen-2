import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, useI18n } from '../context.jsx';
import { PhoneInput } from '../components/Shared.jsx';

export function Login() {
  const { t, tError, path } = useI18n();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [values, setValues] = useState({ login: '', password: '' });
  const [error, setError] = useState(null);
  const change = (event) => setValues({ ...values, [event.target.name]: event.target.value });

  async function submit(event) {
    event.preventDefault();
    setError(null);
    try {
      const { user } = await api('/auth/login', { method: 'POST', body: values });
      setUser(user);
      navigate(location.state?.from ?? path());
    } catch (failure) {
      setError(failure);
    }
  }

  return (
    <main className="wrap auth">
      <h1>{t('login')}</h1>
      <p className="meta">{t('loginIntro')}</p>
      <section className="panel">
        <form className="stack" onSubmit={submit}>
          <label>{t('phoneOrEmail')}<input type="text" name="login" value={values.login} onChange={change} required maxLength={200} autoComplete="username" /></label>
          <label>{t('password')}<input type="password" name="password" value={values.password} onChange={change} required maxLength={200} autoComplete="current-password" /></label>
          {error && <p className="error-text" role="alert">{tError(error)}</p>}
          <button className="btn full" type="submit">{t('login')}</button>
        </form>
      </section>
      <p className="alt">{t('newHere')} <Link to={path('/register')} state={location.state}>{t('createAccount')}</Link></p>
    </main>
  );
}

export function Register() {
  const { t, tError, path } = useI18n();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [values, setValues] = useState({ name: '', phone: '', email: '', password: '', password2: '' });
  const [error, setError] = useState(null);
  const change = (event) => setValues({ ...values, [event.target.name]: event.target.value });
  const mismatch = values.password2 !== '' && values.password !== values.password2;

  async function submit(event) {
    event.preventDefault();
    if (mismatch) return;
    setError(null);
    try {
      const { user } = await api('/auth/register', {
        method: 'POST',
        body: { name: values.name, phone: values.phone, email: values.email, password: values.password },
      });
      setUser(user);
      navigate(location.state?.from ?? path());
    } catch (failure) {
      setError(failure);
    }
  }

  return (
    <main className="wrap auth">
      <h1>{t('createAccount')}</h1>
      <p className="meta">{t('registerIntro')}</p>
      <section className="panel">
        <form className="stack" onSubmit={submit}>
          <label>{t('fullName')}<input type="text" name="name" value={values.name} onChange={change} required minLength={2} maxLength={100} autoComplete="name" /></label>
          <label>{t('phone')}<PhoneInput value={values.phone} onChange={change} required autoComplete="tel" /></label>
          <label>{t('email')}<input type="email" name="email" value={values.email} onChange={change} required maxLength={200} autoComplete="email" /></label>
          <label>{t('password')}<input type="password" name="password" value={values.password} onChange={change} minLength={8} maxLength={200} required autoComplete="new-password" /><span className="hint">{t('atLeast8')}</span></label>
          <label>{t('repeatPassword')}<input type="password" name="password2" value={values.password2} onChange={change} minLength={8} maxLength={200} required autoComplete="new-password" /></label>
          <label className="check"><input type="checkbox" required /> {t('agree')}</label>
          {mismatch && <p className="error-text" role="alert">{t('passwordsDiffer')}</p>}
          {error && <p className="error-text" role="alert">{tError(error)}</p>}
          <button className="btn full" type="submit" disabled={mismatch}>{t('signup')}</button>
        </form>
      </section>
      <p className="alt">{t('haveAccount')} <Link to={path('/login')} state={location.state}>{t('login')}</Link></p>
    </main>
  );
}
