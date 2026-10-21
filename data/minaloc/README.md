# MINALOC administrative codes

`villages.csv` is the NCDA coding delimitation sheet
("Rwandan_delimitation_Data_as_ NCDA CODING", sheet `Codes all`, 14,843 villages),
converted with names trimmed and codes zero-padded:
province 2, district 4, sector 6, cell 8, village 10 digits.

`name-overrides.json` maps an official code to the name used in the database when
spellings differ, per level, e.g. `{ "sector": { "050701": "Gashora " } }`.
Add entries only after reviewing the import report.

Load with `npm run import:minaloc-codes` (dry run) and `-- --apply`.
