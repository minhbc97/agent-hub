/** Expected business-rule failure from logic code; the HTTP layer turns it into a 400 with this i18n key. */
export class DomainError extends Error {
  constructor(
    public key: string,
    public params?: Record<string, string | number>,
  ) {
    super(key);
  }
}
