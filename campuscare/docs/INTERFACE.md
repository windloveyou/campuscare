# Interface and workspace organization

The active application is `campuscare/`. The independent learning prototype is preserved in
`backups/legacy-learning-20261111.tar.gz`, including its source, corpus and database.
It is an archive, not an active dependency. Its additional features have not been silently
replaced or claimed as integrated. Backups are excluded from version control.

The authenticated dashboard embeds the interactive campus map for every role. The former
map route redirects to the dashboard. Area, room, asset and reporting actions continue to
use the existing facilities module and server-side permissions.

`frontend/layout.css` defines the shared desktop and mobile layout, using locally available
Latin and Chinese fonts and explicit grid constraints. `frontend/locale.js` provides a
persistent English/Chinese switch for common navigation, controls and module labels.
User-entered records, retrieved source documents and generated answers retain their source
language; the switch does not translate database contents. Additional static messages can
be added to the dictionary as the modules evolve.

Windows verification should include Edge at 1366x768 and 1920x1080 with 100%, 125% and 150%
display scaling. This change has not been validated on a Windows host. Check sidebar text,
table scrolling, form controls, language switching and the dashboard map at those sizes.
