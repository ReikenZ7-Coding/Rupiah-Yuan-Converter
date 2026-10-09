# Rupiah ⇄ Yuan Converter

A small web app that converts Indonesian Rupiah (IDR) to Chinese Yuan (CNY) and back, using the latest exchange rate. Plain HTML, CSS and JavaScript: no build step, no dependencies, no API key.

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
python -m http.server 8080   # then visit http://localhost:8080
```

## Install it as an app

It's a Progressive Web App: once it's served over HTTPS, you can install it and it launches full-screen from your home screen or desktop, and works offline (with the last saved rate).

- **Android / Chrome / Edge:** open the page, then use the browser's **Install app** prompt (or menu → *Install app* / *Add to Home screen*).
- **iPhone / iPad:** open the page in Safari, tap **Share → Add to Home Screen**.

### Hosting it (GitHub Pages)

`.github/workflows/pages.yml` runs the tests and, on pushes to `main`, publishes the app to GitHub Pages. One-time setup: in the repo go to **Settings → Pages → Build and deployment → Source: GitHub Actions**. The app is then served at `https://<owner>.github.io/<repo>/`. Any static host works too, as long as it uses HTTPS (`localhost` also counts, for testing).

Offline support lives in `sw.js`. If you add or rename a file, add it to the `SHELL` list there and bump `CACHE_VERSION`.

## How it works

- Type in either box and the other updates. Swap (⇅) changes which currency is on top.
- Amounts can be typed Indonesian style (`1.234.567,5`), US style (`1,234,567.5`) or plain (`1234.5`). A single separator followed by exactly three digits is read as a thousands separator, so `1.500` is 1,500.
- The rate is fetched when the page loads, every 5 minutes, when the tab becomes visible again after being hidden for that long, and when you press **Refresh**.
- Several free, key-less sources are tried in turn (open.er-api.com, the fawazahmed0 currency-api and its mirror, frankfurter.dev). The first sensible answer wins; rates outside 100–100,000 IDR per CNY are rejected.
- The last good rate is saved in `localStorage`, so the app still works offline and shows that the rate is from the cache.

**About "live":** these free sources publish mid-market rates that update about once a day, not tick by tick. The app shows when it last fetched and the date the source says the rate is from. Rates are for reference only. Banks and money changers add a margin.

## Tests

```bash
node --test tests/converter.test.js
```

Covers amount parsing, formatting, conversion and the provider fallback and timeout logic (with a mocked `fetch`).

## Files

| File | Purpose |
| --- | --- |
| `converter.js` | Pure logic (parsing, formatting, conversion, rate fetching); works in the browser and Node |
| `app.js` | DOM wiring, refresh timer, caching |
| `index.html`, `style.css` | UI, with light and dark themes |
| `manifest.webmanifest`, `icons/` | Install metadata and app icons (`icon.svg` is the source for the PNGs) |
| `sw.js` | Service worker: caches the app shell for offline use |
