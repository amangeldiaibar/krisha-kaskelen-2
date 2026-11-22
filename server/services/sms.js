/**
 * Sends text messages through Mobizon (mobizon.kz), which delivers to Kazakhstan numbers.
 * Without a key, messages are printed to the server console, which is enough for local work.
 */
export function createSms({ apiKey, apiUrl = 'https://api.mobizon.kz', fetchImpl = fetch, log = console }) {
  if (!apiKey) {
    return {
      configured: false,
      async send({ to, text }) {
        log.log(`[sms] MOBIZON_API_KEY is not set, so this SMS was not sent.\nTo: ${to}\n${text}\n`);
      },
    };
  }
  return {
    configured: true,
    async send({ to, text }) {
      const url = new URL('/service/message/sendsmsmessage', apiUrl);
      url.searchParams.set('output', 'json');
      url.searchParams.set('apiKey', apiKey);
      const res = await fetchImpl(url, {
        method: 'POST',
        body: new URLSearchParams({ recipient: to.replace(/\D/g, ''), text }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json().catch(() => null);
      // Mobizon answers 200 with its own code; 0 means the message was accepted.
      if (!res.ok || data?.code !== 0) throw new Error(`Mobizon refused the SMS: ${data?.message ?? res.status}`);
    },
  };
}
