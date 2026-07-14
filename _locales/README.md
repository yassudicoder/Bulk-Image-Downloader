# Locales

`en` is the **source of truth** and is complete. Every user-facing string in the extension
has an `en` key.

The other locales (`es`, `de`, `fr`, `pt_BR`) are **scaffolds**: each ships a small starter
`messages.json` with the highest-visibility strings and a `TODO(<locale>)` marker in each
`description`. **Chrome automatically falls back to `default_locale` (`en`) for any key a
locale is missing**, so the extension is fully functional in every locale today — untranslated
strings simply render in English until a translator fills them in.

To translate a locale: copy keys from `en/messages.json`, translate the `message` values
(leave `extName` — the brand — untranslated), and drop the `TODO` markers. Do not translate
`placeholders` names or `$1`/`$name$` tokens.

The full i18n pass (completing these locales) is milestone **M4**.
