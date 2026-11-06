export class ApiError extends Error {
  constructor(status, code, field) {
    super(code);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const isForm = body instanceof FormData;
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      signal,
      credentials: 'same-origin',
      headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError(0, 'server_offline');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  // A page without our JSON means the request never reached the API.
  if (!data && (res.status >= 500 || res.status === 404)) throw new ApiError(res.status, 'server_offline');
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'generic', data?.field);
  return data;
}
