# Cleaned ECD facility list

`ecd_location.csv` is the final cleaned NCDA ECD list
(`ecd_location_TableToExcel.xlsx`, sheet `ecd_location`, 31,984 rows), reduced to the
columns `scripts/apply-ecd-sheet.ts` needs. Supervisor names, phones and e-mails are
left out. Values are trimmed; dates are `YYYY-MM-DD`.

| column | sheet header |
| --- | --- |
| objectid | OBJECTID |
| ecd_code | ECD Code (legacy `DDSSCCVV/YYYY/NN`) |
| name | 1. Name of the ECD Service Centre |
| province, district, sector, cell, village | Province, District, Sector, Cell, Village |
| start_date | 5. Start Year of the ECD Services Centre/Year of Establishment |
| settings_types | 12. Type of Settings |
| settings_types_temp | settings_types_temp |
| active | 4. Active/ Not Active |
| data_check | Data Check (`Checked` / `Remove` / empty) |

The sheet's latitude/longitude are rounded to one decimal and are not used.

Order of operations:

1. `npx prisma migrate deploy` (NCDA coding migrations 20261021120000–150000)
2. `npm run import:minaloc-codes -- --apply`
3. `npm run apply:ecd-sheet` (dry run, writes `ecd-sheet-report.csv`), review, then
   `npm run apply:ecd-sheet -- --apply`
