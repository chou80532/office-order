# Third Party Notices

This file records external resources and summarizes dependency attribution. Package-by-package license findings are in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## Browser loaded resources

- **Font Awesome Free 6.7.2** is loaded from cdnjs for the existing `fa-*` interface icons. Font Awesome says its Free assets are usable in Open Source projects and asks users to retain attribution. Review the [Font Awesome Free license](https://fontawesome.com/license/free) and [Font Awesome versions](https://fontawesome.com/versions) before publishing.
- **DM Sans** and **Noto Sans TC** are requested from Google Fonts. Google says its font families are released under Open Source licenses; verify the license for each selected family before self-hosting or redistributing font files. See [Google Fonts](https://developers.google.com/fonts).

The browser makes requests to these providers when the app loads. Operators may replace the CDN links in `index.html` with self-hosted assets after reviewing each asset license and attribution requirement.

## npm packages

Direct runtime and development package licenses, including relevant transitive dependency findings, are listed in `THIRD_PARTY_LICENSES.md`. The inventory records technical evidence; it is not a legal opinion.

## Project assets

The repository includes the Office Order SVG icon. Store and menu images are supplied by each deployment operator and are not included in this repository.
