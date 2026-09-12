# Binder Studio — GitHub Pages edition

This edition runs entirely in the browser. Uploaded images, theme labels, and the saved order for Color, Theme, and Manual modes are stored in IndexedDB on the current device.

## Publish

1. Push the repository to GitHub using `main` as the default branch.
2. Open **Settings → Pages** in the GitHub repository.
3. Under **Build and deployment**, select **GitHub Actions** as the source.
4. Run **Deploy Binder Studio to GitHub Pages** from the Actions tab, or push another commit to `main`.

The workflow at `.github/workflows/deploy-pages.yml` publishes this `github-pages` directory.

## Storage note

GitHub Pages does not provide a server or database. Clearing browser site data removes this binder, and another browser or device gets a separate empty binder.
