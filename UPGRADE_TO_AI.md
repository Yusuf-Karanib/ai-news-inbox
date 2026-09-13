# Later upgrade to paid AI

Do not rebuild the automation.

Keep:

- Supabase tables and schedule.
- Telegram bot and rating buttons.
- News IDs, history, topic weights, and delivery logic.

Replace the local analysis and beginner-explanation rules:

```text
feeds -> local rules -> database -> beginner formatter -> Telegram
feeds -> paid AI analysis and explanation -> database -> Telegram
```

The paid version must preserve the same topic, importance, action, and source-status fields used for filtering. This makes the swap small and reversible.
