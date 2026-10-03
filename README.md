# Driver Parivar payments

Static page. `data.json` has purchase time, amount, role, product id, and plan type only.

## Open

From this folder:

```
python3 -m http.server 8765
```

Then open http://127.0.0.1:8765 . Opening `index.html` as a file will not load `data.json`.

Times are Asia/Kolkata. The default range is the 7 days ending at the snapshot minute. Green "current users" figures are live totals from when the snapshot was taken, not filtered by the dates.
