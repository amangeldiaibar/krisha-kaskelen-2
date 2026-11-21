/** An error the API turns into a JSON answer with this status and code. */
export class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

/** A 422 that names the form field to fix. */
export const fieldError = (field) => Object.assign(new HttpError(422, 'invalid_field'), { field });

/** A whole number in range, null when empty, and undefined when it is not valid. */
export const toInt = (value, min, max) => {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : undefined;
};

/** An id from the URL. Anything that cannot be a row id is simply not found. */
export const idParam = (value) => {
  const id = toInt(value, 1, 2_147_483_647);
  if (!id) throw new HttpError(404, 'not_found');
  return id;
};
