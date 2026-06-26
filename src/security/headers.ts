/**
 * Browser-like HTTP headers to reduce automation detection risk.
 * These mimic a real Chrome browser making requests to Gemini.
 */

// Chrome 135 on Windows 10 — updated periodically
const CHROME_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

const ACCEPT_LANGUAGE = 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7';

/**
 * Headers that should be added to every upstream Gemini request.
 * These are merged into the request alongside model-specific headers.
 */
export function browserHeaders(): Record<string, string> {
  return {
    'User-Agent': CHROME_USER_AGENT,
    'Accept-Language': ACCEPT_LANGUAGE,
    Accept: '*/*',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
  };
}
