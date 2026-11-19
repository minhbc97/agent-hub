/** Failed request; `key` is the i18n key the UI shows (also the message, for logs and curl). */
export class HttpError extends Error {
  constructor(
    public status: number,
    public key: string,
    public params?: Record<string, string | number>,
  ) {
    super(key);
  }
}
