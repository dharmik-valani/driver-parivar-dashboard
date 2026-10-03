# Driver Parivar payments

Static page. `data.json` has purchase time, amount, role, product id, and plan type only.

## Open

From this folder:

```
python3 -m http.server 8765
```

Then open http://127.0.0.1:8765 . Opening `index.html` as a file will not load `data.json`.

Times are Asia/Kolkata. On load the page asks the live payment function for the last 7 days. If that call fails, it uses data.json instead. Green current-user figures are not filtered by the dates.
