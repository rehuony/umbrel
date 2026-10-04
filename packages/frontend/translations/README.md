# Updating translations

Edit English strings in `public/locales/en.json`. The generator maintains `last-translated.en.json` as a record of the last complete batch—**never edit this snapshot manually**.

## Run a batch

1. Open **Actions → Update Translations → Run workflow**. Leave the target branch empty to use the repository's default branch, or specify a development branch. Select **plan_only** to preview pending work without API calls.
2. Run generation, then review and merge its translation PR into the selected target branch. **Verify System** checks translation structure and freshness with the other source checks.
3. Rerun if English changes. The workflow reuses the open PR and preserves unchanged translations, including reviewer corrections. Resolve any merge conflicts before retrying.
