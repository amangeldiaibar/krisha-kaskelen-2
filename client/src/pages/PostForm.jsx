import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, useFetch, useI18n } from '../context.jsx';
import { NumberInput, PhoneInput, Status } from '../components/Shared.jsx';

const EMPTY = { title: '', deal: 'rent', price: '', rooms: '1', area: '', floor: '', floors: '', year: '', district: 'near_sdu', address: '', description: '', phone: '' };

function Form({ listing }) {
  const { lang, t, tError, path } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState(() =>
    listing
      ? Object.fromEntries(Object.keys(EMPTY).map((key) => [key, listing[key] === null || listing[key] === undefined ? '' : String(listing[key])]))
      : { ...EMPTY, phone: user?.phone ?? '' },
  );
  const [files, setFiles] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const change = (event) => setValues({ ...values, [event.target.name]: event.target.value });

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const body = new FormData();
    Object.entries(values).forEach(([key, value]) => body.append(key, value));
    body.append('lang', lang);
    files.forEach((file) => body.append('photos', file));
    try {
      const { item } = await api(listing ? `/listings/${listing.id}` : '/listings', { method: listing ? 'PUT' : 'POST', body });
      navigate(path(`/listing/${item.id}`));
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <section className="panel">
        <h2>{t('mainDetails')}</h2>
        <div className="stack" style={{ display: 'grid', gap: 14 }}>
          <label>{t('adTitle')}<input name="title" type="text" value={values.title} onChange={change} placeholder={t('adTitlePh')} required minLength={3} maxLength={120} /></label>
          <div className="row">
            <label>{t('deal')}
              <select name="deal" value={values.deal} onChange={change}>
                <option value="rent">{t('rent')}</option>
                <option value="buy">{t('buy')}</option>
              </select>
            </label>
            <label>{t('priceTenge')}<NumberInput name="price" maxDigits={11} value={values.price} onChange={change} required /></label>
          </div>
          <div className="row">
            <label>{t('rooms')}
              <select name="rooms" value={values.rooms} onChange={change}>
                <option value="0">{t('studio')}</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4+</option>
              </select>
            </label>
            <label>{t('area')}<NumberInput name="area" maxDigits={4} value={values.area} onChange={change} required /></label>
          </div>
          <div className="row">
            <label>{t('floor')}<NumberInput name="floor" maxDigits={3} value={values.floor} onChange={change} /></label>
            <label>{t('floorsInBuilding')}<NumberInput name="floors" maxDigits={3} value={values.floors} onChange={change} /></label>
          </div>
          <div className="row">
            <label>{t('yearBuilt')}<NumberInput name="year" maxDigits={4} value={values.year} onChange={change} /></label>
            <label>{t('district')}
              <select name="district" value={values.district} onChange={change}>
                <option value="near_sdu">{t('near_sdu')}</option>
                <option value="center">{t('center')}</option>
                <option value="new">{t('new')}</option>
              </select>
            </label>
          </div>
          <label>{t('address')}<input name="address" type="text" value={values.address} onChange={change} placeholder={t('addressPh')} required minLength={3} maxLength={200} /></label>
        </div>
      </section>
      <section className="panel">
        <h2>{t('description')}</h2>
        <label>{t('tellPeople')}<textarea name="description" value={values.description} onChange={change} placeholder={t('descriptionPh')} required minLength={10} maxLength={5000} /></label>
      </section>
      <section className="panel">
        <h2>{t('photos')}</h2>
        <div className="drop">
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label={t('photos')} onChange={(event) => setFiles([...event.target.files])} />
          <p className="hint">{listing ? t('photosEditHint') : t('photosHint')}</p>
        </div>
      </section>
      <section className="panel">
        <h2>{t('contacts')}</h2>
        <label>{t('ownerPhone')}<PhoneInput value={values.phone} onChange={change} required /></label>
      </section>
      {error && <p className="notice error-text" role="alert">{tError(error)}</p>}
      <button className="btn" type="submit" disabled={busy}>{listing ? t('save') : t('publish')}</button>
    </form>
  );
}

function EditLoader({ id }) {
  const { data, loading, error, reload } = useFetch(`/listings/${id}`);
  if (!data) return <Status loading={loading} error={error} onRetry={reload} />;
  return <Form listing={data.item} />;
}

export default function PostForm() {
  const { id } = useParams();
  const { user, ready } = useAuth();
  const { t, path } = useI18n();
  return (
    <main className="wrap formpage">
      <h1>{id ? t('editTitle') : t('postTitle')}</h1>
      {!ready && <Status loading />}
      {ready && !user && (
        <p className="notice">
          {t('onlyLogged')} <Link to={path('/login')}><b>{t('login')}</b></Link> {t('or')} <Link to={path('/register')}><b>{t('signup')}</b></Link> {t('first')}
        </p>
      )}
      {ready && user && (id ? <EditLoader id={id} /> : <Form />)}
    </main>
  );
}
